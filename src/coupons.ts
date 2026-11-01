import { badRequest, conflict, notFound } from './errors';
import { Db } from './orders';

export interface Coupon {
  code: string;
  percentOff: number; // 1-100
  maxRedemptions: number;
  redemptions: number;
  expiresAt: string; // ISO date, e.g. "2026-12-31"; valid through the end of that day (UTC)
}

const COUPON_COLUMNS = `code, percent_off AS "percentOff", max_redemptions AS "maxRedemptions",
  redemptions, to_char(expires_at, 'YYYY-MM-DD') AS "expiresAt"`;

const normalize = (code: string) => code.trim().toUpperCase();

/**
 * Redeems a coupon once per customer. The redemption row (unique on code +
 * customer) and the counter increment (only while under the limit and not
 * expired) happen in one transaction, so concurrent redemptions can't exceed
 * `maxRedemptions`.
 */
export async function redeemCoupon(db: Db, rawCode: string, customerId: string): Promise<Coupon> {
  const code = normalize(rawCode);
  return db.transaction(async (tx) => {
    const claimed = await tx.query(
      `INSERT INTO coupon_redemptions (code, customer_id) VALUES ($1, $2)
       ON CONFLICT (code, customer_id) DO NOTHING RETURNING code`,
      [code, customerId],
    );
    if (!claimed.length) throw conflict('You have already used this coupon');

    const [coupon] = await tx.query<Coupon>(
      `UPDATE coupons SET redemptions = redemptions + 1
       WHERE code = $1 AND redemptions < max_redemptions AND expires_at >= (now() AT TIME ZONE 'utc')::date
       RETURNING ${COUPON_COLUMNS}`,
      [code],
    );
    if (coupon) return coupon;

    const [existing] = await tx.query<Coupon>(`SELECT ${COUPON_COLUMNS} FROM coupons WHERE code = $1`, [code]);
    if (!existing) throw notFound('Unknown coupon');
    throw conflict(existing.redemptions >= existing.maxRedemptions ? 'Coupon fully redeemed' : 'Coupon expired');
  });
}

/** Price after the coupon, in cents. Never below zero. */
export function applyCoupon(priceCents: number, coupon: Coupon): number {
  const percent = Math.min(100, Math.max(0, coupon.percentOff));
  return Math.max(0, priceCents - Math.round((priceCents * percent) / 100));
}

export async function createCoupon(db: Db, input: Omit<Coupon, 'redemptions'>): Promise<void> {
  const code = normalize(input.code ?? '');
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw badRequest('Code must be 3-32 letters, digits, - or _');
  if (!Number.isInteger(input.percentOff) || input.percentOff < 1 || input.percentOff > 100) {
    throw badRequest('percentOff must be a whole number from 1 to 100');
  }
  if (!Number.isInteger(input.maxRedemptions) || input.maxRedemptions < 1) {
    throw badRequest('maxRedemptions must be a positive whole number');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt) || Number.isNaN(Date.parse(input.expiresAt))) {
    throw badRequest('expiresAt must be a date like 2026-12-31');
  }
  await db.query(
    'INSERT INTO coupons (code, percent_off, max_redemptions, redemptions, expires_at) VALUES ($1, $2, $3, 0, $4)',
    [code, input.percentOff, input.maxRedemptions, input.expiresAt],
  );
}
