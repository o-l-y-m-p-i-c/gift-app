import { useEffect, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  DataTable,
  Button,
  Modal,
  TextField,
  Box,
  Banner,
  Checkbox,
  DropZone,
  List,
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
  importTiers,
} from "~/models/tier.server";
import { getSettings } from "~/models/settings.server";
import { syncStorefrontConfig } from "~/models/storefront-config.server";
import {
  MAX_IMPORT_TIERS,
  SAMPLE_TIERS,
  calculateGiftAmount,
  formatMoney,
  parseTiersCsv,
  tiersToCsv,
} from "~/lib/tiers";
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
  importErrors?: { key: MessageKey; values?: Record<string, number> }[];
};

const MAX_IMPORT_BYTES = 100_000;

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

    if (intent === "import-csv") {
      const csv = String(formData.get("csv") ?? "");
      if (csv.length > MAX_IMPORT_BYTES) {
        return result({ success: false, importErrors: [{ key: "tiers.importErrTooMany", values: { max: MAX_IMPORT_TIERS } }] }, 400);
      }
      const parsed = parseTiersCsv(csv);
      if (parsed.errors.length > 0) {
        return result({ success: false, importErrors: parsed.errors.slice(0, 10) }, 400);
      }
      const counts = await importTiers(shopId, parsed.tiers, { replace: formData.get("replace") === "true" });
      await syncStorefrontConfig(shopId);
      return result({ success: true, messageKey: "tiers.msgImported", values: { count: parsed.tiers.length, ...counts } });
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

function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Import modal: reads the CSV in the browser and posts its text; stays open to show row errors. */
function ImportTiersModal({
  open,
  onClose,
  onImported,
  currencyCode,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (message: string) => void;
  currencyCode: string;
}) {
  const fetcher = useFetcher<typeof action>();
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [replace, setReplace] = useState(false);
  const [readError, setReadError] = useState(false);
  const importing = fetcher.state !== "idle";
  const data = fetcher.state === "idle" ? fetcher.data : undefined;

  useEffect(() => {
    if (data?.success && data.messageKey) {
      onImported(t(data.messageKey, data.values));
      setFile(null);
      setReplace(false);
    }
    // Runs once per finished import; `t` and `onImported` are stable enough for this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleImport = async () => {
    if (!file) return;
    try {
      const csv = await file.text();
      setReadError(false);
      fetcher.submit({ intent: "import-csv", csv, replace: String(replace) }, { method: "post" });
    } catch {
      setReadError(true);
    }
  };

  const errors = [
    ...(readError ? [t("tiers.importErrRead")] : []),
    ...(data && !data.success
      ? data.importErrors?.map((e) => t(e.key, e.values)) ?? [data.messageKey ? t(data.messageKey, data.values) : data.error ?? ""]
      : []),
  ].filter(Boolean);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("tiers.importTitle")}
      primaryAction={{ content: t("tiers.importButton"), onAction: handleImport, loading: importing, disabled: !file }}
      secondaryActions={[{ content: t("tiers.cancel"), onAction: onClose, disabled: importing }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            {t("tiers.importHelp", { currency: currencyCode })}
          </Text>
          {errors.length > 0 && (
            <Banner tone="critical">
              <List>
                {errors.map((message) => (
                  <List.Item key={message}>{message}</List.Item>
                ))}
              </List>
            </Banner>
          )}
          <DropZone
            accept=".csv,text/csv"
            allowMultiple={false}
            variableHeight
            onDrop={(_files, accepted) => {
              setFile(accepted[0] ?? null);
              setReadError(false);
            }}
          >
            {file ? (
              <Box padding="400">
                <Text as="p">{t("tiers.importFile", { name: file.name })}</Text>
              </Box>
            ) : (
              <DropZone.FileUpload actionTitle={t("tiers.importDrop")} actionHint={t("tiers.importDropHint")} />
            )}
          </DropZone>
          <Checkbox label={t("tiers.importReplace")} checked={replace} onChange={setReplace} disabled={importing} />
        </BlockStack>
      </Modal.Section>
    </Modal>
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
  const [showImport, setShowImport] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);

  const handleExport = () => {
    downloadCsv(`gift-tiers-${new Date().toISOString().slice(0, 10)}.csv`, tiersToCsv(tiers));
  };

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
            {importMessage && (
              <Banner tone="success" onDismiss={() => setImportMessage(null)}>
                {importMessage}
              </Banner>
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
              <InlineStack gap="200">
                <Button onClick={() => setShowImport(true)}>{t("tiers.import")}</Button>
                <Button onClick={handleExport} disabled={tiers.length === 0}>
                  {t("tiers.export")}
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <ImportTiersModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onImported={(message) => {
          setImportMessage(message);
          setShowImport(false);
        }}
        currencyCode={currencyCode}
      />

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
