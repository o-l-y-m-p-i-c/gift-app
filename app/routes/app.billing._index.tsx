import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Banner,
  Button,
  DataTable,
  List,
} from "@shopify/polaris";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  PLAN_CURRENCY,
  PLAN_PRICE,
  PRO_PLAN,
  TRIAL_DAYS,
  getBillingAccess,
} from "~/lib/billing.server";
import { getPaymentStats, getSubscriptions, syncBilling } from "~/models/billing.server";
import { authenticate } from "~/shopify.server";

const isTestBilling = () => process.env.SHOPIFY_BILLING_TEST === "true";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const billing = await syncBilling(shopId, { force: true });
  const [subscriptions, stats] = await Promise.all([
    getSubscriptions(shopId),
    getPaymentStats(shopId),
  ]);

  return json({
    plan: {
      name: PRO_PLAN,
      price: formatMoney(Math.round(PLAN_PRICE * 100), PLAN_CURRENCY),
      trialDays: TRIAL_DAYS,
    },
    access: getBillingAccess(billing),
    subscriptionId: billing.subscriptionId,
    currentPeriodEnd: billing.currentPeriodEnd?.toISOString().split("T")[0] ?? null,
    subscriptions: subscriptions.map((sub) => ({
      id: sub.id,
      name: sub.name,
      status: sub.status,
      test: sub.test,
      price: formatMoney(sub.amount, sub.currencyCode),
      trialDays: sub.trialDays,
      date: sub.createdAt.toISOString().split("T")[0],
    })),
    stats: {
      totalPaid: formatMoney(stats.totalPaid, PLAN_CURRENCY),
      paymentCount: stats.paymentCount,
    },
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);
  const shopId = session.shop;
  const intent = (await request.formData()).get("intent");
  const state = await syncBilling(shopId, { force: true });
  const access = getBillingAccess(state);

  if (intent === "subscribe") {
    if (access.reason === "dev_store") {
      return json({ error: "Development stores use the app for free." }, { status: 400 });
    }
    if (access.reason === "subscribed") {
      return json({ error: "The shop already has an active subscription." }, { status: 400 });
    }
    // Carry the remaining app trial over to the Shopify charge so the
    // merchant isn't billed before the 14 days are up.
    await billing.request({
      plan: PRO_PLAN,
      isTest: isTestBilling(),
      trialDays: access.trialDaysLeft,
    });
  }

  if (intent === "cancel" && state.subscriptionId) {
    await billing.cancel({
      subscriptionId: state.subscriptionId,
      isTest: isTestBilling(),
      prorate: true,
    });
    await syncBilling(shopId, { force: true });
    return json({ error: null, message: "Subscription cancelled." });
  }

  return json({ error: "Unknown action." }, { status: 400 });
}

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

const STATUS_TONE: Record<string, "success" | "attention" | "critical" | "info" | undefined> = {
  ACTIVE: "success",
  PENDING: "attention",
  FROZEN: "attention",
  DECLINED: "critical",
  CANCELLED: undefined,
  EXPIRED: undefined,
};

export default function BillingPage() {
  const { plan, access, currentPeriodEnd, subscriptions, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const busyIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : null;
  const planPrice = plan.price;
  const trialEnd = access.trialEndsAt.split("T")[0];

  const statusBadge = {
    dev_store: <Badge tone="info">Development store — free</Badge>,
    subscribed: <Badge tone="success">Active</Badge>,
    trial: <Badge tone="attention">{`Free trial · ${access.trialDaysLeft} day(s) left`}</Badge>,
    trial_expired: <Badge tone="critical">Trial ended</Badge>,
  }[access.reason];

  const rows = subscriptions.map((sub) => [
    sub.date,
    sub.name,
    sub.price,
    `${sub.trialDays} days`,
    <InlineStack gap="100" key={sub.id}>
      <Badge tone={STATUS_TONE[sub.status]}>{sub.status}</Badge>
      {sub.test && <Badge>Test</Badge>}
    </InlineStack>,
  ]);

  return (
    <Page title="Billing" subtitle="Manage your Gift App subscription">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {access.reason === "trial_expired" && (
              <Banner tone="critical" title="Your free trial has ended">
                <Text as="p">
                  Gifts are paused on your storefront. Subscribe to turn them back on.
                </Text>
              </Banner>
            )}
            {actionData?.error && <Banner tone="critical">{actionData.error}</Banner>}
            {actionData && "message" in actionData && actionData.message && (
              <Banner tone="success">{actionData.message}</Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    {plan.name}
                  </Text>
                  {statusBadge}
                </InlineStack>

                <Text variant="heading2xl" as="p">
                  {planPrice}
                  <Text as="span" variant="bodyMd" tone="subdued">
                    {" "}/ month
                  </Text>
                </Text>

                <List>
                  <List.Item>{plan.trialDays}-day free trial</List.Item>
                  <List.Item>Free forever on Shopify development stores</List.Item>
                  <List.Item>Unlimited gift tiers and gifts</List.Item>
                  <List.Item>Billed through your Shopify invoice every 30 days</List.Item>
                </List>

                {access.reason === "trial" && (
                  <Text as="p" tone="subdued">
                    Your trial ends on {trialEnd}. Subscribing now won't charge you
                    until then.
                  </Text>
                )}
                {access.reason === "subscribed" && currentPeriodEnd && (
                  <Text as="p" tone="subdued">
                    Current billing period ends on {currentPeriodEnd}.
                  </Text>
                )}
                {access.reason === "dev_store" && (
                  <Text as="p" tone="subdued">
                    This is a development store, so no subscription is needed. Billing
                    starts once the store moves to a paid Shopify plan.
                  </Text>
                )}

                <InlineStack gap="200">
                  {(access.reason === "trial" || access.reason === "trial_expired") && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="subscribe" />
                      <Button submit variant="primary" loading={busyIntent === "subscribe"}>
                        {`Subscribe for ${planPrice}/month`}
                      </Button>
                    </Form>
                  )}
                  {access.reason === "subscribed" && (
                    <Form
                      method="post"
                      onSubmit={(event) => {
                        if (!confirm("Cancel the subscription? Gifts stop on your storefront unless the free trial is still running.")) {
                          event.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="intent" value="cancel" />
                      <Button submit tone="critical" loading={busyIntent === "cancel"}>
                        Cancel subscription
                      </Button>
                    </Form>
                  )}
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="100">
                  <Text variant="headingMd" as="h2">
                    Payments
                  </Text>
                  <Text as="p" tone="subdued">
                    {stats.paymentCount} payment(s) · {stats.totalPaid} paid in total
                  </Text>
                </BlockStack>
                <Link to="/app/billing/payments">
                  <Button>View payment statistics</Button>
                </Link>
              </InlineStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Subscription history
                </Text>
                {rows.length === 0 ? (
                  <Text as="p" tone="subdued">
                    No subscriptions yet.
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={["Created", "Plan", "Price", "Trial", "Status"]}
                    rows={rows}
                  />
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
