import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { deleteSessionsForShop } from "~/lib/admin-api.server";
import { authenticate } from "~/shopify.server";

/**
 * Mandatory GDPR compliance webhooks:
 *   customers/data_request, customers/redact, shop/redact
 *
 * The app stores no customer details (names, emails, addresses). The only
 * customer-linked data is GiftHistory, keyed by order ID.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const normalizedTopic = String(topic).toUpperCase().replace(/\//g, "_");
  const body = payload as any;

  try {
    switch (normalizedTopic) {
      case "CUSTOMERS_DATA_REQUEST": {
        const orderIds = (body?.orders_requested || []).map(String);
        const records = await prisma.giftHistory.count({
          where: { shopId: shop, orderId: { in: orderIds } },
        });
        // Nothing personal is stored; the merchant already holds these orders.
        console.info(
          `[webhook compliance] Data request for ${shop}: ${records} gift record(s) linked to requested orders.`,
        );
        break;
      }

      case "CUSTOMERS_REDACT": {
        const orderIds = (body?.orders_to_redact || []).map(String);
        if (orderIds.length > 0) {
          await prisma.giftHistory.deleteMany({
            where: { shopId: shop, orderId: { in: orderIds } },
          });
        }
        break;
      }

      case "SHOP_REDACT": {
        await prisma.$transaction([
          prisma.giftHistory.deleteMany({ where: { shopId: shop } }),
          prisma.giftTier.deleteMany({ where: { shopId: shop } }),
          prisma.appSettings.deleteMany({ where: { shopId: shop } }),
          prisma.billingPayment.deleteMany({ where: { shopId: shop } }),
          prisma.billingSubscription.deleteMany({ where: { shopId: shop } }),
          prisma.shopBilling.deleteMany({ where: { shopId: shop } }),
        ]);
        await deleteSessionsForShop(shop);
        break;
      }

      default:
        return json({ error: `Unhandled topic ${topic}` }, { status: 400 });
    }

    return json({ success: true });
  } catch (e) {
    console.error(`[webhook compliance] ${topic} failed:`, e);
    return json({ error: "Internal error" }, { status: 500 });
  }
}
