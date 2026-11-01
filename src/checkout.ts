import { badRequest, conflict, notFound } from './errors';
import { Db, Order, ORDER_COLUMNS, getOrder } from './orders';

export interface Card {
  number: string;
  expMonth: number; // 1-12
  expYear: number; // four digits
  cvc: string;
  holder: string;
}

export interface PaymentGateway {
  charge(input: { amountCents: number; currency: string; card: Card; idempotencyKey: string }): Promise<{ chargeId: string }>;
  refund(input: { chargeId: string; amountCents: number; idempotencyKey: string }): Promise<void>;
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

/** True once the card's expiry month has ended (cards are valid through the end of that month). */
export function isCardExpired(card: Card, now = new Date()): boolean {
  const year = now.getFullYear();
  const month = now.getMonth() + 1; // getMonth() is 0-based; expMonth is 1-12
  return card.expYear < year || (card.expYear === year && card.expMonth < month);
}

function validateCard(card: Card | undefined): Card {
  if (!card || typeof card.number !== 'string' || !isValidCardNumber(card.number)) {
    throw badRequest('Invalid card number');
  }
  if (!Number.isInteger(card.expMonth) || card.expMonth < 1 || card.expMonth > 12 || !Number.isInteger(card.expYear)) {
    throw badRequest('Invalid expiry date');
  }
  if (typeof card.cvc !== 'string' || !/^\d{3,4}$/.test(card.cvc)) throw badRequest('Invalid security code');
  if (isCardExpired(card)) throw badRequest('Card expired');
  return card;
}

/**
 * Charges an unpaid order once. The order is claimed (pending/failed →
 * processing) before the charge, so a double-click or retry can't charge it
 * twice, and the gateway gets an idempotency key per order for the same reason.
 * Card details are never logged.
 */
export async function checkout(db: Db, gateway: PaymentGateway, orderId: string, input: Card): Promise<Order> {
  const card = validateCard(input);

  const [order] = await db.query<Order>(
    `UPDATE orders SET status = 'processing' WHERE id = $1 AND status IN ('pending', 'failed')
     RETURNING ${ORDER_COLUMNS}`,
    [orderId],
  );
  if (!order) {
    const existing = await getOrder(db, orderId);
    if (!existing) throw notFound('Order not found');
    throw conflict(`Order is already ${existing.status}`);
  }

  try {
    const { chargeId } = await gateway.charge({
      amountCents: order.totalCents,
      currency: 'usd',
      card,
      idempotencyKey: `order-${order.id}-charge`,
    });
    await db.query(`UPDATE orders SET status = 'paid', charge_id = $1 WHERE id = $2`, [chargeId, order.id]);
    return { ...order, status: 'paid' };
  } catch (err) {
    await db.query(`UPDATE orders SET status = 'failed' WHERE id = $1 AND status = 'processing'`, [order.id]);
    throw err;
  }
}

/**
 * Refunds up to what's left of a paid order. The refunded amount is reserved
 * first, so two concurrent refunds can't together exceed the total, and
 * released again if the gateway refuses.
 */
export async function refundOrder(db: Db, gateway: PaymentGateway, orderId: string, amountCents: number): Promise<void> {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw badRequest('Refund must be a positive number of cents');

  const [row] = await db.query<{ charge_id: string; refunded_cents: number; total_cents: number }>(
    `UPDATE orders SET refunded_cents = refunded_cents + $1,
       status = CASE WHEN refunded_cents + $1 = total_cents THEN 'refunded' ELSE 'partially_refunded' END
     WHERE id = $2 AND status IN ('paid', 'partially_refunded') AND refunded_cents + $1 <= total_cents
     RETURNING charge_id, refunded_cents, total_cents`,
    [amountCents, orderId],
  );
  if (!row) {
    const existing = await getOrder(db, orderId);
    if (!existing) throw notFound('Order not found');
    throw conflict('Order is not paid, or the refund is more than what is left');
  }

  try {
    await gateway.refund({
      chargeId: row.charge_id,
      amountCents,
      // Unique per refund step: the running total identifies this refund.
      idempotencyKey: `order-${orderId}-refund-${row.refunded_cents}`,
    });
  } catch (err) {
    await db.query(
      `UPDATE orders SET refunded_cents = refunded_cents - $1,
         status = CASE WHEN refunded_cents - $1 = 0 THEN 'paid' ELSE 'partially_refunded' END
       WHERE id = $2`,
      [amountCents, orderId],
    );
    throw err;
  }
}
