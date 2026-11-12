import express, { type NextFunction, type Request, type Response } from "express";
import { APPROVAL_REFUSAL_WORDS, approveTransfer, createCorporateTransfer, pendingForChecker, rejectTransfer } from "./approvals.js";
import { auditLogOf } from "./auditLog.js";
import { BENEFICIARY_REFUSAL_WORDS, addBeneficiary } from "./beneficiaries.js";
import type { Channel, Transfer, User } from "./model.js";
import { DAILY_LIMIT, remainingToday, sentToday } from "./limits.js";
import { formatMoney } from "./money.js";
import { removeBeneficiary } from "./removeBeneficiary.js";
import { CODE_REFUSAL_WORDS, confirmCode, submitTransfer } from "./oneTimeCode.js";
import type { Store } from "./store.js";
import { STATEMENT_REFUSAL_WORDS, statementPdf, statementPeriod, statementRows } from "./statements.js";
import { REFUSAL_WORDS, quoteTransfer, type TransferRequest } from "./transfers.js";
import { escapeHtml, page } from "./views.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const SESSION_COOKIE = "cedar_user";

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** The web pages are the WEB channel; the mobile app calls the API with `X-Cedar-Channel: mobile`. */
export function channelOf(req: Request): Channel {
  return String(req.headers["x-cedar-channel"] ?? "").toLowerCase() === "mobile" ? "MOBILE" : "WEB";
}

function transferRequestOf(req: Request): TransferRequest {
  const body = (req.body ?? {}) as Record<string, unknown>;
  return {
    sourceAccountId: String(body.sourceAccountId ?? ""),
    beneficiaryId: String(body.beneficiaryId ?? ""),
    amount: String(body.amount ?? ""),
    channel: channelOf(req),
    ...(typeof body.reference === "string" && body.reference !== "" ? { reference: body.reference } : {}),
  };
}

/** The words for any refusal code. */
function wordsFor(refusal: string): string {
  const all: Record<string, string | undefined> = { ...REFUSAL_WORDS, ...CODE_REFUSAL_WORDS, ...APPROVAL_REFUSAL_WORDS };
  return all[refusal] ?? "This could not be done.";
}

function isCorporate(store: Store, user: User): boolean {
  return store.customer(user.customerId)?.kind === "CORPORATE";
}

