import { describe, expect, it } from "vitest";
import { demo } from "./helpers.js";

const PAY_SUPPLIER = { sourceAccountId: "A-3001", beneficiaryId: "B-4", amount: "20000.00" };

describe("FAB-12 corporate transfer needs a maker and a checker (BRD 6.1)", () => {
  it("rule 37: a maker creates a corporate transfer; nothing is debited until a checker approves it", async () => {
    const d = demo();
    const before = d.store.accounts.find((a) => a.id === "A-3001")!.balance;
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("PENDING_APPROVAL");
    expect(d.store.accounts.find((a) => a.id === "A-3001")!.balance).toBe(before);

    const approved = await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: "SENT", approvedBy: "U-KARIM" });
    expect(d.store.accounts.find((a) => a.id === "A-3001")!.balance).toBe(before - 2_000_000 - approved.body.fee);
  });

  it("rule 37: only a maker creates and only a checker approves", async () => {
    const d = demo();
    expect((await d.as("U-KARIM").post("/api/transfers", PAY_SUPPLIER)).body.error).toBe("NOT_A_MAKER");
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    expect((await d.as("U-MONA").post(`/api/approvals/${created.body.id}/approve`)).body.error).toBe("NOT_A_CHECKER");
  });

  it("rule 37: a transfer is approved once", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    expect((await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`)).status).toBe(200);
    expect((await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`)).body.error).toBe("NOT_PENDING");
  });

  it("rule 38: a checker sees only the transfers of their own company", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    expect((await d.as("U-KARIM").get("/api/approvals")).body.map((t: { id: string }) => t.id)).toEqual([created.body.id]);
    expect((await d.as("U-HANY").get("/api/approvals")).body).toEqual([]);
    expect((await d.as("U-HANY").post(`/api/approvals/${created.body.id}/approve`)).body.error).toBe("TRANSFER_NOT_FOUND");
  });

  it("rule 40: a transfer not approved within 48 hours expires and nothing is debited", async () => {
    const d = demo();
    const before = d.store.accounts.find((a) => a.id === "A-3001")!.balance;
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    d.clock.advanceMinutes(48 * 60 + 1);
    expect((await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`)).body.error).toBe("EXPIRED");
    expect((await d.as("U-KARIM").get("/api/approvals")).body).toEqual([]);
    expect(d.store.accounts.find((a) => a.id === "A-3001")!.balance).toBe(before);
  });

  it("rule 40: a transfer can still be approved at 48 hours exactly", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    d.clock.advanceMinutes(48 * 60);
    expect((await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`)).status).toBe(200);
  });

  it("BRD 4.2: approving a corporate transfer of 50,000 EGP or more needs the one-time code", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", { ...PAY_SUPPLIER, amount: "75000.00" });
    const asked = await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`);
    expect(asked.status).toBe(202);
    const code = /code is (\d{6})/.exec(d.store.outbox.at(-1)?.text ?? "")?.[1] ?? "";
    const sent = await d.as("U-KARIM").post("/api/transfers/code", { challengeId: asked.body.challengeId, code });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: "SENT", approvedBy: "U-KARIM" });
  });

  it("the checker's page lists the waiting transfer with who created it", async () => {
    const d = demo();
    await d.as("U-MONA").post("/transfer/send", PAY_SUPPLIER);
    const page = await d.as("U-KARIM").get("/approvals");
    expect(page.text).toContain("Mona Said (maker)");
    expect(page.text).toContain("20,000.00 EGP");
  });

  it("the company is notified when the approved transfer is sent, not when it is created", async () => {
    const d = demo();
    const created = await d.as("U-MONA").post("/api/transfers", PAY_SUPPLIER);
    expect(d.store.notifications).toEqual([]);
    await d.as("U-KARIM").post(`/api/approvals/${created.body.id}/approve`);
    expect(d.store.notifications.map((n) => [n.channel, n.customerId])).toEqual([
      ["PUSH", "C-CORP-1"],
      ["EMAIL", "C-CORP-1"],
    ]);
  });
});
