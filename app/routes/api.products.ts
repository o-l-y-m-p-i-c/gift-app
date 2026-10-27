import type { LoaderFunctionArgs } from "@remix-run/node";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { getGiftProducts } from "~/models/gift-products.server";
import { authenticate } from "~/shopify.server";

/**
 * Eligible gift products up to a max price (cents, shop currency).
 * Excluded collections and tags from the app settings are filtered out.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return corsJson({ error: "App proxy session is unavailable.", products: [] }, { status: 401 });
  }

  const url = new URL(request.url);
  const maxPrice = parseInt(url.searchParams.get("maxPrice") || "0", 10);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 250);

  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    return corsJson({ products: [] });
  }

  try {
    const products = (await getGiftProducts(session.shop))
      .filter((product) => product.price <= maxPrice)
      .slice(0, limit);
    return corsJson({ products });
  } catch (e) {
    console.error("[api.products] Error:", e);
    return corsJson({ error: "Unable to load gift products.", products: [] }, { status: 502 });
  }
}
