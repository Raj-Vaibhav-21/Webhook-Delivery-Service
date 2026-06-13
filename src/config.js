import 'dotenv/config';

function required(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env var: ${name}. Copy .env.example to .env and fill it in.`);
  }
  return v;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT ?? 3000),/* This has a sensible default 
                                    Read it with process.env.PORT 
                                    if that's null or undefined, use 3000. */ 
  apiKey: required('API_KEY'),

  worker: {
    pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000),
    batchSize: Number(process.env.WORKER_BATCH_SIZE ?? 10),
    maxAttempts: Number(process.env.MAX_ATTEMPTS ?? 6),
    deliveryTimeoutMs: Number(process.env.DELIVERY_TIMEOUT_MS ?? 5000),
    staleLockMs: Number(process.env.WORKER_STALE_LOCK_MS ?? 60000),
  },
};
