import type { Beneficiary, User } from "./model.js";
import { ibanProblem, normalizeIban, type IbanProblem } from "./iban.js";
import type { Store } from "./store.js";

/** BRD 2.1 rule 4. */
export const MAX_BENEFICIARIES = 50;

export type BeneficiaryRefusal = IbanProblem | "NAME_LENGTH" | "IBAN_ALREADY_SAVED" | "TOO_MANY_BENEFICIARIES";

export type AddBeneficiaryResult = { ok: true; beneficiary: Beneficiary } | { ok: false; refusal: BeneficiaryRefusal };

/** FAB-4: add a beneficiary by IBAN (BRD 2.1). */
export function addBeneficiary(store: Store, user: User, input: { name: string; iban: string }): AddBeneficiaryResult {
  const name = input.name.trim();
  // Rule 1: a name of 2 to 70 characters.
  if (name.length < 2 || name.length > 70) return { ok: false, refusal: "NAME_LENGTH" };
  const iban = normalizeIban(input.iban);
  // Rules 1 and 2: an Egyptian IBAN of 29 characters with valid check digits.
  const problem = ibanProblem(iban);
  if (problem) return { ok: false, refusal: problem };
  const saved = store.beneficiariesOf(user.customerId);
  // Rule 3: the same IBAN cannot be added twice for one customer (a removed one can be added again: BRD 2.3 rule 10).
  if (saved.some((b) => b.iban === iban)) return { ok: false, refusal: "IBAN_ALREADY_SAVED" };
  // Rule 4: at most 50 beneficiaries.
  if (saved.length >= MAX_BENEFICIARIES) return { ok: false, refusal: "TOO_MANY_BENEFICIARIES" };
  const beneficiary: Beneficiary = { id: store.nextId("B"), customerId: user.customerId, name, iban, addedAt: store.clock.now(), removedAt: null };
  store.beneficiaries.push(beneficiary);
  return { ok: true, beneficiary };
}

export const BENEFICIARY_REFUSAL_WORDS: Record<BeneficiaryRefusal, string> = {
  NAME_LENGTH: "Enter a name of 2 to 70 characters.",
  IBAN_FORMAT: "Enter an Egyptian IBAN: EG followed by 27 digits.",
  IBAN_CHECK_DIGITS: "This IBAN is not valid. Check it and try again.",
  IBAN_ALREADY_SAVED: "This IBAN is already one of your beneficiaries.",
  TOO_MANY_BENEFICIARIES: "You already have 50 beneficiaries. Remove one to add another.",
};
