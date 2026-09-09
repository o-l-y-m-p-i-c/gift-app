import type { LoaderFunctionArgs } from "@remix-run/node";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { adminGraphql, getAdminConfig } from "~/lib/admin-api.server";

/**
 * Fetch eligible gift products for a given max price.
 * Uses the static Admin API access token — no sessions needed.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const url = new URL(request.url);
  const maxPrice = parseInt(url.searchParams.get("maxPrice") || "0");

  if (maxPrice <= 0) {
    return corsJson({ products: [] });
  }

  const config = getAdminConfig();
  if (!config) {
    console.error("[api.products] SHOPIFY_ADMIN_ACCESS_TOKEN not configured");
    return corsJson({ products: [] });
  }

  const query = `#graphql
    query GetGiftProducts($first: Int!) {
      products(first: $first, query: "status:active") {
        nodes {
          id
          title
          status
          featuredImage {
            url
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

    console.log(`[api.products] maxPrice=${maxPrice}, found ${products.length} eligible variants`);
    return corsJson({ products });
  } catch (e) {
    console.error("[api.products] Error:", e);
    return corsJson({ products: [] });
  }
}
