import request from "supertest";
import { createApp } from "../src/app.js";
import { FixedClock } from "../src/clock.js";
import type { Settings } from "../src/settings.js";
import { seedStore, type Store } from "../src/store.js";

/** 10:00 Cairo time on a Tuesday in sprint 2. */
export const DEMO_NOW = new Date("2026-10-20T08:00:00Z");

export function demo(now: Date = DEMO_NOW, settings?: Settings) {
  const clock = new FixedClock(now);
  const store: Store = seedStore(clock, settings);
  const app = createApp(store);
  const as = (userId: string, channel: "web" | "mobile" = "web") => ({
    get: (path: string) => request(app).get(path).set("X-Cedar-User", userId).set("X-Cedar-Channel", channel),
    post: (path: string, body: object = {}) => request(app).post(path).set("X-Cedar-User", userId).set("X-Cedar-Channel", channel).send(body),
    delete: (path: string) => request(app).delete(path).set("X-Cedar-User", userId).set("X-Cedar-Channel", channel),
  });
  return { clock, store, app, as };
}

type Demo = ReturnType<typeof demo>;

/** Sends a transfer through the API, typing the one-time code when one is asked for. */
export async function send(d: Demo, userId: string, body: { sourceAccountId: string; beneficiaryId: string; amount: string }, channel: "web" | "mobile" = "web") {
  const first = await d.as(userId, channel).post("/api/transfers", body);
  if (first.status !== 202) return first;
  const code = /code is (\d{6})/.exec(d.store.outbox.at(-1)?.text ?? "")?.[1] ?? "";
  return d.as(userId, channel).post("/api/transfers/code", { challengeId: first.body.challengeId, code });
}

/** "12345.67" from minor units. */
export function amountText(minor: number): string {
  return (minor / 100).toFixed(2);
}
