import type { LoaderFunctionArgs } from "@remix-run/node";
import { getSettings } from "~/models/settings.server";
import { corsJson, handleCorsPreflight } from "~/lib/cors";

export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return corsJson({ error: "Missing shop parameter" }, { status: 400 });
  }

  const settings = await getSettings(shop);

  return corsJson({
    settings: {
      useTotalAfterDiscounts: settings.useTotalAfterDiscounts,
      showLevelUpNotification: settings.showLevelUpNotification,
      showRemovalNotification: settings.showRemovalNotification,
    },
  });
}
