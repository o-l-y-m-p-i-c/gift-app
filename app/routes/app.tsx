import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "@remix-run/react";
import { Frame, Page, Layout, BlockStack, Text, Banner } from "@shopify/polaris";
import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-remix/server";
import { getBillingAccess } from "~/lib/billing.server";
import { syncBilling } from "~/models/billing.server";
import { useI18n } from "~/i18n/react";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, redirect } = await authenticate.admin(request);
  const billing = await syncBilling(session.shop);
  const access = getBillingAccess(billing);

  // Only the billing pages stay reachable once the trial is over.
  if (!access.hasAccess && !new URL(request.url).pathname.startsWith("/app/billing")) {
    throw redirect("/app/billing");
  }

  return json({ access });
}

export default function AppLayout() {
  const { access } = useLoaderData<typeof loader>();
  const { pathname } = useLocation();
  const { t } = useI18n();

  return (
    <Frame>
        <Page>
          <Layout>
            <Layout.Section>
              <BlockStack gap="400">
                {access.reason === "trial" && !pathname.startsWith("/app/billing") && (
                  <Banner tone="info" title={t("trialBanner.title", { days: access.trialDaysLeft })}>
                    <Text as="p">
                      {t("trialBanner.body")} <Link to="/app/billing">{t("trialBanner.link")}</Link>
                    </Text>
                  </Banner>
                )}
                <Outlet />
              </BlockStack>
            </Layout.Section>
          </Layout>
        </Page>
    </Frame>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
