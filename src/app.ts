import express, { type NextFunction, type Request, type Response } from "express";
import { BENEFICIARY_REFUSAL_WORDS, addBeneficiary } from "./beneficiaries.js";
import type { Channel, User } from "./model.js";
import { formatMoney } from "./money.js";
import { removeBeneficiary } from "./removeBeneficiary.js";
import type { Store } from "./store.js";
import { REFUSAL_WORDS, quoteTransfer, sendTransfer, type TransferRequest } from "./transfers.js";
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
  };
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
         <p><a href="/transfer">Send money</a></p></section>
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
    const hidden = Object.entries(request)
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
    const result = sendTransfer(store, req.user!, transferRequestOf(req));
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
    const result = sendTransfer(store, req.user!, transferRequestOf(req));
    if (!result.ok) return res.status(422).json({ error: result.refusal });
    return res.status(201).json(result.transfer);
  });

  app.get("/api/transfers", signedIn, (req, res) => {
    res.json(store.transfersOf(req.user!.customerId));
  });

  return app;
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
  return page(
    "Send money",
    `${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
     <section><form method="post" action="/transfer/confirm">
       <label for="from">From</label><select id="from" name="sourceAccountId">${accounts}</select>
       <label for="to">To</label><select id="to" name="beneficiaryId">${beneficiaries}</select>
       <label for="amount">Amount (EGP)</label><input id="amount" name="amount" inputmode="decimal" required>
       <br><button>Continue</button></form></section>`,
    user.name,
  );
}
