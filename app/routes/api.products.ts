import type { LoaderFunctionArgs } from "@remix-run/node";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { adminGraphql } from "~/lib/admin-api.server";
import { getSettings } from "~/models/settings.server";
import { authenticate } from "~/shopify.server";

/**
 * Fetch eligible gift products for a given max price.
 * Uses the OAuth session stored in Prisma — no static token needed.
 * Excludes products in collections marked as excluded in app settings.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return corsJson({ error: "App proxy session is unavailable.", products: [] }, { status: 401 });
  }

  const url = new URL(request.url);
  const shop = session.shop;
  const maxPrice = parseInt(url.searchParams.get("maxPrice") || "0");

  if (maxPrice <= 0) {
    return corsJson({ products: [] });
  }

  // Load excluded collections and tags from settings
  let excludedCollectionIds: string[] = [];
  let excludedTags: string[] = [];
  if (shop) {
    try {
      const settings = await getSettings(shop);
      excludedCollectionIds = settings.excludedCollections || [];
      excludedTags = settings.excludedTags || [];
    } catch (e) {
      console.warn("[api.products] Failed to load settings:", e);
    }
  }

  const query = `#graphql
    query GetGiftProducts($first: Int!, $after: String) {
      products(first: $first, after: $after, query: "status:active") {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          title
          status
          tags
          featuredImage {
            url
          }
          collections(first: 250) {
            edges {
              node {
                id
              }
            }
          }
          variants(first: 10) {
            nodes {
              id
              legacyResourceId
              title
              price
              availableForSale
            }
          }
        }
      }
    }
  `;

  try {
    const products: any[] = [];
    let cursor: string | null = null;
    let hasNextPage = true;
    let pageCount = 0;
    const maxPages = 20; // 20 × 250 = 5000 products max

    while (hasNextPage && pageCount < maxPages) {
      const data: any = await adminGraphql(query, { first: 250, after: cursor }, shop);

      if (data.errors) {
        console.error("[api.products] GraphQL errors:", JSON.stringify(data.errors));
        break;
      }

      const allProducts = data.data?.products?.nodes || [];
      hasNextPage = data.data?.products?.pageInfo?.hasNextPage || false;
      cursor = data.data?.products?.pageInfo?.endCursor || null;
      pageCount++;

      for (const product of allProducts) {
        if (product.status !== "ACTIVE") continue;

        // Check if product is in any excluded collection
        if (excludedCollectionIds.length > 0) {
          const productCollectionIds = (product.collections?.edges || []).map(
            (e: any) => e.node.id,
          );
          const isExcluded = productCollectionIds.some((id: string) =>
            excludedCollectionIds.includes(id),
          );
          if (isExcluded) continue;
        }

        // Check if product has any excluded tag
        if (excludedTags.length > 0) {
          const productTags = product.tags || [];
          const hasExcludedTag = productTags.some((tag: string) =>
            excludedTags.includes(tag),
          );
          if (hasExcludedTag) continue;
        }

        for (const variant of product.variants?.nodes || []) {
          const priceCents = Math.round(parseFloat(variant.price || "0") * 100);

          if (
            variant.availableForSale &&
            priceCents > 0 &&
            priceCents <= maxPrice
          ) {
            products.push({
              productId: product.id,
              variantId: variant.legacyResourceId.toString(),
              title:
                variant.title === "Default Title"
                  ? product.title
                  : `${product.title} — ${variant.title}`,
              price: priceCents,
              image: product.featuredImage?.url || "",
            });
          }
        }
      }
    }

    console.log(`[api.products] maxPrice=${maxPrice}, excluded=${excludedCollectionIds.length} collections, ${excludedTags.length} tags, scanned ${pageCount} pages, found ${products.length} eligible variants`);
    return corsJson({ products });
  } catch (e) {
    console.error("[api.products] Error:", e);
    return corsJson({ products: [] });
  }
}
