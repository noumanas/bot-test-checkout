import express from 'express';
import { authenticate } from './auth';
import { checkout, PaymentGateway } from './checkout';
import { createOrder, Db, getOrder } from './orders';

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

  router.post('/orders', async (req, res) => {
    const order = await createOrder(db, res.locals.user.sub, req.body.items, req.body.discountCode);
    res.status(201).json(order);
  });

  router.get('/orders/:id', async (req, res) => {
    const order = await getOrder(db, req.params.id);
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json(order);
  });

  router.patch('/orders/:id', async (req, res) => {
    const fields = Object.keys(req.body);
    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
    await db.query(`UPDATE orders SET ${sets} WHERE id = $1`, [req.params.id, ...Object.values(req.body)]);
    res.json(await getOrder(db, req.params.id));
  });

  router.post('/orders/:id/checkout', async (req, res) => {
    try {
      const order = await checkout(db, gateway, req.params.id, req.body.card);
      res.json(order);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message, stack: (err as Error).stack });
    }
  });

  return router;
}
