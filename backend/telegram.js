// Telegram daily energy report bot.
// Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in docker-compose to activate.
//
// How to get your chat ID:
//   1. Create a bot via @BotFather → copy the token
//   2. Send any message to your bot
//   3. Visit https://api.telegram.org/bot<TOKEN>/getUpdates → find "chat":{"id": ...}

// ─── Price generation (mirrors src/api/elia.js) ───────────────────────────
function generatePricesForDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
  const seed = d.getFullYear() * 1000 + (d.getMonth() + 1) * 31 + d.getDate();
  const pseudo = h => ((Math.sin(h * 2.7 + seed) + 1) / 2) * 0.018 - 0.009;

  return Array.from({ length: 24 }, (_, h) => {
    const solar   = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
    const morning = Math.exp(-0.5 * ((h - 8) ** 2) / 3.5);
    const evening = Math.exp(-0.5 * ((h - 19) ** 2) / 2.5);
    const base    = isWeekend ? 0.085 : 0.105;
    const price   = base + morning * 0.10 + evening * 0.16 - solar * 0.05 + pseudo(h);
    return Math.round(Math.max(0.03, Math.min(0.40, price)) * 10000) / 10000;
  });
}

async function getTodayPrices(dateStr) {
  try {
    const url = 'https://opendata.elia.be/api/explore/v2.1/catalog/datasets/ods134/records?limit=200&order_by=datetime+desc';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const byHour = {};
    for (const r of (data.results || [])) {
      const dt  = new Date(r.datetime);
      const day = dt.toLocaleDateString('en-CA');
      if (day !== dateStr) continue;
      const h = dt.getHours();
      const p = r.imbalanceprice ?? r.marginalincrementalprice;
      if (p != null) { byHour[h] = byHour[h] ?? []; byHour[h].push(p / 1000); }
    }

    if (Object.keys(byHour).length < 6) throw new Error('Too few hours');

    const generated = generatePricesForDate(dateStr);
    return generated.map((gen, h) => {
      const bucket = byHour[h];
      if (bucket?.length) return bucket.reduce((a, b) => a + b, 0) / bucket.length;
      return gen;
    });
  } catch {
    return generatePricesForDate(dateStr);
  }
}

// ─── Chart image via QuickChart.io (free, no auth) ───────────────────────
function buildChartUrl(prices, dateLabel) {
  const sorted = [...prices].sort((a, b) => a - b);
  const cheapT = sorted[Math.floor(sorted.length * 0.28)];
  const expT   = sorted[Math.floor(sorted.length * 0.78)];

  const colors = prices.map(p =>
    p <= cheapT ? '#4ade80' : p >= expT ? '#f97316' : '#94a3b8'
  );

  const config = {
    type: 'bar',
    data: {
      labels: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
      datasets: [{
        data: prices.map(p => +p.toFixed(4)),
        backgroundColor: colors,
        borderRadius: 3,
      }],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `⚡ Energy prices — ${dateLabel}`,
          color: '#f1f5f9',
          font: { size: 14, weight: 'bold' },
          padding: { bottom: 10 },
        },
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.06)' },
          title: { display: true, text: 'Hour of day', color: '#64748b', font: { size: 11 } },
        },
        y: {
          ticks: { color: '#94a3b8', font: { size: 10 }, callback: 'function(v){ return "€"+v.toFixed(2); }' },
          grid: { color: 'rgba(255,255,255,0.06)' },
          title: { display: true, text: '€ / kWh', color: '#64748b', font: { size: 11 } },
        },
      },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(config));
  return `https://quickchart.io/chart?c=${encoded}&backgroundColor=%230f172a&width=640&height=320`;
}

// ─── Savings tips ─────────────────────────────────────────────────────────
function buildTips(prices) {
  const indexed = prices.map((p, h) => ({ h, p }));
  const sorted  = [...indexed].sort((a, b) => a.p - b.p);
  const avg     = prices.reduce((a, b) => a + b, 0) / prices.length;
  const cheapest = sorted[0];
  const priciest = sorted[sorted.length - 1];

  const cheapHours = sorted.slice(0, 5).map(x => `${String(x.h).padStart(2, '0')}:00`);
  const saving     = Math.round((1 - cheapest.p / priciest.p) * 100);

  const LOADS = [
    { name: 'EV charger (11 kW)',   kWh: 11 * 8   },
    { name: 'Dishwasher',           kWh: 1.8 * 1.5 },
    { name: 'Washing machine',      kWh: 2.0 * 1   },
    { name: 'Tumble dryer',         kWh: 2.5 * 1   },
    { name: 'Electric oven',        kWh: 3.0 * 0.75 },
  ];

  const currentHour = new Date().getHours();
  const tips = LOADS.map(l => ({
    ...l,
    savingEur: l.kWh * (prices[currentHour] - cheapest.p),
  })).filter(t => t.savingEur > 0.005)
    .sort((a, b) => b.savingEur - a.savingEur);

  return { cheapHours, cheapest, priciest, avg, saving, tips };
}

