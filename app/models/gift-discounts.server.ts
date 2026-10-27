import { prisma } from "~/db.server";
import { adminGraphql } from "~/lib/admin-api.server";

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
// Codes are kept a day past expiry so orders still being processed can reference them.
const DELETE_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;
const lastCleanupAt = new Map<string, number>();

export async function recordGiftDiscount(id: string, shopId: string, endsAt: Date) {
  await prisma.giftDiscount.create({ data: { id, shopId, endsAt } });
}

/** Delete the shop's expired gift codes from Shopify, at most every 10 minutes per shop. */
export async function cleanupExpiredGiftDiscounts(shopId: string, now = Date.now()) {
  if (now - (lastCleanupAt.get(shopId) ?? 0) < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt.set(shopId, now);

  const expired = await prisma.giftDiscount.findMany({
    where: { shopId, endsAt: { lt: new Date(now - DELETE_AFTER_EXPIRY_MS) } },
    select: { id: true },
    take: BATCH_SIZE,
  });
  if (expired.length === 0) return;

  const ids = expired.map((discount) => discount.id);
  const data: any = await adminGraphql(
    `#graphql
      mutation DeleteExpiredGiftCodes($ids: [ID!]!) {
        discountCodeBulkDelete(ids: $ids) {
          job {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `,
    { ids },
    shopId,
  );
  const errors = data?.data?.discountCodeBulkDelete?.userErrors || [];
  if (errors.length > 0) {
    console.error("[gift-discounts] Bulk delete failed:", errors);
    return;
  }
  await prisma.giftDiscount.deleteMany({ where: { id: { in: ids } } });
}
