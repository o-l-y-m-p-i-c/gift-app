import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import { deleteSessionsForShop } from "~/lib/admin-api.server";
import { clearSubscription } from "~/models/billing.server";
import { authenticate } from "~/shopify.server";

/**
 * Webhook: app/uninstalled
 *
 * When a merchant uninstalls the app, Shopify revokes the OAuth
 * access token. We proactively delete all stored sessions for
 * that shop so the next install creates a fresh session instead
 * of leaving a stale 401-causing row in the Session table.
 */
export async function action({ request }: ActionFunctionArgs) {
  // Verifies the HMAC signature; throws a 401 response for forged requests.
  const { shop } = await authenticate.webhook(request);

  try {
    const deleted = await deleteSessionsForShop(shop);
    console.info(
      `[webhook app/uninstalled] Deleted ${deleted} session(s) for ${shop}`,
    );

    // Optionally deactivate gift tiers for the uninstalled shop
    await prisma.giftTier
      .updateMany({ where: { shopId: shop }, data: { active: false } })
      .catch(() => {});

    // Shopify cancels the app subscription on uninstall; the trial start is
    // kept so a reinstall doesn't grant a new trial.
    await clearSubscription(shop).catch(() => {});

    return json({ success: true, deletedSessions: deleted });
  } catch (e) {
    console.error("[webhook app/uninstalled] Error:", e);
    return json({ error: "Internal error" }, { status: 500 });
  }
}
