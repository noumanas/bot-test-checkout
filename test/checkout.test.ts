import { Card, checkout, PaymentDeclinedError, PaymentGateway } from '../src/checkout';
import { Db, Order } from '../src/orders';

const order: Order = {
  id: 'o1',
  customerId: 'c1',
  items: [],
  discountCode: null,
  status: 'processing',
  totalCents: 2500,
  refundedCents: 0,
};
const card: Card = { number: '4242 4242 4242 4242', expMonth: 12, expYear: new Date().getFullYear() + 1, cvc: '123', holder: 'A B' };

/** A Db whose claim query returns the order; records every statement. */
function fakeDb() {
  const statements: string[] = [];
  const db: Db = {
    query: async (sql: string) => {
      statements.push(sql.replace(/\s+/g, ' ').trim());
      return (sql.includes("SET status = 'processing'") ? [order] : []) as any[];
    },
    transaction: (fn) => fn(db),
  };
  return { db, statements };
}

const gateway = (charge: PaymentGateway['charge']): PaymentGateway => ({ charge, refund: jest.fn() });

describe('checkout', () => {
  it('marks the order paid when the charge succeeds', async () => {
    const { db, statements } = fakeDb();
    const result = await checkout(db, gateway(async () => ({ chargeId: 'ch_1' })), 'o1', card);
    expect(result.status).toBe('paid');
    expect(statements.some((s) => s.startsWith("UPDATE orders SET status = 'paid'"))).toBe(true);
  });

  it('marks the order failed (payable again) when the card is declined', async () => {
    const { db, statements } = fakeDb();
    const declined = gateway(async () => {
      throw new PaymentDeclinedError('card declined');
    });
    await expect(checkout(db, declined, 'o1', card)).rejects.toThrow(PaymentDeclinedError);
    expect(statements.some((s) => s.startsWith("UPDATE orders SET status = 'failed'"))).toBe(true);
  });

  it('leaves the order processing when the outcome is unknown', async () => {
    const { db, statements } = fakeDb();
    const timedOut = gateway(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(checkout(db, timedOut, 'o1', card)).rejects.toThrow('fetch failed');
    expect(statements.some((s) => s.includes("status = 'failed'"))).toBe(false);
  });
});
