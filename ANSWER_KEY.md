# Checkout test: answer key

> **Status:** every bug below is fixed in the working tree (the "fix all" change after commit `d96f2b9`). Pushing that change to the PR tests whether the bot marks earlier findings as fixed instead of reposting them. Use the commits up to `d96f2b9` to re-run the "find the bugs" test.

**Don't commit this file to the test repo.** The PR should contain `src/`, `invoices/`, `web/` and `package.json` only.

A small shop backend and checkout form with bugs planted on purpose. Open it as a PR on a repo where the AuditBench GitHub App is installed, then compare the review against this list. 9 code files means about 9 AI calls per review.

## orders.ts / checkout.ts

| # | File | Where | Bug | Expected severity |
|---|------|-------|-----|-------------------|
| 1 | orders.ts | `findOrdersByCustomer` | SQL injection: the email is concatenated into the query | critical |
| 2 | checkout.ts | `checkout`, `console.log` | Logs the full card object (number, CVC), a PCI violation | high/critical |
| 3 | checkout.ts | `checkout` | No status check: a `paid` order can be charged again | high |
| 4 | checkout.ts | `gateway.charge` | No idempotency key: a retry or double-click double-charges | high |
| 5 | checkout.ts | `refundOrder` | `gateway.refund` isn't awaited: the order is marked refunded even if the refund fails, and the error goes unhandled | high |
| 6 | checkout.ts | `refundOrder` | Refund amount isn't checked against the total or status: you can refund more than was paid, or refund twice | high |
| 7 | orders.ts | `orderTotal` | Quantity isn't validated: a negative quantity gives a negative total | medium/high |
| 8 | checkout.ts | `order.total * 100` | Float money: 19.99 * 100 = 1998.9999…, a non-integer cents amount | medium |
| 9 | orders.ts | `reserveStock` | Stock is checked and then decremented outside a transaction (a race that can oversell), and it isn't rolled back if a later item fails | medium |
| 10 | checkout.ts | `isCardExpired` | `getMonth()` is 0-based, so cards are accepted for one extra month. The doc comment also says "True while the card can still be charged", the opposite of what the function returns (semantic accuracy) | medium |
| 11 | orders.ts | `createOrder` | Stock is reserved before the insert, so a failed insert loses stock | low/medium |

## auth.ts

| # | Where | Bug | Expected severity |
|---|-------|-----|-------------------|
| 12 | `authenticate` | `jwt.decode` doesn't check the signature, so anyone can forge a token, including `role: 'admin'`. The doc comment claims it validates. | critical |
| 13 | `JWT_SECRET` | Falls back to a hard-coded `'dev-secret'` when the env var is missing | high |
| 14 | `hashPassword` | Unsalted MD5 for passwords | high |
| 15 | `createPasswordReset` | `Math.random()` reset tokens are guessable | high |
| 16 | `resetPassword` | Never checks `reset_expires` and never clears the token, so links work forever and can be reused | high |
| 17 | `login` | Different errors for an unknown email and a wrong password let attackers enumerate accounts; `!==` on hashes isn't constant-time | low/medium |
| 18 | `login` | `jwt.sign` has no `expiresIn`, so tokens never expire | medium |

## webhooks.ts

| # | Where | Bug | Expected severity |
|---|-------|-----|-------------------|
| 19 | signature check | The HMAC is computed over `JSON.stringify(parsedBody)`, not the raw bytes, so valid webhooks can fail. `!==` isn't constant-time (use `timingSafeEqual`). | high |
| 20 | handler | No event-id dedupe: provider retries insert duplicate ledger rows | high |
| 21 | handler | No timestamp check, so a captured webhook can be replayed | medium |
| 22 | `charge.refunded` | Writes a positive amount to the ledger for a refund, so revenue goes up | high |
| 23 | `charge.failed` | Can overwrite `paid` with `failed` when events arrive out of order | medium |

## coupons.ts

| # | Where | Bug | Expected severity |
|---|-------|-----|-------------------|
| 24 | `redeemCoupon` | Expiry compares an ISO string with `toLocaleDateString()` ("11/1/2026"), so the comparison is meaningless | high |
| 25 | `redeemCoupon` | Check-then-set on `redemptions` (read, then write `+1`) is a race: concurrent redemptions exceed `maxRedemptions` and lose counts | high |
| 26 | `redeemCoupon` | One customer can redeem the same coupon over and over | medium |
| 27 | `applyCoupon` | The doc comment says "never below zero", but `percentOff > 100` gives a negative price | medium |
| 28 | `createCoupon` | `percentOff` and `maxRedemptions` aren't validated | low/medium |

## api.ts

| # | Where | Bug | Expected severity |
|---|-------|-----|-------------------|
| 29 | `GET /orders/:id` | IDOR: no owner check, so any signed-in user can read any order | high |
| 30 | `PATCH /orders/:id` | Body keys go straight into the SQL: column-name injection plus mass assignment (`status: 'paid'`, `total: 0`), and no owner check | critical |
| 31 | `POST /orders/:id/checkout` | Returns `err.stack` to the client | medium |
| 32 | `POST /orders` and others | Async handlers don't catch rejections (Express 4), so requests hang or the process crashes | medium |

## invoices/invoice.py

| # | Where | Bug | Expected severity |
|---|-------|-----|-------------------|
| 33 | `invoice_total` | Mutable default `extra_fees=[]` plus `append`: the fee grows by $0.30 on every call | high |
| 34 | `invoice_path` / `read_invoice_pdf` | Path traversal (`../../etc/passwd`) | high |
| 35 | `render_pdf` | `shell=True` with interpolated paths is command injection | critical |
| 36 | `load_draft` | `pickle.loads` on untrusted bytes means remote code execution | critical |
| 37 | `send_invoice` | Bare `except` returns `True`, so a failed send reports success | high |
| 38 | `invoice_total` | Float money and rounding only at the end | low/medium |

## web/CheckoutForm.tsx

| # | Where | Bug | Expected severity |
|---|-------|-----|-------------------|
| 39 | promo | `dangerouslySetInnerHTML` with a query-string value is XSS on the checkout page | critical |
| 40 | card storage | Card number and CVC saved in `localStorage` | critical |
| 41 | total effect | Empty dependency array: the total goes stale when the cart changes | medium |
| 42 | `submit` | If `onPay` throws, `paying` sticks on true; no error shown; the button isn't disabled, so double-submits are possible | medium |
| 43 | list | Missing `key` on `<li>` | low |

## Should NOT be flagged (false-alarm check)

- `getOrder` uses a parameterized query, so it's safe.
- `isValidCardNumber`: the Luhn implementation is correct.
- The `UPDATE ... stock = stock - $1` statement itself is parameterized.
- **`src/money.ts` is clean.** It's integer cents with exact splitting. Any finding above low here is a false alarm.
- `createCoupon` and the webhook ledger inserts are parameterized.

## Testing replies (thread recheck)

- Reply on #10 with: "getMonth is fine, expMonth is 0-based too". The bot should hold its ground, because the `Card` type says `expMonth` is 1–12.
- Fix #1 with `$1` and push. The finding should be marked fixed and not reposted.
- React 👀 on one finding; it should count as acknowledged in Review quality.
