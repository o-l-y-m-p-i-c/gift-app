import { prisma } from "~/db.server";
import { adminGraphql } from "~/lib/admin-api.server";
import {
  SAMPLE_TIERS,
  calculateGiftAmount,
  tierFromMetaobject,
  tierToFields,
  type ImportedTier,
  type Tier,
  type TierInput,
} from "~/lib/tiers";
import { getSettings } from "~/models/settings.server";

/**
 * Gift tiers live in the app-owned `$app:gift_tier` metaobject (declared in
 * shopify.app.toml). Storefront endpoints read them often, so each shop's
 * list is cached briefly and dropped on every write.
 */
const TIER_TYPE = "$app:gift_tier";
const CACHE_MS = 60 * 1000;
const cache = new Map<string, { tiers: Tier[]; expiresAt: number }>();
const migrations = new Map<string, Promise<void>>();

export class DuplicateTierError extends Error {}

async function mutate(query: string, variables: Record<string, unknown>, shopId: string, root: string) {
  const data: any = await adminGraphql(query, variables, shopId);
  const result = data?.data?.[root];
  const error = data?.errors?.[0]?.message || result?.userErrors?.[0]?.message;
  if (error || !result) throw new Error(`[tiers] ${root} failed: ${error || "no result"}`);
  return result;
}

async function fetchTiers(shopId: string) {
  const tiers: Tier[] = [];
  let after: string | null = null;
  do {
    const data: any = await adminGraphql(
      `#graphql
        query GiftTiers($after: String) {
          metaobjects(type: "${TIER_TYPE}", first: 250, after: $after) {
            nodes {
              id
              fields {
                key
                value
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      `,
      { after },
      shopId,
    );
    if (data?.errors?.length) throw new Error(`[tiers] Read failed: ${data.errors[0].message}`);
    const page = data?.data?.metaobjects;
    tiers.push(...(page?.nodes ?? []).map(tierFromMetaobject));
    after = page?.pageInfo?.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return tiers.sort((a, b) => a.minAmount - b.minAmount);
}

async function createMetaobject(shopId: string, tier: TierInput, currencyCode: string) {
  await mutate(
    `#graphql
      mutation CreateGiftTier($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject {
            id
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    { metaobject: { type: TIER_TYPE, fields: tierToFields(tier, currencyCode) } },
    shopId,
    "metaobjectCreate",
  );
}

async function deleteMetaobject(shopId: string, id: string) {
  await mutate(
    `#graphql
      mutation DeleteGiftTier($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    { id },
    shopId,
    "metaobjectDelete",
  );
}

/**
 * Copy tiers saved by earlier versions in the GiftTier table into metaobjects,
 * once per shop. Tiers already present (same minimum amount) are skipped, so a
 * migration interrupted halfway can safely run again.
 */
async function migrateLegacyTiers(shopId: string) {
  const settings = await getSettings(shopId);
  if (settings.tiersMigratedAt) return;

  const legacy = await prisma.giftTier.findMany({ where: { shopId } });
  if (legacy.length > 0) {
    const existing = new Set((await fetchTiers(shopId)).map((tier) => tier.minAmount));
    for (const tier of legacy.filter((t) => !existing.has(t.minAmount))) {
      await createMetaobject(shopId, tier, settings.currencyCode);
    }
  }
  await prisma.appSettings.update({ where: { shopId }, data: { tiersMigratedAt: new Date() } });
}

function ensureMigrated(shopId: string) {
  let pending = migrations.get(shopId);
  if (!pending) {
    pending = migrateLegacyTiers(shopId).finally(() => migrations.delete(shopId));
    migrations.set(shopId, pending);
  }
  return pending;
}

export async function getTiers(shopId: string): Promise<Tier[]> {
  const cached = cache.get(shopId);
  if (cached && cached.expiresAt > Date.now()) return cached.tiers;
  await ensureMigrated(shopId);
  const tiers = await fetchTiers(shopId);
  cache.set(shopId, { tiers, expiresAt: Date.now() + CACHE_MS });
  return tiers;
}

export async function getActiveTiers(shopId: string) {
  return (await getTiers(shopId)).filter((tier) => tier.active);
}

async function findTier(shopId: string, id: string) {
  const tier = (await getTiers(shopId)).find((t) => t.id === id);
  if (!tier) throw new Error("Tier not found");
  return tier;
}

export async function createTier(shopId: string, data: Omit<TierInput, "active">) {
  if ((await getTiers(shopId)).some((tier) => tier.minAmount === data.minAmount)) {
    throw new DuplicateTierError();
  }
  const { currencyCode } = await getSettings(shopId);
  await createMetaobject(shopId, { ...data, active: true }, currencyCode);
  cache.delete(shopId);
}

async function updateMetaobject(shopId: string, id: string, fields: { key: string; value: string }[]) {
  await mutate(
    `#graphql
      mutation UpdateGiftTier($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject {
            id
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `,
    { id, metaobject: { fields } },
    shopId,
    "metaobjectUpdate",
  );
}

export async function updateTier(shopId: string, id: string, data: { active: boolean }) {
  await findTier(shopId, id);
  await updateMetaobject(shopId, id, [{ key: "active", value: String(data.active) }]);
  cache.delete(shopId);
}

/**
 * Import tiers from a CSV file. Rows matching an existing tier's minimum
 * amount update it, other rows create tiers; with `replace`, tiers missing
 * from the file are deleted. Unchanged tiers aren't written.
 */
export async function importTiers(shopId: string, rows: ImportedTier[], { replace = false } = {}) {
  const [existing, { currencyCode }] = await Promise.all([getTiers(shopId), getSettings(shopId)]);
  const byAmount = new Map(existing.map((tier) => [tier.minAmount, tier]));
  const counts = { created: 0, updated: 0, removed: 0 };
  cache.delete(shopId);

  try {
    for (const row of rows) {
      const tier = { ...row, giftAmount: calculateGiftAmount(row.minAmount, row.giftPercent) };
      const current = byAmount.get(row.minAmount);
      if (!current) {
        await createMetaobject(shopId, tier, currencyCode);
        counts.created += 1;
      } else if (current.giftPercent !== tier.giftPercent || current.giftAmount !== tier.giftAmount || current.active !== tier.active) {
        await updateMetaobject(shopId, current.id, tierToFields(tier, currencyCode));
        counts.updated += 1;
      }
    }
    if (replace) {
      const keep = new Set(rows.map((row) => row.minAmount));
      for (const tier of existing.filter((t) => !keep.has(t.minAmount))) {
        await deleteMetaobject(shopId, tier.id);
        counts.removed += 1;
      }
    }
  } finally {
    cache.delete(shopId);
  }
  return counts;
}

export async function deleteTier(shopId: string, id: string) {
  await findTier(shopId, id);
  await deleteMetaobject(shopId, id);
  cache.delete(shopId);
}

// ─── Sample preset ────────────────────────────────────────────

/**
 * Replace a shop's tiers with the sample preset.
 */
export async function importSampleTiers(shopId: string): Promise<number> {
  const [tiers, { currencyCode }] = await Promise.all([getTiers(shopId), getSettings(shopId)]);
  cache.delete(shopId);
  for (const tier of tiers) await deleteMetaobject(shopId, tier.id);
  for (const t of SAMPLE_TIERS) {
    const giftAmount = calculateGiftAmount(t.minAmount, t.giftPercent);
    await createMetaobject(shopId, { ...t, giftAmount, active: true }, currencyCode);
  }
  cache.delete(shopId);
  return SAMPLE_TIERS.length;
}
