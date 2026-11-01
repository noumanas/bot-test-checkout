/**
 * Money helpers. Amounts are integer cents throughout; convert to and from
 * display strings only at the edges.
 */

export function toCents(amount: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!match) throw new Error(`Not a money amount: ${amount}`);
  const [, whole, frac = ''] = match;
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

export function formatCents(cents: number, currency = 'USD'): string {
  if (!Number.isInteger(cents)) throw new Error(`Cents must be an integer: ${cents}`);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** Splits `cents` into `parts` integer shares that add back up exactly (earlier shares get the remainder). */
export function splitCents(cents: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('parts must be a positive integer');
  const base = Math.floor(cents / parts);
  const remainder = cents - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}
