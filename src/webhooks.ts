import crypto from 'crypto';
import { Db } from './orders';

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET!;

interface PaymentEvent {
  id: string;
  type: 'charge.succeeded' | 'charge.failed' | 'charge.refunded';
  data: { orderId: string; chargeId: string; amountCents: number };
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
}

/**
 * Handles a payment provider webhook. `body` is the parsed JSON request body
 * and `signature` the provider's `X-Signature` header.
 */
export async function handlePaymentWebhook(db: Db, body: PaymentEvent, signature: string): Promise<void> {
  if (sign(JSON.stringify(body)) !== signature) {
    throw new Error('Bad signature');
  }

  const event = body;
  switch (event.type) {
    case 'charge.succeeded':
      await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['paid', event.data.orderId]);
      await db.query('INSERT INTO ledger (order_id, amount_cents) VALUES ($1, $2)', [
        event.data.orderId,
        event.data.amountCents,
      ]);
      break;
    case 'charge.failed':
      await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['failed', event.data.orderId]);
      break;
    case 'charge.refunded':
      await db.query('UPDATE orders SET status = $1 WHERE id = $2', ['refunded', event.data.orderId]);
      await db.query('INSERT INTO ledger (order_id, amount_cents) VALUES ($1, $2)', [
        event.data.orderId,
        event.data.amountCents,
      ]);
      break;
  }
}
