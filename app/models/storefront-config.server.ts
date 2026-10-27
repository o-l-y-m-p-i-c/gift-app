import { prisma } from "~/db.server";
import { adminGraphql } from "~/lib/admin-api.server";
import { getBillingAccess } from "~/lib/billing.server";
import { getActiveTiers } from "~/models/tier.server";

/**
 * The storefront config (tiers, settings, billing window) is written to an
 * app-data metafield on the app installation, so theme blocks can render it
 * straight from Liquid (`app.metafields.gift.config`) instead of waiting for
 * app proxy requests on every page load.
 */
export const CONFIG_NAMESPACE = "gift";
export const CONFIG_KEY = "config";

export async function buildStorefrontConfig(shopId: string) {
  const [tiers, settings, billing] = await Promise.all([
    getActiveTiers(shopId),
    prisma.appSettings.findUnique({ where: { shopId } }),
    prisma.shopBilling.findUnique({ where: { shopId } }),
  ]);
  const access = billing ? getBillingAccess(billing) : null;

  return {
    version: 1,
    currencyCode: settings?.currencyCode ?? "USD",
    settings: {
      active: settings?.active ?? true,
      useTotalAfterDiscounts: settings?.useTotalAfterDiscounts ?? true,
      showLevelUpNotification: settings?.showLevelUpNotification ?? true,
      showRemovalNotification: settings?.showRemovalNotification ?? true,
    },
    // The trial ends without any event, so the storefront compares the
    // date itself; development stores and subscribers have no end date.
    billing: {
      unlimited: access ? access.reason === "dev_store" || access.reason === "subscribed" : false,
      trialEndsAt: access?.trialEndsAt ?? null,
    },
    tiers: tiers.map((t) => ({ id: t.id, minAmount: t.minAmount, giftAmount: t.giftAmount })),
  };
}

const installationIds = new Map<string, string>();

async function getInstallationId(shopId: string) {
  const cached = installationIds.get(shopId);
  if (cached) return cached;
  const data: any = await adminGraphql(`query { currentAppInstallation { id } }`, {}, shopId);
  const id = data?.data?.currentAppInstallation?.id;
  if (!id) throw new Error("App installation not found.");
  installationIds.set(shopId, id);
  return id;
}

/** Write the current config to the shop's app metafield. Never throws. */
export async function syncStorefrontConfig(shopId: string) {
  try {
    const [ownerId, config] = await Promise.all([getInstallationId(shopId), buildStorefrontConfig(shopId)]);
    const data: any = await adminGraphql(
      `#graphql
        mutation SetGiftConfig($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        metafields: [
          { ownerId, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: JSON.stringify(config) },
        ],
      },
      shopId,
    );
    const errors = data?.data?.metafieldsSet?.userErrors || [];
    if (errors.length > 0) {
      console.error("[storefront-config] metafieldsSet failed:", errors);
    }
  } catch (e) {
    installationIds.delete(shopId);
    console.error("[storefront-config] Sync failed:", e);
  }
}
