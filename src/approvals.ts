import type { Transfer, User } from "./model.js";
import { ONE_TIME_CODE_THRESHOLD, issueCode } from "./oneTimeCode.js";
import { notifyTransferExpired, notifyTransferSent } from "./notifications.js";
import type { Store } from "./store.js";
import { quoteTransfer, type TransferRefusal, type TransferRequest } from "./transfers.js";

/** BRD 6.1 rule 40: a transfer not approved within 48 hours expires and nothing is debited. */
export const APPROVAL_WINDOW_HOURS = 48;

export type ApprovalRefusal = TransferRefusal | "NOT_A_MAKER" | "NOT_A_CHECKER" | "TRANSFER_NOT_FOUND" | "NOT_PENDING" | "EXPIRED" | "REASON_REQUIRED";

export type CreateResult = { ok: true; transfer: Transfer } | { ok: false; refusal: ApprovalRefusal };
export type ApproveResult = { ok: true; transfer: Transfer } | { ok: "CODE_REQUIRED"; challengeId: string } | { ok: false; refusal: ApprovalRefusal };

/** Marks the company's unapproved transfers that are past their 48 hours as EXPIRED (rule 40). */
export function expireOverdue(store: Store, now: Date): void {
  for (const t of store.transfers) {
    if (t.status === "PENDING_APPROVAL" && t.expiresAt && now.getTime() > t.expiresAt.getTime()) {
      t.status = "EXPIRED";
      // Criterion 4: the maker is told.
      notifyTransferExpired(store, t, store.user(t.userId)?.name ?? "the maker");
    }
  }
}

/** Rule 37: a maker creates a corporate transfer. Nothing is debited until a checker approves it. */
export function createCorporateTransfer(store: Store, maker: User, request: TransferRequest): CreateResult {
  if (!maker.roles.includes("MAKER")) return { ok: false, refusal: "NOT_A_MAKER" };
  const quoted = quoteTransfer(store, maker, request);
  if (!quoted.ok) return quoted;
  const { quote } = quoted;
  const now = store.clock.now();
  const transfer: Transfer = {
    id: store.nextId("T"),
    reference: store.nextId("CP"),
    customerId: maker.customerId,
    userId: maker.id,
    sourceAccountId: quote.account.id,
    beneficiaryId: quote.beneficiary.id,
    beneficiaryName: quote.beneficiary.name,
    beneficiaryIban: quote.beneficiary.iban,
    amount: quote.amount,
    fee: quote.fee,
    channel: request.channel,
    status: "PENDING_APPROVAL",
    createdAt: now,
    sentAt: null,
    approvedBy: null,
    expiresAt: new Date(now.getTime() + APPROVAL_WINDOW_HOURS * 3_600_000),
  };
  store.transfers.push(transfer);
  return { ok: true, transfer };
}

/** Rule 38: a checker sees only the transfers of their own company. */
export function pendingForChecker(store: Store, checker: User): Transfer[] {
  expireOverdue(store, store.clock.now());
  return store.transfers.filter((t) => t.customerId === checker.customerId && t.status === "PENDING_APPROVAL");
}

/**
 * Rule 37: a checker approves a pending corporate transfer, which is then sent and debited.
 * A transfer of 50,000 EGP or more also needs the one-time code (BRD 4.2, no exception by customer type).
 */
export function approveTransfer(store: Store, checker: User, transferId: string, options: { codeVerified?: boolean } = {}): ApproveResult {
  if (!checker.roles.includes("CHECKER")) return { ok: false, refusal: "NOT_A_CHECKER" };
  const now = store.clock.now();
  expireOverdue(store, now);
  const transfer = store.transfers.find((t) => t.id === transferId && t.customerId === checker.customerId);
  if (!transfer) return { ok: false, refusal: "TRANSFER_NOT_FOUND" };
  if (transfer.status === "EXPIRED") return { ok: false, refusal: "EXPIRED" };
  if (transfer.status !== "PENDING_APPROVAL") return { ok: false, refusal: "NOT_PENDING" };
  if (transfer.amount >= ONE_TIME_CODE_THRESHOLD && !options.codeVerified) {
    return { ok: "CODE_REQUIRED", challengeId: issueCode(store, checker, { approveTransferId: transfer.id }) };
  }
  // Criterion 5: the rules are checked at the moment of approval, not only at creation (account, beneficiary, limit,
  // balance; the one-time code above).
  const quoted = quoteTransfer(store, checker, {
    sourceAccountId: transfer.sourceAccountId,
    beneficiaryId: transfer.beneficiaryId,
    amount: (transfer.amount / 100).toFixed(2),
    channel: transfer.channel,
  });
  if (!quoted.ok) return quoted;
  const account = quoted.quote.account;
  account.balance -= transfer.amount + transfer.fee;
  transfer.status = "SENT";
  transfer.sentAt = now;
  transfer.approvedBy = checker.id;
  notifyTransferSent(store, transfer);
  return { ok: true, transfer };
}

/** Criterion 2: a checker rejects a pending corporate transfer with a reason. Nothing is debited. */
export function rejectTransfer(store: Store, checker: User, transferId: string, reason: string): CreateResult {
  if (!checker.roles.includes("CHECKER")) return { ok: false, refusal: "NOT_A_CHECKER" };
  const why = reason.trim();
  if (why.length === 0) return { ok: false, refusal: "REASON_REQUIRED" };
  expireOverdue(store, store.clock.now());
  const transfer = store.transfers.find((t) => t.id === transferId && t.customerId === checker.customerId);
  if (!transfer) return { ok: false, refusal: "TRANSFER_NOT_FOUND" };
  if (transfer.status === "EXPIRED") return { ok: false, refusal: "EXPIRED" };
  if (transfer.status !== "PENDING_APPROVAL") return { ok: false, refusal: "NOT_PENDING" };
  transfer.status = "REJECTED";
  transfer.rejectionReason = why.slice(0, 500);
  return { ok: true, transfer };
}

export const APPROVAL_REFUSAL_WORDS: Partial<Record<ApprovalRefusal, string>> = {
  NOT_A_MAKER: "Only a maker can create a company transfer.",
  NOT_A_CHECKER: "Only a checker can approve a company transfer.",
  TRANSFER_NOT_FOUND: "This transfer was not found.",
  NOT_PENDING: "This transfer is not waiting for approval.",
  EXPIRED: "This transfer was not approved within 48 hours and has expired. Nothing was debited.",
  REASON_REQUIRED: "Say why you reject this transfer.",
};
