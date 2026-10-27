import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { syncBilling } from "~/models/billing.server";
import { authenticate } from "~/shopify.server";

/**
 * Webhook: app_subscriptions/update
 *
 * Fires when a subscription is activated, cancelled, declined, frozen, etc.
 * Re-syncs the shop's billing state so storefront access follows it.
 */
export async function action({ request }: ActionFunctionArgs) {
  const { shop } = await authenticate.webhook(request);

  try {
    await syncBilling(shop, { force: true });
    return json({ success: true });
  } catch (e) {
    console.error("[webhook app_subscriptions/update] Error:", e);
    return json({ error: "Internal error" }, { status: 500 });
  }
}
