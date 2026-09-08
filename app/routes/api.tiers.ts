import type { LoaderFunctionArgs } from "@remix-run/node";
import { getActiveTiers } from "~/models/tier.server";
import { corsJson, handleCorsPreflight } from "~/lib/cors";

export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return corsJson({ error: "Missing shop parameter" }, { status: 400 });
  }

  const tiers = await getActiveTiers(shop);

  return corsJson({
    tiers: tiers.map((t) => ({
      id: t.id,
      minAmount: t.minAmount,
      giftPercent: t.giftPercent,
      giftAmount: t.giftAmount,
    })),
  });
}
