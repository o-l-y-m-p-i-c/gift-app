import "@shopify/shopify-app-remix/server/adapters/node";
import { BillingInterval, shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "~/db.server";
import { PLAN_CURRENCY, PLAN_PRICE, PRO_PLAN, TRIAL_DAYS } from "~/lib/billing.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: process.env.SCOPES?.split(",") || [
    "read_products",
    "write_products",
    "read_orders",
    "read_discounts",
    "write_discounts",
    "write_app_proxy",
  ],
  appUrl: process.env.SHOPIFY_APP_URL!,
  sessionStorage: new PrismaSessionStorage(prisma),
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
  api: {
    apiVersion: "2026-07",
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
