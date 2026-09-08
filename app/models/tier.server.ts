import { prisma } from "~/db.server";
import { DAVINES_TIERS, calculateGiftAmount, findActiveTier } from "~/lib/tiers";

// Re-export for convenience
export { DAVINES_TIERS, calculateGiftAmount, findActiveTier };

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
  data: {
    minAmount?: number;
    giftPercent?: number;
    giftAmount?: number;
    collectionId?: string | null;
    active?: boolean;
  },
) {
  return prisma.giftTier.update({ where: { id }, data });
}

export async function deleteTier(id: number) {
  return prisma.giftTier.delete({ where: { id } });
}

// ─── Bulk import from CSV data ────────────────────────────────

/**
 * Bulk import Davines tiers for a shop.
 * Clears existing tiers and inserts the 57 Davines tiers.
 */
export async function importDavinesTiers(shopId: string): Promise<number> {
  await prisma.giftTier.deleteMany({ where: { shopId } });

  await prisma.giftTier.createMany({
    data: DAVINES_TIERS.map((t) => ({
      shopId,
      minAmount: t.minAmount,
      giftPercent: t.giftPercent,
      giftAmount: t.giftAmount,
      collectionId: null,
      active: true,
    })),
  });

  return DAVINES_TIERS.length;
}
