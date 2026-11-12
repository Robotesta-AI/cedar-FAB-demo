import type { Account, Beneficiary, Channel, Transfer, User } from "./model.js";
import { parseAmount, type Minor } from "./money.js";
import { transferFee } from "./fees.js";
import { withinNewBeneficiaryCap } from "./newBeneficiary.js";
import { notifyTransferSent } from "./notifications.js";
import { withinDailyLimit } from "./limits.js";
import type { Store } from "./store.js";

/** What a customer asks for. */
export interface TransferRequest {
  sourceAccountId: string;
  beneficiaryId: string;
  amount: string;
  channel: Channel;
  /** BRD 3.3 rule 20: the transfer's reference. Given on the confirmation; a retry sends the same one. */
  reference?: string;
}

export type TransferRefusal =
  | "AMOUNT_INVALID"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NOT_ACTIVE"
  | "BENEFICIARY_NOT_FOUND"
  | "INSUFFICIENT_BALANCE"
  | "NEW_BENEFICIARY_CAP"
  | "TRANSFERS_LOCKED"
  | "DAILY_LIMIT_EXCEEDED"
  | "TIMED_OUT"
  | "REFERENCE_IN_USE";

/** BRD 3.1 rule 14: what the confirmation screen shows before the customer confirms. */
export interface TransferQuote {
  account: Account;
  beneficiary: Beneficiary;
  maskedIban: string;
  amount: Minor;
  fee: Minor;
  total: Minor;
}

export type QuoteResult = { ok: true; quote: TransferQuote } | { ok: false; refusal: TransferRefusal };
export type SendResult = { ok: true; transfer: Transfer } | { ok: false; refusal: TransferRefusal; transfer?: Transfer };

/** "EG28 **** **** **** **** **** 0001": the country, the check digits and the last four characters. */
export function maskIban(iban: string): string {
  return `${iban.slice(0, 4)} **** **** **** **** **** ${iban.slice(-4)}`;
}

/** Checks a request and prices it. Nothing is debited. */
export function quoteTransfer(store: Store, user: User, request: TransferRequest): QuoteResult {
  // BRD 4.2 rule 32: after three wrong one-time codes, transfers are locked for 15 minutes.
  const lockedUntil = store.transferLocks.get(user.customerId);
  if (lockedUntil && store.clock.now().getTime() < lockedUntil.getTime()) return { ok: false, refusal: "TRANSFERS_LOCKED" };
  const amount = parseAmount(request.amount);
  if (amount === null) return { ok: false, refusal: "AMOUNT_INVALID" };
  const account = store.accounts.find((a) => a.id === request.sourceAccountId && a.customerId === user.customerId);
  if (!account) return { ok: false, refusal: "ACCOUNT_NOT_FOUND" };
  // BRD 3.1 rule 15: a frozen or closed account cannot send.
  if (account.status !== "ACTIVE") return { ok: false, refusal: "ACCOUNT_NOT_ACTIVE" };
  const beneficiary = store.beneficiariesOf(user.customerId).find((b) => b.id === request.beneficiaryId);
  if (!beneficiary) return { ok: false, refusal: "BENEFICIARY_NOT_FOUND" };
  // BRD 2.3 (FAB-9): at most 10,000 EGP in total to a beneficiary added less than 24 hours ago.
  if (!withinNewBeneficiaryCap(store, beneficiary, amount, store.clock.now())) return { ok: false, refusal: "NEW_BENEFICIARY_CAP" };
  // BRD 4.1 rules 25-27: the daily limit, per customer, across accounts and channels.
  const customer = store.customer(user.customerId);
  if (customer && !withinDailyLimit(store, customer, amount, store.clock.now())) return { ok: false, refusal: "DAILY_LIMIT_EXCEEDED" };
  const fee = transferFee(amount, account.currency);
  const total = amount + fee;
  // BRD 3.1 rule 13: more than the available balance is refused and nothing is debited.
  if (total > account.balance) return { ok: false, refusal: "INSUFFICIENT_BALANCE" };
  return { ok: true, quote: { account, beneficiary, maskedIban: maskIban(beneficiary.iban), amount, fee, total } };
}

/** The transfer this customer already made with this reference, if any. */
export function transferByReference(store: Store, customerId: string, reference: string | undefined): Transfer | undefined {
  if (!reference) return undefined;
  return store.transfers.find((t) => t.customerId === customerId && t.reference === reference);
}

