import { prisma } from "~/db.server";

export async function getHistory(shopId: string, limit = 50) {
  return prisma.giftHistory.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function createHistoryEntry(data: {
  shopId: string;
  orderId: string;
  tierId: number;
  giftProductId: string;
  giftProductTitle: string;
  giftProductPrice: number;
  giftProductImage?: string | null;
  cartTotal: number;
  thresholdBase: number;
}) {
  return prisma.giftHistory.create({ data });
}

export async function getStats(shopId: string) {
  const total = await prisma.giftHistory.count({ where: { shopId } });
  const totalValue = await prisma.giftHistory.aggregate({
    where: { shopId },
    _sum: { giftProductPrice: true },
  });

  return {
    totalGifts: total,
    totalValue: totalValue._sum.giftProductPrice ?? 0,
  };
}
