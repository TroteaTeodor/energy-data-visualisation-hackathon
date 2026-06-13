import Chart from 'chart.js/auto';
import { detectAppliances, APPLIANCE_META, APPLIANCE_ORDER } from '../nilm/detect.js';

// No-op — kept so main.js import doesn't break (called with Elia MW data)
export function updateConsumption() {}

const HOUSEHOLD_ID = 1;
const MINUTES_PER_DAY = 1440;

let dates = [];
let selectedIdx = -1;
let chart = null;
let nilmChart = null;
let nilmVisible = false;
let currentNilm = null;
let currentMinute = MINUTES_PER_DAY - 1;
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

  selectedIdx = dates.length - 1;
  await loadAndRender();
}

function toggleNilm() {
  nilmVisible = !nilmVisible;
  const section = document.getElementById('con-nilm-section');
  const btn = document.getElementById('btn-nilm-toggle');
  section.classList.toggle('hidden', !nilmVisible);
  btn.classList.toggle('active', nilmVisible);
  btn.textContent = nilmVisible ? 'Hide NILM' : 'Show NILM';
  if (nilmVisible && currentNilm) renderNilmChart(currentNilm, currentMinute);
}

async function navigate(delta) {
  const next = selectedIdx + delta;
  if (next < 0 || next >= dates.length) return;
  selectedIdx = next;
  await loadAndRender();
}

