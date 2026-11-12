import type { Transfer, User } from "./model.js";
import type { Store } from "./store.js";

export type AuditAction = "APPROVED" | "REJECTED" | "EXPIRED";

export interface AuditEntry {
  at: Date;
  customerId: string;
  /** The user who acted. */
  userId: string;
  action: AuditAction;
  transferReference: string;
}

/**
 * FAB-22 (BRD 7.2): the audit log of corporate approvals. Append-only: the application offers no way to edit or
 * delete an entry (rule 44).
 */
export function writeAudit(store: Store, user: User, action: AuditAction, transfer: Transfer): void {
  store.auditLog.push(Object.freeze({ at: store.clock.now(), customerId: transfer.customerId, userId: user.id, action, transferReference: transfer.reference }));
}

/** The company's audit log, newest first. */
export function auditLogOf(store: Store, customerId: string): AuditEntry[] {
  return store.auditLog.filter((e) => e.customerId === customerId).slice().reverse();
}
