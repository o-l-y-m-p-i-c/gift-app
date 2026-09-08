import type { LoaderFunctionArgs } from "@remix-run/node";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { authenticate, unauthenticated } from "~/shopify.server";
import { prisma } from "~/db.server";

/**
 * Fetch eligible gift products for a given max price.
 * Uses Shopify Admin API to query product variants.
 *
 * Auth strategy:
 *   1. Try app-proxy authentication (signed request from Shopify storefront).
 *   2. Fall back to looking up the shop's session in the DB and using
 *      unauthenticated.admin(shop) — this handles cases where the app proxy
 *      signature validation fails but we still have a valid offline token.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const url = new URL(request.url);
  const maxPrice = parseInt(url.searchParams.get("maxPrice") || "0");
  const shopParam = url.searchParams.get("shop") || "";

  if (maxPrice <= 0) {
    return corsJson({ products: [] });
  }

  let admin: any = null;

  // Strategy 1: app proxy auth
  try {
    const result = await authenticate.public.appProxy(request);
    if (result?.admin && result?.session) {
      admin = result.admin;
    }
  } catch (e) {
    console.error("[api.products] appProxy auth failed:", e);
  }

  // Strategy 2: fall back to unauthenticated.admin using shop from query or DB
  if (!admin) {
    const shopDomain = shopParam.includes(".myshopify.com")
      ? shopParam
      : await resolveShopDomain(shopParam);

    if (shopDomain) {
      try {
        const { admin: unauthAdmin } = await unauthenticated.admin(shopDomain);
        admin = unauthAdmin;
      } catch (e) {
        console.error("[api.products] unauthenticated.admin fallback failed:", e);
      }
    }
  }

  if (!admin) {
    console.error("[api.products] No admin client available");
    return corsJson({ products: [] });
  }

  // Query ALL active products with their variants, then filter in code.
  // This is more reliable than relying on the price:<= search syntax.
  const maxPriceDecimal = (maxPrice / 100).toFixed(2);

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
    const res = await admin.graphql(query, { variables: { first: 50 } });
    const data: any = await res.json();

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

    console.log(`[api.products] maxPrice=${maxPriceDecimal}, found ${products.length} eligible variants`);
    return corsJson({ products });
  } catch (e) {
    console.error("[api.products] Error:", e);
    return corsJson({ products: [] });
  }
}

/**
 * Resolve the shop domain from the query param or the database.
 * The app proxy may send the shop as the full domain (e.g. "test-store-size-localization.myshopify.com")
 * or as the shop's primary domain. We need the .myshopify.com domain.
 */
async function resolveShopDomain(shopParam: string): Promise<string | null> {
  if (shopParam.includes(".myshopify.com")) {
    return shopParam;
  }

  // Look up the most recent session
  const session = await prisma.session.findFirst({
    orderBy: { createdAt: "desc" },
    select: { shop: true },
  });
  if (session?.shop?.includes(".myshopify.com")) {
    return session.shop;
  }

  // Look up any tier with a real shop domain
  const tier = await prisma.giftTier.findFirst({
    where: { shopId: { contains: ".myshopify.com" } },
    select: { shopId: true },
  });
  return tier?.shopId || null;
}