// ─── Telegram API call ────────────────────────────────────────────────────
async function telegramPost(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json;
}

// ─── Main report ──────────────────────────────────────────────────────────
export async function sendDailyEnergyReport(token, chatId) {
  const now       = new Date();
  const dateStr   = now.toLocaleDateString('en-CA');
  const dateLabel = now.toLocaleDateString('en-BE', { weekday: 'long', day: 'numeric', month: 'long' });

  const prices  = await getTodayPrices(dateStr);
  const { cheapHours, cheapest, priciest, avg, saving, tips } = buildTips(prices);
  const chartUrl = buildChartUrl(prices, dateLabel);

  const fmtH = h => `${String(h).padStart(2, '0')}:00`;
  const fmtP = p => `€${p.toFixed(3)}`;

  let caption = `<b>⚡ Ohm my grid — ${dateLabel}</b>\n\n`;
  caption += `🟢 Cheapest: <b>${fmtH(cheapest.h)}</b> (${fmtP(cheapest.p)}/kWh)\n`;
  caption += `🔴 Most expensive: <b>${fmtH(priciest.h)}</b> (${fmtP(priciest.p)}/kWh)\n`;
  caption += `📊 Daily average: <b>${fmtP(avg)}/kWh</b>\n`;
  caption += `💰 Peak vs cheapest: <b>${saving}% more expensive</b>\n\n`;

  caption += `🕐 <b>Best hours to run appliances:</b>\n`;
  caption += cheapHours.map(h => `  • ${h}`).join('\n');

  if (tips.length) {
    caption += `\n\n💡 <b>Shift today and save:</b>\n`;
    for (const t of tips.slice(0, 3)) {
      caption += `  • ${t.name} → save <b>${fmtP(t.savingEur)}</b> by running at ${fmtH(cheapest.h)}\n`;
    }
  }

  caption += `\n<i>Source: Elia Open Data · Ohm my grid</i>`;

  await telegramPost(token, 'sendPhoto', {
    chat_id: chatId,
    photo: chartUrl,
    caption,
    parse_mode: 'HTML',
  });

  console.log(`[Telegram] Daily report sent for ${dateStr}`);
}

// ─── Scheduler (no node-cron needed) ─────────────────────────────────────
function msUntilNext7am() {
  const now    = new Date();
  const target = new Date();
  target.setUTCHours(5, 0, 0, 0); // 07:00 Brussels CEST = 05:00 UTC
  if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
  return target - now;
}

// Send reports for the last N days (for testing / catch-up)
export async function sendLastNDaysReports(token, chatId, n = 7) {
  const results = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr   = d.toLocaleDateString('en-CA');
    const dateLabel = d.toLocaleDateString('en-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    try {
      const prices = await getTodayPrices(dateStr);
      const { cheapHours, cheapest, priciest, avg, saving, tips } = buildTips(prices);
      const chartUrl = buildChartUrl(prices, dateLabel);

      const fmtH = h => `${String(h).padStart(2, '0')}:00`;
      const fmtP = p => `€${p.toFixed(3)}`;

      let caption = `<b>⚡ Ohm my grid — ${dateLabel}</b>\n\n`;
      caption += `🟢 Cheapest: <b>${fmtH(cheapest.h)}</b> (${fmtP(cheapest.p)}/kWh)\n`;
      caption += `🔴 Most expensive: <b>${fmtH(priciest.h)}</b> (${fmtP(priciest.p)}/kWh)\n`;
      caption += `📊 Daily average: <b>${fmtP(avg)}/kWh</b>\n`;
      caption += `💰 Peak vs cheapest: <b>${saving}% more expensive</b>\n\n`;
      caption += `🕐 <b>Best hours to run appliances:</b>\n`;
      caption += cheapHours.map(h => `  • ${h}`).join('\n');
      if (tips.length) {
        caption += `\n\n💡 <b>Shift today and save:</b>\n`;
        for (const t of tips.slice(0, 3)) {
          caption += `  • ${t.name} → save <b>${fmtP(t.savingEur)}</b> at ${fmtH(cheapest.h)}\n`;
        }
      }
      caption += `\n<i>Source: Elia Open Data · Ohm my grid</i>`;

      await telegramPost(token, 'sendPhoto', {
        chat_id: chatId,
        photo: chartUrl,
        caption,
        parse_mode: 'HTML',
      });
      results.push({ date: dateStr, ok: true });
      console.log(`[Telegram] Sent report for ${dateStr}`);
      // Small delay between messages to avoid Telegram rate limits
      if (i > 0) await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.warn(`[Telegram] Report for ${dateStr} failed:`, e.message);
      results.push({ date: dateStr, ok: false, error: e.message });
    }
  }
  return results;
}

