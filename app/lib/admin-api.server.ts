/**
 * Lightweight Shopify Admin GraphQL client using a static access token.
 *
 * The Admin API access token is obtained from:
 *   Shopify Admin → Apps → [app] → App setup → Admin API integration
 * It does NOT expire and does NOT require OAuth sessions.
 *
 * Set SHOPIFY_ADMIN_ACCESS_TOKEN and SHOPIFY_SHOP_DOMAIN in the environment.
 */

const API_VERSION = "2026-07";

export function getAdminConfig() {
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN;

  if (!accessToken || !shopDomain) {
    return null;
  }

  return { accessToken, shopDomain };
}

export async function adminGraphql(
  query: string,
  variables: Record<string, unknown> = {},
) {
  const config = getAdminConfig();
  if (!config) {
    throw new Error("SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_SHOP_DOMAIN is not set.");
  }

  const endpoint = `https://${config.shopDomain}/admin/api/${API_VERSION}/graphql.json`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Shopify Admin API error: ${response.status} ${response.statusText}${text ? ` — ${text.slice(0, 200)}` : ""}`,
    );
  }

  return response.json();
}
