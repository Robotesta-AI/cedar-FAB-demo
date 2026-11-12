import { describe, expect, it } from "vitest";
import { demo } from "./helpers.js";

const PAY_SUPPLIER = { sourceAccountId: "A-3001", beneficiaryId: "B-4", amount: "20000.00" };

describe("FAB-22 audit log for every approval (BRD 7.2)", () => {
  it("rule 43: an approval is written to the audit log with the time, the user and the transfer reference", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`);
    const log = await d.as("U-KARIM").get("/api/audit");
    expect(log.body).toEqual([
      { at: d.clock.now().toISOString(), customerId: "C-CORP-1", userId: "U-KARIM", action: "APPROVED", transferReference: created.body.reference },
    ]);
  });

  it("rule 43: a rejection is written to the audit log, and nothing is debited", async () => {
    const d = demo();
    const before = d.store.accounts.find((a) => a.id === "A-3001")!.balance;
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    const rejected = await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/reject`);
    expect(rejected.body.status).toBe("REJECTED");
    expect(d.store.accounts.find((a) => a.id === "A-3001")!.balance).toBe(before);
    expect((await d.as("U-KARIM").get("/api/audit")).body.map((e: { action: string }) => e.action)).toEqual(["REJECTED"]);
  });

  it("only a checker rejects, and a rejected transfer cannot be approved afterwards", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    expect((await d.as("U-MONA").post(`/api/approvals/${created.body.id}/reject`)).body.error).toBe("NOT_A_CHECKER");
    await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/reject`);
    expect((await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`)).body.error).toBe("NOT_PENDING");
  });

  it("rule 44: the audit log cannot be edited or deleted from the application", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`);
    expect((await d.as("U-KARIM").delete("/api/audit")).status).toBe(404);
    expect((await d.as("U-KARIM").post("/api/audit", { action: "REJECTED" })).status).toBe(404);
    expect(Object.isFrozen(d.store.auditLog[0])).toBe(true);
  });

  it("a checker sees only their own company's audit log, and a maker cannot read it", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`);
    expect((await d.as("U-HANY").get("/api/audit")).body).toEqual([]);
    expect((await d.as("U-MONA").get("/api/audit")).status).toBe(403);
  });
});
