import express from 'express';
import { apiKeyAuth } from './middleware/auth.js';
import { subscriptionsRouter } from './routes/subscriptions.js';
import { eventsRouter } from './routes/events.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  /* It parses JSON bytes into a real req.body object so the
     route handlers get structured data instead of a stream. */

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  /*Load balancers and uptime probes need to ping /health thousands of times a 
    day without credentials. By putting it above apiKeyAuth, the request hits this handler,
    gets answered and never reaches the gate. */

  // Everything below requires the API key.
  app.use(apiKeyAuth);
  app.use('/subscriptions', subscriptionsRouter);
  app.use('/events', eventsRouter);

  // 404 fallthrough
  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  /* Central error handler. Maps a couple of common Postgres errors to 4xx
  so a bad UUID or unique clash isn't reported as a 500.
  eslint-disable-next-line no-unused-vars*/
  app.use((err, req, res, next) => {
    if (err.code === '22P02') {
      // invalid text representation (e.g. malformed uuid in the URL)
      return res.status(400).json({ error: 'invalid id format' });
    }
    if (err.code === '23505') {
      // unique_violation
      return res.status(409).json({ error: 'conflict', detail: err.detail });
    }
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
