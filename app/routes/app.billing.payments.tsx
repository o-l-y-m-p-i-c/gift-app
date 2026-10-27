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
import { getPaymentStats, getPayments, syncBilling } from "~/models/billing.server";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const billing = await syncBilling(shopId, { force: true });
  const [payments, stats] = await Promise.all([getPayments(shopId), getPaymentStats(shopId)]);
  const access = getBillingAccess(billing);
  const toDate = (date: Date) => date.toISOString().split("T")[0];

  return json({
    stats: {
      totalPaid: formatMoney(stats.totalPaid, PLAN_CURRENCY),
      paymentCount: stats.paymentCount,
      averagePayment: formatMoney(
        stats.paymentCount > 0 ? Math.round(stats.totalPaid / stats.paymentCount) : 0,
        PLAN_CURRENCY,
      ),
      lastPaymentAt: stats.lastPaymentAt ? toDate(stats.lastPaymentAt) : null,
      monthlyCost: formatMoney(access.reason === "subscribed" ? Math.round(PLAN_PRICE * 100) : 0, PLAN_CURRENCY),
      nextChargeAt:
        access.reason === "subscribed" && billing.currentPeriodEnd
          ? toDate(billing.currentPeriodEnd)
          : null,
      byMonth: stats.byMonth.map((entry) => ({
        month: entry.month,
        count: entry.count,
        amount: formatMoney(entry.amount, PLAN_CURRENCY),
      })),
    },
    payments: payments.map((payment) => ({
      id: payment.id,
      date: toDate(payment.periodStart),
      period: `${toDate(payment.periodStart)} – ${toDate(payment.periodEnd)}`,
      amount: formatMoney(payment.amount, payment.currencyCode),
      test: payment.test,
    })),
  });
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
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
  const { stats, payments } = useLoaderData<typeof loader>();

  const monthRows = stats.byMonth.map((entry) => [entry.month, entry.count, entry.amount]);
  const paymentRows = payments.map((payment) => [
    payment.date,
    payment.period,
    payment.amount,
    <InlineStack gap="100" key={payment.id}>
      <Badge tone="success">Paid</Badge>
      {payment.test && <Badge>Test</Badge>}
    </InlineStack>,
  ]);

  return (
    <Page
      title="Payment statistics"
      subtitle="Subscription charges for the Gift App"
      backAction={{ content: "Billing", url: "/app/billing" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Layout>
              <Layout.Section variant="oneThird">
                <StatCard value={stats.totalPaid} label="Total paid" />
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <StatCard value={stats.paymentCount} label="Payments" />
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <StatCard value={stats.averagePayment} label="Avg payment" />
              </Layout.Section>
            </Layout>
            <Layout>
              <Layout.Section variant="oneThird">
                <StatCard value={stats.monthlyCost} label="Current monthly cost" />
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <StatCard value={stats.lastPaymentAt ?? "—"} label="Last payment" />
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <StatCard value={stats.nextChargeAt ?? "—"} label="Next charge" />
              </Layout.Section>
            </Layout>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  By month
                </Text>
                {monthRows.length === 0 ? (
                  <Text as="p" tone="subdued">
                    No paid billing cycles yet.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric"]}
                    headings={["Month", "Payments", "Amount"]}
                    rows={monthRows}
                    totals={["", stats.paymentCount, stats.totalPaid]}
                    showTotalsInFooter
                  />
                )}
              </BlockStack>
            </Card>

            <Card>
              {paymentRows.length === 0 ? (
                <EmptyState heading="No payments yet" image="">
                  <Text as="p" tone="subdued">
                    Payments appear here after the free trial, once each 30-day
                    billing cycle is charged.
                  </Text>
                </EmptyState>
              ) : (
                <BlockStack gap="300">
                  <Text variant="headingMd" as="h2">
                    All payments
                  </Text>
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "text"]}
                    headings={["Charged", "Billing period", "Amount", "Status"]}
                    rows={paymentRows}
                  />
                  <Text as="p" tone="subdued" variant="bodySm">
                    Test charges are excluded from the totals. Charges appear on your
                    Shopify invoice, which remains the official record.
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
