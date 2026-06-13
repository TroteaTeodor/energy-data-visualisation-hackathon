import Chart from 'chart.js/auto';
import { detectAppliances, APPLIANCE_META, APPLIANCE_ORDER } from '../nilm/detect.js';
import { generateTips, generateFutureTips, APPLIANCE_LABEL } from '../nilm/tips.js';
import { maybeNotifyTips } from './settings.js';
import { getHourlyImbalancePrices, generatePricesForDate } from '../api/elia.js';

export function updateConsumption() {}

const HOUSEHOLD_ID    = 1;
const MINUTES_PER_DAY = 1440;
const MAX_FUTURE_DAYS = 7;

let dates            = [];
let selectedDate     = null;
let chart            = null;
let nilmChart        = null;
let costChart        = null;
let currentNilm      = null;
let currentMinute    = MINUTES_PER_DAY - 1;
let nilmVisible      = false;
let listenersAttached = false;
let tipsCache = null;
let futureTipsCache = null;
let todayPrices = null;       // real Elia prices for today, fetched once per session
let activeCostPrices = null;  // prices currently shown in the cost chart tooltip

export async function initConsumption() {
  const emptyEl   = document.getElementById('con-empty');
  const contentEl = document.getElementById('con-content');

  const prevLength = dates.length;
  try {
    const res = await fetch(`/api/households/${HOUSEHOLD_ID}/consumption`);
    if (!res.ok) throw new Error();
    dates = await res.json();
  } catch {
    dates = [];
  }

  // Reset tips cache when new data has been saved
  if (dates.length !== prevLength) tipsCache = null;

  if (!dates.length) {
    emptyEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  contentEl.classList.remove('hidden');

  if (!listenersAttached) {
    document.getElementById('con-prev').addEventListener('click', () => navigate(-1));
    document.getElementById('con-next').addEventListener('click', () => navigate(+1));
    document.getElementById('btn-nilm-toggle').addEventListener('click', toggleNilm);
    listenersAttached = true;
  }

  selectedDate = dates[dates.length - 1].date;
  await loadAndRender();
}

function toggleNilm() {
  nilmVisible = !nilmVisible;
  const btn       = document.getElementById('btn-nilm-toggle');
  const mainCanvas = document.getElementById('con-chart');
  const nilmCanvas = document.getElementById('con-nilm-chart');
  const legend    = document.getElementById('nilm-legend');
  const title     = document.getElementById('con-chart-title');

  btn.textContent = nilmVisible ? 'Show Power' : 'Show NILM';
  btn.classList.toggle('active', nilmVisible);
  mainCanvas.style.display = nilmVisible ? 'none' : '';
  nilmCanvas.style.display = nilmVisible ? '' : 'none';
  legend.style.display     = nilmVisible ? '' : 'none';
  if (title) title.textContent = nilmVisible
    ? 'NILM breakdown — estimated appliance contributions'
    : 'Household power (W)';

  // Trigger a chart resize after toggling visibility
  if (nilmVisible && nilmChart) nilmChart.resize();
  if (!nilmVisible && chart)    chart.resize();
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isFutureDate(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(dateStr + 'T00:00:00') > today;
}

function isInDb(dateStr) {
  return dates.some(d => d.date === dateStr);
}

function maxAllowedDate() {
  const lastDbDate = dates[dates.length - 1].date;
  return addDays(lastDbDate, MAX_FUTURE_DAYS);
}

function minAllowedDate() {
  return dates[0].date;
}

async function navigate(delta) {
  const next = addDays(selectedDate, delta);
  if (next < minAllowedDate() || next > maxAllowedDate()) return;
  selectedDate = next;
  await loadAndRender();
}

async function loadAndRender() {
  const isPrediction = !isInDb(selectedDate);
  const lastDbDate   = dates[dates.length - 1].date;
  const isLatestDb   = selectedDate === lastDbDate;

  // Nav buttons
  document.getElementById('con-prev').disabled = selectedDate <= minAllowedDate();
  document.getElementById('con-next').disabled = selectedDate >= maxAllowedDate();

  // Badges
  document.getElementById('con-today-badge').style.display   = isLatestDb ? '' : 'none';
  document.getElementById('con-predict-badge').classList.toggle('hidden', !isPrediction);
  document.getElementById('con-predict-bar').classList.toggle('hidden', !isPrediction);

  // Date label
  const d = new Date(selectedDate + 'T12:00:00Z');
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS    = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  setText('con-date-label', `${DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`);

  // Calculate currentMinute first — used to gate the prediction fetch
  const now = new Date();
  currentMinute = isLatestDb
    ? Math.min(now.getHours() * 60 + now.getMinutes(), MINUTES_PER_DAY - 1)
    : MINUTES_PER_DAY - 1;

  let watts, priceSeriesRaw, daysAveraged = 0, predictionWatts = null;

  if (isPrediction) {
    try {
      const res = await fetch(`/api/households/${HOUSEHOLD_ID}/prediction/${selectedDate}`);
      if (!res.ok) throw new Error('No prediction data');
      const body    = await res.json();
      watts         = body.watts_series;
      priceSeriesRaw = body.price_series;
      daysAveraged  = body.days_averaged;
      setText('con-predict-days', String(daysAveraged));
      setText('con-predict-dow', DAY_NAMES[d.getUTCDay()]);
    } catch {
      setText('con-date-label', `${DAY_NAMES[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} — No prediction available`);
      return;
    }
  } else {
    try {
      const res = await fetch(`/api/households/${HOUSEHOLD_ID}/consumption/${selectedDate}`);
      if (!res.ok) throw new Error();
      const body    = await res.json();
      watts         = body.watts_series;
      priceSeriesRaw = body.price_series;
    } catch {
      return;
    }

    // Fetch prediction + real Elia prices in parallel (both needed for future tips)
    if (isLatestDb) {
      const [predRes] = await Promise.allSettled([
        fetch(`/api/households/${HOUSEHOLD_ID}/prediction/${selectedDate}`).then(r => r.ok ? r.json() : null),
        todayPrices
          ? Promise.resolve()
          : getHourlyImbalancePrices().then(data => {
              // Convert {hour, price}[] → float[24], fill gaps with synthetic fallback
              const fallback = generatePricesForDate(selectedDate);
              const arr = [...fallback];
              for (const { hour, price } of data) arr[hour] = price;
              todayPrices = arr;
            }).catch(() => {
              todayPrices = generatePricesForDate(selectedDate);
            }),
      ]);
      if (predRes.status === 'fulfilled' && predRes.value) {
        predictionWatts = predRes.value.watts_series;
      }
    }
  }

  // For predictions, show all data (full day forecast)
  const clipMinute = isPrediction ? MINUTES_PER_DAY - 1 : currentMinute;
  const slice      = watts.slice(0, clipMinute + 1);
  const visible    = watts.map((w, i) => (isPrediction || i <= clipMinute) ? w : null);

  const currentW = slice.at(-1) ?? 0;
  const totalKwh = slice.reduce((s, w) => s + w, 0) / 60 / 1000;
  const peakW    = Math.max(...slice);
  const avgW     = Math.round(slice.reduce((s, w) => s + w, 0) / slice.length);

  setText('con-current',      isPrediction ? '~' + avgW.toLocaleString() : currentW.toLocaleString());
  setText('con-kwh',          totalKwh.toFixed(1));
  setText('con-peak',         peakW.toLocaleString());
  setText('con-avg',          avgW.toLocaleString());
  setText('con-now-label',    isPrediction ? 'Avg (pred)' : isLatestDb ? 'Now' : 'At close');
  setText('con-period-label', isPrediction ? 'predicted' : isLatestDb ? 'today' : 'full day');
  setText('con-now-time',     isLatestDb
    ? `now  ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    : '');

  // Cost — for today use real Elia prices (same source as Energy Prices page)
  const priceSeries = (isLatestDb && todayPrices)
    ? todayPrices
    : priceSeriesRaw?.length === 24 ? priceSeriesRaw.map(Number) : null;
  if (priceSeries) {
    const hourlyCost = Array(24).fill(0);
    slice.forEach((w, m) => {
      hourlyCost[Math.floor(m / 60)] += (w / 1000 / 60) * priceSeries[Math.floor(m / 60)];
    });
    const totalCost = hourlyCost.reduce((s, c) => s + c, 0);
    setText('con-cost', `€${totalCost.toFixed(2)}`);
    document.getElementById('cost-card')?.classList.remove('hidden');
    renderCostChart(hourlyCost, priceSeries, clipMinute);
    document.getElementById('con-cost-section')?.classList.remove('hidden');
  } else {
    setText('con-cost', '—');
    document.getElementById('cost-card')?.classList.add('hidden');
    document.getElementById('con-cost-section')?.classList.add('hidden');
  }

  // Build "rest of day" prediction overlay for today (only when day isn't over).
  const todayPredictedVisible = predictionWatts && currentMinute < MINUTES_PER_DAY - 1
    ? predictionWatts.map((w, i) => i >= currentMinute ? w : null)
    : null;

  renderMainChart(visible, isLatestDb ? currentMinute : null, isPrediction, todayPredictedVisible);

  currentNilm = detectAppliances(watts);

  // Merge actual NILM up to now + predicted NILM for rest of day
  let nilmToRender = currentNilm;
  if (predictionWatts) {
    const predNilm = detectAppliances(predictionWatts);
    nilmToRender = {};
    for (const id of APPLIANCE_ORDER) {
      const actual = currentNilm[id] ?? [];
      const pred   = predNilm[id]   ?? [];
      nilmToRender[id] = Array.from({ length: MINUTES_PER_DAY }, (_, i) =>
        i < currentMinute ? actual[i] ?? 0 : pred[i] ?? actual[i] ?? 0
      );
    }
  }
  const nilmClipMinute = predictionWatts ? MINUTES_PER_DAY - 1 : clipMinute;
  // Always render so the chart is populated when the user toggles to NILM view
  renderNilmChart(nilmToRender, nilmClipMinute, isPrediction);

  // Trigger tip generation lazily after the first successful NILM run
  if (!tipsCache) {
    tipsCache = 'loading';
    renderTips(null);
    generateTips(dates, fetchDayWatts).then(tips => {
      tipsCache = tips;
      renderTips(tips);
      if (tips.length) maybeNotifyTips(tips);
    }).catch(() => {
      tipsCache = null;
    });
  } else if (Array.isArray(tipsCache)) {
    renderTips(tipsCache);
  } else if (tipsCache === 'loading') {
    renderTips(null);
  }

  // Future tips: prediction-based, only meaningful on the latest DB day
  if (!isLatestDb || !predictionWatts) {
    futureTipsCache = null;
    renderFutureTips([]);
  } else if (!futureTipsCache) {
    futureTipsCache = 'loading';
    renderFutureTips(null);
    generateFutureTips(predictionWatts, todayPrices, fetchDayWatts, dates).then(tips => {
      futureTipsCache = tips;
      renderFutureTips(tips);
    }).catch(() => {
      futureTipsCache = null;
    });
  } else if (Array.isArray(futureTipsCache)) {
    renderFutureTips(futureTipsCache);
  } else if (futureTipsCache === 'loading') {
    renderFutureTips(null);
  }
}

function renderFutureTips(tips) {
  const section = document.getElementById('con-future-tips-section');
  const list    = document.getElementById('future-tips-list');
  if (!section || !list) return;

  if (tips === null) {
    section.classList.remove('hidden');
    list.innerHTML = '<div class="tip-loading"><span class="tip-spinner"></span> Computing today\'s predictions…</div>';
    return;
  }

  if (!tips.length) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  list.innerHTML = tips.map(tip => {
    const { appId, confidence, startHour, optimalHour, saving } = tip;
    const priceBased = confidence === null;
    const badgeClass = priceBased ? 'confidence-badge--price'
                     : confidence >= 80 ? 'confidence-badge--high'
                     : 'confidence-badge--mid';
    const color      = priceBased ? '#2dd4bf'
                     : confidence >= 80 ? '#4ade80'
                     : '#fbbf24';
    const badgeText  = priceBased ? '⚡ biggest saver' : `${confidence}% confident`;
    const label      = APPLIANCE_LABEL[appId] ?? appId.replace('_', ' ');
    const fromHour   = `${String(startHour).padStart(2, '0')}:00`;
    const toHour     = `${String(optimalHour).padStart(2, '0')}:00`;
    const meta       = priceBased
      ? 'EV charging accounts for the largest share of household energy cost — today\'s spot prices confirm this window 💡'
      : 'Based on your usage pattern over the last 14 days 📊';
    return `
    <div class="future-tip-card" style="border-left-color:${color}">
      <span class="confidence-badge ${badgeClass}">${badgeText}</span>
      <div class="future-tip-action">
        Instead of charging your ${label} at ${fromHour}, try ${toHour} — save <strong>€${saving.toFixed(2)}</strong> today
      </div>
      <div class="future-tip-meta">${meta}</div>
    </div>`;
  }).join('');
}

// ─── Tip helpers ───

async function fetchDayWatts(date) {
  try {
    const res = await fetch(`/api/households/${HOUSEHOLD_ID}/consumption/${date}`);
    if (!res.ok) return null;
    return (await res.json()).watts_series;
  } catch {
    return null;
  }
}

const APPLIANCE_SVG = {
  dishwasher: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="12" cy="13" r="4"/>
    <circle cx="8" cy="7" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="7" r="0.8" fill="currentColor" stroke="none"/>
    <line x1="16" y1="6.5" x2="17" y2="7.5"/>
  </svg>`,
  washing_machine: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="12" cy="13" r="4"/>
    <path d="M10 11.5 Q12 10 14 11.5"/>
    <circle cx="7.5" cy="7" r="0.8" fill="currentColor" stroke="none"/>
    <line x1="11" y1="7" x2="16" y2="7"/>
  </svg>`,
  ev_charger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 2 L4 14 h7 l-1 8 l9-12 h-7 Z"/>
  </svg>`,
  dryer: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="12" cy="13" r="4"/>
    <path d="M12 9 A4 4 0 0 1 16 13"/>
    <circle cx="7.5" cy="7" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="11" cy="7" r="0.8" fill="currentColor" stroke="none"/>
  </svg>`,
  oven: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <rect x="6" y="10" width="12" height="8" rx="1"/>
    <circle cx="8" cy="6.5" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="6.5" r="0.8" fill="currentColor" stroke="none"/>
    <circle cx="16" cy="6.5" r="0.8" fill="currentColor" stroke="none"/>
  </svg>`,
  hob: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <circle cx="8" cy="10" r="2.5"/>
    <circle cx="16" cy="10" r="2.5"/>
    <circle cx="8" cy="17" r="1.5"/>
    <circle cx="16" cy="17" r="1.5"/>
  </svg>`,
};

function renderTips(tips) {
  const section = document.getElementById('con-tips-section');
  const list    = document.getElementById('tips-list');
  if (!section || !list) return;

  if (tips === null) {
    section.classList.remove('hidden');
    list.innerHTML = '<div class="tip-loading"><span class="tip-spinner"></span> Analysing 30 days of usage…</div>';
    return;
  }

  if (!tips.length) {
    section.classList.add('hidden');
    return;
  }

  const ACCENT_COLORS = ['#2dd4bf', '#a78bfa', '#f97316'];

  section.classList.remove('hidden');
  list.innerHTML = tips.map((tip, i) => {
    const color = ACCENT_COLORS[i % ACCENT_COLORS.length];
    const svg   = APPLIANCE_SVG[tip.appId] ?? APPLIANCE_SVG.oven;
    return `
    <div class="tip-card" style="border-left-color:${color}">
      <div class="tip-card-row">
        <span class="tip-icon" style="color:${color}">${svg}</span>
        <div class="tip-body">
          <div class="tip-habit">${tip.habitLine}</div>
          <div class="tip-saving">${tip.savingLine}</div>
          <div class="tip-fun">${tip.funComparison}</div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ─── Main chart ───

const X_LABELS = Array.from({ length: MINUTES_PER_DAY }, (_, m) =>
  m % 360 === 0 ? `${String(m / 60).padStart(2, '0')}:00` : ''
);

function computeAvgLine(data) {
  // One average dot per hour, placed at the midpoint minute of that hour.
  // Chart.js spanGaps + tension draws a smooth curve through the 24 points.
  const result = new Array(MINUTES_PER_DAY).fill(null);
  for (let h = 0; h < 24; h++) {
    const slice = data.slice(h * 60, (h + 1) * 60).filter(v => v !== null);
    if (!slice.length) continue;
    result[h * 60 + 30] = Math.round(slice.reduce((s, v) => s + v, 0) / slice.length);
  }
  return result;
}

const avgLinePlugin = {
  id: 'avgLine',
  afterDraw(c) {
    const ds = c.data.datasets[2];
    if (!ds?.data) return;
    const lastIdx = ds.data.reduce((last, v, i) => v !== null ? i : last, -1);
    if (lastIdx < 0) return;
    const lastVal = ds.data[lastIdx];
    const { ctx, chartArea, scales } = c;
    const x = Math.min(scales.x.getPixelForValue(lastIdx) + 6, chartArea.right - 68);
    const y = scales.y.getPixelForValue(lastVal);
    ctx.save();
    ctx.font = '600 10px system-ui';
    ctx.fillStyle = 'rgba(251,191,36,0.85)';
    ctx.textAlign = 'left';
    ctx.fillText(`${lastVal.toLocaleString()} W`, x, y - 5);
    ctx.restore();
  },
};

const nowLinePlugin = {
  id: 'nowLine',
  afterDraw(c) {
    if (c._nowMinute == null) return;
    const { ctx, chartArea, scales } = c;
    const x = scales.x.getPixelForValue(c._nowMinute);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.strokeStyle = 'rgba(251,191,36,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.font = '10px system-ui';
    ctx.fillStyle = 'rgba(251,191,36,0.8)';
    ctx.setLineDash([]);
    ctx.fillText('now', x + 4, chartArea.top + 12);
    ctx.restore();
  },
};

function renderMainChart(data, nowMinute, isPrediction, predOverlay = null) {
  const canvas = document.getElementById('con-chart');
  if (!canvas) return;

  const allVals = [...data, ...(predOverlay ?? [])].filter(v => v !== null);
  const maxVal  = Math.max(...allVals, 0);
  const yMax    = Math.ceil(maxVal / 500) * 500 + 500;

  const color     = isPrediction ? '#a78bfa' : '#2dd4bf';
  const bgColor   = isPrediction ? 'rgba(167,139,250,0.07)' : 'rgba(45,212,191,0.07)';
  const dashArray = isPrediction ? [6, 4] : [];
  const predData  = predOverlay ?? new Array(MINUTES_PER_DAY).fill(null);
  const avgData   = computeAvgLine(data);

  if (chart) {
    chart._nowMinute = nowMinute;
    const ds0 = chart.data.datasets[0];
    ds0.data            = data;
    ds0.borderColor     = color;
    ds0.backgroundColor = bgColor;
    ds0.borderDash      = dashArray;
    const ds1 = chart.data.datasets[1];
    ds1.data            = predData;
    const ds2 = chart.data.datasets[2];
    ds2.data            = avgData;
    chart.options.scales.y.max = yMax;
    chart.update('none');
    return;
  }

  chart = new Chart(canvas, {
    type: 'line',
    plugins: [nowLinePlugin, avgLinePlugin],
    data: {
      labels: X_LABELS,
      datasets: [
        {
          label: 'actual',
          data,
          borderColor: color,
          backgroundColor: bgColor,
          borderWidth: 1.5,
          borderDash: dashArray,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          spanGaps: false,
        },
        {
          label: 'predicted',
          data: predData,
          borderColor: 'rgba(167,139,250,0.75)',
          backgroundColor: 'rgba(167,139,250,0.05)',
          borderWidth: 1.5,
          borderDash: [6, 4],
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          spanGaps: false,
        },
        {
          label: 'avg',
          data: avgData,
          borderColor: 'rgba(251,191,36,0.7)',
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          borderDash: [],
          fill: false,
          tension: 0.4,
          pointRadius: 3,
          pointBackgroundColor: 'rgba(251,191,36,0.85)',
          pointBorderColor: 'transparent',
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => {
              const m = items[0].dataIndex;
              return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            },
            label: c => {
              if (c.parsed.y == null) return null;
              if (c.dataset.label === 'avg') return ` ${c.parsed.y.toLocaleString()} W avg`;
              const tag = c.dataset.label === 'predicted' ? ' (predicted)' : '';
              return ` ${c.parsed.y.toLocaleString()} W${tag}`;
            },
          },
          filter: item => item.parsed.y != null,
        },
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 0, callback: (_, i) => X_LABELS[i] || null, maxTicksLimit: 5 },
          grid: { display: false },
        },
        y: {
          min: 0, max: yMax,
          ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 5, callback: v => v === 0 ? '0' : `${(v / 1000).toFixed(1)}k` },
          grid: { color: 'rgba(51,65,85,0.25)' },
        },
      },
    },
  });
  chart._nowMinute = nowMinute;
}

