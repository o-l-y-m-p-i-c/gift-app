import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";
import { corsJson, handleCorsPreflight } from "~/lib/cors";

/**
 * Fetch eligible gift products for a given max price.
 * Uses Shopify Admin API (with session access token) to query products.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const maxPrice = parseInt(url.searchParams.get("maxPrice") || "0");

  if (!shop || maxPrice <= 0) {
    return corsJson({ products: [] });
  }

  // Get the shop's session to access Admin API
  const session = await prisma.session.findFirst({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  if (!session) {
    console.error("[api.products] No session for shop:", shop);
    return corsJson({ products: [] });
  }

  // Query products via Admin GraphQL API
  // maxPrice is in cents, Admin API expects decimal
  const maxPriceDecimal = (maxPrice / 100).toFixed(2);

  const query = `
    query GetGiftProducts {
      products(first: 20, query: "price:<=${maxPriceDecimal}") {
        edges {
          node {
            id
            title
            status
            featuredImage {
              url
              altText
            }
            variants(first: 1) {
              edges {
                node {
                  id
                  price
                }
              }
            }
          }
        }
      }
    }
  `;

  try {
    const adminUrl = `https://${shop}/admin/api/2026-07/graphql.json`;
    const res = await fetch(adminUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": session.accessToken,
      },
      body: JSON.stringify({ query }),
    });

    if (!res.ok) {
      console.error("[api.products] Admin API error:", res.status, await res.text());
      return corsJson({ products: [] });
    }

    const data = await res.json();
    if (data.errors) {
      console.error("[api.products] GraphQL errors:", data.errors);
      return corsJson({ products: [] });
    }

    const products = (data.data?.products?.edges || [])
      .filter((edge: any) => {
        const node = edge.node;
        if (node.status !== "ACTIVE") return false;
        const variant = node.variants.edges[0]?.node;
        const priceCents = Math.round(parseFloat(variant?.price || "0") * 100);
        return priceCents > 0 && priceCents <= maxPrice;
      })
      .map((edge: any) => {
        const node = edge.node;
        const variant = node.variants.edges[0]?.node;
        return {
          productId: node.id,
          variantId: variant?.id,
          title: node.title,
          price: Math.round(parseFloat(variant?.price || "0") * 100),
          image: node.featuredImage?.url || "",
        };
      });

    return corsJson({ products });
  } catch (e) {
    console.error("[api.products] Error:", e);
    return corsJson({ products: [] });
  }
}
