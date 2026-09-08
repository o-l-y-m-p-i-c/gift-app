import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  DataTable,
  EmptyState,
} from "@shopify/polaris";
import { useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getHistory, getStats } from "~/models/history.server";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const [history, stats] = await Promise.all([
    getHistory(shopId),
    getStats(shopId),
  ]);

  return json({
    history: history.map((h) => ({
      id: h.id,
      orderId: h.orderId,
      giftProductTitle: h.giftProductTitle,
      giftProductPrice: (h.giftProductPrice / 100).toFixed(2),
      cartTotal: (h.cartTotal / 100).toFixed(2),
      thresholdBase: (h.thresholdBase / 100).toFixed(2),
      date: h.createdAt.toISOString().split("T")[0],
    })),
    stats: {
      totalGifts: stats.totalGifts,
      totalValue: (stats.totalValue / 100).toFixed(2),
    },
    shopId,
  });
}

export default function HistoryPage() {
  const { history, stats } = useLoaderData<typeof loader>();

  const rows = history.map((h) => [
    h.date,
    h.orderId.slice(-8),
    h.giftProductTitle,
    `${h.giftProductPrice} €`,
    `${h.cartTotal} €`,
    `${h.thresholdBase} €`,
  ]);

  return (
    <Page title="Gift History" subtitle="Track all gifts given to customers">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Layout>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="200" align="center">
                    <Text variant="heading2xl" as="p">
                      {stats.totalGifts}
                    </Text>
                    <Text as="p" tone="subdued">Gifts Given</Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="200" align="center">
                    <Text variant="heading2xl" as="p">
                      {stats.totalValue} €
                    </Text>
                    <Text as="p" tone="subdued">Total Gift Value</Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <Card>
                  <BlockStack gap="200" align="center">
                    <Text variant="heading2xl" as="p">
                      {stats.totalGifts > 0
                        ? ((parseFloat(stats.totalValue) / stats.totalGifts)).toFixed(2)
                        : "0.00"} €
                    </Text>
                    <Text as="p" tone="subdued">Avg Gift Value</Text>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>

            <Card>
              {history.length === 0 ? (
                <EmptyState
                  heading="No gifts given yet"
                  image=""
                >
                  <Text as="p" tone="subdued">
                    Gift history will appear here once customers start receiving gifts.
                  </Text>
                </EmptyState>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                  headings={["Date", "Order", "Gift Product", "Gift Price", "Cart Total", "Threshold Base"]}
                  rows={rows}
                />
              )}
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
