import express from 'express';
import { waitForDb, pool } from './db.js';
import householdsRouter from './routes/households.js';
import { initTelegramBot } from './telegram.js';
import { getTips, setTips } from './tipsStore.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use('/api/households', householdsRouter);

app.get('/api/health', (_, res) => res.json({ ok: true }));

// Helper: find your Telegram chat ID — visit /api/telegram/updates after messaging the bot
app.get('/api/telegram/updates', async (_, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN not set' });
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const data = await r.json();
    const chats = (data.result || []).map(u => ({
      chat_id: u.message?.chat?.id,
      name: u.message?.chat?.first_name || u.message?.chat?.title,
      username: u.message?.chat?.username,
      text: u.message?.text,
    })).filter(c => c.chat_id);
    res.json({ chats, raw: data.result?.slice(-3) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tips cache — populated by frontend after NILM runs, consumed by /tips command
app.post('/api/tips/cache', (req, res) => {
  setTips(req.body?.tips ?? []);
  res.json({ ok: true, count: getTips().length });
});

app.get('/api/tips/cache', (_, res) => res.json(getTips()));

// Send a single tip to Telegram
app.post('/api/telegram/tip', async (req, res) => {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(400).json({ error: 'Bot not configured' });

  const { tip } = req.body ?? {};
  if (!tip) return res.status(400).json({ error: 'No tip provided' });

  const LABELS = {
    dishwasher: 'Dishwasher', washing_machine: 'Washing machine',
    ev_charger: 'EV charger', dryer: 'Tumble dryer',
    oven: 'Electric oven', hob: 'Electric hob',
    heat_pump: 'Heat pump', microwave: 'Microwave',
  };
  const EMOJIS = {
    dishwasher: '🍽️', washing_machine: '👕', ev_charger: '🔋',
    dryer: '🌀', oven: '🥘', hob: '🍳', heat_pump: '🌡️', microwave: '📡',
  };

  const label    = LABELS[tip.appId] ?? tip.appId;
  const emoji    = EMOJIS[tip.appId] ?? '⚡';
  const fromH    = `${String(tip.startHour).padStart(2,'0')}:00`;
  const toH      = `${String(tip.optimalHour).padStart(2,'0')}:00`;
  const badge    = tip.confidence === null ? '⚡ biggest saver' : `${tip.confidence}% confident`;
  const text     = `${emoji} <b>${label} — Smart Tip</b>\n\n`
    + `Instead of running at <b>${fromH}</b>, shift to <b>${toH}</b>\n`
    + `💰 Save <b>€${Number(tip.saving).toFixed(2)}</b> today\n`
    + `📊 ${badge}\n\n`
    + `<i>Ohm my grid · Power Consumption</i>`;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send today's report now
app.post('/api/telegram/test', async (_, res) => {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(400).json({ error: 'Bot not configured' });
  try {
    const { sendDailyEnergyReport } = await import('./telegram.js');
    await sendDailyEnergyReport(token, chatId);
    res.json({ ok: true, message: 'Report sent!' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Send last 7 days of reports in sequence
app.post('/api/telegram/week', async (_, res) => {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return res.status(400).json({ error: 'Bot not configured' });
  try {
    const { sendLastNDaysReports } = await import('./telegram.js');
    const results = await sendLastNDaysReports(token, chatId, 7);
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;

await waitForDb();

// Run migrations that may not be in init.sql yet (safe to re-run)
await pool.query(`
  ALTER TABLE consumption_days ADD COLUMN IF NOT EXISTS price_series NUMERIC[];
`);
console.log('Migrations applied');

app.listen(PORT, () => console.log(`API listening on :${PORT}`));

// Telegram daily energy report bot (optional — needs env vars)
initTelegramBot(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);
