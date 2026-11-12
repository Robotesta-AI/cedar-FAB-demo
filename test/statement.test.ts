import request from "supertest";
import { describe, expect, it } from "vitest";
import { statementPeriod, statementRows } from "../src/statements.js";
import { demo, send } from "./helpers.js";

function binary(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("FAB-14 export a statement as PDF (BRD 7.1)", () => {
  it("rule 41: exports a statement as a PDF", async () => {
    const d = demo();
    await send(d, "U-LAILA", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "1200.00" });
    const res = await d.as("U-LAILA").get("/statement.pdf?from=2026-10-01&to=2026-10-31").buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("cedar-pay-statement-2026-10-01-2026-10-31.pdf");
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rule 41: any period of up to 12 months, and no longer", () => {
    expect(statementPeriod("2025-11-01", "2026-10-31")).toMatchObject({ from: new Date("2025-11-01T00:00:00Z") });
    expect(statementPeriod("2025-10-31", "2026-10-31")).toBe("PERIOD_TOO_LONG");
    expect(statementPeriod("2026-10-31", "2026-10-01")).toBe("PERIOD_INVALID");
    expect(statementPeriod("01/10/2026", "2026-10-31")).toBe("PERIOD_INVALID");
  });

  it("rule 41: a period longer than 12 months is refused", async () => {
    const d = demo();
    const res = await d.as("U-LAILA").get("/statement.pdf?from=2025-01-01&to=2026-10-31").set("Accept", "application/json");
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("PERIOD_TOO_LONG");
  });

  it("rule 42: lists each transfer of the period with its date, reference, beneficiary, amount and fee", async () => {
    const d = demo();
    const first = await send(d, "U-LAILA", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "1200.00" });
    d.clock.advanceMinutes(60 * 24);
    const second = await send(d, "U-LAILA", { sourceAccountId: "A-1002", beneficiaryId: "B-2", amount: "12345.00" });
    const period = statementPeriod("2026-10-01", "2026-10-31");
    if (typeof period === "string") throw new Error(period);
    expect(statementRows(d.store, d.store.user("U-LAILA")!, period)).toEqual([
      { date: "2026-10-20", reference: first.body.reference, beneficiary: "Youssef Fathy", amount: "1,200.00 EGP", fee: "5.00 EGP" },
      { date: "2026-10-21", reference: second.body.reference, beneficiary: "Cairo Flat Rentals", amount: "12,345.00 EGP", fee: "12.35 EGP" },
    ]);
  });

  it("rule 42: only the customer's own sent transfers of the period are listed", async () => {
    const d = demo();
    await send(d, "U-LAILA", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "1200.00" });
    d.store.core.next = "TIMEOUT_BEFORE_POSTING";
    await send(d, "U-LAILA", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "300.00" });
    const september = statementPeriod("2026-09-01", "2026-09-30");
    const october = statementPeriod("2026-10-01", "2026-10-31");
    if (typeof september === "string" || typeof october === "string") throw new Error("period");
    expect(statementRows(d.store, d.store.user("U-LAILA")!, september)).toEqual([]);
    expect(statementRows(d.store, d.store.user("U-LAILA")!, october)).toHaveLength(1);
    expect(statementRows(d.store, d.store.user("U-OMAR")!, october)).toEqual([]);
  });
});
