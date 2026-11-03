import { prisma } from "~/db.server";
import { adminGraphql } from "~/lib/admin-api.server";
import type { buildStorefrontConfig } from "~/models/storefront-config.server";

/**
 * Gifts are made free by one automatic app discount per shop, run by the
 * gift-discount Function (extensions/gift-discount). The Function reads its
 * tiers, exclusions and billing window from a metafield on that discount,
 * which this module keeps in step with the storefront config.
 */
const FUNCTION_HANDLE = "gift-discount";
const CONFIG_NAMESPACE = "$app:gift";
const CONFIG_KEY = "function-config";
const DISCOUNT_TITLE = "Free gifts (Gift Threshold)";
// Shopify Functions compare against local time without a timezone.
const FOREVER = "9999-12-31T00:00:00";
const NEVER = "1970-01-01T00:00:00";

type StorefrontConfig = Awaited<ReturnType<typeof buildStorefrontConfig>>;

const writtenConfigs = new Map<string, string>();

function localDateTime(iso: string) {
  return iso.replace(/(\.\d+)?Z$/, "");
}

export async function buildFunctionConfig(shopId: string, config: StorefrontConfig) {
  const settings = await prisma.appSettings.findUnique({ where: { shopId } });
  const accessUntil = config.billing.unlimited
    ? FOREVER
    : config.billing.trialEndsAt
      ? localDateTime(new Date(config.billing.trialEndsAt).toISOString())
      : NEVER;
  return {
    active: config.settings.active && accessUntil !== NEVER,
    accessUntil,
    message: "Free gift",
    tiers: config.tiers.map((tier) => ({ minAmount: tier.minAmount, giftAmount: tier.giftAmount })),
    excludedCollectionIds: settings?.excludedCollections ?? [],
    excludedTags: settings?.excludedTags ?? [],
  };
}

function discountInput(configJson: string) {
  return {
    title: DISCOUNT_TITLE,
    functionHandle: FUNCTION_HANDLE,
    discountClasses: ["PRODUCT"],
    // Gifts stack with the merchant's own codes and automatic discounts.
    combinesWith: { orderDiscounts: true, productDiscounts: true, shippingDiscounts: true },
    metafields: [{ namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: configJson }],
  };
}

async function createDiscount(shopId: string, configJson: string) {
  const data: any = await adminGraphql(
    `#graphql
      mutation CreateGiftDiscount($discount: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $discount) {
          automaticAppDiscount { discountId }
          userErrors { field message }
        }
      }
    `,
    { discount: { ...discountInput(configJson), startsAt: new Date().toISOString() } },
    shopId,
  );
  const result = data?.data?.discountAutomaticAppCreate;
  const discountId = result?.automaticAppDiscount?.discountId;
  if (!discountId) throw new Error(`Gift discount create failed: ${JSON.stringify(result?.userErrors ?? data?.errors)}`);
  await prisma.appSettings.upsert({
    where: { shopId },
    create: { shopId, giftDiscountId: discountId },
    update: { giftDiscountId: discountId },
  });
  return discountId as string;
}

/** Returns false when the discount no longer exists (deleted by the merchant). */
async function updateDiscount(shopId: string, discountId: string, configJson: string) {
  const data: any = await adminGraphql(
    `#graphql
      mutation UpdateGiftDiscount($id: ID!, $discount: DiscountAutomaticAppInput!) {
        discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $discount) {
          automaticAppDiscount { discountId }
          userErrors { field message }
        }
      }
    `,
    { id: discountId, discount: discountInput(configJson) },
    shopId,
  );
  const result = data?.data?.discountAutomaticAppUpdate;
  if (result?.automaticAppDiscount?.discountId) return true;
  const errors = result?.userErrors ?? data?.errors ?? [];
  if (JSON.stringify(errors).toLowerCase().includes("not exist") || JSON.stringify(errors).toLowerCase().includes("not found")) {
    return false;
  }
  throw new Error(`Gift discount update failed: ${JSON.stringify(errors)}`);
}

/**
 * Create the shop's gift discount, or bring its Function config up to date.
 * Returns whether the discount is in place. Never throws.
 */
export async function syncGiftDiscount(shopId: string, config: StorefrontConfig) {
  try {
    const configJson = JSON.stringify(await buildFunctionConfig(shopId, config));
    const settings = await prisma.appSettings.findUnique({ where: { shopId } });
    const existingId = settings?.giftDiscountId;

    if (existingId && writtenConfigs.get(shopId) === `${existingId}:${configJson}`) return true;

    let discountId = existingId;
    if (!discountId || !(await updateDiscount(shopId, discountId, configJson))) {
      discountId = await createDiscount(shopId, configJson);
    }
    writtenConfigs.set(shopId, `${discountId}:${configJson}`);
    return true;
  } catch (e) {
    writtenConfigs.delete(shopId);
    console.error("[gift-discount] Sync failed:", e);
    return false;
  }
}
