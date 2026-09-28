import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { getSettings } from "~/models/settings.server";
import { createHistoryEntry } from "~/models/history.server";

/**
 * Webhook: orders/create
 * Records gift history when an order with a gift product is placed.
 */
export async function action({ request }: ActionFunctionArgs) {
  const topic = request.headers.get("X-Shopify-Topic");
  const shop = request.headers.get("X-Shopify-Shop-Domain");

  if (topic !== "orders/create" || !shop) {
    return json({ error: "Invalid webhook" }, { status: 400 });
  }

  try {
    const order = await request.json();

    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    const giftLineItems = lineItems.filter((item: any) =>
      item.properties?.some(
        (property: any) => property.name === "_gift" && property.value === "true",
      ),
    );

    if (giftLineItems.length === 0) {
      return json({ success: true, message: "No gift in order" });
    }

    const settings = await getSettings(shop);
    const toCents = (value: unknown) => {
      const amount = Number.parseFloat(String(value ?? "0"));
      return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
    };
    const lineTotal = (item: any) =>
      toCents(item.price) * Math.max(0, Number(item.quantity) || 0);

    const qualifyingLineItems = lineItems.filter(
      (item: any) => !giftLineItems.includes(item),
    );
    const qualifyingSubtotal = qualifyingLineItems.reduce(
      (total: number, item: any) => total + lineTotal(item),
      0,
    );
    const qualifyingDiscounts = qualifyingLineItems.reduce(
      (total: number, item: any) => total + toCents(item.total_discount),
      0,
    );
    const thresholdBase = settings.useTotalAfterDiscounts
      ? Math.max(0, qualifyingSubtotal - qualifyingDiscounts)
      : qualifyingSubtotal;

    const cartTotal = toCents(order.total_price);
    const giftPrice = giftLineItems.reduce(
      (total: number, item: any) => total + lineTotal(item),
      0,
    );
    const giftProductIds = [...new Set(
      giftLineItems.map((item: any) => String(item.product_id)).filter(Boolean),
    )];
    const giftTitles = [...new Set(
      giftLineItems.map((item: any) => item.title).filter(Boolean),
    )];
    const giftImage = giftLineItems.find((item: any) => item.image?.src)?.image?.src || null;

    const tier = await prisma.giftTier.findFirst({
      where: {
        shopId: shop,
        minAmount: { lte: thresholdBase },
        active: true,
      },
      orderBy: { minAmount: "desc" },
    });

    if (!tier) {
      return json({ success: true, message: "No matching tier" });
    }

    await createHistoryEntry({
      shopId: shop,
      orderId: String(order.id),
      tierId: tier.id,
      giftProductId: giftProductIds.join(","),
      giftProductTitle: giftTitles.join(", ") || "Unknown",
      giftProductPrice: giftPrice,
      giftProductImage: giftImage,
      cartTotal,
      thresholdBase,
    });

    return json({ success: true });
  } catch (e) {
    console.error("[webhook orders/create] Error:", e);
    return json({ error: "Internal error" }, { status: 500 });
  }
}
