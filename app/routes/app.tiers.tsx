import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DataTable,
  Button,
  Badge,
  Modal,
  TextField,
  Select,
  Box,
} from "@shopify/polaris";
import { useLoaderData, useActionData, useSubmit } from "@remix-run/react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { prisma } from "~/db.server";
import {
  getTiers,
  createTier,
  updateTier,
  deleteTier,
  importDavinesTiers,
} from "~/models/tier.server";
import { DAVINES_TIERS, calculateGiftAmount } from "~/lib/tiers";

import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const tiers = await getTiers(shopId);

  return json({
    tiers: tiers.map((t) => ({
      id: t.id,
      minAmount: t.minAmount,
      minAmountEuro: (t.minAmount / 100).toFixed(2),
      giftPercent: t.giftPercent,
      giftAmount: t.giftAmount,
      giftAmountEuro: (t.giftAmount / 100).toFixed(2),
      active: t.active,
    })),
    shopId,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const shopId = formData.get("shopId") as string;

  try {
    if (intent === "create") {
      const minAmount = parseInt(formData.get("minAmount") as string) * 100;
      const giftPercent = parseFloat(formData.get("giftPercent") as string);
      const giftAmount = calculateGiftAmount(minAmount, giftPercent);

      await createTier({
        shopId,
        minAmount,
        giftPercent,
        giftAmount,
        collectionId: null,
      });

      return json({ success: true, message: "Tier created" });
    }

    if (intent === "update") {
      const id = parseInt(formData.get("id") as string);
      const active = formData.get("active") === "true";

      await updateTier(id, { active });

      return json({ success: true, message: "Tier updated" });
    }

    if (intent === "delete") {
      const id = parseInt(formData.get("id") as string);
      await deleteTier(id);
      return json({ success: true, message: "Tier deleted" });
    }

    if (intent === "import-davines") {
      const count = await importDavinesTiers(shopId);
      return json({ success: true, message: `Imported ${count} Davines tiers` });
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
  const { tiers, shopId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [showCreate, setShowCreate] = useState(false);
  const [newMinAmount, setNewMinAmount] = useState("");
  const [newPercent, setNewPercent] = useState("");

  const rows = tiers.map((t) => [
    `${t.minAmountEuro} €`,
    `${t.giftPercent.toFixed(1)}%`,
    `${t.giftAmountEuro} €`,
    t.active ? (
      <Badge tone="success">Active</Badge>
    ) : (
      <Badge tone="critical">Inactive</Badge>
    ),
    <Button
      size="slim"
      onClick={() => {
        const formData = new FormData();
        formData.append("intent", "delete");
        formData.append("id", String(t.id));
        formData.append("shopId", shopId);
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
    formData.append("shopId", shopId);
    formData.append("minAmount", newMinAmount);
    formData.append("giftPercent", newPercent);
    submit(formData, { method: "post" });
    setShowCreate(false);
    setNewMinAmount("");
    setNewPercent("");
  };

  const handleImportDavines = () => {
    const formData = new FormData();
    formData.append("intent", "import-davines");
    formData.append("shopId", shopId);
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
                        No tiers configured yet. Import the Davines preset or create custom tiers.
                      </Text>
                      <Button variant="primary" onClick={handleImportDavines}>
                        {`Import Davines Preset (${DAVINES_TIERS.length} tiers)`}
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
                    <Button onClick={handleImportDavines}>
                      Reset to Davines Preset
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
              label="Minimum Amount (EUR)"
              type="number"
              value={newMinAmount}
              onChange={setNewMinAmount}
              autoComplete="off"
              placeholder="e.g., 130"
              helpText="Cart total threshold in euros"
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
                    {(
                      Math.round(
                        (parseFloat(newMinAmount) * 100 * parseFloat(newPercent)) / 100,
                      ) / 100
                    ).toFixed(2)}{" "}
                    €
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
