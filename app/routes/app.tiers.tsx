import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DataTable,
  Button,
  Modal,
  TextField,
  Box,
} from "@shopify/polaris";
import { useLoaderData, useActionData, useFetcher, useSubmit } from "@remix-run/react";
import { Switch } from "~/components/Switch";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  DuplicateTierError,
  getTiers,
  createTier,
  updateTier,
  deleteTier,
  importSampleTiers,
} from "~/models/tier.server";
import { getSettings } from "~/models/settings.server";
import { syncStorefrontConfig } from "~/models/storefront-config.server";
import { SAMPLE_TIERS, calculateGiftAmount, formatMoney } from "~/lib/tiers";
import type { MessageKey } from "~/i18n";
import { useI18n } from "~/i18n/react";

import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [tiers, settings] = await Promise.all([getTiers(shopId), getSettings(shopId)]);

  return json({
    tiers: tiers.map((t) => ({
      id: t.id,
      minAmount: t.minAmount,
      giftPercent: t.giftPercent,
      giftAmount: t.giftAmount,
      active: t.active,
    })),
    currencyCode: settings.currencyCode,
  });
}

/** Messages are returned as keys and translated in the browser. */
type ActionResult = {
  success: boolean;
  messageKey?: MessageKey;
  values?: Record<string, number>;
  error?: string;
};

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const result = (data: ActionResult, status = 200) => json(data, { status });

  try {
    if (intent === "create") {
      const minAmount = Math.round(parseFloat(formData.get("minAmount") as string) * 100);
      const giftPercent = parseFloat(formData.get("giftPercent") as string);
      if (!Number.isFinite(minAmount) || minAmount <= 0 || !Number.isFinite(giftPercent) || giftPercent <= 0 || giftPercent > 100) {
        return result({ success: false, messageKey: "tiers.msgInvalid" }, 400);
      }
      const giftAmount = calculateGiftAmount(minAmount, giftPercent);

      await createTier(shopId, { minAmount, giftPercent, giftAmount });

      await syncStorefrontConfig(shopId);
      return result({ success: true, messageKey: "tiers.msgCreated" });
    }

    if (intent === "update") {
      const id = String(formData.get("id"));
      const active = formData.get("active") === "true";

      await updateTier(shopId, id, { active });

      await syncStorefrontConfig(shopId);
      return result({ success: true, messageKey: "tiers.msgUpdated" });
    }

    if (intent === "delete") {
      const id = String(formData.get("id"));
      await deleteTier(shopId, id);
      await syncStorefrontConfig(shopId);
      return result({ success: true, messageKey: "tiers.msgDeleted" });
    }

    if (intent === "import-sample") {
      const count = await importSampleTiers(shopId);
      await syncStorefrontConfig(shopId);
      return result({ success: true, messageKey: "tiers.msgSampleLoaded", values: { count } });
    }

    return result({ success: false, messageKey: "common.unknownAction" }, 400);
  } catch (error) {
    if (error instanceof DuplicateTierError) {
      return result({ success: false, messageKey: "tiers.msgDuplicate" }, 400);
    }
    return result({ success: false, error: (error as Error).message }, 500);
  }
}

/**
 * Each row saves through its own fetcher: the switch flips at once, shows a
 * spinner until the change is saved and reloaded, and reverts if saving fails.
 */
function TierStatusSwitch({ id, active }: { id: string; active: boolean }) {
  const fetcher = useFetcher<typeof action>();
  const { t } = useI18n();
  const saving = fetcher.state !== "idle";
  const checked = saving ? fetcher.formData?.get("active") === "true" : active;
  const failed = !saving && fetcher.data && !fetcher.data.success ? fetcher.data : null;

  return (
    <BlockStack gap="100">
      <Switch
        checked={checked}
        loading={saving}
        label={checked ? t("tiers.active") : t("tiers.inactive")}
        onChange={(next) => fetcher.submit({ intent: "update", id, active: String(next) }, { method: "post" })}
      />
      {failed && (
        <Text as="span" tone="critical" variant="bodySm">
          {failed.messageKey ? t(failed.messageKey, failed.values) : failed.error}
        </Text>
      )}
    </BlockStack>
  );
}

