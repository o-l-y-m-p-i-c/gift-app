import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  DataTable,
  EmptyState,
} from "@shopify/polaris";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { PLAN_CURRENCY, PLAN_PRICE, getBillingAccess } from "~/lib/billing.server";
import { formatMoney } from "~/lib/tiers";
import { useI18n } from "~/i18n/react";
import { getPaymentStats, getPayments, syncBilling } from "~/models/billing.server";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const billing = await syncBilling(shopId, { force: true });
  const [payments, stats] = await Promise.all([getPayments(shopId), getPaymentStats(shopId)]);
  const access = getBillingAccess(billing);
  const toDate = (date: Date) => date.toISOString().split("T")[0];

  // Amounts stay in cents; the page formats them in the admin's language.
  return json({
    currency: PLAN_CURRENCY,
    stats: {
      totalPaid: stats.totalPaid,
      paymentCount: stats.paymentCount,
      averagePayment: stats.paymentCount > 0 ? Math.round(stats.totalPaid / stats.paymentCount) : 0,
      lastPaymentAt: stats.lastPaymentAt ? toDate(stats.lastPaymentAt) : null,
      monthlyCost: access.reason === "subscribed" ? Math.round(PLAN_PRICE * 100) : 0,
      nextChargeAt:
        access.reason === "subscribed" && billing.currentPeriodEnd
          ? toDate(billing.currentPeriodEnd)
          : null,
      byMonth: stats.byMonth,
    },
    payments: payments.map((payment) => ({
      id: payment.id,
      date: toDate(payment.periodStart),
      period: `${toDate(payment.periodStart)} – ${toDate(payment.periodEnd)}`,
      amount: payment.amount,
      currency: payment.currencyCode,
      test: payment.test,
    })),
  });
}

function StatCard({ value, label }: { value: string | number; label: string }) {
  return (
    <Card>
      <BlockStack gap="200" align="center">
        <Text variant="heading2xl" as="p">
          {value}
        </Text>
        <Text as="p" tone="subdued">
          {label}
        </Text>
      </BlockStack>
    </Card>
  );
}

export default function PaymentsPage() {
  const { currency, stats, payments } = useLoaderData<typeof loader>();
  const { t, locale } = useI18n();
  const money = (cents: number, code = currency) => formatMoney(cents, code, locale);

  const monthRows = stats.byMonth.map((entry) => [entry.month, entry.count, money(entry.amount)]);
  const paymentRows = payments.map((payment) => [
    payment.date,
    payment.period,
    money(payment.amount, payment.currency),
    <InlineStack gap="100" key={payment.id}>
      <Badge tone="success">{t("payments.paid")}</Badge>
      {payment.test && <Badge>{t("payments.test")}</Badge>}
    </InlineStack>,
  ]);

  return (
    <Page
      title={t("payments.title")}
      subtitle={t("payments.subtitle")}
      backAction={{ content: t("payments.back"), url: "/app/billing" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Layout>
              <Layout.Section variant="oneThird">
                <StatCard value={money(stats.totalPaid)} label={t("payments.totalPaid")} />
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <StatCard value={stats.paymentCount} label={t("payments.count")} />
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <StatCard value={money(stats.averagePayment)} label={t("payments.average")} />
              </Layout.Section>
            </Layout>
            <Layout>
              <Layout.Section variant="oneThird">
                <StatCard value={money(stats.monthlyCost)} label={t("payments.monthlyCost")} />
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <StatCard value={stats.lastPaymentAt ?? "—"} label={t("payments.lastPayment")} />
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <StatCard value={stats.nextChargeAt ?? "—"} label={t("payments.nextCharge")} />
              </Layout.Section>
            </Layout>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  {t("payments.byMonth")}
                </Text>
                {monthRows.length === 0 ? (
                  <Text as="p" tone="subdued">
                    {t("payments.noCycles")}
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric"]}
                    headings={[t("payments.colMonth"), t("payments.colPayments"), t("payments.colAmount")]}
                    rows={monthRows}
                    totals={["", stats.paymentCount, money(stats.totalPaid)]}
                    showTotalsInFooter
                  />
                )}
              </BlockStack>
            </Card>

            <Card>
              {paymentRows.length === 0 ? (
                <EmptyState heading={t("payments.emptyTitle")} image="">
                  <Text as="p" tone="subdued">
                    {t("payments.emptyBody")}
                  </Text>
                </EmptyState>
              ) : (
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    {t("payments.allPayments")}
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "text"]}
                    headings={[
                      t("payments.colCharged"),
                      t("payments.colPeriod"),
                      t("payments.colAmount"),
                      t("payments.colStatus"),
                    ]}
                    rows={paymentRows}
                  />
                  <Text as="p" tone="subdued" variant="bodySm">
                    {t("payments.note")}
                  </Text>
                </BlockStack>
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
