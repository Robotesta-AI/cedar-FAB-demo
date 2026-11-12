import { describe, expect, it } from "vitest";
import { demo } from "./helpers.js";

describe("FAB-6 send money to a saved beneficiary (BRD 3.1)", () => {
  it("rule 12: refuses an amount below 1.00 EGP or with more than 2 decimals", async () => {
    const { as } = demo();
    for (const amount of ["0.50", "10.123"]) {
      const res = await as("U-LAILA").post("/api/transfers", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("AMOUNT_INVALID");
    }
  });

  it("rule 13: a transfer larger than the available balance is refused and nothing is debited", async () => {
    const { as, store } = demo();
    store.accounts.find((a) => a.id === "A-1002")!.balance = 50_000;
    const res = await as("U-LAILA").post("/api/transfers", { sourceAccountId: "A-1002", beneficiaryId: "B-1", amount: "500.01" });
    expect(res.body.error).toBe("INSUFFICIENT_BALANCE");
    expect(store.accounts.find((a) => a.id === "A-1002")!.balance).toBe(50_000);
    expect(store.transfers).toHaveLength(0);
  });

  it("rule 14: the confirmation shows the beneficiary, the masked IBAN, the amount, the fee and the total", async () => {
    const { as } = demo();
    const res = await as("U-LAILA").post("/transfer/confirm", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "1500" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("Youssef Fathy");
    expect(res.text).toContain("EG93 **** **** **** **** **** 0001");
    expect(res.text).not.toContain("EG939999000500000000000050001");
    expect(res.text).toContain("1,500.00 EGP");
    expect(res.text).toMatch(/Fee<\/th><td>[\d,.]+ EGP/);
    expect(res.text).toMatch(/Total<\/th><td>[\d,.]+ EGP/);
  });

  it("rule 15: a frozen account cannot send", async () => {
    const { as } = demo();
    const res = await as("U-OMAR").post("/api/transfers", { sourceAccountId: "A-2001", beneficiaryId: "B-3", amount: "100" });
    expect(res.body.error).toBe("ACCOUNT_NOT_ACTIVE");
  });

  it("sends to a saved beneficiary, debits the account and records the transfer with its channel", async () => {
    const { as, store } = demo();
    const res = await as("U-LAILA", "mobile").post("/api/transfers", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "2500.50" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("SENT");
    expect(res.body.channel).toBe("MOBILE");
    const account = store.accounts.find((a) => a.id === "A-1001")!;
    expect(account.balance).toBe(42_000_000 - 250_050 - res.body.fee);
  });

  it("a customer cannot send from another customer's account or to another customer's beneficiary", async () => {
    const { as } = demo();
    expect((await as("U-OMAR").post("/api/transfers", { sourceAccountId: "A-1001", beneficiaryId: "B-3", amount: "10" })).body.error).toBe("ACCOUNT_NOT_FOUND");
    expect((await as("U-LAILA").post("/api/transfers", { sourceAccountId: "A-1001", beneficiaryId: "B-3", amount: "10" })).body.error).toBe("BENEFICIARY_NOT_FOUND");
  });
});
