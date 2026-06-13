import Chart from 'chart.js/auto';
import { APPLIANCES } from '../generator/appliances.js';
import { generateDataset } from '../generator/generate.js';

let dataset = null;
let previewDayIndex = 0;
let dayChart = null;

// Mutable copy of appliance config — user can toggle/edit before generating
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

  // Defer one tick so the button label updates before the synchronous work
  setTimeout(() => {
    dataset = generateDataset({ appliances });

    const totalKwh = dataset.reduce((s, r) => s + r.watts_total * 0.25, 0) / 1000;
    setText('res-days', '91');
    setText('res-points', dataset.length.toLocaleString());
    setText('res-kwh', Math.round(totalKwh).toLocaleString());
    setText('res-avg', (totalKwh / 91).toFixed(1));

    document.getElementById('gen-results').classList.remove('hidden');
    previewDayIndex = 0;
    renderDayPreview();

    btn.textContent = 'Regenerate';
    btn.disabled = false;
  }, 10);
}

// ─── Day preview ───

function renderDayPreview() {
  if (!dataset) return;
  const daySlots = dataset.slice(previewDayIndex * 96, (previewDayIndex + 1) * 96);
  if (!daySlots.length) return;

  const { date, day_of_week } = daySlots[0];
  document.getElementById('preview-date').textContent = `${day_of_week}, ${date}`;

  const labels = daySlots.map((_, i) => {
    const h = Math.floor(i / 4);
    const m = (i % 4) * 15;
    return (m === 0) ? `${String(h).padStart(2, '0')}h` : '';
  });
  const data = daySlots.map(r => r.watts_total);

  if (!dayChart) {
    dayChart = new Chart(document.getElementById('day-preview-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data,
          borderColor: '#2dd4bf',
          backgroundColor: 'rgba(45,212,191,0.07)',
          borderWidth: 1.5,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: c => ` ${c.parsed.y.toLocaleString()} W` } },
        },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 0 },
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
    dayChart.data.labels = labels;
    dayChart.data.datasets[0].data = data;
    dayChart.update('none');
  }

  // ── Appliance events summary ──
  const enabledApps = appliances.filter(a => a.enabled);
  const events = [];

  for (const app of enabledApps) {
    let inRun = false;
    let runStart = 0;
    for (let s = 0; s <= 96; s++) {
      const on = s < 96 && daySlots[s].appliances[app.id];
      if (on && !inRun) { inRun = true; runStart = s; }
      else if (!on && inRun) {
        inRun = false;
        events.push({ name: app.name, from: slotToTime(runStart), to: slotToTime(s), watts: app.watts });
      }
    }
  }

  const summary = document.getElementById('day-appliance-summary');
  summary.innerHTML = events.length
    ? events.map(e => `
        <div class="ap-event">
          <span class="ap-event-name">${e.name}</span>
          <span class="ap-event-time">${e.from} → ${e.to}</span>
          <span class="ap-event-watts">${e.watts.toLocaleString()} W</span>
        </div>`).join('')
    : '<div class="gen-mix-empty">No major appliance events recorded for this day</div>';
}

function slotToTime(slot) {
  return `${String(Math.floor(slot / 4)).padStart(2, '0')}:${String((slot % 4) * 15).padStart(2, '0')}`;
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
  const header = ['timestamp', 'date', 'day_of_week', 'slot', 'watts_total', ...appIds].join(',');
  const rows = dataset.map(r =>
    [r.timestamp, r.date, r.day_of_week, r.slot, r.watts_total,
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
