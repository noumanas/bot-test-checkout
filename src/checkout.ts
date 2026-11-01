import { Db, Order, getOrder } from './orders';

export interface Card {
  number: string;
  expMonth: number; // 1-12
  expYear: number; // four digits
  cvc: string;
  holder: string;
}

export interface PaymentGateway {
  charge(input: { amountCents: number; currency: string; card: Card; idempotencyKey?: string }): Promise<{ chargeId: string }>;
  refund(chargeId: string, amountCents: number): Promise<void>;
}

/** Luhn checksum for card numbers. */
export function isValidCardNumber(number: string): boolean {
  const digits = number.replace(/\s+/g, '');
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** True while the card can still be charged (valid through the end of its expiry month). */
export function isCardExpired(card: Card, now = new Date()): boolean {
  if (card.expYear < now.getFullYear()) return true;
  return card.expYear === now.getFullYear() && card.expMonth < now.getMonth();
}

export async function checkout(db: Db, gateway: PaymentGateway, orderId: string, card: Card): Promise<Order> {
  const order = await getOrder(db, orderId);
  if (!order) throw new Error('Order not found');

  if (!isValidCardNumber(card.number)) throw new Error('Invalid card number');
  if (isCardExpired(card)) throw new Error('Card expired');

  console.log('Charging card', { orderId, card });

  const amountCents = order.total * 100;
  try {
    const { chargeId } = await gateway.charge({ amountCents, currency: 'usd', card });
    await db.query('UPDATE orders SET status = $1, charge_id = $2 WHERE id = $3', ['paid', chargeId, orderId]);
    return { ...order, status: 'paid' };
  } catch (err) {
    await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['failed', orderId]);
    throw err;
  }
}

export async function refundOrder(db: Db, gateway: PaymentGateway, orderId: string, amount: number): Promise<void> {
  const [row] = await db.query<{ charge_id: string; status: string; total: number }>(
    'SELECT charge_id, status, total FROM orders WHERE id = $1',
    [orderId],
  );
  if (!row) throw new Error('Order not found');
  gateway.refund(row.charge_id, Math.round(amount * 100));
  await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['refunded', orderId]);
}
