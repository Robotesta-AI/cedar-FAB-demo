import type { Minor } from "./money.js";

/** The transfer fee. Not charged yet: FAB-10 brings the fee of BRD section 5. */
export function transferFee(_amount: Minor): Minor {
  return 0;
}
