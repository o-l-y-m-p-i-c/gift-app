import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

/**
 * CORS headers for storefront widget requests.
 * In development, the widget fetches directly from the app URL (ngrok)
 * which is a different origin than the Shopify store.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
};

export function corsJson(data: unknown, init?: ResponseInit) {
  return json(data, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...CORS_HEADERS,
    },
  });
}

export function handleCorsPreflight(request: Request) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }
  return null;
}
