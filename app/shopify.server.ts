import "@shopify/shopify-app-remix/server/adapters/node";
import { shopifyApp } from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "~/db.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  scopes: process.env.SCOPES?.split(",") || [
    "read_products",
    "write_products",
    "read_orders",
    "write_discounts",
    "write_cart_transforms",
    "write_app_proxy",
  ],
  appUrl: process.env.SHOPIFY_APP_URL!,
  sessionStorage: new PrismaSessionStorage(prisma),
  isEmbeddedApp: true,
  api: {
    apiVersion: "2026-07",
  },
});

export default shopify;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
