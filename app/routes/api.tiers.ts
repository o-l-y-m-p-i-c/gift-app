import type { LoaderFunctionArgs } from "@remix-run/node";
import { getActiveTiers } from "~/models/tier.server";
import { getSettings } from "~/models/settings.server";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return corsJson({ error: "App proxy session is unavailable." }, { status: 401 });
  }

  const [tiers, settings] = await Promise.all([
    getActiveTiers(session.shop),
    getSettings(session.shop),
  ]);

  return corsJson({
    // Tier amounts are in this currency; the storefront converts them to
    // the customer's currency with Shopify.currency.rate.
    currencyCode: settings.currencyCode,
    tiers: tiers.map((t) => ({
      id: t.id,
      minAmount: t.minAmount,
      giftPercent: t.giftPercent,
      giftAmount: t.giftAmount,
    })),
  });
}
