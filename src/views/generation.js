import Chart from 'chart.js/auto';
import { APPLIANCES } from '../generator/appliances.js';
import { generateDataset } from '../generator/generate.js';

const MINUTES_PER_DAY = 1440;

let dataset = null;
let previewDayIndex = 0;
let dayChart = null;

// Mutable copy — user can toggle/edit before generating
let appliances = APPLIANCES.map(a => ({ ...a }));

export function initGeneration() {
  renderApplianceList();
  document.getElementById('btn-generate').addEventListener('click', onGenerate);
  document.getElementById('btn-prev-day').addEventListener('click', () => {
    previewDayIndex = Math.max(0, previewDayIndex - 1);
    renderDayPreview();
  });
  document.getElementById('btn-next-day').addEventListener('click', () => {
    previewDayIndex = Math.min(90, previewDayIndex + 1);
    renderDayPreview();
  });
  document.getElementById('btn-export-json').addEventListener('click', exportJson);
  document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
}

// ─── Appliance list ───

function renderApplianceList() {
  const el = document.getElementById('appliance-list');
  el.innerHTML = appliances.map((a, i) => `
    <div class="appliance-row">
      <label class="ap-toggle">
        <input type="checkbox" class="ap-enabled" data-idx="${i}" ${a.enabled ? 'checked' : ''}>
        <span class="ap-name">${a.name}</span>
      </label>
      <div class="ap-watts-wrap">
        <input type="number" class="ap-watts" data-idx="${i}" value="${a.watts}" min="100" max="15000" step="100">
        <span class="ap-unit">W</span>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.ap-enabled').forEach(cb =>
    cb.addEventListener('change', e => { appliances[+e.target.dataset.idx].enabled = e.target.checked; })
  );
  el.querySelectorAll('.ap-watts').forEach(inp =>
    inp.addEventListener('change', e => {
      const v = parseInt(e.target.value);
      if (!isNaN(v) && v > 0) appliances[+e.target.dataset.idx].watts = v;
    })
  );
}

// ─── Generate ───

function onGenerate() {
  const btn = document.getElementById('btn-generate');
  btn.textContent = 'Generating…';
  btn.disabled = true;

  setTimeout(() => {
    dataset = generateDataset({ appliances });

    // kWh: each row is 1 minute = 1/60 hour → watts / 60000 = kWh
    const totalKwh = dataset.reduce((s, r) => s + r.watts_total, 0) / 60000;
    const days = dataset.length / MINUTES_PER_DAY;

    setText('res-days', Math.round(days).toString());
    setText('res-points', dataset.length.toLocaleString());
    setText('res-kwh', Math.round(totalKwh).toLocaleString());
    setText('res-avg', (totalKwh / days).toFixed(1));

    document.getElementById('gen-results').classList.remove('hidden');
    previewDayIndex = 0;
    renderDayPreview();

    btn.textContent = 'Regenerate';
    btn.disabled = false;
  }, 10);
}

// ─── Day preview ───

// X-axis: show one label per hour (every 60th minute), empty string otherwise
function buildLabels() {
  return Array.from({ length: MINUTES_PER_DAY }, (_, m) =>
    m % 60 === 0 ? `${String(m / 60).padStart(2, '0')}h` : ''
  );
}

function renderDayPreview() {
  if (!dataset) return;
  const start = previewDayIndex * MINUTES_PER_DAY;
  const dayRows = dataset.slice(start, start + MINUTES_PER_DAY);
  if (!dayRows.length) return;

  const { date, day_of_week } = dayRows[0];
  document.getElementById('preview-date').textContent = `${day_of_week}, ${date}`;

  const data = dayRows.map(r => r.watts_total);

  if (!dayChart) {
    dayChart = new Chart(document.getElementById('day-preview-chart'), {
      type: 'line',
      data: {
        labels: buildLabels(),
        datasets: [{
          data,
          borderColor: '#2dd4bf',
          backgroundColor: 'rgba(45,212,191,0.07)',
          borderWidth: 1,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
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
              title: (items) => {
                const m = items[0].dataIndex;
                return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
              },
              label: c => ` ${c.parsed.y.toLocaleString()} W`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: '#64748b',
              font: { size: 9 },
              maxRotation: 0,
              // Only render non-empty labels
              callback: (_, i) => buildLabels()[i] || null,
              maxTicksLimit: 24,
            },
            grid: { display: false },
          },
          y: {
            min: 0,
            ticks: { color: '#64748b', font: { size: 10 }, callback: v => `${v} W` },
            grid: { color: 'rgba(51,65,85,0.3)' },
          },
        },
      },
    });
  } else {
    dayChart.data.datasets[0].data = data;
    dayChart.update('none');
  }

  // ── Appliance event summary ──
  const enabledApps = appliances.filter(a => a.enabled);
  const events = [];

  for (const app of enabledApps) {
    let inRun = false, runStart = 0;
    for (let m = 0; m <= MINUTES_PER_DAY; m++) {
      const on = m < MINUTES_PER_DAY && dayRows[m].appliances[app.id];
      if (on && !inRun)       { inRun = true; runStart = m; }
      else if (!on && inRun)  { inRun = false; events.push({ name: app.name, from: minToTime(runStart), to: minToTime(m), watts: app.watts }); }
    }
  }

  document.getElementById('day-appliance-summary').innerHTML = events.length
    ? events.map(e => `
        <div class="ap-event">
          <span class="ap-event-name">${e.name}</span>
          <span class="ap-event-time">${e.from} → ${e.to}</span>
          <span class="ap-event-watts">${e.watts.toLocaleString()} W</span>
        </div>`).join('')
    : '<div class="gen-mix-empty">No major appliance events recorded for this day</div>';
}

function minToTime(minute) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

// ─── Export ───

function exportJson() {
  if (!dataset) return;
  triggerDownload(
    new Blob([JSON.stringify(dataset, null, 2)], { type: 'application/json' }),
    'household_consumption.json'
  );
}

function exportCsv() {
  if (!dataset) return;
  const appIds = appliances.filter(a => a.enabled).map(a => a.id);
  const header = ['timestamp', 'date', 'day_of_week', 'minute', 'watts_total', ...appIds].join(',');
  const rows = dataset.map(r =>
    [r.timestamp, r.date, r.day_of_week, r.minute, r.watts_total,
      ...appIds.map(id => r.appliances[id] ? '1' : '0')].join(',')
  );
  triggerDownload(
    new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }),
    'household_consumption.csv'
  );
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
