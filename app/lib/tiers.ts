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

/** A gift tier as stored in the app-owned `$app:gift_tier` metaobject. */
export interface Tier {
  id: string; // Metaobject GID
  label: string;
  minAmount: number;
  giftPercent: number;
  giftAmount: number;
  active: boolean;
}

export type TierInput = Omit<Tier, "id" | "label">;

export function tierLabel(minAmount: number, giftPercent: number, currencyCode: string) {
  return `${formatMoney(minAmount, currencyCode)}+ · ${giftPercent}%`;
}

export function tierFromMetaobject(node: { id: string; fields: { key: string; value: string | null }[] }): Tier {
  const field = Object.fromEntries(node.fields.map((f) => [f.key, f.value ?? ""]));
  return {
    id: node.id,
    label: field.label ?? "",
    minAmount: Number.parseInt(field.min_amount, 10) || 0,
    giftPercent: Number.parseFloat(field.gift_percent) || 0,
    giftAmount: Number.parseInt(field.gift_amount, 10) || 0,
    active: field.active === "true",
  };
}

export function tierToFields(tier: TierInput, currencyCode: string) {
  return [
    { key: "label", value: tierLabel(tier.minAmount, tier.giftPercent, currencyCode) },
    { key: "min_amount", value: String(tier.minAmount) },
    { key: "gift_percent", value: String(tier.giftPercent) },
    { key: "gift_amount", value: String(tier.giftAmount) },
    { key: "active", value: String(tier.active) },
  ];
}

/** Format an amount in cents with the shop currency. */
export function formatMoney(cents: number, currencyCode: string, locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(
    cents / 100,
  );
}
