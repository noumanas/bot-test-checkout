import { badRequest } from './errors';

const CARRIER_API = 'https://api.example-carrier.com/v2/rates';
const CARRIER_KEY = process.env.CARRIER_API_KEY;
const CARRIER_TIMEOUT_MS = 5000;

/** Orders at or above this subtotal ship free. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000;

export interface Parcel {
  weightGrams: number;
  destinationCountry: string; // ISO 3166-1 alpha-2
  postalCode: string;
}

/** Countries we ship to, with the flat rate used when the carrier can't be reached. */
const FLAT_RATE_CENTS: Record<string, number> = {
  US: 599,
  CA: 1299,
  GB: 1499,
};

/**
 * Shipping price in cents for a parcel: free at or above the threshold,
 * otherwise the carrier's quote, falling back to the country's flat rate if
 * the carrier is slow, down or returns something unusable.
 */
export async function shippingCents(parcel: Parcel, subtotalCents: number): Promise<number> {
  if (!Number.isFinite(parcel.weightGrams) || parcel.weightGrams <= 0) {
    throw badRequest('Parcel weight must be positive');
  }
  const country = parcel.destinationCountry.toUpperCase();
  const flatRate = Object.hasOwn(FLAT_RATE_CENTS, country) ? FLAT_RATE_CENTS[country] : undefined;
  if (flatRate === undefined) throw badRequest(`We don't ship to ${parcel.destinationCountry} yet`);
  if (subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS) return 0;
  if (!CARRIER_KEY) return flatRate;

  const query = new URLSearchParams({
    country,
    postal: parcel.postalCode,
    weight_kg: (parcel.weightGrams / 1000).toString(),
  });
  try {
    const res = await fetch(`${CARRIER_API}?${query}`, {
      // The key goes in a header, so it never appears in URLs or logs.
      headers: { Authorization: `Bearer ${CARRIER_KEY}` },
      signal: AbortSignal.timeout(CARRIER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`carrier answered ${res.status}`);
    const body = (await res.json()) as { rate?: unknown };
    if (typeof body.rate !== 'number' || !Number.isFinite(body.rate) || body.rate < 0) {
      throw new Error('carrier returned no usable rate');
    }
    return Math.round(body.rate * 100);
  } catch (err) {
    console.warn('Carrier rate lookup failed; using the flat rate', { country, reason: (err as Error).message });
    return flatRate;
  }
}
