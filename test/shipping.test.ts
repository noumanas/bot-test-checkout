import { HttpError } from '../src/errors';
import { FREE_SHIPPING_THRESHOLD_CENTS, Parcel, shippingCents } from '../src/shipping';

const parcel: Parcel = { weightGrams: 1500, destinationCountry: 'US', postalCode: '94105' };
const UNDER = FREE_SHIPPING_THRESHOLD_CENTS - 1;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('shippingCents', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env.CARRIER_API_KEY = 'test-key';
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.CARRIER_API_KEY;
    jest.restoreAllMocks();
  });

  it.each([0, -100, NaN, Infinity])('rejects weight %p', async (weightGrams) => {
    await expect(shippingCents({ ...parcel, weightGrams }, UNDER)).rejects.toThrow(HttpError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a country we do not ship to', async () => {
    await expect(shippingCents({ ...parcel, destinationCountry: 'ZZ' }, UNDER)).rejects.toThrow(/don't ship to ZZ/);
    // Inherited object keys are not countries.
    await expect(shippingCents({ ...parcel, destinationCountry: 'constructor' }, UNDER)).rejects.toThrow(HttpError);
  });

  it('is free at and above the threshold, without calling the carrier', async () => {
    expect(await shippingCents(parcel, FREE_SHIPPING_THRESHOLD_CENTS)).toBe(0);
    expect(await shippingCents(parcel, FREE_SHIPPING_THRESHOLD_CENTS + 1)).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('converts a carrier quote to cents and sends kilograms with the key in a header', async () => {
    fetchMock.mockResolvedValue(json({ rate: 7.455 }));
    expect(await shippingCents({ ...parcel, destinationCountry: 'us' }, UNDER)).toBe(746);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const query = new URL(url).searchParams;
    expect(query.get('weight_kg')).toBe('1.5');
    expect(query.get('country')).toBe('US');
    expect(url).not.toContain('test-key');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('encodes the postal code', async () => {
    fetchMock.mockResolvedValue(json({ rate: 5 }));
    await shippingCents({ ...parcel, destinationCountry: 'GB', postalCode: 'SW1A 1AA&x=1' }, UNDER);
    const query = new URL(fetchMock.mock.calls[0][0] as string).searchParams;
    expect(query.get('postal')).toBe('SW1A 1AA&x=1');
    expect(query.get('x')).toBeNull();
  });

  it.each([
    ['a non-200 response', () => json({ error: 'down' }, 503)],
    ['a missing rate', () => json({})],
    ['a negative rate', () => json({ rate: -1 })],
    ['a non-numeric rate', () => json({ rate: '7.00' })],
  ])('falls back to the flat rate on %s', async (_label, response) => {
    fetchMock.mockResolvedValue(response());
    expect(await shippingCents({ ...parcel, destinationCountry: 'CA' }, UNDER)).toBe(1299);
  });

  it('falls back to the flat rate when the request fails, without logging the key', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await shippingCents(parcel, UNDER)).toBe(599);
    expect(JSON.stringify((console.warn as jest.Mock).mock.calls)).not.toContain('test-key');
  });

  it('uses the flat rate without calling the carrier when no key is configured', async () => {
    delete process.env.CARRIER_API_KEY;
    expect(await shippingCents(parcel, UNDER)).toBe(599);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
