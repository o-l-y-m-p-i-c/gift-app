import { adminGraphql } from "~/lib/admin-api.server";
import { getSettings } from "~/models/settings.server";

export interface GiftProduct {
  productId: string;
  variantId: string;
  title: string;
  price: number; // cents, shop currency
  image: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_PAGES = 20; // 20 × 250 = 5000 products

const cache = new Map<string, { expiresAt: number; products: Promise<GiftProduct[]> }>();

/** Drop the cached catalogue, e.g. after exclusions change. */
export function invalidateGiftProducts(shopId: string) {
  cache.delete(shopId);
}

/**
 * Every available, non-excluded variant that could be offered as a gift,
 * cached per shop so storefront requests don't rescan the catalogue.
 */
export async function getGiftProducts(shopId: string): Promise<GiftProduct[]> {
  const cached = cache.get(shopId);
  if (cached && cached.expiresAt > Date.now()) return cached.products;

  const products = loadGiftProducts(shopId);
  cache.set(shopId, { expiresAt: Date.now() + CACHE_TTL_MS, products });
  products.catch(() => cache.delete(shopId));
  return products;
}

const GIFT_PRODUCTS_QUERY = `#graphql
  query GetGiftProducts($first: Int!, $after: String) {
    products(first: $first, after: $after, query: "status:active") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        tags
        featuredImage {
          url
        }
        collections(first: 250) {
          nodes {
            id
          }
        }
        variants(first: 100) {
          nodes {
            legacyResourceId
            title
            price
            availableForSale
          }
        }
      }
    }
  }
`;

async function loadGiftProducts(shopId: string): Promise<GiftProduct[]> {
  const settings = await getSettings(shopId);
  const excludedCollections = new Set(settings.excludedCollections || []);
  const excludedTags = new Set(settings.excludedTags || []);

  const products: GiftProduct[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;

  while (hasNextPage && pageCount < MAX_PAGES) {
    const data: any = await adminGraphql(GIFT_PRODUCTS_QUERY, { first: 250, after: cursor }, shopId);
    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    hasNextPage = data.data?.products?.pageInfo?.hasNextPage || false;
    cursor = data.data?.products?.pageInfo?.endCursor || null;
    pageCount++;

    for (const product of data.data?.products?.nodes || []) {
      const inExcludedCollection = (product.collections?.nodes || []).some((c: any) =>
        excludedCollections.has(c.id),
      );
      const hasExcludedTag = (product.tags || []).some((tag: string) => excludedTags.has(tag));
      if (inExcludedCollection || hasExcludedTag) continue;

      for (const variant of product.variants?.nodes || []) {
        const price = Math.round(parseFloat(variant.price || "0") * 100);
        if (!variant.availableForSale || price <= 0) continue;
        products.push({
          productId: product.id,
          variantId: String(variant.legacyResourceId),
          title:
            variant.title === "Default Title" ? product.title : `${product.title} — ${variant.title}`,
          price,
          image: product.featuredImage?.url || "",
        });
      }
    }
  }

  return products.sort((a, b) => b.price - a.price);
}
