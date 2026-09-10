import { prisma } from "~/db.server";
import { adminGraphql, getAdminConfig } from "~/lib/admin-api.server";

export async function getSettings(shopId: string) {
  let settings = await prisma.appSettings.findUnique({ where: { shopId } });

  if (!settings) {
    settings = await prisma.appSettings.create({
      data: { shopId },
    });
  }

  return settings;
}

export async function updateSettings(
  shopId: string,
  data: {
    useTotalAfterDiscounts?: boolean;
    showLevelUpNotification?: boolean;
    showRemovalNotification?: boolean;
    active?: boolean;
    excludedCollections?: string[];
  },
) {
  return prisma.appSettings.upsert({
    where: { shopId },
    create: { shopId, ...data },
    update: data,
  });
}

/**
 * Fetch all collections from Shopify Admin API for the exclusion picker.
 * Returns [{ id, title, handle, productsCount }] sorted by title.
 */
export async function fetchCollectionsForPicker() {
  const config = getAdminConfig();
  if (!config) return [];

  const query = `
    query CollectionsForPicker($first: Int!) {
      collections(first: $first) {
        edges {
          node {
            id
            title
            handle
            productsCount {
              count
            }
          }
        }
      }
    }
  `;

  try {
    const data = await adminGraphql(query, { first: 250 });
    const edges = data?.data?.collections?.edges || [];
    return edges.map((edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      handle: edge.node.handle,
      productsCount: edge.node.productsCount?.count ?? 0,
    }));
  } catch (error) {
    console.error("[settings] Failed to fetch collections:", error);
    return [];
  }
}