async function loadAndRender() {
  const { date, day_of_week } = dates[selectedIdx];
  const isLatest = selectedIdx === dates.length - 1;

  setText('con-date-label', formatDateLabel(date, day_of_week));
  document.getElementById('con-prev').disabled = selectedIdx === 0;
  document.getElementById('con-next').disabled = isLatest;
  document.getElementById('con-today-badge').style.display = isLatest ? '' : 'none';

  let watts;
  try {
    const res = await fetch(`/api/households/${HOUSEHOLD_ID}/consumption/${date}`);
    if (!res.ok) throw new Error();
    watts = (await res.json()).watts_series;
  } catch {
    return;
  }

  const now = new Date();
  currentMinute = isLatest
    ? Math.min(now.getHours() * 60 + now.getMinutes(), MINUTES_PER_DAY - 1)
    : MINUTES_PER_DAY - 1;

  const visible = watts.map((w, i) => i <= currentMinute ? w : null);
  const slice   = watts.slice(0, currentMinute + 1);

  const currentW = slice.at(-1) ?? 0;
  const totalKwh = slice.reduce((s, w) => s + w, 0) / 60 / 1000;
  const peakW    = Math.max(...slice);
  const avgW     = Math.round(slice.reduce((s, w) => s + w, 0) / slice.length);

  setText('con-current',      currentW.toLocaleString());
  setText('con-kwh',          totalKwh.toFixed(1));
  setText('con-peak',         peakW.toLocaleString());
  setText('con-avg',          avgW.toLocaleString());
  setText('con-now-label',    isLatest ? 'Now' : 'At close');
  setText('con-period-label', isLatest ? 'today' : 'full day');
  setText('con-now-time',     isLatest
    ? `now  ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    : '');

  renderMainChart(visible, isLatest ? currentMinute : null);

  // Run NILM (fast — linear scans over 1440 points)
  currentNilm = detectAppliances(watts);
  if (nilmVisible) renderNilmChart(currentNilm, currentMinute);
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

function renderMainChart(data, nowMinute) {
  const canvas = document.getElementById('con-chart');
  if (!canvas) return;
  const maxVal = Math.max(...data.filter(v => v !== null), 0);
  const yMax   = Math.ceil(maxVal / 500) * 500 + 500;

  if (chart) {
    chart._nowMinute             = nowMinute;
    chart.data.datasets[0].data = data;
    chart.options.scales.y.max  = yMax;
    chart.update('none');
    return;
  }

  chart = new Chart(canvas, {
    type: 'line',
    plugins: [nowLinePlugin],
    data: {
      labels: X_LABELS,
      datasets: [{
        data,
        borderColor: '#2dd4bf',
        backgroundColor: 'rgba(45,212,191,0.07)',
        borderWidth: 1.5,
        fill: true,
        tension: 0.2,
        pointRadius: 0,
        spanGaps: false,
      }],
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
            label: c => ` ${c.parsed.y?.toLocaleString()} W`,
          },
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

// ─── NILM stacked chart ───

function renderNilmChart(nilm, clipMinute) {
  const canvas = document.getElementById('con-nilm-chart');
  if (!canvas) return;

  // Datasets in stack order (bottom → top)
  const datasets = APPLIANCE_ORDER.map(id => {
    const meta = APPLIANCE_META[id];
    const raw  = nilm[id] ?? [];
    const data = raw.map((w, i) => i <= clipMinute ? w : null);
    return {
      label: meta.label,
      data,
      backgroundColor: hexToRgba(meta.color, 0.82),
      borderColor: meta.color,
      borderWidth: 0.5,
      fill: true,
      tension: 0.15,
      pointRadius: 0,
      spanGaps: false,
    };
  });

  const allVals = APPLIANCE_ORDER.flatMap(id => (nilm[id] ?? []).slice(0, clipMinute + 1));
  // Y max = total of all stacked values at peak minute
  const perMinuteTotal = Array.from({ length: clipMinute + 1 }, (_, m) =>
    APPLIANCE_ORDER.reduce((s, id) => s + (nilm[id]?.[m] ?? 0), 0)
  );
  const yMax = Math.ceil(Math.max(...perMinuteTotal, 0) / 500) * 500 + 500;

  const nilmTooltip = {
    callbacks: {
      title: items => {
        const m = items[0].dataIndex;
        return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      },
      label: c => ` ${c.dataset.label}: ${c.parsed.y?.toLocaleString() ?? 0} W`,
    },
  };

  if (nilmChart) {
    nilmChart.data.datasets.forEach((ds, i) => { ds.data = datasets[i].data; });
    nilmChart.options.scales.y.max = yMax;
    nilmChart.update('none');
  } else {
    nilmChart = new Chart(canvas, {
      type: 'line',
      data: { labels: X_LABELS, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: nilmTooltip },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 0, callback: (_, i) => X_LABELS[i] || null, maxTicksLimit: 5 },
            grid: { display: false },
          },
          y: {
            stacked: true,
            min: 0,
            max: yMax,
            ticks: { color: '#64748b', font: { size: 10 }, maxTicksLimit: 5, callback: v => v === 0 ? '0' : `${(v / 1000).toFixed(1)}k` },
            grid: { color: 'rgba(51,65,85,0.25)' },
          },
        },
      },
    });
  }

  renderNilmLegend(nilm, clipMinute);
}

function renderNilmLegend(nilm, clipMinute) {
  const legend = document.getElementById('nilm-legend');
  if (!legend) return;

  const totalKwh = key => (nilm[key] ?? []).slice(0, clipMinute + 1).reduce((s, w) => s + w, 0) / 60 / 1000;
  const grandKwh = APPLIANCE_ORDER.reduce((s, id) => s + totalKwh(id), 0);

  legend.innerHTML = [...APPLIANCE_ORDER].reverse().map(id => {
    const meta = APPLIANCE_META[id];
    const kwh  = totalKwh(id);
    const pct  = grandKwh > 0 ? Math.round((kwh / grandKwh) * 100) : 0;
    if (kwh < 0.01) return ''; // hide zero-contribution appliances
    return `
      <div class="nilm-legend-item">
        <span class="nilm-swatch" style="background:${meta.color}"></span>
        <span class="nilm-legend-label">${meta.label}</span>
        <span class="nilm-legend-kwh">${kwh.toFixed(2)} kWh</span>
        <span class="nilm-legend-pct">${pct}%</span>
      </div>`;
  }).join('');
}

// ─── Helpers ───

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function formatDateLabel(date, dayOfWeek) {
  const d = new Date(date + 'T00:00:00');
  return `${dayOfWeek}, ${d.getDate()} ${d.toLocaleString('en', { month: 'long' })} ${d.getFullYear()}`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
