/**
 * Davines discount logic — 57 tiers from 50€ to 620€.
 * Each tier: minAmount (cents), giftPercent, giftAmount (cents, rounded).
 *
 * This file is safe to import on both client and server (no Prisma).
 */
export interface DavinesTier {
  minAmount: number;   // in cents (e.g., 5000 = 50.00 EUR)
  giftPercent: number; // e.g., 9.0
  giftAmount: number;  // in cents — pre-calculated max gift price
}

export const DAVINES_TIERS: DavinesTier[] = [
  { minAmount: 5000, giftPercent: 5.0, giftAmount: 300 },
  { minAmount: 6000, giftPercent: 5.5, giftAmount: 300 },
  { minAmount: 7000, giftPercent: 6.0, giftAmount: 400 },
  { minAmount: 8000, giftPercent: 6.5, giftAmount: 500 },
  { minAmount: 9000, giftPercent: 7.0, giftAmount: 600 },
  { minAmount: 10000, giftPercent: 7.5, giftAmount: 800 },
  { minAmount: 11000, giftPercent: 8.0, giftAmount: 900 },
  { minAmount: 12000, giftPercent: 8.5, giftAmount: 1000 },
  { minAmount: 13000, giftPercent: 9.0, giftAmount: 1200 },
  { minAmount: 14000, giftPercent: 9.5, giftAmount: 1300 },
  { minAmount: 15000, giftPercent: 10.0, giftAmount: 1500 },
  { minAmount: 16000, giftPercent: 10.5, giftAmount: 1700 },
  { minAmount: 17000, giftPercent: 11.0, giftAmount: 1900 },
  { minAmount: 18000, giftPercent: 11.5, giftAmount: 2100 },
  { minAmount: 19000, giftPercent: 12.0, giftAmount: 2300 },
  { minAmount: 20000, giftPercent: 12.5, giftAmount: 2500 },
  { minAmount: 21000, giftPercent: 13.0, giftAmount: 2700 },
  { minAmount: 22000, giftPercent: 13.5, giftAmount: 3000 },
  { minAmount: 23000, giftPercent: 14.0, giftAmount: 3200 },
  { minAmount: 24000, giftPercent: 14.5, giftAmount: 3500 },
  { minAmount: 25000, giftPercent: 15.0, giftAmount: 3800 },
  { minAmount: 26000, giftPercent: 15.5, giftAmount: 4000 },
  { minAmount: 27000, giftPercent: 16.0, giftAmount: 4300 },
  { minAmount: 28000, giftPercent: 16.5, giftAmount: 4600 },
  { minAmount: 29000, giftPercent: 17.0, giftAmount: 4900 },
  { minAmount: 30000, giftPercent: 17.5, giftAmount: 5300 },
  { minAmount: 32000, giftPercent: 18.0, giftAmount: 5800 },
  { minAmount: 33000, giftPercent: 18.5, giftAmount: 6100 },
  { minAmount: 34000, giftPercent: 19.0, giftAmount: 6500 },
  { minAmount: 35000, giftPercent: 19.5, giftAmount: 6800 },
  { minAmount: 36000, giftPercent: 20.0, giftAmount: 7200 },
  { minAmount: 37000, giftPercent: 20.5, giftAmount: 7600 },
  { minAmount: 38000, giftPercent: 21.0, giftAmount: 8000 },
  { minAmount: 39000, giftPercent: 21.5, giftAmount: 8400 },
  { minAmount: 40000, giftPercent: 22.0, giftAmount: 8800 },
  { minAmount: 41000, giftPercent: 22.5, giftAmount: 9200 },
  { minAmount: 42000, giftPercent: 23.0, giftAmount: 9700 },
  { minAmount: 43000, giftPercent: 23.5, giftAmount: 10100 },
  { minAmount: 44000, giftPercent: 24.0, giftAmount: 10600 },
  { minAmount: 45000, giftPercent: 24.5, giftAmount: 11000 },
  { minAmount: 46000, giftPercent: 25.0, giftAmount: 11500 },
  { minAmount: 47000, giftPercent: 25.5, giftAmount: 12000 },
  { minAmount: 48000, giftPercent: 26.0, giftAmount: 12500 },
  { minAmount: 49000, giftPercent: 26.5, giftAmount: 13000 },
  { minAmount: 50000, giftPercent: 27.0, giftAmount: 13500 },
  { minAmount: 51000, giftPercent: 27.5, giftAmount: 14000 },
  { minAmount: 52000, giftPercent: 28.0, giftAmount: 14600 },
  { minAmount: 53000, giftPercent: 28.5, giftAmount: 15100 },
  { minAmount: 54000, giftPercent: 29.0, giftAmount: 15700 },
  { minAmount: 55000, giftPercent: 29.5, giftAmount: 16200 },
  { minAmount: 56000, giftPercent: 30.0, giftAmount: 16800 },
  { minAmount: 57000, giftPercent: 30.5, giftAmount: 17400 },
  { minAmount: 58000, giftPercent: 31.0, giftAmount: 18000 },
  { minAmount: 59000, giftPercent: 31.5, giftAmount: 18600 },
  { minAmount: 60000, giftPercent: 32.0, giftAmount: 19200 },
  { minAmount: 61000, giftPercent: 32.5, giftAmount: 19800 },
  { minAmount: 62000, giftPercent: 33.0, giftAmount: 20500 },
];

/**
 * Calculate gift amount from threshold and percent.
 * Uses standard rounding (round half up).
 * All values in cents.
 */
export function calculateGiftAmount(minAmount: number, giftPercent: number): number {
  const raw = (minAmount * giftPercent) / 100;
  return Math.round(raw);
}

/**
 * Find the active tier for a given threshold base (in cents).
 * Returns the highest tier where minAmount <= thresholdBase.
 */
export function findActiveTier<T extends { minAmount: number }>(
  tiers: T[],
  thresholdBase: number,
): T | null {
  const active = tiers
    .filter((t) => t.minAmount <= thresholdBase)
    .sort((a, b) => b.minAmount - a.minAmount);
  return active[0] ?? null;
}
