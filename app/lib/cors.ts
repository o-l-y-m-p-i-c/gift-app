import { json } from "@remix-run/node";

/**
 * Storefront requests go through the Shopify app proxy, so the browser sees
 * them as same-origin and no CORS headers are needed in production.
 * In development the widget may call the tunnel URL directly, so CORS is
 * only opened up outside production.
 */
const DEV_CORS_HEADERS: Record<string, string> =
  process.env.NODE_ENV === "production"
    ? {}
    : {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

export function corsJson(data: unknown, init?: ResponseInit) {
  return json(data, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...DEV_CORS_HEADERS,
    },
  });
}

export function handleCorsPreflight(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: DEV_CORS_HEADERS,
    });
  }
  return null;
}
