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
  Modal,
} from "@shopify/polaris";
import { useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
  useSubmit,
} from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  PLAN_CURRENCY,
  PLAN_PRICE,
  PRO_PLAN,
  TRIAL_DAYS,
  getBillingAccess,
} from "~/lib/billing.server";
import { formatMoney } from "~/lib/tiers";
import type { MessageKey } from "~/i18n";
import { useI18n } from "~/i18n/react";
import { getSubscriptions, syncBilling } from "~/models/billing.server";
import { authenticate } from "~/shopify.server";

const isTestBilling = () => process.env.SHOPIFY_BILLING_TEST === "true";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const billing = await syncBilling(shopId, { force: true });
  const subscriptions = await getSubscriptions(shopId);

  // Amounts stay in cents; the page formats them in the admin's language.
  return json({
    plan: {
      name: PRO_PLAN,
      price: Math.round(PLAN_PRICE * 100),
      currency: PLAN_CURRENCY,
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
      amount: sub.amount,
      currency: sub.currencyCode,
      trialDays: sub.trialDays,
      date: sub.createdAt.toISOString().split("T")[0],
    })),
  });
}

/** Messages are returned as keys and translated in the browser. */
type ActionResult = { error?: MessageKey; message?: MessageKey };

export async function action({ request }: ActionFunctionArgs) {
  const { session, billing } = await authenticate.admin(request);
  const shopId = session.shop;
  const intent = (await request.formData()).get("intent");
  const state = await syncBilling(shopId, { force: true });
  const access = getBillingAccess(state);
  const result = (data: ActionResult, status = 200) => json(data, { status });

  if (intent === "subscribe") {
    if (access.reason === "dev_store") {
      return result({ error: "billing.errDevStore" }, 400);
    }
    if (access.reason === "subscribed") {
      return result({ error: "billing.errSubscribed" }, 400);
    }
    try {
      // Carry the remaining app trial over to the Shopify charge so the
      // merchant isn't billed before the 14 days are up. On success this
      // throws a redirect to Shopify's approval page.
      await billing.request({
        plan: PRO_PLAN,
        isTest: isTestBilling(),
        trialDays: access.trialDaysLeft,
      });
    } catch (error) {
      if (error instanceof Response) throw error;
      console.error("[billing] Subscription request failed:", error);
      return result({ error: "billing.errRequest" }, 502);
    }
  }

  if (intent === "cancel" && state.subscriptionId) {
    try {
      await billing.cancel({
        subscriptionId: state.subscriptionId,
        isTest: isTestBilling(),
        prorate: true,
      });
    } catch (error) {
      if (error instanceof Response) throw error;
      console.error("[billing] Cancel failed:", error);
      return result({ error: "billing.errRequest" }, 502);
    }
    await syncBilling(shopId, { force: true });
    return result({ message: "billing.msgCancelled" });
  }

  return result({ error: "billing.errUnknown" }, 400);
}

// Same tones as Retail Network Map's Billing page.
const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "info" | undefined> = {
  ACTIVE: "success",
  PENDING: "warning",
  FROZEN: "warning",
  DECLINED: "critical",
  CANCELLED: undefined,
  EXPIRED: undefined,
};

