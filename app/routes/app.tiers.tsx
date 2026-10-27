import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Checkbox,
  DataTable,
  Button,
  Modal,
  TextField,
  Box,
} from "@shopify/polaris";
import { useLoaderData, useActionData, useSubmit } from "@remix-run/react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  getTiers,
  createTier,
  updateTier,
  deleteTier,
  importSampleTiers,
} from "~/models/tier.server";
import { getSettings } from "~/models/settings.server";
import { syncStorefrontConfig } from "~/models/storefront-config.server";
import { SAMPLE_TIERS, calculateGiftAmount, formatMoney } from "~/lib/tiers";

import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [tiers, settings] = await Promise.all([getTiers(shopId), getSettings(shopId)]);
  const currencyCode = settings.currencyCode;

  return json({
    tiers: tiers.map((t) => ({
      id: t.id,
      minAmount: t.minAmount,
      minAmountLabel: formatMoney(t.minAmount, currencyCode),
      giftPercent: t.giftPercent,
      giftAmount: t.giftAmount,
      giftAmountLabel: formatMoney(t.giftAmount, currencyCode),
      active: t.active,
    })),
    currencyCode,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  try {
    if (intent === "create") {
      const minAmount = Math.round(parseFloat(formData.get("minAmount") as string) * 100);
      const giftPercent = parseFloat(formData.get("giftPercent") as string);
      if (!Number.isFinite(minAmount) || minAmount <= 0 || !Number.isFinite(giftPercent) || giftPercent <= 0 || giftPercent > 100) {
        return json(
          { success: false, message: "Enter a positive minimum amount and a percentage between 0 and 100." },
          { status: 400 },
        );
      }
      const giftAmount = calculateGiftAmount(minAmount, giftPercent);

      await createTier({
        shopId,
        minAmount,
        giftPercent,
        giftAmount,
        collectionId: null,
      });

      await syncStorefrontConfig(shopId);
      return json({ success: true, message: "Tier created" });
    }

    if (intent === "update") {
      const id = parseInt(formData.get("id") as string);
      const active = formData.get("active") === "true";

      await updateTier(id, shopId, { active });

      await syncStorefrontConfig(shopId);
      return json({ success: true, message: "Tier updated" });
    }

    if (intent === "delete") {
      const id = parseInt(formData.get("id") as string);
      await deleteTier(id, shopId);
      await syncStorefrontConfig(shopId);
      return json({ success: true, message: "Tier deleted" });
    }

    if (intent === "import-sample") {
      const count = await importSampleTiers(shopId);
      await syncStorefrontConfig(shopId);
      return json({ success: true, message: `Loaded ${count} sample tiers` });
    }

    return json({ success: false, message: "Unknown intent" }, { status: 400 });
  } catch (error) {
    return json(
      { success: false, message: (error as Error).message },
      { status: 500 },
    );
  }
}

export default function TiersPage() {
  const { tiers, currencyCode } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [showCreate, setShowCreate] = useState(false);
  const [newMinAmount, setNewMinAmount] = useState("");
  const [newPercent, setNewPercent] = useState("");

  const handleTierActiveChange = (id: number, active: boolean) => {
    const formData = new FormData();
    formData.append("intent", "update");
    formData.append("id", String(id));
    formData.append("active", String(active));
    submit(formData, { method: "post" });
  };

  const rows = tiers.map((t) => [
    t.minAmountLabel,
    `${t.giftPercent.toFixed(1)}%`,
    t.giftAmountLabel,
    <Checkbox
      label={t.active ? "Active" : "Inactive"}
      labelHidden
      checked={t.active}
      onChange={(checked) => handleTierActiveChange(t.id, checked)}
    />,
    <Button
      size="slim"
      onClick={() => {
        const formData = new FormData();
        formData.append("intent", "delete");
        formData.append("id", String(t.id));
            submit(formData, { method: "post" });
      }}
      tone="critical"
    >
      Delete
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

  return (
    <Page title="Gift Tiers" subtitle="Configure threshold amounts and gift percentages">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData && (
              <Card>
                <Text as="p" tone={actionData.success ? "success" : "critical"}>
                  {actionData.message}
                </Text>
              </Card>
            )}

            <Card>
              <BlockStack gap="400">
                <Box paddingBlock="200">
                  <Text variant="headingMd" as="h2">
                    Threshold Tiers ({tiers.length})
                  </Text>
                </Box>

                {tiers.length === 0 ? (
                  <Box paddingBlock="400">
                    <BlockStack gap="300" align="center">
                      <Text as="p" tone="subdued">
                        No tiers configured yet. Load the sample tiers or create your own.
                      </Text>
                      <Button variant="primary" onClick={handleImportSample}>
                        {`Load sample tiers (${SAMPLE_TIERS.length})`}
                      </Button>
                    </BlockStack>
                  </Box>
                ) : (
                  <>
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "numeric"]}
                      headings={["Min Amount", "Gift %", "Max Gift Price", "Status", ""]}
                      rows={rows}
                    />
                    <Button onClick={handleImportSample}>
                      Replace with sample tiers
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
                Add Tier
              </Text>
              <Button variant="primary" fullWidth onClick={() => setShowCreate(true)}>
                Create Custom Tier
              </Button>
              <Box paddingBlock="200">
                <Text as="p" tone="subdued">
                  Formula: gift = round(minAmount × percent / 100)
                </Text>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Gift Tier"
        primaryAction={{
          content: "Create",
          onAction: handleCreate,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowCreate(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label={`Minimum amount (${currencyCode})`}
              type="number"
              value={newMinAmount}
              onChange={setNewMinAmount}
              autoComplete="off"
              placeholder="e.g., 100"
              helpText="Cart total threshold in your shop currency"
            />
            <TextField
              label="Gift Percentage"
              type="number"
              value={newPercent}
              onChange={setNewPercent}
              autoComplete="off"
              placeholder="e.g., 9.0"
              helpText="Percentage of threshold for max gift price"
              suffix="%"
            />
            {newMinAmount && newPercent && (
              <Box padding="300" background="bg-surface-secondary" borderRadius="200">
                <BlockStack gap="200">
                  <Text as="p" tone="subdued">Preview:</Text>
                  <Text as="p">
                    Max gift price:{" "}
                    {formatMoney(
                      calculateGiftAmount(
                        Math.round(parseFloat(newMinAmount) * 100),
                        parseFloat(newPercent),
                      ),
                      currencyCode,
                    )}
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
