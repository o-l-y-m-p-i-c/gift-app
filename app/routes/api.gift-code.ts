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
 * Create ONE BXGY discount code PER gift variant.
 *
 * Each code gives 100% off on exactly 1 unit of that specific variant.
 * If the user increases quantity, only 1 unit is free, the rest are full price.
 *
 * Body:
 *   - giftVariantIds: string[]  — all gift variant IDs (existing + new)
 *   - tierId: number
 *   - qualifyingVariantIds: string[] — non-gift cart variant IDs
 *   - shop: string
 *
 * Returns: { codes: string[] } — one code per gift variant
 */
async function handleGiftCode(shopDomain: string, body: any) {
  const giftVariantIds: string[] = Array.isArray(body?.giftVariantIds)
    ? [...new Set<string>(body.giftVariantIds.map((id: unknown) => String(id)))]
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

  const giftVariantGids = giftVariantIds.map(
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

  const nodes = (variantData.data?.nodes || []).filter(Boolean);
  const giftNodes = nodes.slice(0, giftVariantGids.length);
  const qualifyingNodes = nodes.slice(giftVariantGids.length);

  // Validate gift variants: active, available, priced, within budget
  let totalGiftValue = 0;
  for (const gv of giftNodes) {
    const price = Math.round(Number(gv?.price || 0) * 100);
    if (
      !gv?.availableForSale ||
      gv.product?.status !== "ACTIVE" ||
      price <= 0
    ) {
      return corsJson({ error: "One or more gift products are not available." }, { status: 422 });
    }
    totalGiftValue += price;
  }

  if (totalGiftValue > tier.giftAmount) {
    return corsJson({ error: "Total gift value exceeds the tier budget." }, { status: 422 });
  }

  // Validate qualifying variants
  const qualifyingPrices = qualifyingNodes
    .map((item: any) => Math.round(Number(item.price || 0) * 100))
    .filter((p: number) => p > 0);

  if (qualifyingPrices.length === 0) {
    return corsJson({ error: "Qualifying cart products are unavailable." }, { status: 422 });
  }

  const minimumPurchase = Math.max(tier.minAmount, Math.min(...qualifyingPrices));
  const now = new Date();
  const endsAt = new Date(now.getTime() + 30 * 60 * 1000);

  // Create ONE BXGY code PER gift variant.
  // Each code: customer buys qualifying items → gets 1 unit of this variant free.
  // This ensures only 1 unit per variant is discounted. Extra units = full price.
  const codes: string[] = [];

  for (let i = 0; i < giftVariantGids.length; i++) {
    const giftGid = giftVariantGids[i];
    const code = `GIFT-${randomBytes(10).toString("hex").toUpperCase()}`;

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
              value: { amount: (minimumPurchase / 100).toFixed(2) },
              items: {
                products: { productVariantsToAdd: qualifyingVariantGids },
              },
              isOneTimePurchase: true,
              isSubscription: false,
            },
            customerGets: {
              value: {
                discountOnQuantity: {
                  quantity: "1",
                  effect: { percentage: 1.0 },
                },
              },
              items: {
                products: { productVariantsToAdd: [giftGid] },
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

    codes.push(code);
  }

  return corsJson({ codes });
}