export default function TiersPage() {
  const { tiers, currencyCode } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const { t, locale } = useI18n();
  const money = (cents: number) => formatMoney(cents, currencyCode, locale);

  const [showCreate, setShowCreate] = useState(false);
  const [newMinAmount, setNewMinAmount] = useState("");
  const [newPercent, setNewPercent] = useState("");

  const rows = tiers.map((tier) => [
    money(tier.minAmount),
    `${tier.giftPercent.toFixed(1)}%`,
    money(tier.giftAmount),
    <TierStatusSwitch key={`active-${tier.id}`} id={tier.id} active={tier.active} />,
    <Button
      key={`delete-${tier.id}`}
      size="slim"
      onClick={() => {
        const formData = new FormData();
        formData.append("intent", "delete");
        formData.append("id", tier.id);
        submit(formData, { method: "post" });
      }}
      tone="critical"
    >
      {t("tiers.delete")}
    </Button>,
  ]);

  const handleCreate = () => {
    const formData = new FormData();
    formData.append("intent", "create");
    formData.append("minAmount", newMinAmount);
    formData.append("giftPercent", newPercent);
    submit(formData, { method: "post" });
    setShowCreate(false);
    setNewMinAmount("");
    setNewPercent("");
  };

  const handleImportSample = () => {
    const formData = new FormData();
    formData.append("intent", "import-sample");
    submit(formData, { method: "post" });
  };

  const actionMessage = actionData?.messageKey
    ? t(actionData.messageKey, actionData.values)
    : actionData?.error;

  return (
    <Page title={t("tiers.title")} subtitle={t("tiers.subtitle")}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionMessage && (
              <Card>
                <Text as="p" tone={actionData?.success ? "success" : "critical"}>
                  {actionMessage}
                </Text>
              </Card>
            )}

            <Card>
              <BlockStack gap="400">
                <Box paddingBlock="200">
                  <Text variant="headingMd" as="h2">
                    {t("tiers.listTitle", { count: tiers.length })}
                  </Text>
                </Box>

                {tiers.length === 0 ? (
                  <Box paddingBlock="400">
                    <BlockStack gap="300" align="center">
                      <Text as="p" tone="subdued">
                        {t("tiers.empty")}
                      </Text>
                      <Button variant="primary" onClick={handleImportSample}>
                        {t("tiers.loadSample", { count: SAMPLE_TIERS.length })}
                      </Button>
                    </BlockStack>
                  </Box>
                ) : (
                  <>
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "numeric"]}
                      headings={[
                        t("tiers.colMinAmount"),
                        t("tiers.colPercent"),
                        t("tiers.colGiftAmount"),
                        t("tiers.colStatus"),
                        "",
                      ]}
                      rows={rows}
                    />
                    <Button onClick={handleImportSample}>
                      {t("tiers.replaceSample")}
                    </Button>
                  </>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">
                {t("tiers.addTitle")}
              </Text>
              <Button variant="primary" fullWidth onClick={() => setShowCreate(true)}>
                {t("tiers.createButton")}
              </Button>
              <Box paddingBlock="200">
                <Text as="p" tone="subdued">
                  {t("tiers.formula")}
                </Text>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={t("tiers.modalTitle")}
        primaryAction={{
          content: t("tiers.create"),
          onAction: handleCreate,
        }}
        secondaryActions={[{ content: t("tiers.cancel"), onAction: () => setShowCreate(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label={t("tiers.minAmountLabel", { currency: currencyCode })}
              type="number"
              value={newMinAmount}
              onChange={setNewMinAmount}
              autoComplete="off"
              placeholder={t("tiers.minAmountPlaceholder")}
              helpText={t("tiers.minAmountHelp")}
            />
            <TextField
              label={t("tiers.percentLabel")}
              type="number"
              value={newPercent}
              onChange={setNewPercent}
              autoComplete="off"
              placeholder={t("tiers.percentPlaceholder")}
              helpText={t("tiers.percentHelp")}
              suffix="%"
            />
            {newMinAmount && newPercent && (
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">{t("tiers.preview")}</Text>
                  <Text as="p">
                    {t("tiers.previewAmount", {
                      amount: money(
                        calculateGiftAmount(
                          Math.round(parseFloat(newMinAmount) * 100),
                          parseFloat(newPercent),
                        ),
                      ),
                    })}
                  </Text>
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
