# Cedar Pay

Cedar Pay is the transfer app of **Cedar Bank, a fictional bank**. It exists for a demonstration: Cedar Bank,
its customers, accounts, IBANs, phone numbers and every figure here are invented. The IBANs use the made-up
bank code `9999`. There is no real customer data, no real bank connection and no secret in this repository.

The rules come from the business requirements, *Cedar Pay BRD v1.2* (26 October 2026). Work is tracked in the
Jira project `FAB`; every pull request is named with its ticket key, e.g. `FAB-4: Add a beneficiary by IBAN`.

## Run it

```sh
pnpm install
pnpm start          # http://localhost:3000
```

Sign in by choosing one of the demo users; there are no passwords. The web pages are the web channel. The
mobile app is represented by the JSON API under `/api`, called with the header `X-Cedar-Channel: mobile`.

| Demo user | Customer | Roles |
|---|---|---|
| Laila Fathy | retail, two active accounts | customer |
| Omar Nabil | retail, a frozen account | customer |
| Mona Said | Nile Delta Trading (corporate) | maker |
| Karim Adel | Nile Delta Trading (corporate) | checker |
| Salma Youssef | Nile Delta Trading (corporate) | maker and checker |
| Hany Mostafa | Red Sea Logistics (corporate) | checker |

## Settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | The port the app listens on |
| `SMS_NOTIFICATIONS` | off | Only `true` turns it on: an SMS after every transfer as well as the push notification and the e-mail. A trial of the draft "SMS after every transfer" (BRD 3.5, not approved). While it is off no SMS is sent |

Notifications and one-time codes go to in-memory outboxes; nothing leaves the app.

## Test

```sh
pnpm typecheck
pnpm test           # or: pnpm test:ci, which also writes test-results/junit.xml
```

CI (`.github/workflows/ci.yml`) runs the type check and the tests on every pull request and on `main`, and
publishes the JUnit report as the artifact `robotesta-test-results-test` on every run, failed runs included.