export function createApp(store: Store): express.Express {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  // Demo sign-in: choose one of the invented users. There are no passwords in this demonstration.
  app.use((req, _res, next) => {
    const id = cookieValue(req, SESSION_COOKIE) ?? (req.headers["x-cedar-user"] as string | undefined);
    req.user = id ? store.user(id) : undefined;
    next();
  });

  const signedIn = (req: Request, res: Response, next: NextFunction) => {
    if (req.user) return next();
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "SIGN_IN_REQUIRED" });
    return res.redirect("/");
  };

  app.get("/", (_req, res) => {
    const options = store.users
      .map((u) => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.name)} (${escapeHtml(store.customer(u.customerId)?.name ?? "")})</option>`)
      .join("");
    res.send(page("Sign in", `<section><form method="post" action="/sign-in"><label for="user">Demo user</label>
      <select id="user" name="userId">${options}</select><br><button>Sign in</button></form></section>`));
  });

  app.post("/sign-in", (req, res) => {
    const user = store.user(String(req.body?.userId ?? ""));
    if (!user) return res.status(400).send(page("Sign in", `<p class="error">Choose a demo user.</p>`));
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(user.id)}; Path=/; HttpOnly; SameSite=Lax`);
    return res.redirect("/home");
  });

  app.post("/sign-out", (_req, res) => {
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
    res.redirect("/");
  });

  app.get("/home", signedIn, (req, res) => {
    const user = req.user!;
    const accounts = store
      .accountsOf(user.customerId)
      .map((a) => `<tr><td>${escapeHtml(a.label)}</td><td>${escapeHtml(a.iban)}</td><td>${formatMoney(a.balance)}</td><td>${a.status}</td></tr>`)
      .join("");
    const beneficiaries = store
      .beneficiariesOf(user.customerId)
      .map(
        (b) =>
          `<tr><td>${escapeHtml(b.name)}</td><td>${escapeHtml(b.iban)}</td><td><form method="post" action="/beneficiaries/${escapeHtml(b.id)}/remove"><button>Remove</button></form></td></tr>`,
      )
      .join("");
    const history = store
      .transfersOf(user.customerId)
      .slice()
      .reverse()
      .map((t) => `<tr><td>${escapeHtml(t.reference)}</td><td>${escapeHtml(t.beneficiaryName)}</td><td>${formatMoney(t.amount)}</td><td>${formatMoney(t.fee)}</td><td>${t.status}</td></tr>`)
      .join("");
    res.send(
      page(
        "Your accounts",
        `<section><table><tr><th>Account</th><th>IBAN</th><th>Balance</th><th>Status</th></tr>${accounts}</table>
         <p><a href="/transfer">Send money</a> · <a href="/statement">Statement</a>${user.roles.includes("CHECKER") ? ` · <a href="/approvals">Approvals</a>` : ""}</p></section>
         <section><h2>Beneficiaries</h2><table><tr><th>Name</th><th>IBAN</th></tr>${beneficiaries}</table>
         <p><a href="/beneficiaries/new">Add a beneficiary</a></p></section>
         <section><h2>Transfers</h2><table><tr><th>Reference</th><th>To</th><th>Amount</th><th>Fee</th><th>Status</th></tr>${history}</table></section>`,
        user.name,
      ),
    );
  });

  app.get("/transfer", signedIn, (req, res) => {
    res.send(transferForm(store, req.user!));
  });

  app.post("/transfer/confirm", signedIn, (req, res) => {
    const request = transferRequestOf(req);
    const result = quoteTransfer(store, req.user!, request);
    if (!result.ok) return res.status(422).send(transferForm(store, req.user!, REFUSAL_WORDS[result.refusal]));
    const { quote } = result;
    // FAB-13: the reference is fixed here, so a retry after a timeout is the same transfer.
    const hidden = Object.entries({ ...request, reference: request.reference ?? store.nextId("CP") })
      .filter(([k]) => k !== "channel")
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
      .join("");
    return res.send(
      page(
        "Confirm the transfer",
        `<section><table>
          <tr><th>To</th><td>${escapeHtml(quote.beneficiary.name)}</td></tr>
          <tr><th>IBAN</th><td>${escapeHtml(quote.maskedIban)}</td></tr>
          <tr><th>Amount</th><td>${formatMoney(quote.amount)}</td></tr>
          <tr><th>Fee</th><td>${formatMoney(quote.fee)}</td></tr>
          <tr><th>Total</th><td>${formatMoney(quote.total)}</td></tr></table>
          <form method="post" action="/transfer/send">${hidden}<button>Confirm and send</button></form></section>`,
        req.user!.name,
      ),
    );
  });

  app.post("/transfer/send", signedIn, (req, res) => {
    if (isCorporate(store, req.user!)) {
      // FAB-12: a company transfer is created by a maker and waits for a checker.
      const created = createCorporateTransfer(store, req.user!, transferRequestOf(req));
      if (!created.ok) return res.status(422).send(transferForm(store, req.user!, wordsFor(created.refusal)));
      const t = created.transfer;
      return res.send(
        page("Waiting for approval", `<section><p class="notice">${formatMoney(t.amount)} to ${escapeHtml(t.beneficiaryName)} is waiting for a checker's approval. Reference ${escapeHtml(t.reference)}. It expires in 48 hours if it is not approved.</p><p><a href="/home">Back to your accounts</a></p></section>`, req.user!.name),
      );
    }
    const result = submitTransfer(store, req.user!, transferRequestOf(req));
    if (result.ok === "CODE_REQUIRED") return res.send(codeForm(req.user!, result.challengeId));
    if (!result.ok && result.refusal === "TIMED_OUT" && result.transfer) return res.status(504).send(retryPage(req.user!, result.transfer));
    if (!result.ok) return res.status(422).send(transferForm(store, req.user!, REFUSAL_WORDS[result.refusal]));
    const t = result.transfer;
    return res.send(
      page("Transfer sent", `<section><p class="notice">${formatMoney(t.amount)} sent to ${escapeHtml(t.beneficiaryName)}. Reference ${escapeHtml(t.reference)}.</p><p><a href="/home">Back to your accounts</a></p></section>`, req.user!.name),
    );
  });

  app.post("/beneficiaries/:id/remove", signedIn, (req, res) => {
    removeBeneficiary(store, req.user!, String(req.params.id));
    res.redirect("/home");
  });

  app.get("/beneficiaries/new", signedIn, (req, res) => {
    res.send(beneficiaryForm(req.user!));
  });

  app.post("/beneficiaries", signedIn, (req, res) => {
    const result = addBeneficiary(store, req.user!, { name: String(req.body?.name ?? ""), iban: String(req.body?.iban ?? "") });
    if (!result.ok) return res.status(422).send(beneficiaryForm(req.user!, BENEFICIARY_REFUSAL_WORDS[result.refusal]));
    return res.redirect("/home");
  });

  app.post("/transfer/code", signedIn, (req, res) => {
    const challengeId = String(req.body?.challengeId ?? "");
    const result = confirmCode(store, req.user!, challengeId, String(req.body?.code ?? ""));
    if (!result.ok && result.refusal === "TIMED_OUT" && "transfer" in result && result.transfer) return res.status(504).send(retryPage(req.user!, result.transfer));
    if (!result.ok) {
      const words = wordsFor(result.refusal);
      if (result.refusal === "CODE_WRONG") return res.status(422).send(codeForm(req.user!, challengeId, words));
      return res.status(422).send(transferForm(store, req.user!, words));
    }
    const t = result.transfer;
    return res.send(
      page("Transfer sent", `<section><p class="notice">${formatMoney(t.amount)} sent to ${escapeHtml(t.beneficiaryName)}. Reference ${escapeHtml(t.reference)}.</p><p><a href="/home">Back to your accounts</a></p></section>`, req.user!.name),
    );
  });

  // FAB-12: the checker's list of the company's transfers waiting for approval.
  app.get("/approvals", signedIn, (req, res) => {
    res.send(approvalsPage(store, req.user!));
  });

  app.post("/approvals/:id/reject", signedIn, (req, res) => {
    const result = rejectTransfer(store, req.user!, String(req.params.id));
    if (!result.ok) return res.status(422).send(approvalsPage(store, req.user!, wordsFor(result.refusal)));
    return res.send(approvalsPage(store, req.user!, undefined, `Rejected: ${result.transfer.reference}. Nothing was debited.`));
  });

  app.get("/audit", signedIn, (req, res) => {
    const rows = auditLogOf(store, req.user!.customerId)
      .map((e) => `<tr><td>${escapeHtml(e.at.toISOString())}</td><td>${escapeHtml(store.user(e.userId)?.name ?? e.userId)}</td><td>${e.action}</td><td>${escapeHtml(e.transferReference)}</td></tr>`)
      .join("");
    res.send(page("Audit log", `<section><table><tr><th>Time</th><th>User</th><th>Action</th><th>Transfer</th></tr>${rows}</table></section>`, req.user!.name));
  });

  app.post("/approvals/:id/approve", signedIn, (req, res) => {
    const result = approveTransfer(store, req.user!, String(req.params.id));
    if (result.ok === "CODE_REQUIRED") return res.send(codeForm(req.user!, result.challengeId));
    if (!result.ok) return res.status(422).send(approvalsPage(store, req.user!, wordsFor(result.refusal)));
    return res.send(approvalsPage(store, req.user!, undefined, `Approved and sent: ${result.transfer.reference}.`));
  });

  // FAB-14: export a statement as PDF.
  app.get("/statement", signedIn, (req, res) => {
    res.send(statementForm(req.user!));
  });

  app.get("/statement.pdf", signedIn, async (req, res) => {
    const period = statementPeriod(String(req.query.from ?? ""), String(req.query.to ?? ""));
    if (typeof period === "string") {
      if (req.accepts(["html", "json"]) === "json") return res.status(422).json({ error: period });
      return res.status(422).send(statementForm(req.user!, STATEMENT_REFUSAL_WORDS[period]));
    }
    const customer = store.customer(req.user!.customerId)!;
    const pdf = await statementPdf(customer.name, period, statementRows(store, req.user!, period));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="cedar-pay-statement-${String(req.query.from)}-${String(req.query.to)}.pdf"`);
    return res.send(pdf);
  });

  // The demonstration's outbox: the messages that would go to the customer's registered phone.
  app.get("/demo/messages", signedIn, (req, res) => {
    const phone = store.customer(req.user!.customerId)?.phone;
    const rows = store.outbox
      .filter((m) => m.to === phone)
      .slice()
      .reverse()
      .map((m) => `<tr><td>${escapeHtml(m.at.toISOString())}</td><td>${escapeHtml(m.text)}</td></tr>`)
      .join("");
    res.send(page("Messages to your phone (demo)", `<section><table><tr><th>Sent</th><th>Message</th></tr>${rows}</table></section>`, req.user!.name));
  });

  // The API the mobile app uses.
  app.get("/api/beneficiaries", signedIn, (req, res) => {
    res.json(store.beneficiariesOf(req.user!.customerId));
  });

  app.post("/api/beneficiaries", signedIn, (req, res) => {
    const result = addBeneficiary(store, req.user!, { name: String(req.body?.name ?? ""), iban: String(req.body?.iban ?? "") });
    if (!result.ok) return res.status(422).json({ error: result.refusal });
    return res.status(201).json(result.beneficiary);
  });

  app.delete("/api/beneficiaries/:id", signedIn, (req, res) => {
    const removed = removeBeneficiary(store, req.user!, String(req.params.id));
    if (!removed) return res.status(404).json({ error: "BENEFICIARY_NOT_FOUND" });
    return res.json(removed);
  });

  app.get("/api/accounts", signedIn, (req, res) => {
    res.json(store.accountsOf(req.user!.customerId));
  });

  app.post("/api/transfers/quote", signedIn, (req, res) => {
    const result = quoteTransfer(store, req.user!, transferRequestOf(req));
    if (!result.ok) return res.status(422).json({ error: result.refusal });
    const { quote } = result;
    return res.json({ beneficiaryName: quote.beneficiary.name, maskedIban: quote.maskedIban, amount: quote.amount, fee: quote.fee, total: quote.total });
  });

  app.post("/api/transfers", signedIn, (req, res) => {
    if (isCorporate(store, req.user!)) {
      const created = createCorporateTransfer(store, req.user!, transferRequestOf(req));
      if (!created.ok) return res.status(422).json({ error: created.refusal });
      return res.status(201).json(created.transfer);
    }
    const result = submitTransfer(store, req.user!, transferRequestOf(req));
    if (result.ok === "CODE_REQUIRED") return res.status(202).json({ status: "CODE_REQUIRED", challengeId: result.challengeId });
    if (!result.ok && result.refusal === "TIMED_OUT") return res.status(504).json({ error: "TIMED_OUT", reference: result.transfer?.reference });
    if (!result.ok) return res.status(422).json({ error: result.refusal });
    return res.status(201).json(result.transfer);
  });

  app.post("/api/transfers/code", signedIn, (req, res) => {
    const result = confirmCode(store, req.user!, String(req.body?.challengeId ?? ""), String(req.body?.code ?? ""));
    if (!result.ok && result.refusal === "TIMED_OUT") return res.status(504).json({ error: "TIMED_OUT", reference: "transfer" in result ? result.transfer?.reference : undefined });
    if (!result.ok) return res.status(422).json({ error: result.refusal, ...("wrongCodesLeft" in result ? { wrongCodesLeft: result.wrongCodesLeft } : {}) });
    return res.status(201).json(result.transfer);
  });

  app.get("/api/approvals", signedIn, (req, res) => {
    res.json(pendingForChecker(store, req.user!));
  });

  app.post("/api/approvals/:id/approve", signedIn, (req, res) => {
    const result = approveTransfer(store, req.user!, String(req.params.id));
    if (result.ok === "CODE_REQUIRED") return res.status(202).json({ status: "CODE_REQUIRED", challengeId: result.challengeId });
    if (!result.ok) return res.status(422).json({ error: result.refusal });
    return res.json(result.transfer);
  });

  app.post("/api/approvals/:id/reject", signedIn, (req, res) => {
    const result = rejectTransfer(store, req.user!, String(req.params.id));
    if (!result.ok) return res.status(422).json({ error: result.refusal });
    return res.json(result.transfer);
  });

  // FAB-22: the company's audit log, read-only for its checkers.
  app.get("/api/audit", signedIn, (req, res) => {
    if (!req.user!.roles.includes("CHECKER")) return res.status(403).json({ error: "NOT_A_CHECKER" });
    return res.json(auditLogOf(store, req.user!.customerId));
  });

  app.get("/api/limits/today", signedIn, (req, res) => {
    const customer = store.customer(req.user!.customerId)!;
    if (customer.kind !== "RETAIL") return res.json({ limit: null });
    const now = store.clock.now();
    return res.json({ limit: DAILY_LIMIT, sent: sentToday(store, customer.id, now), remaining: remainingToday(store, customer.id, now) });
  });

  app.get("/api/transfers", signedIn, (req, res) => {
    res.json(store.transfersOf(req.user!.customerId));
  });

  return app;
}

function statementForm(user: User, error?: string): string {
  return page(
    "Export a statement",
    `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
     <section><form method="get" action="/statement.pdf">
       <label for="from">From</label><input id="from" name="from" type="date" required>
       <label for="to">To</label><input id="to" name="to" type="date" required>
       <br><button>Download PDF</button></form>
     <p>Any period of up to 12 months.</p></section>`,
    user.name,
  );
}

/** FAB-13: the transfer timed out; the customer can retry it with the same reference. */
function retryPage(user: User, t: Transfer): string {
  const fields = { sourceAccountId: t.sourceAccountId, beneficiaryId: t.beneficiaryId, amount: (t.amount / 100).toFixed(2), reference: t.reference };
  const hidden = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`)
    .join("");
  return page(
    "The bank did not answer in time",
    `<section><p class="error">${escapeHtml(REFUSAL_WORDS.TIMED_OUT)}</p>
     <p>Transfer ${escapeHtml(t.reference)}: ${formatMoney(t.amount)} to ${escapeHtml(t.beneficiaryName)}.</p>
     <form method="post" action="/transfer/send">${hidden}<button>Retry</button></form></section>`,
    user.name,
  );
}

