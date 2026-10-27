import { describe, expect, it } from "vitest";
import { SAMPLE_TIERS, calculateGiftAmount, findActiveTier, formatMoney } from "./tiers";

describe("tiers", () => {
  it("rounds the gift amount half up", () => {
    expect(calculateGiftAmount(10000, 7.5)).toBe(750);
    expect(calculateGiftAmount(333, 50)).toBe(167);
  });

  it("finds the highest tier the cart reaches", () => {
    expect(findActiveTier(SAMPLE_TIERS, 4999)).toBeNull();
    expect(findActiveTier(SAMPLE_TIERS, 15000)?.minAmount).toBe(15000);
    expect(findActiveTier(SAMPLE_TIERS, 99999)?.minAmount).toBe(30000);
  });

  it("formats amounts in the shop currency", () => {
    expect(formatMoney(1234, "USD")).toBe("$12.34");
    expect(formatMoney(1234, "EUR", "de-DE")).toBe("12,34\u00a0€");
  });
});
