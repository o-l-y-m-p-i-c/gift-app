/**
 * Shopify Admin GraphQL client using OAuth sessions from Prisma.
 *
 * No static access token needed — the token is stored automatically
 * in the Session table when a merchant installs the app via OAuth.
 *
 * Uses shopify.unauthenticated.admin(shop) from Shopify App Remix,
 * which looks up the offline session for the given shop domain.
 */

import { unauthenticated } from "~/shopify.server";

const API_VERSION = "2026-07";

/**
 * Execute a Shopify Admin GraphQL query for a specific shop.
 * Uses the OAuth session stored in Prisma (no env token needed).
 */
export async function adminGraphql(
  query: string,
  variables: Record<string, unknown> = {},
  shop?: string,
) {
  if (!shop) {
    throw new Error("Shop domain is required for adminGraphql.");
  }

  const { admin } = await unauthenticated.admin(shop);

  const response = await admin.graphql(query, { variables });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Shopify Admin API error: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }

  return response.json();
}

/**
 * Get the shop domain from a request URL's ?shop= parameter.
 */
export function getShopFromRequest(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get("shop") || "";
}

/**
 * Check if admin API access is available for a given shop.
 * Returns true if an OAuth session exists in the database.
 */
export async function hasAdminAccess(shop: string): Promise<boolean> {
  if (!shop || !shop.includes(".myshopify.com")) return false;
  try {
    await unauthenticated.admin(shop);
    return true;
  } catch {
    return false;
  }
}
