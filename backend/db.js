import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function waitForDb(retries = 15, delayMs = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1');
      console.log('Database ready');
      return;
    } catch {
      console.log(`Waiting for database… (${i + 1}/${retries})`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error('Could not connect to database after retries');
}
