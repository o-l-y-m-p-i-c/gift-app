import { prisma } from "~/db.server";

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
  },
) {
  return prisma.appSettings.upsert({
    where: { shopId },
    create: { shopId, ...data },
    update: data,
  });
}
