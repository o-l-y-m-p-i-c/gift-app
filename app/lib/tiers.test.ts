import { describe, expect, it } from "vitest";
import {
  SAMPLE_TIERS,
  calculateGiftAmount,
  findActiveTier,
  formatMoney,
  tierFromMetaobject,
  tierToFields,
} from "./tiers";

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

  it("round-trips a tier through metaobject fields", () => {
    const input = { minAmount: 10000, giftPercent: 7.5, giftAmount: 750, active: true };
    const fields = tierToFields(input, "USD");
    expect(fields.find((f) => f.key === "label")?.value).toBe("$100.00+ · 7.5%");
    expect(tierFromMetaobject({ id: "gid://shopify/Metaobject/1", fields })).toEqual({
      id: "gid://shopify/Metaobject/1",
      label: "$100.00+ · 7.5%",
      ...input,
    });
  });

  it("reads an inactive tier and tolerates missing values", () => {
    const tier = tierFromMetaobject({
      id: "gid://shopify/Metaobject/2",
      fields: [{ key: "active", value: "false" }, { key: "min_amount", value: null }],
    });
    expect(tier).toMatchObject({ active: false, minAmount: 0, giftAmount: 0 });
  });
});
