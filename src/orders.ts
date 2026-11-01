import { badRequest, conflict } from './errors';

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

/** What a customer asks for. Prices always come from the products table, never the client. */
export interface OrderRequestItem {
  productId: string;
  quantity: number;
}

export interface OrderItem extends OrderRequestItem {
  unitPriceCents: number;
}

export const ORDER_STATUSES = ['pending', 'processing', 'paid', 'failed', 'partially_refunded', 'refunded'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  discountCode: string | null;
  status: OrderStatus;
  totalCents: number;
  refundedCents: number;
}

/** Order columns mapped to `Order` field names, optionally qualified with a table alias. */
const orderColumns = (t = '') =>
  `${t}id, ${t}customer_id AS "customerId", ${t}items, ${t}discount_code AS "discountCode", ${t}status,
  ${t}total_cents AS "totalCents", ${t}refunded_cents AS "refundedCents"`;

export const ORDER_COLUMNS = orderColumns();

const DISCOUNTS: Record<string, number> = {
  WELCOME10: 10,
  LAUNCH25: 25,
};

/** Most of one product a single order may contain. */
export const MAX_QUANTITY = 100;

/**
 * Checks the requested items and merges lines for the same product, so the
 * per-product limit applies to the combined quantity and stock is taken once
 * per product.
 */
export function validateItems(items: unknown): OrderRequestItem[] {
  if (!Array.isArray(items) || items.length === 0) throw badRequest('Order has no items');
  const merged = new Map<string, number>();
  for (const item of items) {
    const { productId, quantity } = (item ?? {}) as Partial<OrderRequestItem>;
    if (typeof productId !== 'string' || !productId) throw badRequest('Each item needs a productId');
    if (!Number.isInteger(quantity) || quantity! < 1 || quantity! > MAX_QUANTITY) {
      throw badRequest(`Quantity must be a whole number from 1 to ${MAX_QUANTITY}`);
    }
    const combined = (merged.get(productId) ?? 0) + quantity!;
    if (combined > MAX_QUANTITY) throw badRequest(`At most ${MAX_QUANTITY} of each product per order`);
    merged.set(productId, combined);
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

/** Total in integer cents. Throws on an unknown discount code rather than silently ignoring it. */
export function orderTotalCents(items: OrderItem[], discountCode?: string | null): number {
  const subtotal = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  if (!discountCode) return subtotal;
  const percentOff = DISCOUNTS[discountCode.trim().toUpperCase()];
  if (percentOff === undefined) throw badRequest('Unknown discount code');
  return subtotal - Math.round((subtotal * percentOff) / 100);
}

export async function findOrdersByCustomer(db: Db, customerEmail: string): Promise<Order[]> {
  return db.query<Order>(
    `SELECT ${orderColumns('o.')}
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.email = $1`,
    [customerEmail],
  );
}

export async function getOrder(db: Db, id: string): Promise<Order | undefined> {
  const rows = await db.query<Order>(`SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1`, [id]);
  return rows[0];
}

/**
 * Takes stock for every item and returns them priced. Each decrement only
 * succeeds if enough stock is left, so concurrent orders can't oversell;
 * run it inside a transaction so a later shortage releases earlier items.
 */
async function reserveStock(tx: Db, items: OrderRequestItem[]): Promise<OrderItem[]> {
  const priced: OrderItem[] = [];
  for (const item of items) {
    const [row] = await tx.query<{ price_cents: number }>(
      'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING price_cents',
      [item.quantity, item.productId],
    );
    if (!row) throw conflict(`Out of stock: ${item.productId}`);
    priced.push({ ...item, unitPriceCents: row.price_cents });
  }
  return priced;
}

export async function createOrder(
  db: Db,
  customerId: string,
  requested: unknown,
  discountCode?: string | null,
): Promise<Order> {
  const items = validateItems(requested);
  return db.transaction(async (tx) => {
    const priced = await reserveStock(tx, items);
    const totalCents = orderTotalCents(priced, discountCode);
    const [order] = await tx.query<Order>(
      `INSERT INTO orders (customer_id, items, discount_code, status, total_cents, refunded_cents)
       VALUES ($1, $2, $3, 'pending', $4, 0) RETURNING ${ORDER_COLUMNS}`,
      [customerId, JSON.stringify(priced), discountCode?.trim().toUpperCase() || null, totalCents],
    );
    return order;
  });
}

/** Applies (or with null, removes) a discount code on an unpaid order and reprices it. */
export async function setDiscountCode(db: Db, order: Order, discountCode: string | null): Promise<Order> {
  if (order.status !== 'pending') throw conflict('Only unpaid orders can be changed');
  const totalCents = orderTotalCents(order.items, discountCode);
  const [updated] = await db.query<Order>(
    `UPDATE orders SET discount_code = $1, total_cents = $2 WHERE id = $3 AND status = 'pending'
     RETURNING ${ORDER_COLUMNS}`,
    [discountCode?.trim().toUpperCase() || null, totalCents, order.id],
  );
  if (!updated) throw conflict('Only unpaid orders can be changed');
  return updated;
}
