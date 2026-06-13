import Chart from 'chart.js/auto';
import { detectAppliances, APPLIANCE_META, APPLIANCE_ORDER } from '../nilm/detect.js';

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

export async function initConsumption() {
  const emptyEl   = document.getElementById('con-empty');
  const contentEl = document.getElementById('con-content');

  try {
    const res = await fetch(`/api/households/${HOUSEHOLD_ID}/consumption`);
    if (!res.ok) throw new Error();
    dates = await res.json();
  } catch {
    dates = [];
  }

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

    // Fetch prediction to extend today's chart from now → midnight
    if (isLatestDb && currentMinute < MINUTES_PER_DAY - 1) {
      try {
        const res = await fetch(`/api/households/${HOUSEHOLD_ID}/prediction/${selectedDate}`);
        if (res.ok) predictionWatts = (await res.json()).watts_series;
      } catch {}
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

  // Cost
  const priceSeries = priceSeriesRaw?.length === 24 ? priceSeriesRaw.map(Number) : null;
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

  // Build "rest of day" prediction overlay for today.
  // Include currentMinute in both series so the lines visually connect.
  const todayPredictedVisible = predictionWatts
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
  // Extend clip to end of day when prediction fills the rest
  const nilmClipMinute = predictionWatts ? MINUTES_PER_DAY - 1 : clipMinute;
  renderNilmChart(nilmToRender, nilmClipMinute, isPrediction);
}

// ─── Main chart ───

const X_LABELS = Array.from({ length: MINUTES_PER_DAY }, (_, m) =>
  m % 360 === 0 ? `${String(m / 60).padStart(2, '0')}:00` : ''
);

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

  if (chart) {
    chart._nowMinute = nowMinute;
    // Mutate existing dataset objects — don't replace references
    const ds0 = chart.data.datasets[0];
    ds0.data            = data;
    ds0.borderColor     = color;
    ds0.backgroundColor = bgColor;
    ds0.borderDash      = dashArray;
    const ds1 = chart.data.datasets[1];
    ds1.data            = predData;
    chart.options.scales.y.max = yMax;
    chart.update('none');
    return;
  }

  chart = new Chart(canvas, {
    type: 'line',
    plugins: [nowLinePlugin],
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
    const meta = APPLIANCE_META[id];
    const raw  = nilm[id] ?? [];
    const data = raw.map((w, i) => (isPrediction || i <= clipMinute) ? w : null);
    return {
      label: meta.label,
      data,
      backgroundColor: hexToRgba(meta.color, isPrediction ? 0.5 : 0.82),
      borderColor: meta.color,
      borderWidth: isPrediction ? 0 : 0.5,
      borderDash: isPrediction ? [4, 4] : [],
      fill: true,
      tension: 0.15,
      pointRadius: 0,
      spanGaps: false,
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
            label: c => ` €${c.parsed.y.toFixed(4)} · ${(priceSeries[c.dataIndex] * 100).toFixed(1)}¢/kWh`,
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
