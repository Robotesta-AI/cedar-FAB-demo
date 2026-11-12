import { describe, expect, it } from "vitest";
import { demo } from "./helpers.js";

const PAY_SUPPLIER = { sourceAccountId: "A-3001", beneficiaryId: "B-4", amount: "20000.00" };

describe("FAB-12 follow-up: reject with a reason, tell the maker on expiry, check at approval", () => {
  it("criterion 2: a checker rejects a pending transfer with a reason; it moves to Rejected and nothing is debited", async () => {
    const d = demo();
    const before = d.store.accounts.find((a) => a.id === "A-3001")!.balance;
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    const rejected = await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/reject`, { reason: "Wrong supplier invoice" });
    expect(rejected.body).toMatchObject({ status: "REJECTED", rejectionReason: "Wrong supplier invoice" });
    expect(d.store.accounts.find((a) => a.id === "A-3001")!.balance).toBe(before);
    expect((await d.as("U-KARIM").get("/api/approvals")).body).toEqual([]);
  });

  it("criterion 2: a rejection needs a reason, and only a checker can reject", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    expect((await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/reject`, { reason: "  " })).body.error).toBe("REASON_REQUIRED");
    expect((await d.as("U-MONA").post(`/api/approvals/${created.body.id}/reject`, { reason: "No" })).body.error).toBe("NOT_A_CHECKER");
  });

  it("criterion 2: a rejected transfer cannot be approved afterwards", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/reject`, { reason: "Duplicate" });
    expect((await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`)).body.error).toBe("NOT_PENDING");
  });

  it("criterion 4: a transfer not approved within 48 hours expires and the maker is notified once", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    d.clock.advanceMinutes(48 * 60 + 1);
    await d.as("U-KARIM").get("/api/approvals");
    await d.as("U-KARIM").get("/api/approvals");
    expect(d.store.transfers.find((t) => t.id === created.body.id)!.status).toBe("EXPIRED");
    const notices = d.store.notifications.filter((n) => n.transferReference === created.body.reference);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toContain("expired without approval");
    expect(notices[0]!.text).toContain("Mona Said");
  });

  it("criterion 5: the rules are checked at the moment of approval, not only at creation", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    d.store.accounts.find((a) => a.id === "A-3001")!.status = "FROZEN";
    expect((await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`)).body.error).toBe("ACCOUNT_NOT_ACTIVE");
    d.store.accounts.find((a) => a.id === "A-3001")!.status = "ACTIVE";
    d.store.beneficiaries.find((b) => b.id === "B-4")!.removedAt = d.clock.now();
    expect((await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`)).body.error).toBe("BENEFICIARY_NOT_FOUND");
  });

  it("the checker's page offers Reject with a reason", async () => {
    const d = demo();
    await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    const page = await d.as("U-KARIM").get("/approvals");
    expect(page.text).toContain('name="reason"');
    expect(page.text).toContain("Reject");
  });
});
