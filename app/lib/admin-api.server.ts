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
 * Delete all stored sessions for a shop. Called when a session is
 * detected as invalid (401) or when the app is uninstalled.
 */
export async function deleteSessionsForShop(shop: string): Promise<number> {
  if (!shop) return 0;
  const result = await prisma.session.deleteMany({ where: { shop } });
  return result.count;
}
