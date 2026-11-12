/** An Egyptian IBAN: "EG", 2 check digits and 25 digits, 29 characters in all (BRD 2.1 rule 1). */
const EG_IBAN = /^EG\d{27}$/;

/** Spaces removed, upper-cased. */
export function normalizeIban(text: string): string {
  return text.replace(/\s+/g, "").toUpperCase();
}

/** ISO 13616 mod-97: move the first four characters to the end, letters to numbers, remainder 1. */
export function ibanChecksumValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

export type IbanProblem = "IBAN_FORMAT" | "IBAN_CHECK_DIGITS";

/** BRD 2.1 rules 1 and 2. Returns the problem, or null when the IBAN is a valid Egyptian IBAN. */
export function ibanProblem(iban: string): IbanProblem | null {
  if (!EG_IBAN.test(iban)) return "IBAN_FORMAT";
  if (!ibanChecksumValid(iban)) return "IBAN_CHECK_DIGITS";
  return null;
}
