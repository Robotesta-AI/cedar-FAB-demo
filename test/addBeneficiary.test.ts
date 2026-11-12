import { describe, expect, it } from "vitest";
import { ibanChecksumValid } from "../src/iban.js";
import { MAX_BENEFICIARIES } from "../src/beneficiaries.js";
import { demo } from "./helpers.js";

/** Invented IBANs with the fictional bank code 9999 and valid check digits. */
const NEW_IBAN = "EG829999000300000000000030002";
const BAD_CHECK_DIGITS = "EG839999000300000000000030002";

function ibanFor(n: number): string {
  const bban = `99990007${String(n).padStart(17, "0")}`;
  const numeric = [...`${bban}EG00`].map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join("");
  const check = 98 - Number(BigInt(numeric) % 97n);
  return `EG${String(check).padStart(2, "0")}${bban}`;
}

describe("FAB-4 add a beneficiary by IBAN (BRD 2.1)", () => {
  it("rule 1: adds a beneficiary with a name of 2 to 70 characters and an Egyptian IBAN of 29 characters", async () => {
    const { as, store } = demo();
    const res = await as("U-LAILA").post("/api/beneficiaries", { name: "Hoda Kamel", iban: "eg82 9999 0003 0000 0000 0000 3000 2" });
    expect(res.status).toBe(201);
    expect(res.body.iban).toBe(NEW_IBAN);
    expect(store.beneficiariesOf("C-RETAIL-1").map((b) => b.name)).toContain("Hoda Kamel");
  });

  it("rule 1: refuses a name shorter than 2 or longer than 70 characters", async () => {
    const { as } = demo();
    for (const name of ["H", "x".repeat(71)]) {
      const res = await as("U-LAILA").post("/api/beneficiaries", { name, iban: NEW_IBAN });
      expect(res.body.error).toBe("NAME_LENGTH");
    }
    expect((await as("U-LAILA").post("/api/beneficiaries", { name: "x".repeat(70), iban: NEW_IBAN })).status).toBe(201);
  });

  it("rule 1: refuses an IBAN that is not EG with 29 characters", async () => {
    const { as } = demo();
    for (const iban of ["EG82999900030000000000003000", "GB82999900030000000000003000212", "EG82999900030000000000003000A"]) {
      expect((await as("U-LAILA").post("/api/beneficiaries", { name: "Hoda Kamel", iban })).body.error).toBe("IBAN_FORMAT");
    }
  });

  it("rule 2: an IBAN that fails its check digits is refused", async () => {
    const { as } = demo();
    expect(ibanChecksumValid(BAD_CHECK_DIGITS)).toBe(false);
    const res = await as("U-LAILA").post("/api/beneficiaries", { name: "Hoda Kamel", iban: BAD_CHECK_DIGITS });
    expect(res.body.error).toBe("IBAN_CHECK_DIGITS");
  });

  it("rule 3: the same IBAN cannot be added twice for one customer, but another customer can add it", async () => {
    const { as } = demo();
    expect((await as("U-LAILA").post("/api/beneficiaries", { name: "Hoda Kamel", iban: NEW_IBAN })).status).toBe(201);
    expect((await as("U-LAILA").post("/api/beneficiaries", { name: "Hoda K.", iban: NEW_IBAN })).body.error).toBe("IBAN_ALREADY_SAVED");
    expect((await as("U-OMAR").post("/api/beneficiaries", { name: "Hoda Kamel", iban: NEW_IBAN })).status).toBe(201);
  });

  it("rule 4: a customer holds at most 50 beneficiaries", async () => {
    const { as, store } = demo();
    const already = store.beneficiariesOf("C-RETAIL-1").length;
    for (let i = already; i < MAX_BENEFICIARIES; i += 1) {
      expect((await as("U-LAILA").post("/api/beneficiaries", { name: `Payee ${i}`, iban: ibanFor(i) })).status).toBe(201);
    }
    const res = await as("U-LAILA").post("/api/beneficiaries", { name: "One too many", iban: ibanFor(999) });
    expect(res.body.error).toBe("TOO_MANY_BENEFICIARIES");
  });

  it("every seeded IBAN is a valid Egyptian IBAN", async () => {
    const { store } = demo();
    for (const iban of [...store.accounts.map((a) => a.iban), ...store.beneficiaries.map((b) => b.iban)]) {
      expect(ibanChecksumValid(iban)).toBe(true);
    }
  });

  it("the web form adds a beneficiary and shows the refusal in words", async () => {
    const { as } = demo();
    const refused = await as("U-LAILA").post("/beneficiaries", { name: "Hoda Kamel", iban: BAD_CHECK_DIGITS });
    expect(refused.status).toBe(422);
    expect(refused.text).toContain("This IBAN is not valid");
    const added = await as("U-LAILA").post("/beneficiaries", { name: "Hoda Kamel", iban: NEW_IBAN });
    expect(added.status).toBe(302);
  });
});
