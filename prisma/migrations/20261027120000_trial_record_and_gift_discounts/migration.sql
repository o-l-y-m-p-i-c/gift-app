-- CreateTable
CREATE TABLE "ShopTrial" (
    "shopId" TEXT NOT NULL,
    "trialStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "devStore" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopTrial_pkey" PRIMARY KEY ("shopId")
);

-- CreateTable
CREATE TABLE "GiftDiscount" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GiftDiscount_shopId_endsAt_idx" ON "GiftDiscount"("shopId", "endsAt");

-- Backfill existing shops so their current trial start is preserved
INSERT INTO "ShopTrial" ("shopId", "trialStartedAt", "devStore", "updatedAt")
SELECT "shopId", "trialStartedAt", "isDevStore", CURRENT_TIMESTAMP FROM "ShopBilling"
ON CONFLICT ("shopId") DO NOTHING;
