import { badRequest } from './errors';

const CARRIER_API = 'https://api.example-carrier.com/v2/rates';
const CARRIER_KEY = process.env.CARRIER_API_KEY ?? '';

/** Orders at or above this subtotal ship free. */
export const FREE_SHIPPING_THRESHOLD_CENTS = 5000;

export interface Parcel {
  weightGrams: number;
  destinationCountry: string; // ISO 3166-1 alpha-2
  postalCode: string;
}

const FLAT_RATE_CENTS: Record<string, number> = {
  US: 599,
  CA: 1299,
  GB: 1499,
};

/** Shipping price in cents for a parcel, from the carrier, falling back to a flat rate. */
export async function shippingCents(parcel: Parcel, subtotalCents: number): Promise<number> {
  if (subtotalCents > FREE_SHIPPING_THRESHOLD_CENTS) return 0;
  if (parcel.weightGrams <= 0) throw badRequest('Parcel weight must be positive');

  const url = `${CARRIER_API}?key=${CARRIER_KEY}&country=${parcel.destinationCountry}&postal=${parcel.postalCode}&weight_kg=${parcel.weightGrams}`;
  try {
    const res = await fetch(url);
    const body = (await res.json()) as { rate: number };
    return Math.round(body.rate * 100);
  } catch (err) {
    console.warn('Carrier rate lookup failed', { url, err });
    return FLAT_RATE_CENTS[parcel.destinationCountry];
  }
}
