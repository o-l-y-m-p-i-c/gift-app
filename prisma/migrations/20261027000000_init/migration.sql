-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN,
    "locale" TEXT,
    "collaborator" BOOLEAN,
    "emailVerified" BOOLEAN,
    "onlineAccessInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftTier" (
    "id" SERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "minAmount" INTEGER NOT NULL,
    "giftPercent" DOUBLE PRECISION NOT NULL,
    "giftAmount" INTEGER NOT NULL,
    "collectionId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" SERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "useTotalAfterDiscounts" BOOLEAN NOT NULL DEFAULT true,
    "showLevelUpNotification" BOOLEAN NOT NULL DEFAULT true,
    "showRemovalNotification" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "excludedCollections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftHistory" (
    "id" SERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tierId" INTEGER NOT NULL,
    "giftProductId" TEXT NOT NULL,
    "giftProductTitle" TEXT NOT NULL,
    "giftProductPrice" INTEGER NOT NULL,
    "giftProductImage" TEXT,
    "cartTotal" INTEGER NOT NULL,
    "thresholdBase" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopBilling" (
    "id" SERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "trialStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDevStore" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionId" TEXT,
    "subscriptionStatus" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopBilling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "amount" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingPayment" (
    "id" SERIAL NOT NULL,
    "shopId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateIndex
CREATE INDEX "GiftTier_shopId_idx" ON "GiftTier"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftTier_shopId_minAmount_key" ON "GiftTier"("shopId", "minAmount");

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_shopId_key" ON "AppSettings"("shopId");

-- CreateIndex
CREATE INDEX "GiftHistory_shopId_idx" ON "GiftHistory"("shopId");

-- CreateIndex
CREATE INDEX "GiftHistory_orderId_idx" ON "GiftHistory"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopBilling_shopId_key" ON "ShopBilling"("shopId");

-- CreateIndex
CREATE INDEX "BillingSubscription_shopId_idx" ON "BillingSubscription"("shopId");

-- CreateIndex
CREATE INDEX "BillingPayment_shopId_idx" ON "BillingPayment"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingPayment_subscriptionId_periodStart_key" ON "BillingPayment"("subscriptionId", "periodStart");

