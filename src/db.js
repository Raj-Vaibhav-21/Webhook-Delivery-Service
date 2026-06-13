import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10, /* The most important number in this file. 
             It's the ceiling on concurrent connections this process will ever hold. */
});

pool.on('error', (err) => {
  console.error('Unexpected idle client error', err);
});
/* A dropped idle connection is a routine, expected event, and it must not take down our server. 
We log it and move on; the pool quietly discards the dead connection 
and opens a fresh one next time it's needed. */

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
/* Why didn't transaction use pool.query here ?
   It is because a transaction is multiple statements that must run on the same physical connection. 
   BEGIN, then your INSERTs, then COMMIT - these are stateful; the BEGIN "opens" a transaction on that one connection. 
   If you fired them through pool.query, each call might land on a different connection from the pool: 
   BEGIN on connection A, INSERT on connection B (which knows nothing about A's open transaction), COMMIT on connection C. 
   It won't make any sense. */ 