function approvalsPage(store: Store, user: User, error?: string, notice?: string): string {
  const rows = pendingForChecker(store, user)
    .map(
      (t) => `<tr><td>${escapeHtml(t.reference)}</td><td>${escapeHtml(store.user(t.userId)?.name ?? "")}</td><td>${escapeHtml(t.beneficiaryName)}</td><td>${formatMoney(t.amount)}</td><td>${escapeHtml(t.expiresAt?.toISOString() ?? "")}</td>
        <td><form method="post" action="/approvals/${escapeHtml(t.id)}/approve"><button>Approve</button></form>
            <form method="post" action="/approvals/${escapeHtml(t.id)}/reject"><button>Reject</button></form></td></tr>`,
    )
    .join("");
  return page(
    "Waiting for approval",
    `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : ""}
     <section><table><tr><th>Reference</th><th>Created by</th><th>To</th><th>Amount</th><th>Expires</th><th></th></tr>${rows}</table></section>`,
    user.name,
  );
}

function codeForm(user: User, challengeId: string, error?: string): string {
  return page(
    "Enter your one-time code",
    `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
     <section><p>A transfer of 50,000 EGP or more needs the 6-digit code we sent to your registered phone. It is valid for 3 minutes.</p>
     <form method="post" action="/transfer/code"><input type="hidden" name="challengeId" value="${escapeHtml(challengeId)}">
       <label for="code">Code</label><input id="code" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required>
       <br><button>Send</button></form>
     <p class="demo"><a href="/demo/messages">See the messages to your phone (demo)</a></p></section>`,
    user.name,
  );
}

