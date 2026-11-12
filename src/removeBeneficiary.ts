import type { Beneficiary, User } from "./model.js";
import type { Store } from "./store.js";

/**
 * FAB-15: remove a beneficiary (BRD 2.2). The beneficiary is marked removed, not deleted: a transfer already sent to
 * it is not affected (rule 6), and removing cancels nothing by itself (rule 7).
 */
export function removeBeneficiary(store: Store, user: User, beneficiaryId: string): Beneficiary | null {
  const beneficiary = store.beneficiariesOf(user.customerId).find((b) => b.id === beneficiaryId);
  if (!beneficiary) return null;
  beneficiary.removedAt = store.clock.now();
  return beneficiary;
}
