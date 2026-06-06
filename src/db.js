import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

pool.on('error', (err) => {
  // A pool-level error (e.g. an idle client dropped by the server) should be
  // logged, not crash the whole process.
  console.error('Unexpected idle client error', err);
});

export function query(text, params) {
  return pool.query(text, params);
}

// Run a function inside a transaction, with automatic COMMIT/ROLLBACK.
// Usage: await withTransaction(async (client) => { ... });
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
