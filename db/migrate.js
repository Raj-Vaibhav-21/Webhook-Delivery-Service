// Minimal forward-only migration runner.
// Applies any .sql file in db/migrations that hasn't run yet, in filename order,
// each inside its own transaction, tracked in a schema_migrations table.
// Intentionally tiny so you can see exactly how migrations work under the hood.
// (Swap for node-pg-migrate later if you want down-migrations.)

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from '../src/db.js';

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, 'migrations');

async function run() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const appliedRes = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRes.rows.map((r) => r.filename));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`Applying ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        count++;
        console.log('ok');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
    console.log(count ? `Done. Applied ${count} migration(s).` : 'Already up to date.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
