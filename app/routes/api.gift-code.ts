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
 * Create ONE discountCodeBasicCreate PER gift variant.
 *
 * Each code gives a FIXED amount off (equal to that variant's price)
 * on ONLY that variant, with appliesOnEachItem: false.
 *
 * This means:
 * - Each gift is 100% free (discount = price, 1 unit)
 * - If user increases qty to 5: discount stays fixed → pays for 4 extra
 * - Gifts stack: each has its own code, basic discounts combine
 * - No abuse possible (server-side enforcement)
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

  // Validate gift variants and collect their prices
  let totalGiftValue = 0;
  const giftPrices: number[] = [];
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
    giftPrices.push(price);
    totalGiftValue += price;
  }

  if (totalGiftValue > tier.giftAmount) {
    return corsJson({ error: "Total gift value exceeds the tier budget." }, { status: 422 });
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + 30 * 60 * 1000);

  // Create ONE discount code PER gift variant.
  // Each code: fixed amount off = variant price, appliesOnEachItem: false.
  // This makes 1 unit free but doesn't scale with quantity (abuse-proof).
  // Basic discount codes combine with each other (unlike BXGY).
  const codes: string[] = [];

  for (let i = 0; i < giftVariantGids.length; i++) {
    const giftGid = giftVariantGids[i];
    const giftPrice = giftPrices[i];
    const code = `GIFT-${randomBytes(10).toString("hex").toUpperCase()}`;

    let discountData: any;
    try {
      discountData = await adminGraphql(
        `#graphql
          mutation CreateGiftCode($basicCodeDiscount: DiscountCodeBasicInput!) {
            discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
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
          basicCodeDiscount: {
            title: `Gift ${code}`,
            code,
            startsAt: now.toISOString(),
            endsAt: endsAt.toISOString(),
            context: {
              all: "ALL",
            },
            customerGets: {
              value: {
                discountAmount: {
                  amount: (giftPrice / 100).toFixed(2),
                  appliesOnEachItem: false,
                },
              },
              items: {
                products: {
                  productVariantsToAdd: [giftGid],
                },
              },
            },
            usageLimit: 1,
            appliesOncePerCustomer: false,
            combinesWith: {
              orderDiscounts: true,
              productDiscounts: true,
              shippingDiscounts: true,
            },
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

    const errors = discountData.data?.discountCodeBasicCreate?.userErrors || [];

    if (errors.length > 0 || !discountData.data?.discountCodeBasicCreate?.codeDiscountNode) {
      console.error("[gift-code] Creation failed:", errors, discountData.errors || []);
      return corsJson({ error: errors[0]?.message || "Unable to create gift discount." }, { status: 422 });
    }

    codes.push(code);
  }

  return corsJson({ codes });
}
