import PDFDocument from "pdfkit";
import type { Transfer, User } from "./model.js";
import { formatMoney } from "./money.js";
import type { Store } from "./store.js";

/** BRD 7.1 rule 41: a statement covers any period of up to 12 months. */
export const MAX_STATEMENT_MONTHS = 12;

export type StatementRefusal = "PERIOD_INVALID" | "PERIOD_TOO_LONG";

export interface StatementPeriod {
  from: Date;
  /** Exclusive: the day after the last day asked for. */
  until: Date;
}

/** Reads "2026-09-01".."2026-10-31" as a period; refuses more than 12 months. */
export function statementPeriod(fromText: string, toText: string): StatementPeriod | StatementRefusal {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(fromText) || !day.test(toText)) return "PERIOD_INVALID";
  const from = new Date(`${fromText}T00:00:00Z`);
  const to = new Date(`${toText}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return "PERIOD_INVALID";
  const limit = new Date(from);
  limit.setUTCMonth(limit.getUTCMonth() + MAX_STATEMENT_MONTHS);
  const until = new Date(to.getTime() + 86_400_000);
  if (until > limit) return "PERIOD_TOO_LONG";
  return { from, until };
}

export interface StatementRow {
  date: string;
  reference: string;
  beneficiary: string;
  amount: string;
  fee: string;
}

/** Rule 42: each sent transfer of the period with its date, reference, beneficiary, amount and fee. */
export function statementRows(store: Store, user: User, period: StatementPeriod): StatementRow[] {
  return store
    .transfersOf(user.customerId)
    .filter((t): t is Transfer & { sentAt: Date } => t.status === "SENT" && t.sentAt !== null && t.sentAt >= period.from && t.sentAt < period.until)
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
    .map((t) => ({
      date: t.sentAt.toISOString().slice(0, 10),
      reference: t.reference,
      beneficiary: t.beneficiaryName,
      amount: formatMoney(t.amount),
      fee: formatMoney(t.fee),
    }));
}

/** FAB-14: the statement as a PDF. */
export function statementPdf(customerName: string, period: StatementPeriod, rows: StatementRow[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48, info: { Title: "Cedar Pay statement", Author: "Cedar Bank (fictional)" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const last = new Date(period.until.getTime() - 86_400_000);
    doc.fontSize(18).text("Cedar Pay statement");
    doc.fontSize(10).text(`${customerName} · ${period.from.toISOString().slice(0, 10)} to ${last.toISOString().slice(0, 10)}`);
    doc.text("Cedar Bank is fictional. This statement is invented for a demonstration.");
    doc.moveDown();
    const columns = [48, 128, 238, 378, 468];
    const line = (cells: string[]) => {
      const y = doc.y;
      cells.forEach((cell, i) => doc.text(cell, columns[i], y, { width: (columns[i + 1] ?? 548) - (columns[i] ?? 48) - 6 }));
      doc.moveDown(0.4);
    };
    doc.font("Helvetica-Bold");
    line(["Date", "Reference", "Beneficiary", "Amount", "Fee"]);
    doc.font("Helvetica");
    if (rows.length === 0) doc.text("No transfers in this period.", 48);
    for (const row of rows) line([row.date, row.reference, row.beneficiary, row.amount, row.fee]);
    doc.end();
  });
}

export const STATEMENT_REFUSAL_WORDS: Record<StatementRefusal, string> = {
  PERIOD_INVALID: "Choose a start day and an end day, the end on or after the start.",
  PERIOD_TOO_LONG: "A statement covers at most 12 months.",
};
