import { describe, expect, it } from "vitest";
import { demo } from "./helpers.js";

const BIG = { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "50000.00" };

function lastCode(store: ReturnType<typeof demo>["store"]): string {
  const text = store.outbox.at(-1)?.text ?? "";
  return /code is (\d{6})/.exec(text)?.[1] ?? "";
}

describe("FAB-5 one-time code for transfers of 50,000 EGP or more (BRD 4.2)", () => {
  it("rule 30: a transfer of exactly 50,000.00 EGP needs a 6-digit code sent to the registered phone, and nothing is sent before it", async () => {
    const { as, store } = demo();
    const res = await as("U-LAILA").post("/api/transfers", BIG);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("CODE_REQUIRED");
    expect(store.transfers).toHaveLength(0);
    expect(store.outbox.at(-1)?.to).toBe("+20 10 0000 0001");
    expect(lastCode(store)).toMatch(/^\d{6}$/);
  });

  it("rule 30: a transfer of 49,999.99 EGP is sent without a code", async () => {
    const { as, store } = demo();
    const res = await as("U-LAILA").post("/api/transfers", { ...BIG, amount: "49999.99" });
    expect(res.status).toBe(201);
    expect(store.outbox).toHaveLength(0);
  });

  it("rule 30: the right code sends the transfer", async () => {
    const { as, store } = demo();
    const { challengeId } = (await as("U-LAILA").post("/api/transfers", BIG)).body;
    const sent = await as("U-LAILA").post("/api/transfers/code", { challengeId, code: lastCode(store) });
    expect(sent.status).toBe(201);
    expect(sent.body.amount).toBe(5_000_000);
  });

  it("rule 30: the code is required on every channel (mobile too)", async () => {
    const { as } = demo();
    expect((await as("U-LAILA", "mobile").post("/api/transfers", BIG)).status).toBe(202);
  });

  it("rule 31: the code is valid for 3 minutes", async () => {
    const { as, store, clock } = demo();
    const { challengeId } = (await as("U-LAILA").post("/api/transfers", BIG)).body;
    clock.advanceMinutes(3);
    clock.set(new Date(clock.now().getTime() + 1_000));
    const res = await as("U-LAILA").post("/api/transfers/code", { challengeId, code: lastCode(store) });
    expect(res.body.error).toBe("CODE_EXPIRED");
    expect(store.transfers).toHaveLength(0);
  });

  it("rule 31: the code is valid at 3 minutes exactly", async () => {
    const { as, store, clock } = demo();
    const { challengeId } = (await as("U-LAILA").post("/api/transfers", BIG)).body;
    clock.advanceMinutes(3);
    expect((await as("U-LAILA").post("/api/transfers/code", { challengeId, code: lastCode(store) })).status).toBe(201);
  });

  it("rule 31: the code is valid for one transfer only", async () => {
    const { as, store } = demo();
    const { challengeId } = (await as("U-LAILA").post("/api/transfers", BIG)).body;
    const code = lastCode(store);
    expect((await as("U-LAILA").post("/api/transfers/code", { challengeId, code })).status).toBe(201);
    expect((await as("U-LAILA").post("/api/transfers/code", { challengeId, code })).body.error).toBe("CODE_ALREADY_USED");
    expect(store.transfers).toHaveLength(1);
  });

  it("rule 32: three wrong codes cancel the transfer and lock transfers for 15 minutes", async () => {
    const { as, store, clock } = demo();
    const { challengeId } = (await as("U-LAILA").post("/api/transfers", BIG)).body;
    const wrong = lastCode(store) === "000000" ? "111111" : "000000";
    expect((await as("U-LAILA").post("/api/transfers/code", { challengeId, code: wrong })).body).toMatchObject({ error: "CODE_WRONG", wrongCodesLeft: 2 });
    expect((await as("U-LAILA").post("/api/transfers/code", { challengeId, code: wrong })).body).toMatchObject({ error: "CODE_WRONG", wrongCodesLeft: 1 });
    expect((await as("U-LAILA").post("/api/transfers/code", { challengeId, code: wrong })).body.error).toBe("TRANSFER_CANCELLED");
    expect((await as("U-LAILA").post("/api/transfers/code", { challengeId, code: lastCode(store) })).body.error).toBe("TRANSFER_CANCELLED");
    expect((await as("U-LAILA").post("/api/transfers", { ...BIG, amount: "100" })).body.error).toBe("TRANSFERS_LOCKED");
    clock.advanceMinutes(15);
    expect((await as("U-LAILA").post("/api/transfers", { ...BIG, amount: "100" })).status).toBe(201);
    expect(store.transfers).toHaveLength(1);
  });

  it("a code belongs to the user it was sent for", async () => {
    const { as, store } = demo();
    const { challengeId } = (await as("U-LAILA").post("/api/transfers", BIG)).body;
    expect((await as("U-OMAR").post("/api/transfers/code", { challengeId, code: lastCode(store) })).body.error).toBe("CODE_NOT_FOUND");
  });

  it("the web flow asks for the code after the confirmation", async () => {
    const { as } = demo();
    const res = await as("U-LAILA").post("/transfer/send", BIG);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Enter your one-time code");
  });
});
