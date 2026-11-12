import { describe, expect, it } from "vitest";
import { NEW_BENEFICIARY_CAP } from "../src/newBeneficiary.js";
import { demo } from "./helpers.js";

/** A beneficiary of Laila's added at the demo's "now" (an invented IBAN with valid check digits). */
function addNew(d: ReturnType<typeof demo>) {
  d.store.beneficiaries.push({ id: "B-NEW", customerId: "C-RETAIL-1", name: "Hoda Kamel", iban: "EG829999000300000000000030002", addedAt: d.clock.now(), removedAt: null });
}
const TO_NEW = { sourceAccountId: "A-1001", beneficiaryId: "B-NEW" };

describe("FAB-15 remove a beneficiary (BRD 2.2)", () => {
  it("rule 5: a customer can remove a beneficiary; it is marked removed and no longer offered", async () => {
    const d = demo();
    const res = await d.as("U-LAILA").delete("/api/beneficiaries/B-2");
    expect(res.status).toBe(200);
    expect(d.store.beneficiaries.find((b) => b.id === "B-2")!.removedAt).toEqual(d.clock.now());
    expect(d.store.beneficiariesOf("C-RETAIL-1").map((b) => b.id)).toEqual(["B-1"]);
    expect((await d.as("U-LAILA").post("/api/transfers", { sourceAccountId: "A-1001", beneficiaryId: "B-2", amount: "10" })).body.error).toBe("BENEFICIARY_NOT_FOUND");
  });

  it("rule 6: a transfer already sent to that beneficiary is not affected", async () => {
    const d = demo();
    const sent = await d.as("U-LAILA").post("/api/transfers", { sourceAccountId: "A-1001", beneficiaryId: "B-2", amount: "10" });
    await d.as("U-LAILA").delete("/api/beneficiaries/B-2");
    expect(d.store.transfers.find((t) => t.id === sent.body.id)).toMatchObject({ status: "SENT", beneficiaryName: "Cairo Flat Rentals" });
  });

  it("a customer cannot remove another customer's beneficiary", async () => {
    const d = demo();
    expect((await d.as("U-OMAR").delete("/api/beneficiaries/B-1")).status).toBe(404);
  });
});

describe("FAB-9 new beneficiary: at most 10,000 EGP in the first 24 hours (BRD 2.3)", () => {
  it("rule 8: at most 10,000 EGP in total to a beneficiary added less than 24 hours ago", async () => {
    const d = demo();
    addNew(d);
    expect((await d.as("U-LAILA").post("/api/transfers", { ...TO_NEW, amount: "6000.00" })).status).toBe(201);
    expect((await d.as("U-LAILA").post("/api/transfers", { ...TO_NEW, amount: "4000.01" })).body.error).toBe("NEW_BENEFICIARY_CAP");
    expect((await d.as("U-LAILA").post("/api/transfers", { ...TO_NEW, amount: "4000.00" })).status).toBe(201);
    expect(NEW_BENEFICIARY_CAP).toBe(1_000_000);
  });

  it("rule 9: the cap ends exactly 24 hours after the beneficiary was added", async () => {
    const d = demo();
    addNew(d);
    d.clock.advanceMinutes(24 * 60 - 1);
    expect((await d.as("U-LAILA").post("/api/transfers", { ...TO_NEW, amount: "10000.01" })).body.error).toBe("NEW_BENEFICIARY_CAP");
    d.clock.advanceMinutes(1);
    expect((await d.as("U-LAILA").post("/api/transfers", { ...TO_NEW, amount: "10000.01" })).status).toBe(201);
  });

  it("a beneficiary added long ago has no cap", async () => {
    const d = demo();
    expect((await d.as("U-LAILA").post("/api/transfers", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "20000.00" })).status).toBe(201);
  });
});
