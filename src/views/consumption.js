import Chart from 'chart.js/auto';

// No-op — kept so main.js import doesn't break (it calls this with Elia MW data)
export function updateConsumption() {}

const HOUSEHOLD_ID = 1;
const MINUTES_PER_DAY = 1440;

let dates = [];
let selectedIdx = -1;
let chart = null;
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
    listenersAttached = true;
  }

  selectedIdx = dates.length - 1;
  await loadAndRender();
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
  const currentMinute = isLatest
    ? Math.min(now.getHours() * 60 + now.getMinutes(), MINUTES_PER_DAY - 1)
    : MINUTES_PER_DAY - 1;

  // Null out future minutes so the line stops at "now"
  const visible = watts.map((w, i) => i <= currentMinute ? w : null);
  const slice   = watts.slice(0, currentMinute + 1);

  const currentW  = slice.at(-1) ?? 0;
  const totalKwh  = slice.reduce((s, w) => s + w, 0) / 60 / 1000;
  const peakW     = Math.max(...slice);
  const avgW      = Math.round(slice.reduce((s, w) => s + w, 0) / slice.length);

  setText('con-current',      currentW.toLocaleString());
  setText('con-kwh',          totalKwh.toFixed(1));
  setText('con-peak',         peakW.toLocaleString());
  setText('con-avg',          avgW.toLocaleString());
  setText('con-now-label',    isLatest ? 'Now' : 'At close');
  setText('con-period-label', isLatest ? 'today' : 'full day');
  setText('con-now-time',     isLatest
    ? `now  ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    : '');

  renderChart(visible, isLatest ? currentMinute : null);
}

// ─── Chart ───

const X_LABELS = Array.from({ length: MINUTES_PER_DAY }, (_, m) =>
  m % 360 === 0 ? `${String(m / 60).padStart(2, '0')}:00` : ''
);

// Draws a dashed vertical "now" line at chart._nowMinute
const nowLinePlugin = {
  id: 'nowLine',
  afterDraw(chart) {
    if (chart._nowMinute == null) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x.getPixelForValue(chart._nowMinute);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.strokeStyle = 'rgba(251,191,36,0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    // Small "now" label above the line
    ctx.font = '10px system-ui';
    ctx.fillStyle = 'rgba(251,191,36,0.8)';
    ctx.textAlign = 'left';
    ctx.setLineDash([]);
    ctx.fillText('now', x + 4, chartArea.top + 12);
    ctx.restore();
  },
};

function renderChart(data, nowMinute) {
  const canvas = document.getElementById('con-chart');
  if (!canvas) return;

  const maxVal = Math.max(...data.filter(v => v !== null), 0);
  const yMax   = Math.ceil(maxVal / 500) * 500 + 500;

  if (chart) {
    chart._nowMinute              = nowMinute;
    chart.data.datasets[0].data  = data;
    chart.options.scales.y.max   = yMax;
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
          ticks: {
            color: '#64748b',
            font: { size: 9 },
            maxRotation: 0,
            callback: (_, i) => X_LABELS[i] || null,
            maxTicksLimit: 5,
          },
          grid: { display: false },
        },
        y: {
          min: 0,
          max: yMax,
          ticks: {
            color: '#64748b',
            font: { size: 10 },
            maxTicksLimit: 5,
            callback: v => v === 0 ? '0' : `${(v / 1000).toFixed(1)}k`,
          },
          grid: { color: 'rgba(51,65,85,0.25)' },
        },
      },
    },
  });

  chart._nowMinute = nowMinute;
}

// ─── Helpers ───

function formatDateLabel(date, dayOfWeek) {
  const d = new Date(date + 'T00:00:00');
  return `${dayOfWeek}, ${d.getDate()} ${d.toLocaleString('en', { month: 'long' })} ${d.getFullYear()}`;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
