import { Outlet, useLoaderData } from "@remix-run/react";
import { Frame, Navigation, Page, Layout, BlockStack, Text, Link as PolarisLink, Card } from "@shopify/polaris";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  return json({ shop: session.shop });
}

export default function AppLayout() {
  const { shop } = useLoaderData<typeof loader>();
  const shopParam = `?shop=${shop}`;

  const navItems = [
    { label: "Dashboard", to: `/${shopParam}` },
    { label: "Gift Tiers", to: `/app/tiers${shopParam}` },
    { label: "Settings", to: `/app/settings${shopParam}` },
    { label: "History", to: `/app/history${shopParam}` },
  ];

  return (
    <Frame
      navigation={
        <Navigation location={typeof window !== "undefined" ? window.location.pathname : "/"}>
          <Navigation.Section
            title="Gift Threshold"
            items={navItems.map((item) => ({
              label: item.label,
              url: item.to,
            }))}
          />
        </Navigation>
      }
    >
      <Page>
        <Layout>
          <Layout.Section>
            <BlockStack gap="400">
              {/* Top nav links for quick access */}
              <Card>
                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", padding: "8px 12px" }}>
                  {navItems.map((item) => (
                    <PolarisLink key={item.to} url={item.to}>
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {item.label}
                      </Text>
                    </PolarisLink>
                  ))}
                </div>
              </Card>
              <Outlet />
            </BlockStack>
          </Layout.Section>
        </Layout>
      </Page>
    </Frame>
  );
}
