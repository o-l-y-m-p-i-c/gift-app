import type { LoaderFunctionArgs } from "@remix-run/node";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { authenticate } from "~/shopify.server";

/**
 * Fetch eligible gift products for a given max price.
 * Uses Shopify Admin API (with session access token) to query products.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const url = new URL(request.url);
  const maxPrice = parseInt(url.searchParams.get("maxPrice") || "0");

  if (maxPrice <= 0) {
    return corsJson({ products: [] });
  }

  // Get the shop's session to access Admin API
  const { admin, session } = await authenticate.public.appProxy(request);

  if (!admin || !session) {
    console.error("[api.products] No offline session for app proxy request");
    return corsJson({ products: [] });
  }

  // Query products via Admin GraphQL API
  // maxPrice is in cents, Admin API expects decimal
  const maxPriceDecimal = (maxPrice / 100).toFixed(2);

  const query = `#graphql
    query GetGiftProducts($query: String!) {
      productVariants(first: 20, query: $query) {
        nodes {
          legacyResourceId
          title
          price
          availableForSale
          product {
            id
            title
            status
            featuredImage {
              url
            }
          }
        }
      }
    }
  `;

  try {
    const res = await admin.graphql(query, {
      variables: { query: `price:<=${maxPriceDecimal}` },
    });
    const data: any = await res.json();

    if (data.errors) {
      console.error("[api.products] GraphQL errors:", data.errors);
      return corsJson({ products: [] });
    }

    const products = (data.data?.productVariants?.nodes || [])
      .filter((variant: any) => {
        const priceCents = Math.round(parseFloat(variant.price || "0") * 100);
        return (
          variant.availableForSale &&
          variant.product.status === "ACTIVE" &&
          priceCents > 0 &&
          priceCents <= maxPrice
        );
      })
      .map((variant: any) => ({
        productId: variant.product.id,
        variantId: variant.legacyResourceId.toString(),
        title:
          variant.title === "Default Title"
            ? variant.product.title
            : `${variant.product.title} — ${variant.title}`,
        price: Math.round(parseFloat(variant.price || "0") * 100),
        image: variant.product.featuredImage?.url || "",
      }));

    return corsJson({ products });
  } catch (e) {
    console.error("[api.products] Error:", e);
    return corsJson({ products: [] });
  }
}
