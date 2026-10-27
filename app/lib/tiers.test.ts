import { describe, expect, it } from "vitest";
import {
  SAMPLE_TIERS,
  calculateGiftAmount,
  findActiveTier,
  formatMoney,
  parseTiersCsv,
  tierFromMetaobject,
  tierToFields,
  tiersToCsv,
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

  it("exports tiers as CSV and imports them back", () => {
    const tiers = [
      { minAmount: 10000, giftPercent: 7.5, active: true },
      { minAmount: 5000, giftPercent: 5, active: false },
    ];
    const csv = tiersToCsv(tiers);
    expect(csv).toBe("min_amount,gift_percent,active\n100.00,7.5,true\n50.00,5,false\n");
    expect(parseTiersCsv(csv)).toEqual({ tiers: [tiers[1], tiers[0]], errors: [] });
  });

  it("reads Excel-style CSV with semicolons, decimal commas and no active column", () => {
    const csv = "\uFEFFMin_Amount;Gift_Percent\r\n\"100,50\";7,5\r\n\r\n200;10\r\n";
    expect(parseTiersCsv(csv)).toEqual({
      tiers: [
        { minAmount: 10050, giftPercent: 7.5, active: true },
        { minAmount: 20000, giftPercent: 10, active: true },
      ],
      errors: [],
    });
  });

  it("reports bad rows, duplicates and a missing header", () => {
    const csv = "min_amount,gift_percent,active\n100,5,true\n0,5,true\n100,6,true\n200,150,true\n300,5,maybe\n";
    expect(parseTiersCsv(csv).errors).toEqual([
      { key: "tiers.importErrRow", values: { row: 3 } },
      { key: "tiers.importErrDuplicate", values: { row: 4 } },
      { key: "tiers.importErrRow", values: { row: 5 } },
      { key: "tiers.importErrRow", values: { row: 6 } },
    ]);
    expect(parseTiersCsv("amount,percent\n100,5\n").errors).toEqual([{ key: "tiers.importErrHeader" }]);
    expect(parseTiersCsv("min_amount,gift_percent\n").errors).toEqual([{ key: "tiers.importErrEmpty" }]);
  });

  it("reads an inactive tier and tolerates missing values", () => {
    const tier = tierFromMetaobject({
      id: "gid://shopify/Metaobject/2",
      fields: [{ key: "active", value: "false" }, { key: "min_amount", value: null }],
    });
    expect(tier).toMatchObject({ active: false, minAmount: 0, giftAmount: 0 });
  });
});
