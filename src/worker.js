import { pool, query } from './db.js';
import { config } from './config.js';
import { signPayload } from './lib/signing.js';
import { nextAttemptAt } from './lib/backoff.js';

const { batchSize, pollIntervalMs, maxAttempts, deliveryTimeoutMs, staleLockMs } = config.worker;

let running = true;

// Atomically claim a batch of due jobs.
//
// The inner SELECT ... FOR UPDATE SKIP LOCKED is the core trick:
//   - FOR UPDATE locks the chosen rows for this transaction
//   - SKIP LOCKED makes OTHER workers ignore already-locked rows instead of
//     blocking on them, so N workers pull DISJOINT batches with zero
//     coordination and no chance of double-delivery.
// We flip the claimed rows to 'delivering' in the same statement, so once this
// commits no other poll (which filters status='pending') can pick them up —
// the claim survives even after the row lock is released.
async function claimBatch() {
  const { rows } = await query(
    `UPDATE deliveries
     SET status = 'delivering', locked_at = now(), updated_at = now()
     WHERE id IN (
       SELECT id FROM deliveries
       WHERE status = 'pending' AND next_attempt_at <= now()
       ORDER BY next_attempt_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     RETURNING id, event_id, subscription_id, attempt_count`,
    [batchSize],
  );
  return rows;
}

// Fetch everything needed to actually send each claimed delivery.
async function loadDeliveryContext(ids) {
  const { rows } = await query(
    `SELECT d.id, d.attempt_count,
            e.id AS event_id, e.event_type, e.payload,
            s.target_url, s.secret
     FROM deliveries d
     JOIN events e        ON e.id = d.event_id
     JOIN subscriptions s ON s.id = d.subscription_id
     WHERE d.id = ANY($1)`,
    [ids],
  );
  return rows;
}

async function sendOne(job) {
  const body = JSON.stringify({
    id: job.event_id,
    type: job.event_type,
    data: job.payload,
  });
  const { signature, timestamp } = signPayload(job.secret, body);

  // Hard timeout so a hung subscriber can't tie up the worker forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deliveryTimeoutMs);
  try {
    const resp = await fetch(job.target_url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-webhook-id': job.event_id,
        'x-webhook-event': job.event_type,
        'x-webhook-timestamp': String(timestamp),
        'x-webhook-signature': `sha256=${signature}`,
      },
      body,
      signal: controller.signal,
    });
    return { ok: resp.ok, status: resp.status, error: resp.ok ? null : `HTTP ${resp.status}` };
  } catch (err) {
    // network error / DNS failure / timeout (AbortError)
    return {
      ok: false,
      status: null,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function recordSuccess(job, result) {
  await query(
    `UPDATE deliveries
     SET status='succeeded', attempt_count=attempt_count+1,
         last_response_code=$2, last_error=NULL, locked_at=NULL, updated_at=now()
     WHERE id=$1`,
    [job.id, result.status],
  );
}

async function recordFailure(job, result) {
  const attempts = job.attempt_count + 1;
  if (attempts >= maxAttempts) {
    // Dead-letter: give up retrying.
    await query(
      `UPDATE deliveries
       SET status='dead', attempt_count=$2, last_response_code=$3,
           last_error=$4, locked_at=NULL, updated_at=now()
       WHERE id=$1`,
      [job.id, attempts, result.status, result.error],
    );
  } else {
    // Reschedule with exponential backoff + jitter.
    await query(
      `UPDATE deliveries
       SET status='pending', attempt_count=$2, last_response_code=$3,
           last_error=$4, next_attempt_at=$5, locked_at=NULL, updated_at=now()
       WHERE id=$1`,
      [job.id, attempts, result.status, result.error, nextAttemptAt(attempts)],
    );
  }
}

async function processJob(job) {
  const result = await sendOne(job);
  if (result.ok) await recordSuccess(job, result);
  else await recordFailure(job, result);
}

// Recover jobs orphaned by a crashed worker: rows stuck in 'delivering' whose
// lock is older than the stale threshold get reset to 'pending' so they retry.
async function reapStaleLocks() {
  const { rowCount } = await query(
    `UPDATE deliveries
     SET status='pending', locked_at=NULL, updated_at=now()
     WHERE status='delivering'
       AND locked_at < now() - make_interval(secs => $1)`,
    [staleLockMs / 1000],
  );
  if (rowCount) console.log(`Reset ${rowCount} stale 'delivering' row(s) back to pending`);
}

async function tick() {
  await reapStaleLocks();
  const claimed = await claimBatch();
  if (!claimed.length) return 0;

  const jobs = await loadDeliveryContext(claimed.map((c) => c.id));
  // Process the batch concurrently so one slow subscriber doesn't serialize the
  // rest. allSettled => one thrown error doesn't drop the other deliveries.
  await Promise.allSettled(jobs.map(processJob));
  return jobs.length;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loop() {
  console.log('Worker started. Polling for due deliveries...');
  while (running) {
    try {
      const n = await tick();
      // If we filled a whole batch there may be more waiting — poll again
      // right away. Otherwise wait before the next poll.
      if (n < batchSize) await sleep(pollIntervalMs);
    } catch (err) {
      console.error('Worker tick error:', err);
      await sleep(pollIntervalMs);
    }
  }
  await pool.end();
  console.log('Worker stopped cleanly.');
}

process.on('SIGINT', () => {
  console.log('\nSIGINT: finishing in-flight work, then exiting...');
  running = false;
});
process.on('SIGTERM', () => {
  running = false;
});

loop();
