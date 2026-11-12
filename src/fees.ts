import { egp, type Minor } from "./money.js";

/** BRD 3.2 rule 16: the currencies a customer can send in. */
export type Currency = "EGP" | "USD" | "EUR" | "GBP" | "SAR";

/** The day's rates, in piastres per unit of the currency. Invented figures for the demonstration. */
export const DAY_RATES: Record<Currency, number> = { EGP: 100, USD: 4_850, EUR: 5_220, GBP: 6_140, SAR: 1_293 };

/** BRD 5.1 rule 33: the fee is 0.1% of the transfer amount. */
export const FEE_RATE_PER_THOUSAND = 1;
/** Rule 34: minimum 5.00 EGP, maximum 250.00 EGP. */
export const MINIMUM_FEE: Minor = egp(5);
export const MAXIMUM_FEE: Minor = egp(250);

/** An EGP amount in minor units of the currency at the day's rate, rounded half-up to the cent. */
function egpToCurrency(egpMinor: Minor, currency: Currency): Minor {
  const rate = DAY_RATES[currency];
  // egpMinor * 100 / rate, rounded half-up, in integers.
  return Math.floor((egpMinor * 100 * 2 + rate) / (2 * rate));
}

/**
 * FAB-10: the transfer fee, in the debit currency (the source account's), in its minor units.
 * Rule 35: calculated and rounded in the debit currency, half-up to 2 decimals (12.345 -> 12.35), in integer
 * arithmetic so nothing is lost to floating point; never rounded in one currency and then converted.
 * The minimum and maximum (rule 34) are EGP amounts, taken in the debit currency at the day's rate.
 */
export function transferFee(amount: Minor, currency: Currency = "EGP"): Minor {
  // amount * 0.1% in minor units is amount / 1000; adding 500 before the integer division rounds half up.
  const raw = Math.floor((amount * FEE_RATE_PER_THOUSAND + 500) / 1000);
  const minimum = egpToCurrency(MINIMUM_FEE, currency);
  const maximum = egpToCurrency(MAXIMUM_FEE, currency);
  return Math.min(maximum, Math.max(minimum, raw));
}
