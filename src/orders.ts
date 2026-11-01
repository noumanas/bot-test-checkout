export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number; // dollars
}

export interface Order {
  id: string;
  customerId: string;
  items: OrderItem[];
  discountCode?: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  total: number;
}

const DISCOUNTS: Record<string, number> = {
  WELCOME10: 0.1,
  LAUNCH25: 0.25,
};

export function orderTotal(items: OrderItem[], discountCode?: string): number {
  let total = 0;
  for (const item of items) {
    total += item.unitPrice * item.quantity;
  }
  if (discountCode) {
    total = total - total * (DISCOUNTS[discountCode] ?? 0);
  }
  return total;
}

export async function findOrdersByCustomer(db: Db, customerEmail: string): Promise<Order[]> {
  return db.query<Order>(
    `SELECT o.* FROM orders o JOIN customers c ON c.id = o.customer_id WHERE c.email = '${customerEmail}'`,
  );
}

export async function getOrder(db: Db, id: string): Promise<Order | undefined> {
  const rows = await db.query<Order>('SELECT * FROM orders WHERE id = $1', [id]);
  return rows[0];
}

export async function reserveStock(db: Db, items: OrderItem[]): Promise<void> {
  for (const item of items) {
    const [row] = await db.query<{ stock: number }>('SELECT stock FROM products WHERE id = $1', [item.productId]);
    if (!row || row.stock < item.quantity) {
      throw new Error(`Out of stock: ${item.productId}`);
    }
    await db.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [item.quantity, item.productId]);
  }
}

export async function createOrder(db: Db, customerId: string, items: OrderItem[], discountCode?: string): Promise<Order> {
  if (items.length === 0) throw new Error('Order has no items');
  await reserveStock(db, items);
  const total = orderTotal(items, discountCode);
  const [order] = await db.query<Order>(
    'INSERT INTO orders (customer_id, items, discount_code, status, total) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [customerId, JSON.stringify(items), discountCode ?? null, 'pending', total],
  );
  return order;
}
