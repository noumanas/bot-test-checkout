import { HttpError } from '../src/errors';
import { MAX_QUANTITY, OrderItem, orderTotalCents, validateItems } from '../src/orders';

const rejects = (fn: () => unknown, message: RegExp) => {
  expect(fn).toThrow(HttpError);
  expect(fn).toThrow(message);
};

describe('validateItems', () => {
  it('accepts valid items', () => {
    expect(validateItems([{ productId: 'p1', quantity: 2 }, { productId: 'p2', quantity: 1 }])).toEqual([
      { productId: 'p1', quantity: 2 },
      { productId: 'p2', quantity: 1 },
    ]);
  });

  it('rejects a missing or empty item list', () => {
    rejects(() => validateItems([]), /no items/);
    rejects(() => validateItems(undefined), /no items/);
    rejects(() => validateItems('p1'), /no items/);
  });

  it('rejects a missing productId', () => {
    rejects(() => validateItems([{ quantity: 1 }]), /productId/);
    rejects(() => validateItems([null]), /productId/);
  });

  it.each([0, -1, 1.5, MAX_QUANTITY + 1, '2', NaN])('rejects quantity %p', (quantity) => {
    rejects(() => validateItems([{ productId: 'p1', quantity }]), /Quantity/);
  });

  it('merges lines for the same product', () => {
    expect(
      validateItems([
        { productId: 'p1', quantity: 2 },
        { productId: 'p2', quantity: 1 },
        { productId: 'p1', quantity: 3 },
      ]),
    ).toEqual([
      { productId: 'p1', quantity: 5 },
      { productId: 'p2', quantity: 1 },
    ]);
  });

  it('applies the per-product limit to the combined quantity', () => {
    const half = Math.ceil(MAX_QUANTITY / 2) + 1;
    rejects(
      () =>
        validateItems([
          { productId: 'p1', quantity: half },
          { productId: 'p1', quantity: half },
        ]),
      /At most/,
    );
  });
});

describe('orderTotalCents', () => {
  const items: OrderItem[] = [
    { productId: 'p1', quantity: 3, unitPriceCents: 1999 },
    { productId: 'p2', quantity: 1, unitPriceCents: 500 },
  ];

  it('sums integer cents with no discount', () => {
    expect(orderTotalCents(items)).toBe(6497);
    expect(orderTotalCents(items, null)).toBe(6497);
    expect(orderTotalCents(items, '')).toBe(6497);
  });

  it('applies WELCOME10 and LAUNCH25, rounding the discount to the nearest cent', () => {
    expect(orderTotalCents(items, 'WELCOME10')).toBe(6497 - 650); // 649.7 → 650
    expect(orderTotalCents(items, 'LAUNCH25')).toBe(6497 - 1624); // 1624.25 → 1624
  });

  it('matches codes case-insensitively and ignores surrounding spaces', () => {
    expect(orderTotalCents(items, '  welcome10 ')).toBe(orderTotalCents(items, 'WELCOME10'));
  });

  it('rejects an unknown discount code', () => {
    rejects(() => orderTotalCents(items, 'FREEMONEY'), /Unknown discount code/);
  });

  it('is zero for an empty list', () => {
    expect(orderTotalCents([], 'LAUNCH25')).toBe(0);
  });
});
