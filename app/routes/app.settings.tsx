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
import { invalidateGiftProducts } from "~/models/gift-products.server";
import { syncStorefrontConfig } from "~/models/storefront-config.server";
import { authenticate } from "~/shopify.server";
import { useI18n } from "~/i18n/react";

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
  const collections = await fetchCollectionsForPicker(shopId);
  const tags = await fetchProductTagsForPicker(shopId);

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
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;
  const formData = await request.formData();
  const useTotalAfterDiscounts = formData.get("useTotalAfterDiscounts") === "true";
  const showLevelUpNotification = formData.get("showLevelUpNotification") === "true";
  const showRemovalNotification = formData.get("showRemovalNotification") === "true";
  const active = formData.get("active") === "true";
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
    active,
    excludedCollections,
    excludedTags,
  });
  invalidateGiftProducts(shopId);
  await syncStorefrontConfig(shopId);

  return json({ success: true, messageKey: "settings.msgSaved" as const });
}

export default function SettingsPage() {
  const { settings, collections, tags } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const { t } = useI18n();

  const [thresholdMode, setThresholdMode] = useState<string[]>(
    settings.useTotalAfterDiscounts ? ["after"] : ["before"],
  );
  const [active, setActive] = useState(settings.active);
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
    formData.append("active", String(active));
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
    t("settings.productCount", { count: c.productsCount }),
    <Button
      key={c.id}
      size="slim"
      tone="critical"
      onClick={() => handleRemoveExclusion(c.id)}
    >
      {t("settings.remove")}
    </Button>,
  ]);

  // DataTable rows for available collections
  const availableRows = availableCollections.map((c) => [
    c.title,
    t("settings.productCount", { count: c.productsCount }),
    <Button
      key={c.id}
      size="slim"
      onClick={() => handleAddExclusion(c.id)}
    >
      {t("settings.exclude")}
    </Button>,
  ]);

  return (
    <Page title={t("settings.title")} subtitle={t("settings.subtitle")}>
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData && (
              <Card>
                <Text as="p" tone={actionData.success ? "success" : "critical"}>
                  {t(actionData.messageKey)}
                </Text>
              </Card>
            )}

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  {t("settings.statusTitle")}
                </Text>
                <InlineStack gap="300" blockAlign="center">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={active}
                    aria-label={t("settings.statusToggle")}
                    onClick={() => setActive((current) => !current)}
                    style={{
                      width: "52px",
                      height: "30px",
                      padding: "3px",
                      border: "0",
                      borderRadius: "999px",
                      backgroundColor: active ? "#008060" : "#8c9196",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: active ? "flex-end" : "flex-start",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        width: "24px",
                        height: "24px",
                        borderRadius: "50%",
                        backgroundColor: "#ffffff",
                        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.3)",
                      }}
                    />
                  </button>
                  <BlockStack gap="100">
                    <Text as="p" fontWeight="semibold">
                      {active ? t("settings.enabled") : t("settings.disabled")}
                    </Text>
                    <Text as="p" tone="subdued">
                      {t("settings.statusHelp")}
                    </Text>
                  </BlockStack>
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  {t("settings.thresholdTitle")}
                </Text>
                <ChoiceList
                  title={t("settings.thresholdChoice")}
                  choices={[
                    {
                      label: t("settings.thresholdBefore"),
                      value: "before",
                      helpText: t("settings.thresholdBeforeHelp"),
                    },
                    {
                      label: t("settings.thresholdAfter"),
                      value: "after",
                      helpText: t("settings.thresholdAfterHelp"),
                    },
                  ]}
                  selected={thresholdMode}
                  onChange={setThresholdMode}
                />
                <Box paddingBlock="200">
                  <Text as="p" tone="subdued">
                    {t("settings.thresholdNote")}
                  </Text>
                </Box>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  {t("settings.notificationsTitle")}
                </Text>
                <ChoiceList
                  title={t("settings.notificationsChoice")}
                  choices={[
                    {
                      label: t("settings.notifyLevelUp"),
                      value: "levelUp",
                      helpText: t("settings.notifyLevelUpHelp"),
                    },
                    {
                      label: t("settings.notifyRemoval"),
                      value: "removal",
                      helpText: t("settings.notifyRemovalHelp"),
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
                  {t("settings.excludedCollectionsTitle", { count: excludedCollections.length })}
                </Text>
                <Text as="p" tone="subdued">
                  {t("settings.excludedCollectionsHelp")}
                </Text>

                {excludedCollections.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric"]}
                    headings={[t("settings.colCollection"), t("settings.colProducts"), ""]}
                    rows={excludedRows}
                  />
                ) : (
                  <Box paddingBlock="300">
                    <Text as="p" tone="subdued">
                      {t("settings.noExcludedCollections")}
                    </Text>
                  </Box>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  {t("settings.availableCollectionsTitle", { count: availableCollections.length })}
                </Text>
                <TextField
                  label={t("settings.searchCollections")}
                  value={searchQuery}
                  onChange={setSearchQuery}
                  autoComplete="off"
                  placeholder={t("settings.searchPlaceholder")}
                />
                {availableCollections.length > 0 ? (
                  <DataTable
                    columnContentTypes={["text", "text", "numeric"]}
                    headings={[t("settings.colCollection"), t("settings.colProducts"), ""]}
                    rows={availableRows}
                  />
                ) : (
                  <Box paddingBlock="300">
                    <Text as="p" tone="subdued">
                      {allCollections.length === 0
                        ? t("settings.noCollections")
                        : t("settings.noCollectionMatches")}
                    </Text>
                  </Box>
                )}
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">
                  {t("settings.excludedTagsTitle", { count: excludedTagSet.length })}
                </Text>
                <Text as="p" tone="subdued">
                  {t("settings.excludedTagsHelp")}
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
                      {t("settings.noExcludedTags")}
                    </Text>
                  </Box>
                )}

                <Box paddingBlock="200">
                  <Text as="p" tone="subdued">
                    {t("settings.customTagHelp")}
                  </Text>
                </Box>
                <InlineStack gap="200" align="start">
                  <div style={{ flex: 1, maxWidth: "300px" }}>
                    <TextField
                      label={t("settings.customTagLabel")}
                      labelHidden
                      value={customTag}
                      onChange={setCustomTag}
                      autoComplete="off"
                      placeholder={t("settings.customTagPlaceholder")}
                    />
                  </div>
                  <Button
                    onClick={() => {
                      handleAddTagExclusion(customTag);
                      setCustomTag("");
                    }}
                  >
                    {t("settings.addTag")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {allTags.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd" as="h2">
                    {t("settings.availableTagsTitle", { count: availableTags.length })}
                  </Text>
                  <TextField
                    label={t("settings.searchTags")}
                    value={tagSearchQuery}
                    onChange={setTagSearchQuery}
                    autoComplete="off"
                    placeholder={t("settings.searchPlaceholder")}
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
                          {t("settings.tagLimit")}
                        </Text>
                      )}
                    </InlineStack>
                  ) : (
                    <Box paddingBlock="300">
                      <Text as="p" tone="subdued">
                        {allTags.length === 0
                          ? t("settings.noTags")
                          : t("settings.noTagMatches")}
                      </Text>
                    </Box>
                  )}
                </BlockStack>
              </Card>
            )}

            <Button variant="primary" onClick={handleSave}>
              {t("settings.save")}
            </Button>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
