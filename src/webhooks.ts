import crypto from 'crypto';
import { Db } from './orders';

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) throw new Error('PAYMENT_WEBHOOK_SECRET must be set');

/** How old a webhook may be before it's treated as a replay. */
const TOLERANCE_SECONDS = 300;

interface PaymentEvent {
  id: string;
  type: 'charge.succeeded' | 'charge.failed' | 'charge.refunded';
  data: { orderId: string; chargeId: string; amountCents: number };
}

export class WebhookSignatureError extends Error {}

/**
 * Checks the provider's `X-Signature` (hex HMAC-SHA256 of `<timestamp>.<raw body>`)
 * and `X-Timestamp` headers against the raw request bytes — not re-serialized
 * JSON, which wouldn't match byte for byte.
 */
export function verifyWebhook(rawBody: Buffer, signature: string, timestamp: string, now = Date.now()): PaymentEvent {
  const sentAt = Number(timestamp);
  if (!Number.isInteger(sentAt) || Math.abs(now / 1000 - sentAt) > TOLERANCE_SECONDS) {
    throw new WebhookSignatureError('Stale or missing timestamp');
  }
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET!).update(`${timestamp}.`).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new WebhookSignatureError('Bad signature');
  }
  return JSON.parse(rawBody.toString('utf8')) as PaymentEvent;
}

/**
 * Applies a verified event once. Providers retry, so each event id is
 * recorded and repeats are ignored; status changes only move forward, so
 * events arriving out of order can't undo a payment.
 */
export async function handlePaymentWebhook(db: Db, rawBody: Buffer, signature: string, timestamp: string): Promise<void> {
  const event = verifyWebhook(rawBody, signature, timestamp);

  await db.transaction(async (tx) => {
    const fresh = await tx.query(
      'INSERT INTO webhook_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id',
      [event.id, event.type],
    );
    if (!fresh.length) return;

    const { orderId, amountCents } = event.data;
    switch (event.type) {
      case 'charge.succeeded':
        await tx.query(
          `UPDATE orders SET status = 'paid', charge_id = $1 WHERE id = $2 AND status IN ('pending', 'processing', 'failed')`,
          [event.data.chargeId, orderId],
        );
        await tx.query('INSERT INTO ledger (order_id, event_id, amount_cents) VALUES ($1, $2, $3)', [
          orderId,
          event.id,
          amountCents,
        ]);
        break;
      case 'charge.failed':
        await tx.query(`UPDATE orders SET status = 'failed' WHERE id = $1 AND status IN ('pending', 'processing')`, [
          orderId,
        ]);
        break;
      case 'charge.refunded':
        // refundOrder() already updated the order; the ledger records money going out.
        await tx.query('INSERT INTO ledger (order_id, event_id, amount_cents) VALUES ($1, $2, $3)', [
          orderId,
          event.id,
          -Math.abs(amountCents),
        ]);
        break;
    }
  });
}
