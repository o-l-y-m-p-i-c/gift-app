import { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  ChoiceList,
  Button,
  Box,
  DataTable,
  TextField,
  Tag,
  InlineStack,
} from "@shopify/polaris";
import { useLoaderData, useActionData, useSubmit } from "@remix-run/react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  getSettings,
  updateSettings,
  fetchCollectionsForPicker,
  fetchProductTagsForPicker,
} from "~/models/settings.server";
import { authenticate } from "~/shopify.server";

type CollectionInfo = {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const settings = await getSettings(shopId);
  const collections = await fetchCollectionsForPicker();
  const tags = await fetchProductTagsForPicker();

  return json({
    settings: {
      useTotalAfterDiscounts: settings.useTotalAfterDiscounts,
      showLevelUpNotification: settings.showLevelUpNotification,
      showRemovalNotification: settings.showRemovalNotification,
      active: settings.active,
      excludedCollections: settings.excludedCollections || [],
      excludedTags: settings.excludedTags || [],
    },
    collections,
    tags,
    shopId,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const shopId = formData.get("shopId") as string;
  const useTotalAfterDiscounts = formData.get("useTotalAfterDiscounts") === "true";
  const showLevelUpNotification = formData.get("showLevelUpNotification") === "true";
  const showRemovalNotification = formData.get("showRemovalNotification") === "true";
  const excludedCollectionsRaw = formData.get("excludedCollections") as string;
  const excludedCollections = excludedCollectionsRaw
    ? excludedCollectionsRaw.split(",").filter(Boolean)
    : [];
  const excludedTagsRaw = formData.get("excludedTags") as string;
  const excludedTags = excludedTagsRaw
    ? excludedTagsRaw.split(",").filter(Boolean)
    : [];

  await updateSettings(shopId, {
    useTotalAfterDiscounts,
    showLevelUpNotification,
    showRemovalNotification,
    excludedCollections,
    excludedTags,
  });

  return json({ success: true, message: "Settings saved" });
}

export default function SettingsPage() {
  const { settings, collections, tags, shopId } = useLoaderData<typeof loader>();
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

  // Excluded collections state
  const [excludedIds, setExcludedIds] = useState<string[]>(settings.excludedCollections);
  const [searchQuery, setSearchQuery] = useState("");

  // Excluded tags state
  const [excludedTagSet, setExcludedTagSet] = useState<string[]>(settings.excludedTags);
  const [tagSearchQuery, setTagSearchQuery] = useState("");
  const [customTag, setCustomTag] = useState("");

  // Sync state when loader data changes (e.g. after save)
  useEffect(() => {
    setExcludedIds(settings.excludedCollections);
    setExcludedTagSet(settings.excludedTags);
  }, [settings.excludedCollections, settings.excludedTags]);

  const allCollections = (collections as CollectionInfo[]) || [];
  const filteredCollections = allCollections.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const allTags = (tags as string[]) || [];
  const filteredTags = allTags.filter((tag) =>
    tag.toLowerCase().includes(tagSearchQuery.toLowerCase()),
  );

  // Split into excluded and available
  const excludedCollections = excludedIds
    .map((id) => allCollections.find((c) => c.id === id))
    .filter(Boolean) as CollectionInfo[];
  const availableCollections = filteredCollections.filter(
    (c) => !excludedIds.includes(c.id),
  );

  // Split tags into excluded and available
  const availableTags = filteredTags.filter((tag) => !excludedTagSet.includes(tag));

  const handleAddExclusion = (collectionId: string) => {
    setExcludedIds([...excludedIds, collectionId]);
  };

  const handleRemoveExclusion = (collectionId: string) => {
    setExcludedIds(excludedIds.filter((id) => id !== collectionId));
  };

  const handleAddTagExclusion = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !excludedTagSet.includes(trimmed)) {
      setExcludedTagSet([...excludedTagSet, trimmed]);
    }
  };

  const handleRemoveTagExclusion = (tag: string) => {
    setExcludedTagSet(excludedTagSet.filter((t) => t !== tag));
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.append("shopId", shopId);
    formData.append("useTotalAfterDiscounts", String(thresholdMode[0] === "after"));
    formData.append("showLevelUpNotification", String(notifications.includes("levelUp")));
    formData.append("showRemovalNotification", String(notifications.includes("removal")));
    formData.append("excludedCollections", excludedIds.join(","));
    formData.append("excludedTags", excludedTagSet.join(","));
    submit(formData, { method: "post" });
  };

  // DataTable rows for excluded collections
  const excludedRows = excludedCollections.map((c) => [
    c.title,
    `${c.productsCount} products`,
    <Button
      size="slim"
      tone="critical"
      onClick={() => handleRemoveExclusion(c.id)}
    >
      Remove
    </Button>,
  ]);

  // DataTable rows for available collections
  const availableRows = availableCollections.map((c) => [
    c.title,
    `${c.productsCount} products`,
    <Button
      size="slim"
      onClick={() => handleAddExclusion(c.id)}
    >
      Exclude
    </Button>,
  ]);

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

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Excluded Collections ({excludedCollections.length})
                </Text>
                <Text as="p" tone="subdued">
                  Products from these collections will not be shown as available gifts.
                  Products already in the cart are also excluded automatically.
                </Text>

                {excludedCollections.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric"]}
                    headings={["Collection", "Products", ""]}
                    rows={excludedRows}
                  />
                ) : (
                  <Box paddingBlock="300">
                    <Text as="p" tone="subdued">
                      No collections excluded. All products are eligible as gifts.
                    </Text>
                  </Box>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Available Collections ({availableCollections.length})
                </Text>
                <TextField
                  label="Search collections"
                  value={searchQuery}
                  onChange={setSearchQuery}
                  autoComplete="off"
                  placeholder="Type to filter..."
                />
                {availableCollections.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric"]}
                    headings={["Collection", "Products", ""]}
                    rows={availableRows}
                  />
                ) : (
                  <Box paddingBlock="300">
                    <Text as="p" tone="subdued">
                      {allCollections.length === 0
                        ? "No collections found. Make sure the Admin API token is configured."
                        : "All collections are excluded or no matches found."}
                    </Text>
                  </Box>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  Excluded Tags ({excludedTagSet.length})
                </Text>
                <Text as="p" tone="subdued">
                  Products with any of these tags will not be shown as available gifts.
                </Text>

                {excludedTagSet.length > 0 ? (
                  <InlineStack gap="200" wrap>
                    {excludedTagSet.map((tag) => (
                      <Tag
                        key={tag}
                        onRemove={() => handleRemoveTagExclusion(tag)}
                      >
                        {tag}
                      </Tag>
                    ))}
                  </InlineStack>
                ) : (
                  <Box paddingBlock="200">
                    <Text as="p" tone="subdued">
                      No tags excluded.
                    </Text>
                  </Box>
                )}

                <Box paddingBlock="200">
                  <Text as="p" tone="subdued">
                    Add a custom tag (even if it doesn't exist yet):
                  </Text>
                </Box>
                <InlineStack gap="200" align="start">
                  <div style={{ flex: 1, maxWidth: "300px" }}>
                    <TextField
                      label="Custom tag"
                      labelHidden
                      value={customTag}
                      onChange={setCustomTag}
                      autoComplete="off"
                      placeholder="e.g., no-gift, sample, gift-card"
                    />
                  </div>
                  <Button
                    onClick={() => {
                      handleAddTagExclusion(customTag);
                      setCustomTag("");
                    }}
                  >
                    Add Tag
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {allTags.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    Available Tags ({availableTags.length})
                  </Text>
                  <TextField
                    label="Search tags"
                    value={tagSearchQuery}
                    onChange={setTagSearchQuery}
                    autoComplete="off"
                    placeholder="Type to filter..."
                  />
                  {availableTags.length > 0 ? (
                    <InlineStack gap="200" wrap>
                      {availableTags.slice(0, 100).map((tag) => (
                        <Tag
                          key={tag}
                          onClick={() => handleAddTagExclusion(tag)}
                        >
                          {tag}
                        </Tag>
                      ))}
                      {availableTags.length > 100 && (
                        <Text as="p" tone="subdued">
                          Showing first 100 tags. Use search to filter.
                        </Text>
                      )}
                    </InlineStack>
                  ) : (
                    <Box paddingBlock="300">
                      <Text as="p" tone="subdued">
                        {allTags.length === 0
                          ? "No product tags found in the store."
                          : "All tags are excluded or no matches found."}
                      </Text>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            )}

            <Button variant="primary" onClick={handleSave}>
              Save Settings
            </Button>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