// ─── NILM chart ───

function renderNilmChart(nilm, clipMinute, isPrediction) {
  const canvas = document.getElementById('con-nilm-chart');
  if (!canvas) return;

  const datasets = APPLIANCE_ORDER.map(id => {
    const meta  = APPLIANCE_META[id];
    const raw   = nilm[id] ?? [];
    const data  = raw.map((w, i) => (isPrediction || i <= clipMinute) ? w : null);
    const color = meta.color;
    return {
      label: meta.label,
      data,
      backgroundColor: hexToRgba(color, isPrediction ? 0.5 : 0.82),
      borderColor: color,
      borderWidth: isPrediction ? 0 : 0.5,
      borderDash: isPrediction ? [4, 4] : [],
      fill: true,
      tension: 0.15,
      pointRadius: 0,
      spanGaps: false,
      // Dim the predicted portion (after currentMinute) on today's live view.
      // Reads currentMinute at draw-time so no need to update on re-renders.
      segment: {
        backgroundColor: ctx =>
          currentMinute < MINUTES_PER_DAY - 1 && ctx.p0DataIndex >= currentMinute
            ? hexToRgba(color, 0.18)
            : undefined,
        borderColor: ctx =>
          currentMinute < MINUTES_PER_DAY - 1 && ctx.p0DataIndex >= currentMinute
            ? hexToRgba(color, 0.3)
            : undefined,
        borderDash: ctx =>
          currentMinute < MINUTES_PER_DAY - 1 && ctx.p0DataIndex >= currentMinute
            ? [4, 4]
            : undefined,
      },
    };
  });

  const perMinuteTotal = Array.from({ length: clipMinute + 1 }, (_, m) =>
    APPLIANCE_ORDER.reduce((s, id) => s + (nilm[id]?.[m] ?? 0), 0)
  );
  const yMax = Math.ceil(Math.max(...perMinuteTotal, 0) / 500) * 500 + 500;

  const nowMinuteForNilm = isPrediction ? null : currentMinute;

  if (nilmChart) {
    nilmChart._nowMinute = nowMinuteForNilm;
    nilmChart.data.datasets.forEach((ds, i) => {
      ds.data            = datasets[i].data;
      ds.backgroundColor = datasets[i].backgroundColor;
    });
    nilmChart.options.scales.y.max = yMax;
    nilmChart.update('none');
  } else {
    nilmChart = new Chart(canvas, {
      type: 'line',
      plugins: [nowLinePlugin],
      data: { labels: X_LABELS, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => {
                const m = items[0].dataIndex;
                return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
              },
              label: c => ` ${c.dataset.label}: ${c.parsed.y?.toLocaleString() ?? 0} W`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 0, callback: (_, i) => X_LABELS[i] || null, maxTicksLimit: 5 },
            grid: { display: false },
          },
          y: {
            stacked: true, min: 0, max: yMax,
            ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 5, callback: v => v === 0 ? '0' : `${(v / 1000).toFixed(1)}k` },
            grid: { color: 'rgba(51,65,85,0.25)' },
          },
        },
      },
    });
    nilmChart._nowMinute = nowMinuteForNilm;
  }

  renderNilmLegend(nilm, clipMinute);
}

