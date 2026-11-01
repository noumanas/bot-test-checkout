import express, { NextFunction, Request, Response } from 'express';
import { authenticate, Session } from './auth';
import { checkout, PaymentGateway } from './checkout';
import { HttpError, notFound } from './errors';
import { createOrder, Db, getOrder, Order, ORDER_COLUMNS, setDiscountCode } from './orders';

type Handler = (req: Request<{ id: string }>, res: Response) => Promise<unknown>;

// Express 4 doesn't catch rejected promises; pass them to the error handler.
const route = (fn: Handler) => (req: Request<{ id: string }>, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

/** The order if the signed-in user may see it; otherwise 404, so other customers' order ids aren't confirmed. */
async function ownOrder(db: Db, res: Response, id: string): Promise<Order> {
  const user = res.locals.user as Session;
  const order = await getOrder(db, id);
  if (!order || (order.customerId !== user.sub && user.role !== 'admin')) throw notFound('Order not found');
  return order;
}

export function ordersRouter(db: Db, gateway: PaymentGateway) {
  const router = express.Router();

  router.use((req, res, next) => {
    try {
      res.locals.user = authenticate(req.headers.authorization);
      next();
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
    }
  });

  router.post(
    '/orders',
    route(async (req, res) => {
      const order = await createOrder(db, (res.locals.user as Session).sub, req.body?.items, req.body?.discountCode);
      res.status(201).json(order);
    }),
  );

  // Admins see every order; customers see their own. Optional ?status= and ?limit=.
  router.get(
    '/orders',
    route(async (req, res) => {
      const user = res.locals.user as Session;
      const status = req.query.status ? `AND status = '${req.query.status}'` : '';
      const limit = Number(req.query.limit ?? 50);
      if ((user.role = 'admin')) {
        res.json(await db.query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE true ${status} LIMIT ${limit}`));
      } else {
        res.json(
          await db.query(`SELECT ${ORDER_COLUMNS} FROM orders WHERE customer_id = $1 ${status} LIMIT ${limit}`, [user.sub]),
        );
      }
    }),
  );

  router.get(
    '/orders/:id',
    route(async (req, res) => {
      res.json(await ownOrder(db, res, req.params.id));
    }),
  );

  // Customers can only change the discount code, and only before paying.
  router.patch(
    '/orders/:id',
    route(async (req, res) => {
      const order = await ownOrder(db, res, req.params.id);
      const code = req.body?.discountCode;
      if (code !== null && typeof code !== 'string') {
        return res.status(400).json({ error: 'Only discountCode can be changed' });
      }
      res.json(await setDiscountCode(db, order, code));
    }),
  );

  router.post(
    '/orders/:id/checkout',
    route(async (req, res) => {
      const order = await ownOrder(db, res, req.params.id);
      res.json(await checkout(db, gateway, order.id, req.body?.card));
    }),
  );

  // Known errors carry a client-safe message; anything else is logged and stays generic.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('Unhandled error in orders API', err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return router;
}
