import type { LoaderFunctionArgs } from "@remix-run/node";
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

  const settings = await getSettings(session.shop);

  return corsJson({
    settings: {
      useTotalAfterDiscounts: settings.useTotalAfterDiscounts,
      showLevelUpNotification: settings.showLevelUpNotification,
      showRemovalNotification: settings.showRemovalNotification,
    },
  });
}
