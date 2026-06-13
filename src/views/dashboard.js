import { FUEL_COLORS } from '../api/elia.js';

let lastMixPct = [];
let lastTotalMw = 0;
let dominantSource = null;
let dominantPct = 0;

export function storeDashboardState(mixPct, totalMw) {
  lastMixPct = mixPct;
  lastTotalMw = totalMw;
  if (mixPct.length) {
    const top = mixPct[0];
    dominantSource = top?.fuel || null;
    dominantPct = top?.pct || 0;
  }
}

// ─── Digital Clock ───
export function initClock() {
  updateClockDisplay();
  setInterval(updateClockDisplay, 1000);
}

function updateClockDisplay() {
  const now = new Date();
  const timeEl = document.getElementById('clock-time');
  const dateEl = document.getElementById('clock-date');
  const headerTimeEl = document.getElementById('header-time');

  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  timeEl.textContent = `${hh}:${mm}:${ss}`;
  headerTimeEl.textContent = `${hh}:${mm}`;

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  dateEl.textContent = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;

  // Update clock card background based on dominant source
  updateClockColor();
}

function updateClockColor() {
  const card = document.getElementById('clock-card');
  if (!card || !dominantSource) return;

  const colorMap = {
    'Nuclear': { bg: 'rgba(167, 139, 250, 0.08)', dot: '#a78bfa', text: 'Nuclear leading' },
    'Natural Gas': { bg: 'rgba(249, 115, 22, 0.08)', dot: '#f97316', text: `Gas at ${dominantPct.toFixed(0)}%` },
    'Solar': { bg: 'rgba(251, 191, 36, 0.08)', dot: '#fbbf24', text: `Solar at ${dominantPct.toFixed(0)}%` },
    'Wind Offshore': { bg: 'rgba(45, 212, 191, 0.08)', dot: '#2dd4bf', text: `Wind offshore at ${dominantPct.toFixed(0)}%` },
    'Wind Onshore': { bg: 'rgba(45, 212, 191, 0.08)', dot: '#2dd4bf', text: `Wind onshore at ${dominantPct.toFixed(0)}%` },
    'Biofuels': { bg: 'rgba(74, 222, 128, 0.08)', dot: '#4ade80', text: `Biofuels at ${dominantPct.toFixed(0)}%` },
    'Water': { bg: 'rgba(56, 189, 248, 0.08)', dot: '#38bdf8', text: `Hydro at ${dominantPct.toFixed(0)}%` },
  };
  const info = colorMap[dominantSource] || { bg: 'transparent', dot: '#94a3b8', text: 'Grid active' };
  card.style.background = info.bg;

  const dot = document.getElementById('dominant-dot');
  const text = document.getElementById('dominant-text');
  if (dot) dot.style.background = info.dot;
  if (text) text.textContent = info.text;
}

// ─── Generation Mix Bars ───
export function updateGenMix(mixPct) {
  const container = document.getElementById('gen-mix');
  if (!mixPct.length) {
    container.innerHTML = '<div class="gen-mix-empty">Waiting for data...</div>';
    return;
  }

  container.innerHTML = mixPct.map(e => `
    <div class="gen-bar">
      <span class="gen-bar-label">${e.fuel}</span>
      <div class="gen-bar-track">
        <div class="gen-bar-fill" style="width:${e.pct}%;background:${FUEL_COLORS[e.fuel] || '#64748b'}"></div>
      </div>
      <span class="gen-bar-pct">${e.pct.toFixed(0)}%</span>
    </div>
  `).join('');
}

// ─── Stat Cards ───
export function updateStats(totalMw, mixPct) {
  document.getElementById('stat-load').textContent = totalMw ? Math.round(totalMw).toLocaleString() : '—';

  // Estimate CO2
  const factors = { 'Natural Gas': 490, 'Nuclear': 12, 'Solar': 45, 'Wind Offshore': 11, 'Wind Onshore': 11, 'Biofuels': 230, 'Water': 24, 'Other Fossil Fuels': 820, 'Other': 300, 'Energy storage': 100 };
  let co2Total = 0, co2Covered = 0;
  for (const e of mixPct) {
    const f = factors[e.fuel] || 100;
    co2Total += e.pct * f;
    co2Covered += e.pct;
  }
  const co2 = co2Covered > 0 ? co2Total / co2Covered : 0;
  const co2El = document.getElementById('stat-co2');
  if (co2El) co2El.textContent = co2 ? Math.round(co2) : '—';
}

// ─── Best Hours for Renewables ───
export function updateBestHours() {
  const canvas = document.getElementById('best-hours-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  const hours = 24;
  const barW = (W - 4) / hours;

  // Deterministic wind profile using sin wave (not random)
  for (let h = 0; h < hours; h++) {
    const solarFactor = Math.max(0, Math.sin((h - 6) / 12 * Math.PI));
    // Wind is higher at night and spring/fall, lower midday - smooth curve
    const windFactor = 0.35 + 0.25 * Math.sin((h - 2) / 10 * Math.PI);
    const renFactor = solarFactor * 0.6 + windFactor * 0.4;
    const barH = renFactor * (H - 2);
    const x = 2 + h * barW;
    const y = H - 2 - barH;

    // Color: gradient from yellow (solar) to teal (wind)
    const r = Math.round(45 + solarFactor * 206);
    const g = Math.round(212 - solarFactor * 60 + windFactor * 30);
    const b = Math.round(191 - solarFactor * 50);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(x, y, Math.max(barW - 1, 2), barH);
  }
}

// ─── Myth Card ───
let mythInterval = null;

export function showMyth(myths) {
  const card = document.getElementById('myth-card');
  if (!myths.length) { card.classList.add('hidden'); if (mythInterval) clearInterval(mythInterval); return; }

  const m = myths[0];
  document.getElementById('myth-icon').textContent = m.icon;
  document.getElementById('myth-title').textContent = m.title;
  document.getElementById('myth-text').textContent = m.text;
  card.classList.remove('hidden');

  // Cycle through myths (clear old interval first)
  if (mythInterval) clearInterval(mythInterval);
  let idx = 0;
  mythInterval = setInterval(() => {
    idx = (idx + 1) % myths.length;
    const m2 = myths[idx];
    document.getElementById('myth-icon').textContent = m2.icon;
    document.getElementById('myth-title').textContent = m2.title;
    document.getElementById('myth-text').textContent = m2.text;
  }, 10000);
}
