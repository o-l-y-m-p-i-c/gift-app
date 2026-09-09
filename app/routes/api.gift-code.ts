import { randomBytes } from "node:crypto";
import type { ActionFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { adminGraphql, getAdminConfig } from "~/lib/admin-api.server";

export async function action({ request }: ActionFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const config = getAdminConfig();
  if (!config) {
    return corsJson(
      { error: "Server is not configured. Set SHOPIFY_ADMIN_ACCESS_TOKEN and SHOPIFY_SHOP_DOMAIN." },
      { status: 500 },
    );
  }

  const body = await request.json().catch(() => null);
  return handleGiftCode(config.shopDomain, body);
}

/**
 * Create a SINGLE BXGY discount code for ALL gift variants.
 *
 * BXGY with discountOnQuantity:
 * - quantity = N (number of gifts)
 * - effect = percentage 1.0 (100% free)
 *
 * This makes exactly N items 100% FREE. If user increases quantity,
 * only N items are free, extras are full price.
 *
 * Gifts stack because they're all in one code.
 *
 * Body:
 *   - giftVariantIds: string[]  — all gift variant IDs (existing + new)
 *   - tierId: number
 *   - qualifyingVariantIds: string[] — non-gift cart variant IDs
 *   - shop: string
 *
 * Returns: { code: string }
 */
async function handleGiftCode(shopDomain: string, body: any) {
  const giftVariantIds: string[] = Array.isArray(body?.giftVariantIds)
    ? body.giftVariantIds.map((id: unknown) => String(id))
    : [];
  const tierId = Number(body?.tierId);
  const qualifyingVariantIds: string[] = Array.isArray(body?.qualifyingVariantIds)
    ? [...new Set<string>(body.qualifyingVariantIds.map((id: unknown) => String(id)))]
    : [];

  if (
    giftVariantIds.length === 0 ||
    giftVariantIds.length > 50 ||
    giftVariantIds.some((id) => !/^\d+$/.test(id)) ||
    !Number.isInteger(tierId) ||
    qualifyingVariantIds.length === 0 ||
    qualifyingVariantIds.length > 100 ||
    qualifyingVariantIds.some((id) => !/^\d+$/.test(id))
  ) {
    return corsJson({ error: "Invalid gift selection." }, { status: 400 });
  }

  const tier = await prisma.giftTier.findFirst({
    where: { id: tierId, shopId: shopDomain, active: true },
  });

  if (!tier) {
    return corsJson({ error: "Gift tier is unavailable." }, { status: 404 });
  }

  // giftVariantIds may contain duplicates (same variant added multiple times).
  // The total count is used for discountOnQuantity.quantity.
  // Unique IDs are used for productVariantsToAdd (targeting).
  const giftQuantity = giftVariantIds.length;
  const uniqueGiftVariantIds = [...new Set(giftVariantIds)];

  const giftVariantGids = uniqueGiftVariantIds.map(
    (id) => `gid://shopify/ProductVariant/${id}`,
  );
  const qualifyingVariantGids = qualifyingVariantIds.map(
    (id) => `gid://shopify/ProductVariant/${id}`,
  );

  // Query all gift variants + qualifying variants
  const allGids = [...giftVariantGids, ...qualifyingVariantGids];
  let variantData: any;
  try {
    variantData = await adminGraphql(
      `#graphql
        query GiftVariants($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on ProductVariant {
              id
              price
              availableForSale
              product {
                status
              }
            }
          }
        }
      `,
      { ids: allGids },
    );
  } catch (e: any) {
    console.error("[gift-code] Admin API variant query failed:", e?.message || e);
    return corsJson(
      { error: "Shop connection error. Check SHOPIFY_ADMIN_ACCESS_TOKEN." },
      { status: 502 },
    );
  }

  const nodes = variantData.data?.nodes || [];
  const nodesById = new Map<string, any>(
    nodes.filter(Boolean).map((node: any) => [node.id, node]),
  );
  const giftNodes = giftVariantGids.map((gid) => nodesById.get(gid));
  const qualifyingNodes = qualifyingVariantGids
    .map((gid) => nodesById.get(gid))
    .filter(Boolean);

  // Map: variant GID → price (for counting duplicates)
  const giftPriceMap = new Map<string, number>();
  for (const gv of giftNodes) {
    const price = Math.round(Number(gv?.price || 0) * 100);
    if (
      !gv?.availableForSale ||
      gv.product?.status !== "ACTIVE" ||
      price <= 0
    ) {
      return corsJson({ error: "One or more gift products are not available." }, { status: 422 });
    }
    if (price > tier.giftAmount) {
      return corsJson({ error: "Gift product exceeds the tier budget." }, { status: 422 });
    }
    giftPriceMap.set(gv.id, price);
  }

  // Calculate total gift value: sum of each gift unit (including duplicates)
  let totalGiftValue = 0;
  const giftIdCounts = new Map<string, number>();
  for (const id of giftVariantIds) {
    giftIdCounts.set(id, (giftIdCounts.get(id) || 0) + 1);
  }
  for (const [id, count] of giftIdCounts) {
    const gid = `gid://shopify/ProductVariant/${id}`;
    totalGiftValue += (giftPriceMap.get(gid) || 0) * count;
  }

  if (totalGiftValue > tier.giftAmount) {
    return corsJson({ error: "Total gift value exceeds the tier budget." }, { status: 422 });
  }

  // BXGY requires customerBuys.value.amount >= cheapest qualifying item price
  const qualifyingPrices = qualifyingNodes
    .map((item: any) => Math.round(Number(item.price || 0) * 100))
    .filter((p: number) => p > 0);
  if (qualifyingPrices.length === 0) {
    return corsJson({ error: "Qualifying cart products are unavailable." }, { status: 422 });
  }
  const minPurchaseAmount = Math.max(tier.minAmount, Math.min(...qualifyingPrices));

  const code = `GIFT-${randomBytes(12).toString("hex").toUpperCase()}`;
  const now = new Date();
  const endsAt = new Date(now.getTime() + 30 * 60 * 1000);

  // Create ONE BXGY code for ALL gift variants.
  // discountOnQuantity: quantity = N (number of gifts), effect = 100% free.
  // This makes exactly N items 100% FREE.
  // If user increases qty, only N items are free, extras are full price.
  let discountData: any;
  try {
    discountData = await adminGraphql(
      `#graphql
        mutation CreateGiftCode($bxgyCodeDiscount: DiscountCodeBxgyInput!) {
          discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) {
            codeDiscountNode {
              id
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `,
      {
        bxgyCodeDiscount: {
          title: `Gift ${code}`,
          code,
          startsAt: now.toISOString(),
          endsAt: endsAt.toISOString(),
          context: { all: "ALL" },
          customerBuys: {
            value: { amount: (minPurchaseAmount / 100).toFixed(2) },
            items: {
              products: { productVariantsToAdd: qualifyingVariantGids },
            },
          },
          customerGets: {
            value: {
              discountOnQuantity: {
                quantity: String(giftQuantity),
                effect: { percentage: 1.0 },
              },
            },
            items: {
              products: { productVariantsToAdd: giftVariantGids },
            },
          },
          combinesWith: {
            orderDiscounts: true,
            productDiscounts: true,
            shippingDiscounts: true,
          },
          usageLimit: 1,
          appliesOncePerCustomer: false,
        },
      },
    );
  } catch (e: any) {
    console.error("[gift-code] Discount creation failed:", e?.message || e);
    return corsJson(
      { error: "Shop connection error. Check SHOPIFY_ADMIN_ACCESS_TOKEN." },
      { status: 502 },
    );
  }

  const errors = discountData.data?.discountCodeBxgyCreate?.userErrors || [];

  if (errors.length > 0 || !discountData.data?.discountCodeBxgyCreate?.codeDiscountNode) {
    console.error("[gift-code] Creation failed:", errors, discountData.errors || []);
    return corsJson({ error: errors[0]?.message || "Unable to create gift discount." }, { status: 422 });
  }

  return corsJson({ code, giftQuantity, totalGiftValue });
}
