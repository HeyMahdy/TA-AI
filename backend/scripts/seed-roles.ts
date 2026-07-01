import { pool } from '../src/lib/database.js';

async function main(): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `INSERT INTO public.roles (name) VALUES ('student'), ('teacher'), ('admin')
       ON CONFLICT (name) DO NOTHING`,
    );
    const inserted = res.rowCount ?? 0;
    console.log(`seed-roles: completed (rows affected: ${String(inserted)})`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
