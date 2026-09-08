import { useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  ChoiceList,
  Button,
  Box,
} from "@shopify/polaris";
import { useLoaderData, useActionData, useSubmit } from "@remix-run/react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getSettings, updateSettings } from "~/models/settings.server";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const settings = await getSettings(shopId);

  return json({
    settings: {
      useTotalAfterDiscounts: settings.useTotalAfterDiscounts,
      showLevelUpNotification: settings.showLevelUpNotification,
      showRemovalNotification: settings.showRemovalNotification,
      active: settings.active,
    },
    shopId,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const shopId = formData.get("shopId") as string;
  const useTotalAfterDiscounts = formData.get("useTotalAfterDiscounts") === "true";
  const showLevelUpNotification = formData.get("showLevelUpNotification") === "true";
  const showRemovalNotification = formData.get("showRemovalNotification") === "true";

  await updateSettings(shopId, {
    useTotalAfterDiscounts,
    showLevelUpNotification,
    showRemovalNotification,
  });

  return json({ success: true, message: "Settings saved" });
}

export default function SettingsPage() {
  const { settings, shopId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();

  const [thresholdMode, setThresholdMode] = useState<string[]>(
    settings.useTotalAfterDiscounts ? ["after"] : ["before"],
  );
  const [notifications, setNotifications] = useState<string[]>(() => {
    const selected: string[] = [];
    if (settings.showLevelUpNotification) selected.push("levelUp");
    if (settings.showRemovalNotification) selected.push("removal");
    return selected;
  });

  const handleSave = () => {
    const formData = new FormData();
    formData.append("shopId", shopId);
    formData.append("useTotalAfterDiscounts", String(thresholdMode[0] === "after"));
    formData.append("showLevelUpNotification", String(notifications.includes("levelUp")));
    formData.append("showRemovalNotification", String(notifications.includes("removal")));
    submit(formData, { method: "post" });
  };

  return (
    <Page title="Settings" subtitle="Configure gift threshold behavior">
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
                <Text variant="headingMd" as="h2">
                  Threshold Calculation
                </Text>
                <ChoiceList
                  title="Calculate threshold from:"
                  choices={[
                    {
                      label: "Cart subtotal (before discounts/promo codes)",
                      value: "before",
                      helpText: "User qualifies for gift based on total items price, ignoring promo codes",
                    },
                    {
                      label: "Cart total (after discounts/promo codes)",
                      value: "after",
                      helpText: "User qualifies for gift based on final amount after all discounts are applied",
                    },
                  ]}
                  selected={thresholdMode}
                  onChange={setThresholdMode}
                />
                <Box paddingBlock="200">
                  <Text as="p" tone="subdued">
                    The gift product is always excluded from the threshold calculation,
                    regardless of this setting.
                  </Text>
                </Box>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Notifications
                </Text>
                <ChoiceList
                  title="Show notifications in cart:"
                  choices={[
                    {
                      label: "Level up — when a higher gift tier is unlocked",
                      value: "levelUp",
                      helpText: "Shows a celebratory message when user reaches a new threshold",
                    },
                    {
                      label: "Gift removed — when gift is auto-removed due to threshold drop",
                      value: "removal",
                      helpText: "Shows a notice when promo code or item removal drops cart below threshold",
                    },
                  ]}
                  selected={notifications}
                  onChange={setNotifications}
                  allowMultiple
                />
              </BlockStack>
            </Card>

            <Button variant="primary" onClick={handleSave}>
              Save Settings
            </Button>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
