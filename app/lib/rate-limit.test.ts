import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit per window, per key", () => {
    const allow = createRateLimiter({ limit: 2, windowMs: 1000 });
    expect([allow("a", 0), allow("a", 10), allow("a", 20)]).toEqual([true, true, false]);
    expect(allow("b", 20)).toBe(true);
  });

  it("resets when the window ends", () => {
    const allow = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect([allow("a", 0), allow("a", 999), allow("a", 1000)]).toEqual([true, false, true]);
  });
});
