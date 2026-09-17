/**
 * Davines discount logic — 24 tiers from 130€ to 360€.
 * Each tier: minAmount (cents), giftPercent, giftAmount (cents, rounded).
 *
 * This file is safe to import on both client and server (no Prisma).
 */
export interface DavinesTier {
  minAmount: number;   // in cents (e.g., 13000 = 130.00 EUR)
  giftPercent: number; // e.g., 9.0
  giftAmount: number;  // in cents — pre-calculated max gift price
}

export const DAVINES_TIERS: DavinesTier[] = [
  { minAmount: 13000, giftPercent: 9.0, giftAmount: 1170 },
  { minAmount: 14000, giftPercent: 9.5, giftAmount: 1330 },
  { minAmount: 15000, giftPercent: 10.0, giftAmount: 1500 },
  { minAmount: 16000, giftPercent: 10.5, giftAmount: 1680 },
  { minAmount: 17000, giftPercent: 11.0, giftAmount: 1870 },
  { minAmount: 18000, giftPercent: 11.5, giftAmount: 2070 },
  { minAmount: 19000, giftPercent: 12.0, giftAmount: 2280 },
  { minAmount: 20000, giftPercent: 12.5, giftAmount: 2500 },
  { minAmount: 21000, giftPercent: 13.0, giftAmount: 2730 },
  { minAmount: 22000, giftPercent: 13.5, giftAmount: 2970 },
  { minAmount: 23000, giftPercent: 14.0, giftAmount: 3220 },
  { minAmount: 24000, giftPercent: 14.5, giftAmount: 3480 },
  { minAmount: 25000, giftPercent: 15.0, giftAmount: 3750 },
  { minAmount: 26000, giftPercent: 15.5, giftAmount: 4030 },
  { minAmount: 27000, giftPercent: 16.0, giftAmount: 4320 },
  { minAmount: 28000, giftPercent: 16.5, giftAmount: 4620 },
  { minAmount: 29000, giftPercent: 17.0, giftAmount: 4930 },
  { minAmount: 30000, giftPercent: 17.5, giftAmount: 5250 },
  { minAmount: 31000, giftPercent: 18.0, giftAmount: 5580 },
  { minAmount: 32000, giftPercent: 18.5, giftAmount: 5920 },
  { minAmount: 33000, giftPercent: 19.0, giftAmount: 6270 },
  { minAmount: 34000, giftPercent: 19.5, giftAmount: 6630 },
  { minAmount: 35000, giftPercent: 20.0, giftAmount: 7000 },
  { minAmount: 36000, giftPercent: 20.5, giftAmount: 7380 },
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
