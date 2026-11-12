import { describe, expect, it } from "vitest";
import { DAILY_LIMIT } from "../src/limits.js";
import { formatMoney } from "../src/money.js";
import { demo, send } from "./helpers.js";

describe("FAB-8 show the remaining daily limit on the transfer page (BRD 4.1 rule 29)", () => {
  it("shows the full limit before anything is sent today", async () => {
    const d = demo();
    const page = await d.as("U-LAILA").get("/transfer");
    expect(page.text).toContain(`You can still send ${formatMoney(DAILY_LIMIT)} today`);
  });

  it("shows what is left after transfers from both accounts and both channels", async () => {
    const d = demo();
    await send(d, "U-LAILA", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "12000.00" }, "web");
    await send(d, "U-LAILA", { sourceAccountId: "A-1002", beneficiaryId: "B-2", amount: "3000.50" }, "mobile");
    const page = await d.as("U-LAILA").get("/transfer");
    expect(page.text).toContain(`You can still send ${formatMoney(DAILY_LIMIT - 1_500_050)} today`);
    const api = await d.as("U-LAILA", "mobile").get("/api/limits/today");
    expect(api.body).toEqual({ limit: DAILY_LIMIT, sent: 1_500_050, remaining: DAILY_LIMIT - 1_500_050 });
  });

  it("shows 0.00 EGP, never a negative amount, once the limit is reached", async () => {
    const d = demo();
    await send(d, "U-LAILA", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: (DAILY_LIMIT / 100).toFixed(2) });
    expect((await d.as("U-LAILA").get("/transfer")).text).toContain("You can still send 0.00 EGP today");
  });

  it("the transfer page after a refusal still shows the remaining amount", async () => {
    const d = demo();
    const res = await d.as("U-LAILA").post("/transfer/confirm", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "0" });
    expect(res.status).toBe(422);
    expect(res.text).toContain("You can still send");
  });

  it("a corporate customer has no retail daily limit and sees no remaining amount", async () => {
    const d = demo();
    expect((await d.as("U-MONA").get("/transfer")).text).not.toContain("You can still send");
    expect((await d.as("U-MONA").get("/api/limits/today")).body).toEqual({ limit: null });
  });
});
