import { randomInt } from "node:crypto";
import type { User } from "./model.js";
import { approveTransfer, type ApprovalRefusal } from "./approvals.js";
import { egp, type Minor } from "./money.js";
import type { Store } from "./store.js";
import { quoteTransfer, sendTransfer, type SendResult, type TransferRequest } from "./transfers.js";

/** BRD 4.2 rule 30: a transfer of 50,000 EGP or more needs a one-time code. Regulated: no exception. */
export const ONE_TIME_CODE_THRESHOLD: Minor = egp(50_000);
/** Rule 31: valid for 3 minutes. */
export const CODE_VALID_MINUTES = 3;
/** Rule 32: three wrong codes cancel the transfer and lock transfers for 15 minutes. */
export const WRONG_CODES_ALLOWED = 3;
export const LOCK_MINUTES = 15;

export interface CodeChallenge {
  id: string;
  customerId: string;
  userId: string;
  /** What the code releases: a transfer the customer asked for, or a company transfer a checker approves. */
  request?: TransferRequest;
  approveTransferId?: string;
  code: string;
  expiresAt: Date;
  wrongCodes: number;
  state: "OPEN" | "USED" | "CANCELLED";
}

export type SubmitResult = SendResult | { ok: "CODE_REQUIRED"; challengeId: string };

export type CodeRefusal = "CODE_NOT_FOUND" | "CODE_WRONG" | "CODE_EXPIRED" | "CODE_ALREADY_USED" | "TRANSFER_CANCELLED";

export type ConfirmResult = SendResult | { ok: false; refusal: CodeRefusal | ApprovalRefusal; wrongCodesLeft?: number };

/** Sends the transfer, or asks for a one-time code first when the amount is at the threshold or above. */
export function submitTransfer(store: Store, user: User, request: TransferRequest): SubmitResult {
  const quoted = quoteTransfer(store, user, request);
  if (!quoted.ok) return quoted;
  if (quoted.quote.amount < ONE_TIME_CODE_THRESHOLD) return sendTransfer(store, user, request);
  return { ok: "CODE_REQUIRED", challengeId: issueCode(store, user, { request }) };
}

/** Creates a code for what it releases and sends it to the registered phone. Returns the challenge id. */
export function issueCode(store: Store, user: User, releases: { request?: TransferRequest; approveTransferId?: string }): string {
  const now = store.clock.now();
  const challenge: CodeChallenge = {
    id: store.nextId("OTP"),
    customerId: user.customerId,
    userId: user.id,
    ...releases,
    code: String(randomInt(0, 1_000_000)).padStart(6, "0"),
    expiresAt: new Date(now.getTime() + CODE_VALID_MINUTES * 60_000),
    wrongCodes: 0,
    state: "OPEN",
  };
  store.codeChallenges.push(challenge);
  const phone = store.customer(user.customerId)?.phone ?? "";
  // Sent to the registered phone. In this demonstration the message goes to an outbox; nothing leaves the app.
  store.outbox.push({ to: phone, text: `Cedar Pay: your code is ${challenge.code}. It is valid for ${CODE_VALID_MINUTES} minutes.`, at: now });
  return challenge.id;
}

/** Checks the code the customer typed and, when right, sends the transfer it was issued for. */
export function confirmCode(store: Store, user: User, challengeId: string, code: string): ConfirmResult {
  const challenge = store.codeChallenges.find((c) => c.id === challengeId && c.userId === user.id);
  if (!challenge) return { ok: false, refusal: "CODE_NOT_FOUND" };
  if (challenge.state === "USED") return { ok: false, refusal: "CODE_ALREADY_USED" };
  if (challenge.state === "CANCELLED") return { ok: false, refusal: "TRANSFER_CANCELLED" };
  const now = store.clock.now();
  if (now.getTime() > challenge.expiresAt.getTime()) return { ok: false, refusal: "CODE_EXPIRED" };
  if (code.trim() !== challenge.code) {
    challenge.wrongCodes += 1;
    if (challenge.wrongCodes >= WRONG_CODES_ALLOWED) {
      challenge.state = "CANCELLED";
      store.transferLocks.set(user.customerId, new Date(now.getTime() + LOCK_MINUTES * 60_000));
      return { ok: false, refusal: "TRANSFER_CANCELLED" };
    }
    return { ok: false, refusal: "CODE_WRONG", wrongCodesLeft: WRONG_CODES_ALLOWED - challenge.wrongCodes };
  }
  challenge.state = "USED";
  if (challenge.approveTransferId) {
    const approved = approveTransfer(store, user, challenge.approveTransferId, { codeVerified: true });
    // With the code verified, approval never asks for a code again.
    if (approved.ok === "CODE_REQUIRED") return { ok: false, refusal: "CODE_NOT_FOUND" };
    return approved;
  }
  return sendTransfer(store, user, challenge.request!);
}

export const CODE_REFUSAL_WORDS: Record<CodeRefusal, string> = {
  CODE_NOT_FOUND: "This code request was not found. Start the transfer again.",
  CODE_WRONG: "The code is not right. Check the message and try again.",
  CODE_EXPIRED: "The code has expired. Start the transfer again to get a new code.",
  CODE_ALREADY_USED: "This code was already used.",
  TRANSFER_CANCELLED: "Three wrong codes: the transfer was cancelled and transfers are locked for 15 minutes.",
};
