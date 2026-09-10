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
import { prisma } from "~/db.server";

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

    // Auto-cleanup: if the token is revoked/invalid, delete the stale
    // session so the merchant is forced through OAuth on next visit.
    if (response.status === 401 || response.status === 403) {
      await deleteSessionsForShop(shop).catch(() => { });
      console.warn(
        `[adminGraphql] Session for ${shop} returned ${response.status}. Deleted stale session.`,
      );
    }

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

// ─── Session validation & refresh ───────────────────────────

const SHOP_QUERY = `query { shop { id name } }`;

/**
 * Validate that the stored OAuth session for a shop still works
 * by making a lightweight `shop` query. Returns the HTTP status
 * code from Shopify (200 = valid, 401 = invalid/revoked, etc).
 */
export async function validateSession(shop: string): Promise<{
  valid: boolean;
  status: number;
  shopName?: string;
}> {
  if (!shop || !shop.includes(".myshopify.com")) {
    return { valid: false, status: 0 };
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(SHOP_QUERY);

    if (response.ok) {
      const data = await response.json();
      const shopName = data?.data?.shop?.name;
      return { valid: true, status: 200, shopName };
    }

    return { valid: false, status: response.status };
  } catch (e) {
    return { valid: false, status: 0 };
  }
}

/**
 * Delete all stored sessions for a shop. Called when a session is
 * detected as invalid (401) or when the app is uninstalled.
 */
export async function deleteSessionsForShop(shop: string): Promise<number> {
  if (!shop) return 0;
  const result = await prisma.session.deleteMany({ where: { shop } });
  return result.count;
}

/**
 * Ensure the OAuth session for a shop is valid. If the session is
 * stale/revoked (401), delete it so the merchant is forced through
 * OAuth again on their next admin visit.
 *
 * Returns true if the session is valid, false if it was cleaned up
 * and re-authorization is needed.
 */
export async function ensureValidSession(shop: string): Promise<boolean> {
  const { valid, status } = await validateSession(shop);

  if (valid) return true;

  // 401 = token revoked / app uninstalled / scopes changed
  // 0   = no session found or network error
  if (status === 401 || status === 403) {
    await deleteSessionsForShop(shop);
    console.warn(
      `[admin-api] Deleted invalid session for ${shop} (status ${status}). Re-authorization required.`,
    );
  }

  return false;
}
