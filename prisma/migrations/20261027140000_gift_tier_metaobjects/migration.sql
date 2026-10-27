-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "tiersMigratedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "GiftHistory" ALTER COLUMN "tierId" SET DATA TYPE TEXT;

