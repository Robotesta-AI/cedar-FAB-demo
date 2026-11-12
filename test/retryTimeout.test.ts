import { describe, expect, it } from "vitest";
import { demo } from "./helpers.js";

const BODY = { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "1000.00", reference: "CP-MOBILE-0001" };
const balance = (d: ReturnType<typeof demo>) => d.store.accounts.find((a) => a.id === "A-1001")!.balance;

describe("FAB-13 retry a transfer that timed out (BRD 3.3)", () => {
  it("rule 19: a transfer that times out can be retried by the customer, and the retry sends it", async () => {
    const d = demo();
    const before = balance(d);
    d.store.core.next = "TIMEOUT_BEFORE_POSTING";
    const first = await d.as("U-LAILA", "mobile").post("/api/transfers", BODY);
    expect(first.status).toBe(504);
    expect(first.body).toEqual({ error: "TIMED_OUT", reference: "CP-MOBILE-0001" });
    expect(balance(d)).toBe(before);

    const retry = await d.as("U-LAILA", "mobile").post("/api/transfers", BODY);
    expect(retry.status).toBe(201);
    expect(retry.body).toMatchObject({ reference: "CP-MOBILE-0001", status: "SENT" });
    expect(balance(d)).toBe(before - 100_000 - retry.body.fee);
  });

  it("rule 20: a retry with the same reference never sends the money twice", async () => {
    const d = demo();
    const before = balance(d);
    const first = await d.as("U-LAILA", "mobile").post("/api/transfers", BODY);
    const again = await d.as("U-LAILA", "mobile").post("/api/transfers", BODY);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect(d.store.transfers).toHaveLength(1);
    expect(balance(d)).toBe(before - 100_000 - first.body.fee);
  });

  it("rule 21: if the first attempt succeeded late, the retry returns the result of the first attempt", async () => {
    const d = demo();
    const before = balance(d);
    d.store.core.next = "TIMEOUT_AFTER_POSTING";
    const first = await d.as("U-LAILA", "mobile").post("/api/transfers", BODY);
    expect(first.status).toBe(504);
    const retry = await d.as("U-LAILA", "mobile").post("/api/transfers", BODY);
    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe("SENT");
    expect(d.store.transfers).toHaveLength(1);
    expect(balance(d)).toBe(before - 100_000 - retry.body.fee);
  });

  it("rule 20: a retry of a timed-out transfer of 50,000 EGP or more does not ask for a second code and sends once", async () => {
    const d = demo();
    const big = { ...BODY, amount: "60000.00", reference: "CP-MOBILE-0002" };
    const asked = await d.as("U-LAILA").post("/api/transfers", big);
    const code = /code is (\d{6})/.exec(d.store.outbox.at(-1)?.text ?? "")?.[1] ?? "";
    d.store.core.next = "TIMEOUT_AFTER_POSTING";
    expect((await d.as("U-LAILA").post("/api/transfers/code", { challengeId: asked.body.challengeId, code })).status).toBe(504);
    const retry = await d.as("U-LAILA").post("/api/transfers", big);
    expect(retry.status).toBe(201);
    expect(d.store.outbox).toHaveLength(1);
    expect(d.store.transfers).toHaveLength(1);
  });

  it("a timed-out transfer that did not go through counts against the daily limit only once it is sent", async () => {
    const d = demo();
    d.store.core.next = "TIMEOUT_BEFORE_POSTING";
    await d.as("U-LAILA").post("/api/transfers", BODY);
    expect((await d.as("U-LAILA").get("/api/limits/today")).body.sent).toBe(0);
    await d.as("U-LAILA").post("/api/transfers", BODY);
    expect((await d.as("U-LAILA").get("/api/limits/today")).body.sent).toBe(100_000);
  });

  it("another user cannot retry a customer's transfer by its reference", async () => {
    const d = demo();
    d.store.core.next = "TIMEOUT_BEFORE_POSTING";
    await d.as("U-LAILA").post("/api/transfers", BODY);
    d.store.accounts.find((a) => a.id === "A-2001")!.status = "ACTIVE";
    const other = await d.as("U-OMAR").post("/api/transfers", { sourceAccountId: "A-2001", beneficiaryId: "B-3", amount: "10.00", reference: BODY.reference });
    expect(other.status).toBe(201);
    expect(d.store.transfers.find((t) => t.customerId === "C-RETAIL-1")!.status).toBe("TIMED_OUT");
  });

  it("the web page offers a Retry with the same reference after a timeout", async () => {
    const d = demo();
    const confirm = await d.as("U-LAILA").post("/transfer/confirm", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "1000.00" });
    const reference = /name="reference" value="([^"]+)"/.exec(confirm.text)?.[1];
    expect(reference).toMatch(/^CP-/);
    d.store.core.next = "TIMEOUT_BEFORE_POSTING";
    const timedOut = await d.as("U-LAILA").post("/transfer/send", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "1000.00", reference });
    expect(timedOut.status).toBe(504);
    expect(timedOut.text).toContain("Retry");
    expect(timedOut.text).toContain(`name="reference" value="${reference}"`);
    const retried = await d.as("U-LAILA").post("/transfer/send", { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "1000.00", reference });
    expect(retried.status).toBe(200);
    expect(retried.text).toContain("sent to Youssef Fathy");
  });
});

describe("FAB-13 and the notifications (BRD 3.4 rule 24)", () => {
  it("a transfer that went through late is notified once, when it is known to be sent", async () => {
    const d = demo();
    d.store.core.next = "TIMEOUT_AFTER_POSTING";
    await d.as("U-LAILA", "mobile").post("/api/transfers", BODY);
    expect(d.store.notifications).toEqual([]);
    await d.as("U-LAILA", "mobile").post("/api/transfers", BODY);
    await d.as("U-LAILA", "mobile").post("/api/transfers", BODY);
    expect(d.store.notifications.map((n) => n.channel)).toEqual(["PUSH", "EMAIL"]);
  });
});
