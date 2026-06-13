import express from 'express';
import { waitForDb, pool } from './db.js';
import householdsRouter from './routes/households.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use('/api/households', householdsRouter);

app.get('/api/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;

await waitForDb();

// Run migrations that may not be in init.sql yet (safe to re-run)
await pool.query(`
  ALTER TABLE consumption_days ADD COLUMN IF NOT EXISTS price_series NUMERIC[];
`);
console.log('Migrations applied');

app.listen(PORT, () => console.log(`API listening on :${PORT}`));
