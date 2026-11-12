import type { Minor } from "./money.js";

export type CustomerKind = "RETAIL" | "CORPORATE";
export type Role = "CUSTOMER" | "MAKER" | "CHECKER";
export type Channel = "WEB" | "MOBILE";
export type AccountStatus = "ACTIVE" | "FROZEN" | "CLOSED";

export interface Customer {
  id: string;
  name: string;
  kind: CustomerKind;
  /** Invented number; no message is ever really sent. */
  phone: string;
}

export interface User {
  id: string;
  customerId: string;
  name: string;
  roles: Role[];
}

export interface Account {
  id: string;
  customerId: string;
  label: string;
  iban: string;
  currency: "EGP";
  balance: Minor;
  status: AccountStatus;
}

export interface Beneficiary {
  id: string;
  customerId: string;
  name: string;
  iban: string;
  addedAt: Date;
  /** FAB-15: a removed beneficiary is kept, marked removed; transfers already sent to it are not affected. */
  removedAt: Date | null;
}

export type TransferStatus = "SENT";

export interface Transfer {
  id: string;
  reference: string;
  customerId: string;
  userId: string;
  sourceAccountId: string;
  beneficiaryId: string;
  beneficiaryName: string;
  beneficiaryIban: string;
  amount: Minor;
  fee: Minor;
  channel: Channel;
  status: TransferStatus;
  createdAt: Date;
  sentAt: Date | null;
}
