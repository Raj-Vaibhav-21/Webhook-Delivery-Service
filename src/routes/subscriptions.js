import express from 'express';
import crypto from 'node:crypto';
import { query } from '../db.js';
import { createSubscriptionSchema } from '../validation.js';

export const subscriptionsRouter = express.Router();

// Create a subscription. The secret is returned ONCE here, at creation time.
subscriptionsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation failed', details: parsed.error.issues });
    }
    const { target_url, event_type } = parsed.data;
    const secret = parsed.data.secret ?? crypto.randomBytes(32).toString('hex');

    const { rows } = await query(
      `INSERT INTO subscriptions (target_url, event_type, secret)
       VALUES ($1, $2, $3)
       RETURNING id, target_url, event_type, secret, is_active, created_at`,
      [target_url, event_type, secret],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    next(err);
  }
});

subscriptionsRouter.get('/', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, target_url, event_type, is_active, created_at
       FROM subscriptions
       ORDER BY created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

subscriptionsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, target_url, event_type, is_active, created_at
       FROM subscriptions
       WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

subscriptionsRouter.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await query('DELETE FROM subscriptions WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
