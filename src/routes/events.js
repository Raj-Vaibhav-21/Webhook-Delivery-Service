import express from 'express';
import crypto from 'node:crypto';
import { query, withTransaction } from '../db.js';
import { ingestEventSchema } from '../validation.js';

export const eventsRouter = express.Router();

// POST /events — INGEST.
// Persist the event + fan out queue rows, then return 202 immediately.
// We NEVER make the outbound HTTP delivery here; that's the worker's job.
// This decoupling is the whole point: ingest latency stays in single-digit ms
// no matter how slow the subscriber endpoints are.
eventsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = ingestEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'validation failed', details: parsed.error.issues });
    }
    const { event_type, payload } = parsed.data;

    // Idempotency-Key header dedupes client retries. If absent, generate one,
    // so each request is then treated as unique (no dedupe).
    const idempotencyKey = req.get('idempotency-key') ?? crypto.randomUUID();

    const result = await withTransaction(async (client) => {
      // Insert the event. ON CONFLICT => this key was already ingested.
      const insertEvent = await client.query(
        `INSERT INTO events (idempotency_key, event_type, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [idempotencyKey, event_type, payload],
      );

      if (insertEvent.rows.length === 0) {
        // Duplicate: return the existing event id, create NO new deliveries.
        const existing = await client.query(
          'SELECT id FROM events WHERE idempotency_key = $1',
          [idempotencyKey],
        );
        return { eventId: existing.rows[0].id, duplicate: true };
      }

      const eventId = insertEvent.rows[0].id;

      // Fan out: one delivery row per active subscription for this event_type.
      // A single INSERT ... SELECT keeps ingest fast regardless of how many
      // subscribers match.
      await client.query(
        `INSERT INTO deliveries (event_id, subscription_id)
         SELECT $1, s.id
         FROM subscriptions s
         WHERE s.event_type = $2 AND s.is_active
         ON CONFLICT (event_id, subscription_id) DO NOTHING`,
        [eventId, event_type],
      );

      return { eventId, duplicate: false };
    });

    res.status(202).json({
      event_id: result.eventId,
      status: 'accepted',
      duplicate: result.duplicate,
    });
  } catch (err) {
    next(err);
  }
});

// GET /events/:id/deliveries — "what happened to this event?"
eventsRouter.get('/:id/deliveries', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT d.id, d.subscription_id, s.target_url, d.status, d.attempt_count,
              d.next_attempt_at, d.last_response_code, d.last_error,
              d.created_at, d.updated_at
       FROM deliveries d
       JOIN subscriptions s ON s.id = d.subscription_id
       WHERE d.event_id = $1
       ORDER BY d.created_at`,
      [req.params.id],
    );
    res.json({ event_id: req.params.id, deliveries: rows });
  } catch (err) {
    next(err);
  }
});

// GET /events/:id — fetch the event itself (handy for debugging).
eventsRouter.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, idempotency_key, event_type, payload, received_at
       FROM events
       WHERE id = $1`,
      [req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});