function beneficiaryForm(user: User, error?: string): string {
  return page(
    "Add a beneficiary",
    `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
     <section><form method="post" action="/beneficiaries">
       <label for="name">Name</label><input id="name" name="name" maxlength="70" required>
       <label for="iban">IBAN</label><input id="iban" name="iban" placeholder="EG.. .... .... .... .... .... ...." required>
       <br><button>Add</button></form></section>`,
    user.name,
  );
}

function transferForm(store: Store, user: User, error?: string): string {
  const accounts = store
    .accountsOf(user.customerId)
    .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.label)} · ${formatMoney(a.balance)}</option>`)
    .join("");
  const beneficiaries = store
    .beneficiariesOf(user.customerId)
    .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`)
    .join("");
  // FAB-8 (BRD 4.1 rule 29): the transfer page shows how much can still be sent today.
  const remaining =
    store.customer(user.customerId)?.kind === "RETAIL"
      ? `<p class="notice" data-testid="remaining-today">You can still send ${formatMoney(remainingToday(store, user.customerId, store.clock.now()))} today, across all your accounts on web and mobile.</p>`
      : "";
  return page(
    "Send money",
    `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}${remaining}
     <section><form method="post" action="/transfer/confirm">
       <label for="from">From</label><select id="from" name="sourceAccountId">${accounts}</select>
       <label for="to">To</label><select id="to" name="beneficiaryId">${beneficiaries}</select>
       <label for="amount">Amount (EGP)</label><input id="amount" name="amount" inputmode="decimal" required>
       <br><button>Continue</button></form></section>`,
    user.name,
  );
}
