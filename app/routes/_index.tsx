import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Grid,
} from "@shopify/polaris";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link as RemixLink } from "@remix-run/react";
import { getBillingAccess } from "~/lib/billing.server";
import { syncBilling } from "~/models/billing.server";
import { useI18n } from "~/i18n/react";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, redirect } = await authenticate.admin(request);
  const billing = await syncBilling(session.shop);
  if (!getBillingAccess(billing).hasAccess) {
    throw redirect("/app/billing");
  }
  return null;
}

const SECTIONS = [
  { title: "dashboard.tiersTitle", body: "dashboard.tiersBody", button: "dashboard.tiersButton", to: "/app/tiers" },
  { title: "dashboard.settingsTitle", body: "dashboard.settingsBody", button: "dashboard.settingsButton", to: "/app/settings" },
  { title: "dashboard.historyTitle", body: "dashboard.historyBody", button: "dashboard.historyButton", to: "/app/history" },
] as const;

const STEPS = ["dashboard.how1", "dashboard.how2", "dashboard.how3", "dashboard.how4", "dashboard.how5"] as const;

export default function Index() {
  const { t } = useI18n();

  return (
    <Page title={t("dashboard.title")} subtitle={t("dashboard.subtitle")}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  {t("dashboard.welcomeTitle")}
                </Text>
                <Text as="p" tone="subdued">
                  {t("dashboard.welcomeBody")}
                </Text>
              </BlockStack>
            </Card>

            <Grid columns={{ xs: 1, sm: 2, md: 3, lg: 3, xl: 3 }}>
              {SECTIONS.map((section) => (
                <Grid.Cell key={section.to}>
                  <Card>
                    <BlockStack gap="300">
                      <Text variant="headingMd" as="h3">
                        {t(section.title)}
                      </Text>
                      <Text as="p" tone="subdued">
                        {t(section.body)}
                      </Text>
                      <RemixLink to={section.to}>
                        <Button fullWidth>{t(section.button)}</Button>
                      </RemixLink>
                    </BlockStack>
                  </Card>
                </Grid.Cell>
              ))}
            </Grid>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  {t("dashboard.howTitle")}
                </Text>
                <BlockStack gap="200">
                  {STEPS.map((step) => (
                    <Text as="p" key={step}>
                      {t(step)}
                    </Text>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
