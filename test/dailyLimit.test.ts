import { describe, expect, it } from "vitest";
import { DAILY_LIMIT, cairoDay } from "../src/limits.js";
import { amountText, demo, send } from "./helpers.js";

const CURRENT = { sourceAccountId: "A-1001", beneficiaryId: "B-1" };
const SAVINGS = { sourceAccountId: "A-1002", beneficiaryId: "B-2" };

describe("FAB-7 daily transfer limit (BRD 4.1)", () => {
  it("rule 27: a transfer that takes the day's total to exactly the limit is allowed", async () => {
    const d = demo();
    expect((await send(d, "U-LAILA", { ...CURRENT, amount: amountText(DAILY_LIMIT) })).status).toBe(201);
  });

  it("rule 27: a transfer that would take the day's total above the limit is refused and nothing is debited", async () => {
    const d = demo();
    const before = d.store.accounts.find((a) => a.id === "A-1001")!.balance;
    const res = await send(d, "U-LAILA", { ...CURRENT, amount: amountText(DAILY_LIMIT + 1) });
    expect(res.body.error).toBe("DAILY_LIMIT_EXCEEDED");
    expect(d.store.accounts.find((a) => a.id === "A-1001")!.balance).toBe(before);
  });

  it("rule 26: the limit counts all of the customer's accounts together", async () => {
    const d = demo();
    expect((await send(d, "U-LAILA", { ...CURRENT, amount: amountText(DAILY_LIMIT - 1_000_00) })).status).toBe(201);
    expect((await send(d, "U-LAILA", { ...SAVINGS, amount: "1000.01" })).body.error).toBe("DAILY_LIMIT_EXCEEDED");
    expect((await send(d, "U-LAILA", { ...SAVINGS, amount: "1000.00" })).status).toBe(201);
  });

  it("rule 26 (FAB-19): the limit counts web and mobile together, not per channel", async () => {
    const d = demo();
    expect((await send(d, "U-LAILA", { ...CURRENT, amount: amountText(DAILY_LIMIT - 5_000_00) }, "web")).status).toBe(201);
    expect((await send(d, "U-LAILA", { ...CURRENT, amount: "5000.01" }, "mobile")).body.error).toBe("DAILY_LIMIT_EXCEEDED");
  });

  it("rule 28: the day's total resets at 00:00 Cairo time", async () => {
    // 23:30 Cairo time on 20 Oct (UTC+3).
    const d = demo(new Date("2026-10-20T20:30:00Z"));
    expect(cairoDay(d.clock.now())).toBe("2026-10-20");
    expect((await send(d, "U-LAILA", { ...CURRENT, amount: amountText(DAILY_LIMIT) })).status).toBe(201);
    expect((await send(d, "U-LAILA", { ...CURRENT, amount: "1.00" })).body.error).toBe("DAILY_LIMIT_EXCEEDED");
    d.clock.advanceMinutes(30); // 00:00 Cairo time on 21 Oct
    expect(cairoDay(d.clock.now())).toBe("2026-10-21");
    expect((await send(d, "U-LAILA", { ...CURRENT, amount: "1.00" })).status).toBe(201);
  });

  it("rule 25: one customer's transfers do not count against another's limit", async () => {
    const d = demo();
    expect((await send(d, "U-LAILA", { ...CURRENT, amount: amountText(DAILY_LIMIT) })).status).toBe(201);
    d.store.accounts.find((a) => a.id === "A-2001")!.status = "ACTIVE";
    expect((await send(d, "U-OMAR", { sourceAccountId: "A-2001", beneficiaryId: "B-3", amount: "100.00" })).status).toBe(201);
  });

  it("the limit is checked again when the one-time code is typed, not only when the transfer is asked for", async () => {
    const d = demo();
    const first = await d.as("U-LAILA").post("/api/transfers", { ...CURRENT, amount: amountText(DAILY_LIMIT) });
    expect(first.status).toBe(202);
    const code = /code is (\d{6})/.exec(d.store.outbox.at(-1)?.text ?? "")?.[1] ?? "";
    expect((await send(d, "U-LAILA", { ...SAVINGS, amount: "10.00" })).status).toBe(201);
    const late = await d.as("U-LAILA").post("/api/transfers/code", { challengeId: first.body.challengeId, code });
    expect(late.body.error).toBe("DAILY_LIMIT_EXCEEDED");
  });
});