const coreKey = (t: Transfer) => `${t.customerId}:${t.reference}`;

/**
 * Sends a transfer the customer confirmed (FAB-6): checks again, has the core post the amount and the fee, records it.
 * FAB-13 (BRD 3.3): a transfer is identified by its reference. When the core does not answer in time the transfer is
 * TIMED_OUT and the customer can retry it with the same reference; a retry never sends the money twice, and if the
 * first attempt went through late, the retry returns that first attempt.
 */
export function sendTransfer(store: Store, user: User, request: TransferRequest): SendResult {
  const existing = transferByReference(store, user.customerId, request.reference);
  if (existing) return retryTransfer(store, user, existing, request);
  const quoted = quoteTransfer(store, user, request);
  if (!quoted.ok) return quoted;
  const { quote } = quoted;
  const now = store.clock.now();
  const transfer: Transfer = {
    id: store.nextId("T"),
    reference: request.reference || store.nextId("CP"),
    customerId: user.customerId,
    userId: user.id,
    sourceAccountId: quote.account.id,
    beneficiaryId: quote.beneficiary.id,
    beneficiaryName: quote.beneficiary.name,
    beneficiaryIban: quote.beneficiary.iban,
    amount: quote.amount,
    fee: quote.fee,
    channel: request.channel,
    status: "TIMED_OUT",
    createdAt: now,
    sentAt: null,
    approvedBy: null,
    expiresAt: null,
  };
  store.transfers.push(transfer);
  return post(store, transfer);
}

function post(store: Store, transfer: Transfer): SendResult {
  const account = store.accounts.find((a) => a.id === transfer.sourceAccountId)!;
  const outcome = store.core.post(coreKey(transfer), () => {
    account.balance -= transfer.amount + transfer.fee;
  });
  if (outcome === "TIMEOUT") {
    transfer.status = "TIMED_OUT";
    return { ok: false, refusal: "TIMED_OUT", transfer };
  }
  transfer.status = "SENT";
  transfer.sentAt = store.clock.now();
  notifyTransferSent(store, transfer);
  return { ok: true, transfer };
}

/** Rules 19-21: retry a transfer by its reference. */
function retryTransfer(store: Store, user: User, transfer: Transfer, request: TransferRequest): SendResult {
  if (transfer.userId !== user.id) return { ok: false, refusal: "REFERENCE_IN_USE" };
  // Rule 20/21: already sent, or it went through late: return the first attempt, never send again.
  if (transfer.status === "SENT") return { ok: true, transfer };
  if (store.core.wasPosted(coreKey(transfer))) {
    transfer.status = "SENT";
    transfer.sentAt = transfer.sentAt ?? store.clock.now();
    notifyTransferSent(store, transfer);
    return { ok: true, transfer };
  }
  if (transfer.status !== "TIMED_OUT") return { ok: false, refusal: "REFERENCE_IN_USE" };
  // The money did not move: check again (balance, limit, account) before posting.
  const quoted = quoteTransfer(store, user, {
    sourceAccountId: transfer.sourceAccountId,
    beneficiaryId: transfer.beneficiaryId,
    amount: (transfer.amount / 100).toFixed(2),
    channel: request.channel,
  });
  if (!quoted.ok) return quoted;
  return post(store, transfer);
}

export const REFUSAL_WORDS: Record<TransferRefusal, string> = {
  AMOUNT_INVALID: "Enter an amount of at least 1.00 EGP with at most 2 decimals.",
  ACCOUNT_NOT_FOUND: "Choose one of your accounts.",
  ACCOUNT_NOT_ACTIVE: "This account is frozen or closed and cannot send money.",
  BENEFICIARY_NOT_FOUND: "Choose one of your beneficiaries.",
  INSUFFICIENT_BALANCE: "The amount and fee are more than the available balance. Nothing was debited.",
  NEW_BENEFICIARY_CAP: "For 24 hours after a beneficiary is added you can send them at most 10,000 EGP in total. For an urgent larger payment, please visit a branch.",
  DAILY_LIMIT_EXCEEDED: "This transfer would take you above today's limit of 100,000 EGP across all your accounts, on web and mobile. Nothing was debited.",
  TIMED_OUT: "The bank did not answer in time. Your transfer may not have been sent. Retry it: it will never be sent twice.",
  REFERENCE_IN_USE: "This transfer reference is already in use. Start a new transfer.",
  TRANSFERS_LOCKED: "Transfers are locked for 15 minutes after three wrong codes. Try again later.",
};
