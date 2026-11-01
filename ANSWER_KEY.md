# Checkout test: answer key

**Don't commit this file to the test repo.** The PR should contain only `src/`.

`src/orders.ts` and `src/checkout.ts` are a small order and card-checkout module with bugs planted on purpose. Open them as a PR on a repo where the AuditBench GitHub App is installed, then compare the review against this list.

## Bugs it should catch

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

## Should NOT be flagged (false-alarm check)

- `getOrder` uses a parameterized query, so it's safe.
- `isValidCardNumber`: the Luhn implementation is correct.
- The `UPDATE ... stock = stock - $1` statement itself is parameterized.

## Testing replies (thread recheck)

- Reply on #10 with: "getMonth is fine, expMonth is 0-based too". The bot should hold its ground, because the `Card` type says `expMonth` is 1–12.
- Fix #1 with `$1` and push. The finding should be marked fixed and not reposted.
- React 👀 on one finding; it should count as acknowledged in Review quality.
