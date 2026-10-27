import { afterEach, describe, expect, it, vi } from "vitest";
import { TRIAL_DAYS, getBillingAccess, getPaidPeriods } from "./billing.server";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-26T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

describe("getBillingAccess", () => {
  it("grants a trial for the first 14 days", () => {
    const access = getBillingAccess(
      { trialStartedAt: daysAgo(3), isDevStore: false, subscriptionStatus: null },
      now,
    );
    expect(access).toMatchObject({ hasAccess: true, reason: "trial", trialDaysLeft: TRIAL_DAYS - 3 });
  });

  it("blocks access once the trial is over without a subscription", () => {
    const access = getBillingAccess(
      { trialStartedAt: daysAgo(20), isDevStore: false, subscriptionStatus: "CANCELLED" },
      now,
    );
    expect(access).toMatchObject({ hasAccess: false, reason: "trial_expired", trialDaysLeft: 0 });
  });

  it("keeps development stores free", () => {
    const access = getBillingAccess(
      { trialStartedAt: daysAgo(400), isDevStore: true, subscriptionStatus: null },
      now,
    );
    expect(access).toMatchObject({ hasAccess: true, reason: "dev_store" });
  });

  it("grants access with an active subscription", () => {
    const access = getBillingAccess(
      { trialStartedAt: daysAgo(90), isDevStore: false, subscriptionStatus: "ACTIVE" },
      now,
    );
    expect(access).toMatchObject({ hasAccess: true, reason: "subscribed" });
  });
});

describe("getPaidPeriods", () => {
  it("starts billing after the trial and repeats every 30 days", () => {
    const periods = getPaidPeriods(daysAgo(75), 14, now);
    expect(periods.map((p) => p.start.toISOString().slice(0, 10))).toEqual([
      "2026-08-26",
      "2026-09-25",
      "2026-10-25",
    ]);
  });

  it("has no paid periods during the trial", () => {
    expect(getPaidPeriods(daysAgo(5), 14, now)).toHaveLength(0);
  });
});

describe("plan env vars", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads overrides", async () => {
    vi.stubEnv("BILLING_PLAN_PRICE", "19");
    vi.stubEnv("BILLING_TRIAL_DAYS", "7");
    vi.stubEnv("BILLING_PLAN_CURRENCY", "eur");
    vi.resetModules();
    const plan = await import("./billing.server");
    expect([plan.PLAN_PRICE, plan.TRIAL_DAYS, plan.PLAN_CURRENCY]).toEqual([19, 7, "EUR"]);
  });

  it("rejects a fractional trial length", async () => {
    vi.stubEnv("BILLING_TRIAL_DAYS", "7.5");
    vi.resetModules();
    await expect(import("./billing.server")).rejects.toThrow("Invalid BILLING_TRIAL_DAYS");
  });
});
