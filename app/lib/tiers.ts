/**
 * Gift tier helpers. Amounts are in the shop currency's minor unit (cents).
 *
 * This file is safe to import on both client and server (no Prisma).
 */
export interface TierPreset {
  minAmount: number;   // in cents (e.g., 5000 = 50.00 in the shop currency)
  giftPercent: number; // e.g., 5.0
}

/** Optional starter tiers merchants can load and then edit. */
export const SAMPLE_TIERS: TierPreset[] = [
  { minAmount: 5000, giftPercent: 5 },
  { minAmount: 10000, giftPercent: 7.5 },
  { minAmount: 15000, giftPercent: 10 },
  { minAmount: 20000, giftPercent: 12.5 },
  { minAmount: 30000, giftPercent: 15 },
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

/** Format an amount in cents with the shop currency. */
export function formatMoney(cents: number, currencyCode: string, locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(
    cents / 100,
  );
}
