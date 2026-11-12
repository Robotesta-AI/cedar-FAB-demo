import { describe, expect, it } from "vitest";
import { settingsFrom } from "../src/settings.js";
import { DEMO_NOW, demo } from "./helpers.js";

const SEND = { sourceAccountId: "A-1001", beneficiaryId: "B-1", amount: "250.00" };

describe("FAB-16 notify the customer after a transfer (BRD 3.4)", () => {
  it("rule 22: after every transfer the customer is notified by push and by e-mail", async () => {
    const d = demo();
    const sent = await d.as("U-LAILA").post("/api/transfers", SEND);
    expect(d.store.notifications.map((n) => [n.channel, n.transferReference])).toEqual([
      ["PUSH", sent.body.reference],
      ["EMAIL", sent.body.reference],
    ]);
  });

  it("a refused transfer sends no notification", async () => {
    const d = demo();
    await d.as("U-LAILA").post("/api/transfers", { ...SEND, amount: "0.10" });
    expect(d.store.notifications).toEqual([]);
  });

  it("SMS_NOTIFICATIONS is off by default: no SMS is sent", async () => {
    expect(settingsFrom({})).toEqual({ smsNotifications: false });
    expect(settingsFrom({ SMS_NOTIFICATIONS: "yes" })).toEqual({ smsNotifications: false });
    const d = demo();
    await d.as("U-LAILA").post("/api/transfers", SEND);
    expect(d.store.notifications.some((n) => n.channel === "SMS")).toBe(false);
  });

  it("with SMS_NOTIFICATIONS on, an SMS is sent as well, one per transfer (rule 24)", async () => {
    const d = demo(DEMO_NOW, settingsFrom({ SMS_NOTIFICATIONS: "true" }));
    await d.as("U-LAILA").post("/api/transfers", SEND);
    expect(d.store.notifications.map((n) => n.channel)).toEqual(["PUSH", "EMAIL", "SMS"]);
  });
});
