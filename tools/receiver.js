// Standalone test receiver — NOT part of the service itself.
// Run it to have something to deliver TO. It verifies the HMAC signature,
// logs each delivery, and can simulate failures to exercise your retry logic.
//
//   node tools/receiver.js
//     - listens on :4000
//     - POST /hook            -> 200 (success)
//     - POST /hook?fail=1     -> 500 (forces a retry)
//     - POST /hook?slow=8000  -> waits 8s (forces a timeout if > DELIVERY_TIMEOUT_MS)
//
// To check signatures, run it with the subscription's secret:
//   RECEIVER_SECRET=<the secret from POST /subscriptions> node tools/receiver.js

import express from 'express';
import { verifySignature } from '../src/lib/signing.js';

const PORT = Number(process.env.RECEIVER_PORT ?? 4000);
const SECRET = process.env.RECEIVER_SECRET ?? null;

const app = express();
// We need the RAW request body to verify the signature — re-parsing and
// re-serializing JSON could reorder keys and break the HMAC. So capture the
// body as plain text exactly as it arrived.
app.use(express.text({ type: '*/*' }));

app.post('/hook', async (req, res) => {
  const sig = (req.get('x-webhook-signature') ?? '').replace(/^sha256=/, '');
  const ts = req.get('x-webhook-timestamp');

  let verified = 'skipped (set RECEIVER_SECRET to verify)';
  if (SECRET) {
    verified = verifySignature(SECRET, req.body, Number(ts), sig) ? 'VALID' : 'INVALID';
  }
  console.log(`[recv] event=${req.get('x-webhook-event')} sig=${verified} body=${req.body}`);

  const slow = Number(req.query.slow ?? 0);
  if (slow) await new Promise((r) => setTimeout(r, slow));

  if (req.query.fail) return res.status(500).json({ error: 'simulated failure' });
  res.status(200).json({ received: true });
});

app.listen(PORT, () => console.log(`Test receiver on http://localhost:${PORT}/hook`));
