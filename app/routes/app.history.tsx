import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Link,
  DataTable,
  EmptyState,
} from "@shopify/polaris";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getHistory, getStats } from "~/models/history.server";
import { getSettings } from "~/models/settings.server";
import { formatMoney } from "~/lib/tiers";
import { useI18n } from "~/i18n/react";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [history, stats, settings] = await Promise.all([
    getHistory(shopId),
    getStats(shopId),
    getSettings(shopId),
  ]);

  // Amounts stay in cents; the page formats them in the admin's language.
  return json({
    history: history.map((h) => ({
      id: h.id,
      orderId: h.orderId,
      orderUrl: `https://admin.shopify.com/store/${shopId.replace(".myshopify.com", "")}/orders/${encodeURIComponent(h.orderId)}`,
      giftProductTitle: h.giftProductTitle,
      giftProductPrice: h.giftProductPrice,
      cartTotal: h.cartTotal,
      thresholdBase: h.thresholdBase,
      date: h.createdAt.toISOString().split("T")[0],
    })),
    stats: {
      totalGifts: stats.totalGifts,
      totalValue: stats.totalValue,
      averageValue: stats.totalGifts > 0 ? Math.round(stats.totalValue / stats.totalGifts) : 0,
    },
    currencyCode: settings.currencyCode,
  });
}

export default function HistoryPage() {
  const { history, stats, currencyCode } = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const money = (cents: number) => formatMoney(cents, currencyCode, locale);

  const rows = history.map((h) => [
    h.date,
    <Link key={h.id} url={h.orderUrl} external>
      #{h.orderId.slice(-8)}
    </Link>,
    h.giftProductTitle,
    money(h.giftProductPrice),
    money(h.cartTotal),
    money(h.thresholdBase),
  ]);

  const statCards = [
    { value: String(stats.totalGifts), label: t("history.giftsGiven") },
    { value: money(stats.totalValue), label: t("history.totalValue") },
    { value: money(stats.averageValue), label: t("history.averageValue") },
  ];

  return (
    <Page title={t("history.title")} subtitle={t("history.subtitle")}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Layout>
              {statCards.map((card) => (
                <Layout.Section variant="oneThird" key={card.label}>
                  <Card>
                    <BlockStack gap="200" align="center">
                      <Text variant="heading2xl" as="p">
                        {card.value}
                      </Text>
                      <Text as="p" tone="subdued">{card.label}</Text>
                    </BlockStack>
                  </Card>
                </Layout.Section>
              ))}
            </Layout>

            <Card>
              {history.length === 0 ? (
                <EmptyState heading={t("history.emptyTitle")} image="">
                  <Text as="p" tone="subdued">
                    {t("history.emptyBody")}
                  </Text>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                  headings={[
                    t("history.colDate"),
                    t("history.colOrder"),
                    t("history.colProduct"),
                    t("history.colPrice"),
                    t("history.colCartTotal"),
                    t("history.colThreshold"),
                  ]}
                  rows={rows}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
