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

// ─── CSV import / export ──────────────────────────────────────

export const CSV_COLUMNS = ["min_amount", "gift_percent", "active"] as const;
export const MAX_IMPORT_TIERS = 100;

export type ImportedTier = { minAmount: number; giftPercent: number; active: boolean };
export type CsvError =
  | { key: "tiers.importErrEmpty" | "tiers.importErrHeader" }
  | { key: "tiers.importErrTooMany"; values: { max: number } }
  | { key: "tiers.importErrRow" | "tiers.importErrDuplicate"; values: { row: number } };

/** CSV with amounts in the shop currency's major unit, e.g. "100.00". */
export function tiersToCsv(tiers: { minAmount: number; giftPercent: number; active: boolean }[]) {
  const rows = tiers.map((t) => [(t.minAmount / 100).toFixed(2), String(t.giftPercent), String(t.active)]);
  return [CSV_COLUMNS.join(","), ...rows.map((row) => row.join(","))].join("\n") + "\n";
}

const ACTIVE_VALUES: Record<string, boolean> = {
  "": true, true: true, yes: true, "1": true, active: true,
  false: false, no: false, "0": false, inactive: false,
};

/**
 * Parse a tier CSV. Accepts "," or ";" separators (";" files may use a
 * decimal comma, as Excel writes them in many locales); "active" is optional.
 */
export function parseTiersCsv(text: string): { tiers: ImportedTier[]; errors: CsvError[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { tiers: [], errors: [{ key: "tiers.importErrEmpty" }] };

  const separator = lines[0].includes(";") ? ";" : ",";
  const split = (line: string) => line.split(separator).map((cell) => cell.trim().replace(/^"(.*)"$/, "$1").trim());
  const header = split(lines[0]).map((cell) => cell.toLowerCase());
  const col = { min: header.indexOf("min_amount"), percent: header.indexOf("gift_percent"), active: header.indexOf("active") };
  if (col.min < 0 || col.percent < 0) return { tiers: [], errors: [{ key: "tiers.importErrHeader" }] };

  const rows = lines.slice(1);
  if (rows.length === 0) return { tiers: [], errors: [{ key: "tiers.importErrEmpty" }] };
  if (rows.length > MAX_IMPORT_TIERS) {
    return { tiers: [], errors: [{ key: "tiers.importErrTooMany", values: { max: MAX_IMPORT_TIERS } }] };
  }

  const number = (cell = "") => Number(separator === ";" ? cell.replace(",", ".") : cell);
  const tiers: ImportedTier[] = [];
  const errors: CsvError[] = [];
  const seen = new Set<number>();

  rows.forEach((line, index) => {
    const row = index + 2; // 1-based, after the header
    const cells = split(line);
    const minAmount = Math.round(number(cells[col.min]) * 100);
    const giftPercent = number(cells[col.percent]);
    const active = ACTIVE_VALUES[(col.active >= 0 ? cells[col.active] ?? "" : "").toLowerCase()];
    if (
      !cells[col.min] || !Number.isFinite(minAmount) || minAmount <= 0 ||
      !cells[col.percent] || !Number.isFinite(giftPercent) || giftPercent <= 0 || giftPercent > 100 ||
      active === undefined
    ) {
      errors.push({ key: "tiers.importErrRow", values: { row } });
    } else if (seen.has(minAmount)) {
      errors.push({ key: "tiers.importErrDuplicate", values: { row } });
    } else {
      seen.add(minAmount);
      tiers.push({ minAmount, giftPercent, active });
    }
  });

  return { tiers: tiers.sort((a, b) => a.minAmount - b.minAmount), errors };
}

/** Format an amount in cents with the shop currency. */
export function formatMoney(cents: number, currencyCode: string, locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency: currencyCode }).format(
    cents / 100,
  );
}
