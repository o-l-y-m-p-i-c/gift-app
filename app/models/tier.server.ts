import { prisma } from "~/db.server";
import { SAMPLE_TIERS, calculateGiftAmount } from "~/lib/tiers";

// ─── Gift Tier CRUD ───────────────────────────────────────────

export async function getTiers(shopId: string) {
  return prisma.giftTier.findMany({
    where: { shopId },
    orderBy: { minAmount: "asc" },
  });
}

export async function getActiveTiers(shopId: string) {
  return prisma.giftTier.findMany({
    where: { shopId, active: true },
    orderBy: { minAmount: "asc" },
  });
}

export async function createTier(data: {
  shopId: string;
  minAmount: number;
  giftPercent: number;
  giftAmount: number;
  collectionId?: string | null;
}) {
  return prisma.giftTier.create({ data });
}

export async function updateTier(
  id: number,
  shopId: string,
  data: {
    minAmount?: number;
    giftPercent?: number;
    giftAmount?: number;
    collectionId?: string | null;
    active?: boolean;
  },
) {
  const tier = await prisma.giftTier.findFirst({ where: { id, shopId } });
  if (!tier) throw new Error("Tier not found");
  return prisma.giftTier.update({ where: { id }, data });
}

export async function deleteTier(id: number, shopId: string) {
  return prisma.giftTier.deleteMany({ where: { id, shopId } });
}

// ─── Sample preset ────────────────────────────────────────────

/**
 * Replace a shop's tiers with the sample preset.
 */
export async function importSampleTiers(shopId: string): Promise<number> {
  await prisma.$transaction([
    prisma.giftTier.deleteMany({ where: { shopId } }),
    prisma.giftTier.createMany({
      data: SAMPLE_TIERS.map((t) => ({
        shopId,
        minAmount: t.minAmount,
        giftPercent: t.giftPercent,
        giftAmount: calculateGiftAmount(t.minAmount, t.giftPercent),
        collectionId: null,
        active: true,
      })),
    }),
  ]);

  return SAMPLE_TIERS.length;
}
