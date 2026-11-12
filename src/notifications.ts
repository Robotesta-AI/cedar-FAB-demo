import type { Transfer } from "./model.js";
import { formatMoney } from "./money.js";
import type { Store } from "./store.js";

export type NotificationChannel = "PUSH" | "EMAIL" | "SMS";

export interface Notification {
  channel: NotificationChannel;
  customerId: string;
  transferReference: string;
  text: string;
  at: Date;
}

/** Puts one message on a channel, at most once per transfer (BRD 3.4 rule 24). */
function deliver(store: Store, channel: NotificationChannel, transfer: Transfer, text: string): void {
  const already = store.notifications.some((n) => n.channel === channel && n.customerId === transfer.customerId && n.transferReference === transfer.reference);
  if (already) return;
  store.notifications.push({ channel, customerId: transfer.customerId, transferReference: transfer.reference, text, at: store.clock.now() });
}

/** The SMS sender. Only called while SMS_NOTIFICATIONS is on. */
function sendSms(store: Store, transfer: Transfer, text: string): void {
  deliver(store, "SMS", transfer, text);
}

/**
 * FAB-16: after every transfer the customer is notified by push notification and by e-mail (BRD 3.4 rule 22).
 * An SMS is sent as well only while the SMS_NOTIFICATIONS setting is on (off by default).
 * In this demonstration messages go to an outbox in memory; nothing leaves the app.
 */
export function notifyTransferSent(store: Store, transfer: Transfer): void {
  const text = `Cedar Pay: ${formatMoney(transfer.amount)} sent to ${transfer.beneficiaryName}. Reference ${transfer.reference}.`;
  deliver(store, "PUSH", transfer, text);
  deliver(store, "EMAIL", transfer, text);
  if (store.settings.smsNotifications) sendSms(store, transfer, text);
}

/**
 * FAB-12 criterion 4: the maker is told when their corporate transfer expired without approval. A push notification
 * to the company, once per transfer.
 */
export function notifyTransferExpired(store: Store, transfer: Transfer, makerName: string): void {
  const text = `Cedar Pay: ${formatMoney(transfer.amount)} to ${transfer.beneficiaryName} (created by ${makerName}) expired without approval. Reference ${transfer.reference}. Nothing was debited.`;
  deliver(store, "PUSH", transfer, text);
}
