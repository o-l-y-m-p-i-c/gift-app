/**
 * Billing plan definition and access rules. Plan values come from env vars
 * (see .env.example) and fall back to the defaults below.
 */

function envNumber(name: string, fallback: number, { integer = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`Invalid ${name}: "${raw}"`);
  }
  return value;
}

export const PRO_PLAN = process.env.BILLING_PLAN_NAME?.trim() || "Gift App Pro";
export const PLAN_PRICE = envNumber("BILLING_PLAN_PRICE", 9.99);
export const PLAN_CURRENCY = process.env.BILLING_PLAN_CURRENCY?.trim().toUpperCase() || "USD";
export const TRIAL_DAYS = envNumber("BILLING_TRIAL_DAYS", 14, { integer: true });

const DAY_MS = 24 * 60 * 60 * 1000;

export type AccessReason = "dev_store" | "subscribed" | "trial" | "trial_expired";

export interface BillingAccess {
  hasAccess: boolean;
  reason: AccessReason;
  trialEndsAt: string;
  trialDaysLeft: number;
}

export function getBillingAccess(
  billing: {
    trialStartedAt: Date;
    isDevStore: boolean;
    subscriptionStatus: string | null;
  },
  now = new Date(),
): BillingAccess {
  const trialEnd = new Date(billing.trialStartedAt.getTime() + TRIAL_DAYS * DAY_MS);
  const trialDaysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / DAY_MS));
  const base = { trialEndsAt: trialEnd.toISOString(), trialDaysLeft };

  if (billing.isDevStore) return { ...base, hasAccess: true, reason: "dev_store" };
  if (billing.subscriptionStatus === "ACTIVE") return { ...base, hasAccess: true, reason: "subscribed" };
  if (trialDaysLeft > 0) return { ...base, hasAccess: true, reason: "trial" };
  return { ...base, hasAccess: false, reason: "trial_expired" };
}

/**
 * Trial state after learning the shop's current development-store status.
 * A development store transferred to a merchant gets a full trial from the
 * transfer, since its original trial ran out while it was free.
 */
export function nextTrialState(
  trial: { trialStartedAt: Date; devStore: boolean },
  isDevStore: boolean,
  now = new Date(),
) {
  return {
    devStore: isDevStore,
    trialStartedAt: trial.devStore && !isDevStore ? now : trial.trialStartedAt,
  };
}
