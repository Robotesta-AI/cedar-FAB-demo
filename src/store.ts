import type { AuditEntry } from "./auditLog.js";
import type { Clock } from "./clock.js";
import { SimulatedCoreBanking } from "./coreBanking.js";
import type { Account, Beneficiary, Customer, Transfer, User } from "./model.js";
import type { CodeChallenge } from "./oneTimeCode.js";
import { egp } from "./money.js";
import type { Notification } from "./notifications.js";
import { DEFAULT_SETTINGS, type Settings } from "./settings.js";

/**
 * The application's data, in memory. Every customer, account and IBAN here is invented for the demonstration;
 * the IBANs use the fictional bank code 9999 and carry valid check digits.
 */
export class Store {
  customers: Customer[] = [];
  users: User[] = [];
  accounts: Account[] = [];
  beneficiaries: Beneficiary[] = [];
  transfers: Transfer[] = [];
  /** Notifications "sent" to customers (push, e-mail, SMS). A demonstration outbox: nothing leaves the app. */
  notifications: Notification[] = [];
  /** FAB-22: the append-only audit log of corporate approvals. */
  readonly auditLog: AuditEntry[] = [];
  codeChallenges: CodeChallenge[] = [];
  /** Messages "sent" to customers' registered phones. A demonstration outbox: nothing leaves the app. */
  outbox: { to: string; text: string; at: Date }[] = [];
  /** BRD 4.2 rule 32: customers whose transfers are locked, until when. */
  transferLocks = new Map<string, Date>();
  /** The core system that moves the money (FAB-13). */
  core = new SimulatedCoreBanking();
  private sequence = 0;

  constructor(
    readonly clock: Clock,
    readonly settings: Settings = DEFAULT_SETTINGS,
  ) {}

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(5, "0")}`;
  }

  user(id: string): User | undefined {
    return this.users.find((u) => u.id === id);
  }
  customer(id: string): Customer | undefined {
    return this.customers.find((c) => c.id === id);
  }
  accountsOf(customerId: string): Account[] {
    return this.accounts.filter((a) => a.customerId === customerId);
  }
  /** The customer's beneficiaries that are not removed. */
  beneficiariesOf(customerId: string): Beneficiary[] {
    return this.beneficiaries.filter((b) => b.customerId === customerId && b.removedAt === null);
  }
  transfersOf(customerId: string): Transfer[] {
    return this.transfers.filter((t) => t.customerId === customerId);
  }
}

/** The seed accounts (FAB-17). */
export function seedStore(clock: Clock, settings: Settings = DEFAULT_SETTINGS): Store {
  const store = new Store(clock, settings);
  const longAgo = new Date(Date.UTC(2026, 7, 1, 9, 0, 0));
  store.customers.push(
    { id: "C-RETAIL-1", name: "Laila Fathy", kind: "RETAIL", phone: "+20 10 0000 0001" },
    { id: "C-RETAIL-2", name: "Omar Nabil", kind: "RETAIL", phone: "+20 10 0000 0002" },
    { id: "C-CORP-1", name: "Nile Delta Trading", kind: "CORPORATE", phone: "+20 10 0000 0003" },
    { id: "C-CORP-2", name: "Red Sea Logistics", kind: "CORPORATE", phone: "+20 10 0000 0004" },
  );
  store.users.push(
    { id: "U-LAILA", customerId: "C-RETAIL-1", name: "Laila Fathy", roles: ["CUSTOMER"] },
    { id: "U-OMAR", customerId: "C-RETAIL-2", name: "Omar Nabil", roles: ["CUSTOMER"] },
    { id: "U-MONA", customerId: "C-CORP-1", name: "Mona Said (maker)", roles: ["MAKER"] },
    { id: "U-KARIM", customerId: "C-CORP-1", name: "Karim Adel (checker)", roles: ["CHECKER"] },
    { id: "U-SALMA", customerId: "C-CORP-1", name: "Salma Youssef (maker and checker)", roles: ["MAKER", "CHECKER"] },
    { id: "U-HANY", customerId: "C-CORP-2", name: "Hany Mostafa (checker)", roles: ["CHECKER"] },
  );
  store.accounts.push(
    { id: "A-1001", customerId: "C-RETAIL-1", label: "Current account", iban: "EG289999000100000000000010001", currency: "EGP", balance: egp(420_000), status: "ACTIVE" },
    { id: "A-1002", customerId: "C-RETAIL-1", label: "Savings account", iban: "EG989999000100000000000010002", currency: "EGP", balance: egp(150_000), status: "ACTIVE" },
    { id: "A-2001", customerId: "C-RETAIL-2", label: "Current account (frozen)", iban: "EG209999000200000000000020001", currency: "EGP", balance: egp(30_000), status: "FROZEN" },
    { id: "A-3001", customerId: "C-CORP-1", label: "Operating account", iban: "EG129999000300000000000030001", currency: "EGP", balance: egp(5_000_000), status: "ACTIVE" },
    { id: "A-4001", customerId: "C-CORP-2", label: "Operating account", iban: "EG049999000400000000000040001", currency: "EGP", balance: egp(2_000_000), status: "ACTIVE" },
  );
  store.beneficiaries.push(
    { id: "B-1", customerId: "C-RETAIL-1", name: "Youssef Fathy", iban: "EG939999000500000000000050001", addedAt: longAgo, removedAt: null },
    { id: "B-2", customerId: "C-RETAIL-1", name: "Cairo Flat Rentals", iban: "EG859999000600000000000060001", addedAt: longAgo, removedAt: null },
    { id: "B-3", customerId: "C-RETAIL-2", name: "Laila Fathy", iban: "EG289999000100000000000010001", addedAt: longAgo, removedAt: null },
    { id: "B-4", customerId: "C-CORP-1", name: "Red Sea Logistics", iban: "EG049999000400000000000040001", addedAt: longAgo, removedAt: null },
    { id: "B-5", customerId: "C-CORP-2", name: "Nile Delta Trading", iban: "EG129999000300000000000030001", addedAt: longAgo, removedAt: null },
  );
  return store;
}
