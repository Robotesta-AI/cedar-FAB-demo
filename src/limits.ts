import type { Customer } from "./model.js";
import { egp, type Minor } from "./money.js";
import type { Store } from "./store.js";

/**
 * BRD 4.1, clarified on 14 September 2026 after FAB-19 (the limit was counted per channel):
 * a retail customer can send at most 100,000 EGP in one calendar day, Cairo time.
 * The limit is per customer: all of the customer's accounts together, web and mobile together.
 */
export const DAILY_LIMIT_EGP = 150_000;
export const DAILY_LIMIT: Minor = egp(DAILY_LIMIT_EGP);

const CAIRO_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });

/** The calendar day in Cairo, "2026-10-20". Rule 28: the day's total resets at 00:00 Cairo time. */
export function cairoDay(at: Date): string {
  return CAIRO_DAY.format(at);
}

/** What the customer sent today, every account and every channel counted together (rule 26). */
export function sentToday(store: Store, customerId: string, now: Date): Minor {
  const today = cairoDay(now);
  return store
    .transfersOf(customerId)
    .filter((t) => t.status === "SENT" && t.sentAt !== null && cairoDay(t.sentAt) === today)
    .reduce((sum, t) => sum + t.amount, 0);
}

/** Rule 27: a transfer that would take the day's total above the limit is refused; exactly the limit is allowed. */
export function withinDailyLimit(store: Store, customer: Customer, amount: Minor, now: Date): boolean {
  if (customer.kind !== "RETAIL") return true;
  return sentToday(store, customer.id, now) + amount <= DAILY_LIMIT;
}

/** BRD 4.1 rule 29: how much the customer can still send today, never below zero. */
export function remainingToday(store: Store, customerId: string, now: Date): Minor {
  return Math.max(0, DAILY_LIMIT - sentToday(store, customerId, now));
}
