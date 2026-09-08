import { prisma } from "~/db.server";

/**
 * Get the real shop domain for admin routes.
 * Priority:
 *   1. ?shop=... URL param (if it's a .myshopify.com domain)
 *   2. Most recent session in DB
 *   3. Any GiftTier with a .myshopify.com shopId
 *   4. Fallback to "demo-shop"
 */
export async function getShopId(request: Request): Promise<string> {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  if (shopParam && shopParam.includes(".myshopify.com")) {
    return shopParam;
  }

  // Fall back to the most recent session's shop domain
  const session = await prisma.session.findFirst({
    orderBy: { createdAt: "desc" },
    select: { shop: true },
  });
  if (session?.shop?.includes(".myshopify.com")) {
    return session.shop;
  }

  // Fall back to any tier with a real shop domain
  const tier = await prisma.giftTier.findFirst({
    where: { shopId: { contains: ".myshopify.com" } },
    select: { shopId: true },
  });
  if (tier?.shopId) {
    return tier.shopId;
  }

  return shopParam || "demo-shop";
}
