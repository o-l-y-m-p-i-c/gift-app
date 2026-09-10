import type { LoaderFunctionArgs } from "@remix-run/node";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { adminGraphql, getAdminConfig } from "~/lib/admin-api.server";
import { getSettings } from "~/models/settings.server";

/**
 * Fetch eligible gift products for a given max price.
 * Uses the static Admin API access token — no sessions needed.
 * Excludes products in collections marked as excluded in app settings.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") || "";
  const maxPrice = parseInt(url.searchParams.get("maxPrice") || "0");

  if (maxPrice <= 0) {
    return corsJson({ products: [] });
  }

  const config = getAdminConfig();
  if (!config) {
    console.error("[api.products] SHOPIFY_ADMIN_ACCESS_TOKEN not configured");
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
    query GetGiftProducts($first: Int!) {
      products(first: $first, query: "status:active") {
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
    const data: any = await adminGraphql(query, { first: 50 });

    if (data.errors) {
      console.error("[api.products] GraphQL errors:", JSON.stringify(data.errors));
      return corsJson({ products: [] });
    }

    const allProducts = data.data?.products?.nodes || [];

    const products: any[] = [];
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

    console.log(`[api.products] maxPrice=${maxPrice}, excluded=${excludedCollectionIds.length} collections, ${excludedTags.length} tags, found ${products.length} eligible variants`);
    return corsJson({ products });
  } catch (e) {
    console.error("[api.products] Error:", e);
    return corsJson({ products: [] });
  }
}
