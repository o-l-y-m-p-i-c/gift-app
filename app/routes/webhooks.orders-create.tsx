import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
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

    // Find gift line item
    const giftLineItem = order.line_items?.find(
      (item: any) => item.properties?.some((p: any) => p.name === "_gift" && p.value === "true"),
    );

    if (!giftLineItem) {
      return json({ success: true, message: "No gift in order" });
    }

    // Find the tier that was active
    const cartTotal = order.total_price ? Math.round(parseFloat(order.total_price) * 100) : 0;
    const giftPrice = giftLineItem.price ? Math.round(parseFloat(giftLineItem.price) * 100) : 0;
    const thresholdBase = cartTotal - giftPrice;

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
      giftProductId: String(giftLineItem.product_id),
      giftProductTitle: giftLineItem.title || "Unknown",
      giftProductPrice: giftPrice,
      giftProductImage: giftLineItem.image?.src || null,
      cartTotal,
      thresholdBase,
    });

    return json({ success: true });
  } catch (e) {
    console.error("[webhook orders/create] Error:", e);
    return json({ error: "Internal error" }, { status: 500 });
  }
}
