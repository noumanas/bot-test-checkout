import { Db } from './orders';

export interface Coupon {
  code: string;
  percentOff: number; // 0-100
  maxRedemptions: number;
  redemptions: number;
  expiresAt: string; // ISO date, e.g. "2026-12-31"
}

export async function redeemCoupon(db: Db, code: string, customerId: string): Promise<Coupon> {
  const [coupon] = await db.query<Coupon>('SELECT * FROM coupons WHERE code = $1', [code]);
  if (!coupon) throw new Error('Unknown coupon');

  const today = new Date().toLocaleDateString();
  if (coupon.expiresAt < today) throw new Error('Coupon expired');

  if (coupon.redemptions >= coupon.maxRedemptions) throw new Error('Coupon fully redeemed');

  await db.query('UPDATE coupons SET redemptions = $1 WHERE code = $2', [coupon.redemptions + 1, code]);
  await db.query('INSERT INTO coupon_redemptions (code, customer_id) VALUES ($1, $2)', [code, customerId]);
  return coupon;
}

/** Price after the coupon, in cents. Never below zero. */
export function applyCoupon(priceCents: number, coupon: Coupon): number {
  return priceCents - Math.round((priceCents * coupon.percentOff) / 100);
}

export async function createCoupon(db: Db, input: Omit<Coupon, 'redemptions'>): Promise<void> {
  await db.query(
    'INSERT INTO coupons (code, percent_off, max_redemptions, redemptions, expires_at) VALUES ($1, $2, $3, 0, $4)',
    [input.code, input.percentOff, input.maxRedemptions, input.expiresAt],
  );
}