function renderNilmLegend(nilm, clipMinute) {
  const legend = document.getElementById('nilm-legend');
  if (!legend) return;

  const totalKwh  = key => (nilm[key] ?? []).slice(0, clipMinute + 1).reduce((s, w) => s + w, 0) / 60 / 1000;
  const grandKwh  = APPLIANCE_ORDER.reduce((s, id) => s + totalKwh(id), 0);

  legend.innerHTML = [...APPLIANCE_ORDER].reverse().map(id => {
    const meta = APPLIANCE_META[id];
    const kwh  = totalKwh(id);
    const pct  = grandKwh > 0 ? Math.round((kwh / grandKwh) * 100) : 0;
    if (kwh < 0.01) return '';
    return `
      <div class="nilm-legend-item">
        <span class="nilm-swatch" style="background:${meta.color}"></span>
        <span class="nilm-legend-label">${meta.label}</span>
        <span class="nilm-legend-kwh">${kwh.toFixed(2)} kWh</span>
        <span class="nilm-legend-pct">${pct}%</span>
      </div>`;
  }).join('');
}

// ─── Hourly cost chart ───

const COST_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

function renderCostChart(hourlyCost, priceSeries, clipMinute) {
  const canvas = document.getElementById('con-cost-chart');
  if (!canvas) return;

  activeCostPrices = priceSeries; // always keep the module-level ref in sync

  const clipHour  = Math.floor(clipMinute / 60);
  const sorted    = [...priceSeries].sort((a, b) => a - b);
  const cheapT    = sorted[Math.floor(sorted.length * 0.28)];
  const expT      = sorted[Math.floor(sorted.length * 0.78)];
  const barColors = priceSeries.map((p, h) => {
    if (h > clipHour) return 'rgba(51,65,85,0.3)';
    if (p <= cheapT)  return 'rgba(167,139,250,0.75)';
    if (p >= expT)    return 'rgba(249,115,22,0.75)';
    return 'rgba(45,212,191,0.65)';
  });

  const activeCosts = hourlyCost.slice(0, clipHour + 1).filter(c => c > 0);
  const avgCost     = activeCosts.length ? activeCosts.reduce((s, c) => s + c, 0) / activeCosts.length : 0;
  setText('con-cost-avg', `avg ${(avgCost * 100).toFixed(1)}¢/hr`);

  if (costChart) {
    costChart.data.datasets[0].data            = hourlyCost;
    costChart.data.datasets[0].backgroundColor = barColors;
    costChart.options.plugins.tooltip.callbacks.label =
      c => ` €${c.parsed.y.toFixed(4)} · ${(activeCostPrices[c.dataIndex] * 100).toFixed(1)}¢/kWh`;
    costChart.update('none');
    return;
  }

  costChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: COST_LABELS,
      datasets: [{ data: hourlyCost, backgroundColor: barColors, borderRadius: 3, borderSkipped: false }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            // reference activeCostPrices (module-level) so it always reflects the latest render
            label: c => ` €${c.parsed.y.toFixed(4)} · ${(activeCostPrices[c.dataIndex] * 100).toFixed(1)}¢/kWh`,
          },
        },
      },
      scales: {
        x: { ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 0, maxTicksLimit: 8 }, grid: { display: false } },
        y: { min: 0, ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 5, callback: v => `€${v.toFixed(3)}` }, grid: { color: 'rgba(51,65,85,0.25)' } },
      },
    },
  });
}

// ─── Helpers ───

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
