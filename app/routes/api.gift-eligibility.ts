import type { LoaderFunctionArgs } from "@remix-run/node";
import { prisma } from "~/db.server";
import { corsJson, handleCorsPreflight } from "~/lib/cors";
import { adminGraphql } from "~/lib/admin-api.server";
import { getActiveTiers } from "~/models/tier.server";
import { getSettings } from "~/models/settings.server";
import { authenticate } from "~/shopify.server";

/**
 * Gift eligibility endpoint for the product-page "Add as gift" button.
 *
 * GET /apps/gift-threshold/gift-eligibility
 *   ?shop=<shop-domain>
 *   &variantId=<variant-id>
 *   &giftSelections=<comma-separated variant IDs of currently authorized gifts>
 *
 * Returns:
 *   {
 *     eligible: boolean,
 *     reason: "ok" | "no_tier" | "unavailable" | "over_budget" | "busy",
 *     tierId?: number,
 *     giftBudget?: number,        // cents
 *     usedBudget?: number,        // cents
 *     remainingBudget?: number,   // cents
 *     variantPrice?: number,      // cents
 *     amountToUnlock?: number,    // cents (when no_tier)
 *   }
 *
 * The browser-side gift-core.js also performs a local eligibility check,
 * but this endpoint is the authoritative server-side validation.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const preflight = handleCorsPreflight(request);
  if (preflight) return preflight;

  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return corsJson({ eligible: false, reason: "missing_session" }, { status: 401 });
  }

  const url = new URL(request.url);
  const shop = session.shop;
  const variantId = url.searchParams.get("variantId");
  const giftSelectionsParam = url.searchParams.get("giftSelections") || "";

  if (!variantId || !/^\d+$/.test(variantId)) {
    return corsJson({ eligible: false, reason: "invalid_variant" }, { status: 400 });
  }

  // Parse authorized gift selections (variant IDs, may contain duplicates)
  const giftSelections = giftSelectionsParam
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s));

  // Load active tiers for the shop
  const tiers = await getActiveTiers(shop);
  if (tiers.length === 0) {
    return corsJson({
      eligible: false,
      reason: "no_tier",
      amountToUnlock: 0,
    });
  }

  const sortedTiers = [...tiers].sort((a, b) => a.minAmount - b.minAmount);
  const firstTier = sortedTiers[0];

  // Look up the variant price and availability via Admin API
  const variantGid = `gid://shopify/ProductVariant/${variantId}`;
  let variantPrice: number | null = null;
  let variantAvailable: boolean | null = null;
  let variantProductId: string | null = null;
  let variantTags: string[] = [];

  try {
    const variantData: any = await adminGraphql(
      `#graphql
        query GiftEligibilityVariant($id: ID!) {
          node(id: $id) {
            ... on ProductVariant {
              id
              price
              availableForSale
              product {
                id
                status
                tags
              }
            }
          }
        }
      `,
      { id: variantGid },
      shop,
    );

    const node = variantData.data?.node;
    if (node) {
      variantPrice = Math.round(Number(node.price || 0) * 100);
      variantAvailable = node.availableForSale && node.product?.status === "ACTIVE";
      variantProductId = node.product?.id || null;
      variantTags = node.product?.tags || [];
    }
  } catch (e: any) {
    console.error("[gift-eligibility] Variant lookup failed:", e?.message || e);
    return corsJson({
      eligible: false,
      reason: "server_error",
    }, { status: 502 });
  }

  if (variantAvailable === false) {
    return corsJson({
      eligible: false,
      reason: "unavailable",
      variantPrice,
    });
  }

  // Check if the product belongs to any excluded collection or has excluded tags
  const appSettings = await getSettings(shop);
  const excludedCollections = appSettings.excludedCollections || [];
  const excludedTags = appSettings.excludedTags || [];

  // Check excluded tags first (no extra API call needed)
  if (excludedTags.length > 0 && variantTags.length > 0) {
    const hasExcludedTag = variantTags.some((tag) => excludedTags.includes(tag));
    if (hasExcludedTag) {
      return corsJson({
        eligible: false,
        reason: "excluded_tag",
        variantPrice,
      });
    }
  }

  // Check excluded collections (requires product ID)
  if (excludedCollections.length > 0 && variantProductId) {
    try {
      const collectionCheck: any = await adminGraphql(
        `#graphql
          query ProductInExcludedCollections($productId: ID!, $collectionIds: [ID!]!) {
            product(id: $productId) {
              collections(first: 250) {
                edges {
                  node {
                    id
                  }
                }
              }
            }
          }
        `,
        { productId: variantProductId, collectionIds: excludedCollections },
        shop,
      );

      const productCollections = collectionCheck.data?.product?.collections?.edges || [];
      const productCollectionIds = productCollections.map((e: any) => e.node.id);
      const isInExcluded = productCollectionIds.some((id: string) =>
        excludedCollections.includes(id),
      );

      if (isInExcluded) {
        return corsJson({
          eligible: false,
          reason: "excluded_collection",
          variantPrice,
        });
      }
    } catch (e: any) {
      console.warn("[gift-eligibility] Collection check failed:", e?.message || e);
    }
  }

  // Look up prices for existing gift selections to calculate used budget
  let usedBudget = 0;
  if (giftSelections.length > 0) {
    const selectionGids = [...new Set(giftSelections)].map(
      (id) => `gid://shopify/ProductVariant/${id}`,
    );
    try {
      const selectionData: any = await adminGraphql(
        `#graphql
          query GiftEligibilitySelections($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on ProductVariant {
                id
                price
                availableForSale
                product {
                  status
                }
              }
            }
          }
        `,
        { ids: selectionGids },
        shop,
      );

      const nodes = selectionData.data?.nodes || [];
      const priceById = new Map<string, number>();
      for (const node of nodes) {
        if (node) {
          const price = Math.round(Number(node.price || 0) * 100);
          priceById.set(node.id, price);
        }
      }

      // Sum up used budget counting duplicates
      for (const id of giftSelections) {
        const gid = `gid://shopify/ProductVariant/${id}`;
        usedBudget += priceById.get(gid) || 0;
      }
    } catch (e: any) {
      console.warn("[gift-eligibility] Selection lookup failed:", e?.message || e);
    }
  }

  // We don't know the qualifying cart total from this endpoint alone.
  // The browser passes the gift selections; we validate against the highest
  // tier that could be active given the used budget.
  // The authoritative tier check happens in /gift-code when the code is created.
  // Here we find the tier that would apply if the cart qualifies.
  // For a conservative check, use the tier whose giftAmount >= usedBudget + variantPrice.
  const potentialTotal = usedBudget + (variantPrice || 0);

  // Find tiers where the new gift would fit within the budget
  const fittingTiers = sortedTiers.filter((t) => potentialTotal <= t.giftAmount);

  if (fittingTiers.length === 0) {
    // Even the highest tier can't accommodate this gift
    const highestTier = sortedTiers[sortedTiers.length - 1];
    return corsJson({
      eligible: false,
      reason: "over_budget",
      tierId: highestTier.id,
      giftBudget: highestTier.giftAmount,
      usedBudget,
      remainingBudget: Math.max(0, highestTier.giftAmount - usedBudget),
      variantPrice,
    });
  }

  // The active tier is determined by the cart total, which we don't have here.
  // Return the lowest fitting tier as a conservative estimate.
  // The actual tier is resolved in /gift-code.
  const conservativeTier = fittingTiers[0];
  const remainingBudget = Math.max(0, conservativeTier.giftAmount - usedBudget);

  if (variantPrice !== null && variantPrice > remainingBudget) {
    return corsJson({
      eligible: false,
      reason: "over_budget",
      tierId: conservativeTier.id,
      giftBudget: conservativeTier.giftAmount,
      usedBudget,
      remainingBudget,
      variantPrice,
    });
  }

  return corsJson({
    eligible: true,
    reason: "ok",
    tierId: conservativeTier.id,
    giftBudget: conservativeTier.giftAmount,
    usedBudget,
    remainingBudget,
    variantPrice,
  });
}
