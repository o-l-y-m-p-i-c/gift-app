import { randomBytes } from "node:crypto";
import type { ActionFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { authenticate } from "~/shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  // Native Shopify app proxy authentication.
  // Shopify signs every app-proxy request with HMAC.
  let admin: any = null;
  let shopDomain: string = "";

  try {
    const result = await authenticate.public.appProxy(request);
    if (result?.admin && result?.session) {
      admin = result.admin;
      shopDomain = result.session.shop;
    }
  } catch (e) {
    console.error("[gift-code] appProxy auth failed:", e);
  }

  if (!admin) {
    return corsJson(
      { error: "App session is unavailable. Please reinstall the app in Shopify admin." },
      { status: 401 },
    );
  }

  const body = await request.json().catch(() => null);
  return handleGiftCode(admin, shopDomain, body);
}

async function handleGiftCode(admin: any, shopDomain: string, body: any) {
  const variantId = String(body?.variantId || "");
  const tierId = Number(body?.tierId);
  const qualifyingVariantIds: string[] = Array.isArray(body?.qualifyingVariantIds)
    ? [...new Set<string>(body.qualifyingVariantIds.map((id: unknown) => String(id)))]
    : [];

  if (
    !/^\d+$/.test(variantId) ||
    !Number.isInteger(tierId) ||
    qualifyingVariantIds.length === 0 ||
    qualifyingVariantIds.length > 100 ||
    qualifyingVariantIds.includes(variantId) ||
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

  const variantGid = `gid://shopify/ProductVariant/${variantId}`;
  const qualifyingVariantGids = qualifyingVariantIds.map(
    (id) => `gid://shopify/ProductVariant/${id}`,
  );

  let variantData: any;
  try {
    const variantResponse = await admin.graphql(
      `#graphql
        query GiftVariants($giftId: ID!, $qualifyingIds: [ID!]!) {
          productVariant(id: $giftId) {
            id
            price
            availableForSale
            product {
              status
            }
          }
          nodes(ids: $qualifyingIds) {
            ... on ProductVariant {
              id
              price
            }
          }
        }
      `,
      { variables: { giftId: variantGid, qualifyingIds: qualifyingVariantGids } },
    );
    variantData = await variantResponse.json();
  } catch (e: any) {
    console.error("[gift-code] Admin API variant query failed:", e?.message || e);
    return corsJson(
      { error: "Shop connection error. Please reinstall the app in Shopify admin." },
      { status: 502 },
    );
  }

  const variant = variantData.data?.productVariant;
  const price = Math.round(Number(variant?.price || 0) * 100);

  if (
    !variant?.availableForSale ||
    variant.product?.status !== "ACTIVE" ||
    price <= 0 ||
    price > tier.giftAmount
  ) {
    return corsJson({ error: "This product is not eligible as a gift." }, { status: 422 });
  }

  const qualifyingPrices = (variantData.data?.nodes || [])
    .filter(Boolean)
    .map((item: any) => Math.round(Number(item.price || 0) * 100))
    .filter((itemPrice: number) => itemPrice > 0);

  if (qualifyingPrices.length === 0) {
    return corsJson({ error: "Qualifying cart products are unavailable." }, { status: 422 });
  }

  const minimumPurchase = Math.max(tier.minAmount, Math.min(...qualifyingPrices));
  const code = `GIFT-${randomBytes(12).toString("hex").toUpperCase()}`;
  const now = new Date();
  const endsAt = new Date(now.getTime() + 30 * 60 * 1000);

  let discountData: any;
  try {
    const discountResponse = await admin.graphql(
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
        variables: {
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
                  effect: { percentage: 1 },
                },
              },
              items: {
                products: { productVariantsToAdd: [variantGid] },
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
      },
    );
    discountData = await discountResponse.json();
  } catch (e: any) {
    console.error("[gift-code] Discount creation failed:", e?.message || e);
    return corsJson(
      { error: "Shop connection error. Please reinstall the app in Shopify admin." },
      { status: 502 },
    );
  }

  const errors = discountData.data?.discountCodeBxgyCreate?.userErrors || [];

  if (errors.length > 0 || !discountData.data?.discountCodeBxgyCreate?.codeDiscountNode) {
    console.error("[gift-code] Creation failed:", errors, discountData.errors || []);
    return corsJson({ error: errors[0]?.message || "Unable to create gift discount." }, { status: 422 });
  }

  return corsJson({ code });
}
