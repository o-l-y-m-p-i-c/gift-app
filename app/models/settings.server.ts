import { prisma } from "~/db.server";
import { adminGraphql } from "~/lib/admin-api.server";

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
    excludedTags?: string[];
  },
) {
  return prisma.appSettings.upsert({
    where: { shopId },
    create: { shopId, ...data },
    update: data,
  });
}

/**
 * Fetch all product tags from Shopify Admin API for the exclusion picker.
 * Returns string[] sorted alphabetically.
 */
export async function fetchProductTagsForPicker(shop: string) {
  if (!shop) return [];

  const allTags = new Set<string>();
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const query = `
      query ProductTags($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              tags
            }
          }
        }
      }
    `;

    try {
      const data: any = await adminGraphql(query, { first: 250, after: cursor }, shop);
      const edges = data?.data?.products?.edges || [];
      for (const edge of edges) {
        for (const tag of edge.node?.tags || []) {
          if (tag) allTags.add(tag);
        }
      }
      hasNextPage = data?.data?.products?.pageInfo?.hasNextPage || false;
      cursor = data?.data?.products?.pageInfo?.endCursor || null;
    } catch (error) {
      console.error("[settings] Failed to fetch product tags:", error);
      break;
    }
  }

  return Array.from(allTags).sort((a, b) => a.localeCompare(b));
}

/**
 * Fetch all collections from Shopify Admin API for the exclusion picker.
 * Returns [{ id, title, handle, productsCount }] sorted by title.
 */
export async function fetchCollectionsForPicker(shop: string) {
  if (!shop) return [];

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
    const data = await adminGraphql(query, { first: 250 }, shop);
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