// ─── Command polling ──────────────────────────────────────────────────────
async function pollCommands(token, chatId) {
  let offset = 0;

  // Lazy import to avoid circular dependency
  async function getCachedTips() {
    const { getTips } = await import('./tipsStore.js');
    return getTips();
  }

  async function tick() {
    try {
      const res  = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}`);
      const data = await res.json();

      for (const update of (data.result || [])) {
        offset = update.update_id + 1;
        const text = update.message?.text?.trim().toLowerCase();
        const from = update.message?.chat?.id;
        if (!text || !from) continue;

        if (text === '/today' || text === '/start') {
          await sendDailyEnergyReport(token, from);

        } else if (text === '/week') {
          await telegramPost(token, 'sendMessage', { chat_id: from, text: '📅 Sending last 7 days of energy prices…' });
          await sendLastNDaysReports(token, from, 7);

        } else if (text === '/tips') {
          const tips = await getCachedTips();
          if (!tips.length) {
            await telegramPost(token, 'sendMessage', {
              chat_id: from,
              text: '💡 No tips available yet — open the app, go to <b>Power Consumption</b> and wait a few seconds for the predictions to load.',
              parse_mode: 'HTML',
            });
          } else {
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

            let msg = `<b>💡 Your Smart Predictions for Today</b>\n\n`;
            for (const tip of tips) {
              const emoji = EMOJIS[tip.appId] ?? '⚡';
              const label = LABELS[tip.appId] ?? tip.appId;
              const fromH = `${String(tip.startHour).padStart(2,'0')}:00`;
              const toH   = `${String(tip.optimalHour).padStart(2,'0')}:00`;
              const badge = tip.confidence === null ? '⚡ biggest saver' : `${tip.confidence}% confident`;
              msg += `${emoji} <b>${label}</b>\n`;
              msg += `  Shift ${fromH} → ${toH}, save <b>€${Number(tip.saving).toFixed(2)}</b>\n`;
              msg += `  <i>${badge}</i>\n\n`;
            }
            msg += `<i>Ohm my grid · Power Consumption</i>`;
            await telegramPost(token, 'sendMessage', { chat_id: from, text: msg, parse_mode: 'HTML' });
          }

        } else if (text === '/help') {
          await telegramPost(token, 'sendMessage', {
            chat_id: from,
            parse_mode: 'HTML',
            text: `<b>⚡ Ohm my grid — commands</b>\n\n/today — today's prices &amp; tips\n/week — last 7 days of reports\n/tips — your smart appliance predictions\n/help — show this message\n\n<i>Daily report sent automatically at 07:00 CEST</i>`,
          });
        }
      }
    } catch (e) {
      console.warn('[Telegram] Poll error:', e.message);
    }

    setTimeout(tick, 1000);
  }

  tick();
  console.log('[Telegram] Listening for /today /week /tips /help commands');
}

export function initTelegramBot(token, chatId) {
  if (!token || !chatId) {
    console.log('[Telegram] Not configured — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID to enable');
    return;
  }

  // Send today's report immediately on startup
  sendDailyEnergyReport(token, chatId)
    .catch(e => console.warn('[Telegram] Startup report failed:', e.message));

  // Schedule daily at 07:00 CEST
  function schedule() {
    const delay = msUntilNext7am();
    console.log(`[Telegram] Next scheduled report in ${Math.round(delay / 60000)} min`);
    setTimeout(async () => {
      try { await sendDailyEnergyReport(token, chatId); }
      catch (e) { console.warn('[Telegram] Scheduled report failed:', e.message); }
      schedule();
    }, delay);
  }

  schedule();
  pollCommands(token, chatId);
  console.log('[Telegram] Bot initialized — startup report queued, daily at 07:00 CEST');
}
