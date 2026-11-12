/**
 * Money is held in minor units (piastres: 1 EGP = 100) as integers, never as floating point.
 */
export type Minor = number;

const AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** BRD 3.1 rule 12: an amount of at least 1.00 with at most 2 decimals. Returns null when the text is not such an amount. */
export function parseAmount(text: string): Minor | null {
  const clean = text.trim().replace(/,/g, "");
  if (!AMOUNT_PATTERN.test(clean)) return null;
  const [whole = "0", fraction = ""] = clean.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return minor >= 100 ? minor : null;
}

/** "12,345.00 EGP" */
export function formatMoney(minor: Minor, currency = "EGP"): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const fraction = String(abs % 100).padStart(2, "0");
  return `${sign}${whole}.${fraction} ${currency}`;
}

/** Whole EGP to minor units. */
export function egp(amount: number): Minor {
  return Math.round(amount * 100);
}
