import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Link,
  Button,
  Grid,
  Badge,
} from "@shopify/polaris";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link as RemixLink } from "@remix-run/react";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}

export default function Index() {
  return (
    <Page title="Gift Threshold App" subtitle="Give free gifts when customers reach cart thresholds">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  Welcome! 🎁
                </Text>
                <Text as="p" tone="subdued">
                  This app lets you offer free gifts to customers when their cart
                  total reaches configured thresholds. The gift price is calculated
                  as a percentage of the threshold amount.
                </Text>
              </BlockStack>
            </Card>

            <Grid columns={{ xs: 1, sm: 2, md: 3 }}>
              <Grid.Cell>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">
                      Gift Tiers
                    </Text>
                    <Text as="p" tone="subdued">
                      Configure threshold amounts and gift percentages. Import the
                      Davines preset (57 tiers) or create custom tiers.
                    </Text>
                    <RemixLink to="/app/tiers">
                      <Button fullWidth>Manage Tiers</Button>
                    </RemixLink>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">
                      Settings
                    </Text>
                    <Text as="p" tone="subdued">
                      Configure threshold calculation (before/after promo codes)
                      and notification preferences.
                    </Text>
                    <RemixLink to="/app/settings">
                      <Button fullWidth>Configure Settings</Button>
                    </RemixLink>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell>
                <Card>
                  <BlockStack gap="300">
                    <Text variant="headingMd" as="h3">
                      History
                    </Text>
                    <Text as="p" tone="subdued">
                      View all gifts given to customers, including order details
                      and gift values.
                    </Text>
                    <RemixLink to="/app/history">
                      <Button fullWidth>View History</Button>
                    </RemixLink>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>

            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h2">
                  How It Works
                </Text>
                <BlockStack gap="200">
                  <Text as="p">
                    1. Customer adds products to cart
                  </Text>
                  <Text as="p">
                    2. When cart total reaches a threshold, a gift widget appears
                  </Text>
                  <Text as="p">
                    3. Customer selects a free gift (price ≤ calculated max)
                  </Text>
                  <Text as="p">
                    4. Gift is added to cart with 100% discount via Cart Transform
                  </Text>
                  <Text as="p">
                    5. If promo code drops total below threshold, gift is auto-removed
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
