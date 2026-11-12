import type { Beneficiary } from "./model.js";
import { egp, type Minor } from "./money.js";
import type { Store } from "./store.js";

/**
 * FAB-9, BRD 2.3 (fraud rule agreed with Risk on 10 September 2026, no fast track): for 24 hours after a beneficiary
 * is added, the customer can send that beneficiary at most 10,000 EGP in total.
 */
export const NEW_BENEFICIARY_CAP: Minor = egp(10_000);
export const NEW_BENEFICIARY_HOURS = 24;

/** Rule 9: the cap ends exactly 24 hours after the beneficiary was added. */
export function isNewBeneficiary(beneficiary: Beneficiary, now: Date): boolean {
  return now.getTime() < beneficiary.addedAt.getTime() + NEW_BENEFICIARY_HOURS * 3_600_000;
}

/** Whether this amount keeps the beneficiary within the cap. Rule 10: a re-added IBAN is a new beneficiary, a new 24 hours. */
export function withinNewBeneficiaryCap(store: Store, beneficiary: Beneficiary, amount: Minor, now: Date): boolean {
  if (!isNewBeneficiary(beneficiary, now)) return true;
  const sent = store.transfers
    .filter((t) => t.beneficiaryId === beneficiary.id && t.status === "SENT")
    .reduce((sum, t) => sum + t.amount, 0);
  return sent + amount <= NEW_BENEFICIARY_CAP;
}
