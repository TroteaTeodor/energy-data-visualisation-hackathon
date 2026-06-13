import express from 'express';
import { waitForDb } from './db.js';
import householdsRouter from './routes/households.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use('/api/households', householdsRouter);

app.get('/api/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;

await waitForDb();
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
