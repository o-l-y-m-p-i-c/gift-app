import "@shopify/shopify-app-remix/server/adapters/node";
import { ApiVersion, BillingInterval, shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "~/db.server";
import { PLAN_CURRENCY, PLAN_PRICE, PRO_PLAN, TRIAL_DAYS } from "~/lib/billing.server";

/**
 * Offline sessions saved before expiring tokens carry a token Shopify now
 * rejects and no refresh token. Treating them as missing makes the next
 * admin visit exchange for a new, expiring token instead of reusing it.
 */
class ExpiringTokenSessionStorage extends PrismaSessionStorage<typeof prisma> {
  async loadSession(id: string) {
    const session = await super.loadSession(id);
    if (session && !session.isOnline && !session.refreshToken) return undefined;
    return session;
  }
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: process.env.SCOPES?.split(",") || [
    "read_products",
    "read_discounts",
    "write_discounts",
    "read_orders",
    "read_metaobjects",
    "write_metaobjects",
    "read_metaobject_definitions",
    "write_metaobject_definitions",
  ],
  appUrl: process.env.SHOPIFY_APP_URL!,
  sessionStorage: new ExpiringTokenSessionStorage(prisma),
  isEmbeddedApp: true,
  billing: {
    [PRO_PLAN]: {
      trialDays: TRIAL_DAYS,
      lineItems: [
        {
          amount: PLAN_PRICE,
          currencyCode: PLAN_CURRENCY,
          interval: BillingInterval.Every30Days,
        },
      ],
    },
  },
  apiVersion: ApiVersion.July26,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    // Shopify rejects non-expiring offline tokens for the Admin API; the
    // library now stores a refresh token and renews the access token itself.
    expiringOfflineAccessTokens: true,
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
