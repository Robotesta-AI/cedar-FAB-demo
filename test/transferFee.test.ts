import { describe, expect, it } from "vitest";
import { MAXIMUM_FEE, MINIMUM_FEE, transferFee } from "../src/fees.js";
import { parseAmount } from "../src/money.js";
import { demo, send } from "./helpers.js";

const fee = (amount: string) => transferFee(parseAmount(amount)!);

describe("FAB-10 transfer fee 0.1%, minimum 5, maximum 250 (BRD 5.1)", () => {
  it("rule 33: the fee is 0.1% of the amount", () => {
    expect(fee("10000.00")).toBe(1_000);
    expect(fee("123456.00")).toBe(12_346);
  });

  it("rule 34: the minimum fee is 5.00 EGP (BRD example: 4,999.99 gives 5.00)", () => {
    expect(fee("4999.99")).toBe(MINIMUM_FEE);
    expect(fee("1.00")).toBe(500);
    expect(fee("5000.00")).toBe(500);
    expect(fee("5010.00")).toBe(501);
  });

  it("rule 34: the maximum fee is 250.00 EGP (BRD example: 250,001.00 gives 250.00)", () => {
    expect(fee("250001.00")).toBe(MAXIMUM_FEE);
    expect(fee("250000.00")).toBe(25_000);
    expect(fee("249990.00")).toBe(24_999);
  });

  it("rule 35: rounded half-up to 2 decimals (BRD example: 12,345.00 gives 12.35; FAB-21: 0.005 rounds up)", () => {
    expect(fee("12345.00")).toBe(1_235);
    expect(fee("12344.99")).toBe(1_234);
    expect(fee("20005.00")).toBe(2_001);
  });

  it("rule 36: the fee is shown before the customer confirms", async () => {
    const d = demo();
    const confirm = await d.as("U-LAILA").post("/transfer/confirm", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "12345.00" });
    expect(confirm.text).toContain("<tr><th>Fee</th><td>12.35 EGP</td></tr>");
    expect(confirm.text).toContain("<tr><th>Total</th><td>12,357.35 EGP</td></tr>");
    const quote = await d.as("U-LAILA", "mobile").post("/api/transfers/quote", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "12345.00" });
    expect(quote.body).toMatchObject({ amount: 1_234_500, fee: 1_235, total: 1_235_735 });
  });

  it("rule 36: the fee appears as its own line in the history, and the account is debited the amount plus the fee", async () => {
    const d = demo();
    const before = d.store.accounts.find((a) => a.id === "A-1001")!.balance;
    const sent = await send(d, "U-LAILA", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "12345.00" });
    expect(sent.body.fee).toBe(1_235);
    expect(d.store.accounts.find((a) => a.id === "A-1001")!.balance).toBe(before - 1_234_500 - 1_235);
    const home = await d.as("U-LAILA").get("/home");
    expect(home.text).toContain("<td>12,345.00 EGP</td><td>12.35 EGP</td>");
  });

  it("the balance check counts the fee", async () => {
    const d = demo();
    d.store.accounts.find((a) => a.id === "A-1002")!.balance = 100_400;
    const res = await send(d, "U-LAILA", { sourceAccountId: "A-1002", beneficiaryId: "B-2", amount: "1000.00" });
    expect(res.body.error).toBe("INSUFFICIENT_BALANCE");
  });

  it("rule 35 (FAB-24): a foreign-currency fee is calculated and rounded in the debit currency, to the cent", () => {
    // 0.1% of 1,234.50 USD is 1.2345 USD: 1.23 USD, not 1.2345 converted to EGP and back.
    expect(transferFee(123_450, "USD")).toBe(123);
    // 0.1% of 2,345.00 USD is 2.345 USD: half-up to 2.35 USD.
    expect(transferFee(234_500, "USD")).toBe(235);
    // 0.1% of 3,005.00 EUR is 3.005 EUR: 3.01 EUR.
    expect(transferFee(300_500, "EUR")).toBe(301);
  });

  it("rule 34 in a foreign currency: the 5 and 250 EGP bounds at the day's rate, to the cent", () => {
    // 5 EGP at 48.50 EGP per USD is 0.1031 USD: 0.10 USD.
    expect(transferFee(5_000, "USD")).toBe(10);
    // 250 EGP at 48.50 EGP per USD is 5.1546 USD: 5.15 USD.
    expect(transferFee(1_000_000, "USD")).toBe(515);
    expect(transferFee(500_000, "EGP")).toBe(500);
  });
});

