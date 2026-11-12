import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount } from "../src/money.js";

describe("amounts (BRD 3.1 rule 12)", () => {
  it("reads an amount of at least 1.00 with at most 2 decimals, in minor units", () => {
    expect(parseAmount("1")).toBe(100);
    expect(parseAmount("1.00")).toBe(100);
    expect(parseAmount("12,345.5")).toBe(1_234_550);
    expect(parseAmount("0.99")).toBeNull();
    expect(parseAmount("10.001")).toBeNull();
    expect(parseAmount("-5")).toBeNull();
    expect(parseAmount("ten")).toBeNull();
  });

  it("formats minor units as money", () => {
    expect(formatMoney(1_234_500)).toBe("12,345.00 EGP");
    expect(formatMoney(5)).toBe("0.05 EGP");
  });
});