export default function BillingPage() {
  const { plan, access, currentPeriodEnd, subscriptions } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const submit = useSubmit();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { t, locale } = useI18n();
  const busyIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : null;
  const planPrice = formatMoney(plan.price, plan.currency, locale);
  // Dates in the admin's local format; stored values are UTC calendar dates.
  const date = (value: string) => new Date(value).toLocaleDateString(locale, { timeZone: "UTC" });
  const trialEnd = date(access.trialEndsAt);

  const statusBadge = {
    dev_store: <Badge tone="info">{t("billing.badgeDevStore")}</Badge>,
    subscribed: <Badge tone="success">{t("billing.badgeActive")}</Badge>,
    trial: <Badge tone="warning">{t("billing.badgeTrial", { days: access.trialDaysLeft })}</Badge>,
    trial_expired: <Badge tone="critical">{t("billing.badgeTrialEnded")}</Badge>,
  }[access.reason];

  const rows = subscriptions.map((sub) => [
    date(sub.date),
    sub.name,
    formatMoney(sub.amount, sub.currency, locale),
    t("billing.trialDays", { days: sub.trialDays }),
    <InlineStack gap="100" key={sub.id}>
      <Badge tone={STATUS_TONE[sub.status]}>{sub.status}</Badge>
      {sub.test && <Badge>{t("billing.test")}</Badge>}
    </InlineStack>,
  ]);

  return (
    <Page title={t("billing.title")}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {access.reason === "trial_expired" && (
              <Banner tone="critical" title={t("billing.trialEndedTitle")}>
                <Text as="p">{t("billing.trialEndedBody")}</Text>
              </Banner>
            )}
            {actionData?.error && <Banner tone="critical">{t(actionData.error)}</Banner>}
            {actionData?.message && <Banner tone="success">{t(actionData.message)}</Banner>}

            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">
                    {plan.name}
                  </Text>
                  {statusBadge}
                </InlineStack>

                <Text variant="headingLg" as="p">
                  {planPrice} {t("billing.perMonth")}
                </Text>

                <List>
                  <List.Item>{t("billing.featureTrial", { days: plan.trialDays })}</List.Item>
                  <List.Item>{t("billing.featureDevStores")}</List.Item>
                  <List.Item>{t("billing.featureUnlimited")}</List.Item>
                  <List.Item>{t("billing.featureInvoice")}</List.Item>
                </List>

                {access.reason === "trial" && (
                  <Text as="p" tone="subdued">
                    {t("billing.trialEndsOn", { date: trialEnd })}
                  </Text>
                )}
                {access.reason === "subscribed" && currentPeriodEnd && (
                  <Text as="p" tone="subdued">
                    {t("billing.periodEndsOn", { date: date(currentPeriodEnd) })}
                  </Text>
                )}
                {access.reason === "dev_store" && (
                  <Text as="p" tone="subdued">
                    {t("billing.devStoreNote")}
                  </Text>
                )}

                <InlineStack gap="200">
                  {(access.reason === "trial" || access.reason === "trial_expired") && (
                    <Form method="post">
                      <input type="hidden" name="intent" value="subscribe" />
                      <Button submit variant="primary" loading={busyIntent === "subscribe"}>
                        {t("billing.subscribe", { price: planPrice })}
                      </Button>
                    </Form>
                  )}
                  {access.reason === "subscribed" && (
                    <Button tone="critical" loading={busyIntent === "cancel"} onClick={() => setConfirmCancel(true)}>
                      {t("billing.cancel")}
                    </Button>
                  )}
                  <Button loading={revalidator.state === "loading"} onClick={() => revalidator.revalidate()}>
                    {t("billing.refresh")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  {t("billing.historyTitle")}
                </Text>
                {rows.length === 0 ? (
                  <Text as="p" tone="subdued">
                    {t("billing.noSubscriptions")}
                  </Text>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text", "text"]}
                    headings={[
                      t("billing.colCreated"),
                      t("billing.colPlan"),
                      t("billing.colPrice"),
                      t("billing.colTrial"),
                      t("billing.colStatus"),
                    ]}
                    rows={rows}
                  />
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>

      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t("billing.cancelTitle")}
        primaryAction={{
          content: t("billing.cancel"),
          destructive: true,
          onAction: () => {
            setConfirmCancel(false);
            submit({ intent: "cancel" }, { method: "post" });
          },
        }}
        secondaryActions={[{ content: t("billing.keep"), onAction: () => setConfirmCancel(false) }]}
      >
        <Modal.Section>
          <Text as="p">{t("billing.cancelConfirm")}</Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
