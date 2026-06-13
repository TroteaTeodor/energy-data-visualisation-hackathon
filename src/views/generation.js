import Chart from 'chart.js/auto';
import { APPLIANCES } from '../generator/appliances.js';
import { generateDataset } from '../generator/generate.js';
import { generateEvProfile } from '../generator/ev.js';
import { generatePricesForDate } from '../api/elia.js';

const MINUTES_PER_DAY = 1440;

let dataset          = null;
let weekIndex        = 0;
let weekCharts       = [];   // 7 Chart instances, created once on first generate
let applianceCharts  = [];   // 1 per appliance row

// Mutable copy — user can toggle/edit before generating
let appliances = APPLIANCES.map(a => ({ ...a }));

export function initGeneration() {
  renderApplianceList();
  document.getElementById('btn-generate').addEventListener('click', onGenerate);
  document.getElementById('btn-prev-week').addEventListener('click', () => {
    weekIndex = Math.max(0, weekIndex - 1);
    renderWeekPreview();
  });
  document.getElementById('btn-next-week').addEventListener('click', () => {
    const totalWeeks = Math.ceil((dataset.length / MINUTES_PER_DAY) / 7);
    weekIndex = Math.min(totalWeeks - 1, weekIndex + 1);
    renderWeekPreview();
  });
  document.getElementById('btn-export-json').addEventListener('click', exportJson);
  document.getElementById('btn-export-csv').addEventListener('click', exportCsv);
  document.getElementById('btn-save-db').addEventListener('click', saveToDatabase);
}

// ─── Appliance list ───

function renderApplianceList() {
  applianceCharts.forEach(c => c.destroy());
  applianceCharts = [];

  const el = document.getElementById('appliance-list');
  el.innerHTML = appliances.map((a, i) => `
    <div class="appliance-row">
      <div class="ap-row-top">
        <label class="ap-toggle">
          <input type="checkbox" class="ap-enabled" data-idx="${i}" ${a.enabled ? 'checked' : ''}>
          <span class="ap-name">${a.name}</span>
        </label>
        <div class="ap-characteristic">
          <canvas id="ap-chart-${i}"></canvas>
        </div>
        <div class="ap-watts-wrap">
          <input type="number" class="ap-watts" data-idx="${i}" value="${a.watts}" min="100" max="15000" step="100">
          <span class="ap-unit">W</span>
        </div>
      </div>
    </div>
  `).join('');

  appliances.forEach((app, i) => {
    const { profile, labels } = characteristicProfile(app);
    applianceCharts.push(new Chart(document.getElementById(`ap-chart-${i}`), {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: profile,
          borderColor: '#2dd4bf',
          backgroundColor: 'rgba(45,212,191,0.1)',
          borderWidth: 1.5,
          fill: true,
          tension: 0.3,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: {
            ticks: { color: '#64748b', font: { size: 8 }, maxRotation: 0, maxTicksLimit: 6 },
            grid: { display: false },
          },
          y: {
            min: 0,
            ticks: {
              color: '#64748b',
              font: { size: 8 },
              maxTicksLimit: 3,
              callback: v => v === 0 ? '0' : `${(v / 1000).toFixed(1)}k`,
            },
            grid: { color: 'rgba(51,65,85,0.2)' },
          },
        },
      },
    }));
  });

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

// ─── Characteristic profile (noise-free, for display only) ───

function characteristicProfile(app) {
  let raw;

  if (app.id === 'ev_charger') {
    // Fixed SoC params so the CC/CV shape is always clearly visible
    const ev = generateEvProfile(app.watts, { startSoc: 0.30, targetSoc: 0.85 });
    raw = ev ? ev.profile : [];
  } else if (app.phases) {
    raw = noiselessPhaseProfile(app.phases);
  } else {
    raw = noiselessRampProfile(app.watts, app.durationMinutes);
  }

  const labels = buildCharacteristicLabels(raw.length);
  return { profile: raw, labels };
}

function noiselessPhaseProfile(phases) {
  const result = [];
  for (const phase of phases) {
    if (phase.thermostat) {
      let t = 0;
      while (t < phase.duration) {
        const onLen = Math.min(phase.onMin, phase.duration - t);
        for (let i = 0; i < onLen; i++) { result.push(phase.watts); t++; }
        const offLen = Math.min(phase.offMin, phase.duration - t);
        for (let i = 0; i < offLen; i++) { result.push(phase.offWatts ?? 50); t++; }
      }
    } else {
      for (let i = 0; i < phase.duration; i++) result.push(phase.watts);
    }
  }
  return result;
}

function noiselessRampProfile(watts, durationMinutes) {
  const ramp = Math.max(1, Math.floor(durationMinutes * 0.05));
  return Array.from({ length: durationMinutes }, (_, i) => {
    if (i < ramp) return Math.round(watts * (0.6 + 0.4 * (i / ramp)));
    if (i >= durationMinutes - ramp) return Math.round(watts * (0.6 + 0.4 * ((durationMinutes - 1 - i) / ramp)));
    return watts;
  });
}

function buildCharacteristicLabels(len) {
  if (len <= 0) return [];
  // Choose a tick interval that gives 4–6 readable labels
  const useHours = len > 120;
  const interval = useHours
    ? 60 * Math.ceil(len / 60 / 5)   // ~5 hour ticks
    : (len <= 10 ? 1 : len <= 30 ? 5 : 15); // minute ticks

  return Array.from({ length: len }, (_, i) => {
    if (i % interval !== 0 && i !== len - 1) return '';
    if (useHours) {
      const h = i / 60;
      return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
    }
    return `${i}m`;
  });
}

// ─── Generate ───

function onGenerate() {
  const btn = document.getElementById('btn-generate');
  btn.textContent = 'Generating…';
  btn.disabled = true;

  setTimeout(() => {
    // Destroy old charts so canvases can be reused
    weekCharts.forEach(c => c.destroy());
    weekCharts = [];

    dataset = generateDataset({ appliances });

    const totalKwh = dataset.reduce((s, r) => s + r.watts_total, 0) / 60000;
    const days = dataset.length / MINUTES_PER_DAY;

    setText('res-days',   Math.round(days).toString());
    setText('res-points', dataset.length.toLocaleString());
    setText('res-kwh',    Math.round(totalKwh).toLocaleString());
    setText('res-avg',    (totalKwh / days).toFixed(1));

    document.getElementById('gen-results').classList.remove('hidden');
    weekIndex = 0;
    initWeekCharts();
    renderWeekPreview();

    btn.textContent = 'Regenerate';
    btn.disabled = false;
  }, 10);
}

// ─── Week charts ───

// X-axis labels: show 00h / 06h / 12h / 18h, empty elsewhere
const WEEK_LABELS = Array.from({ length: MINUTES_PER_DAY }, (_, m) =>
  m % 360 === 0 ? `${String(m / 60).padStart(2, '0')}h` : ''
);

function makeChartOptions(yMax) {
  return {
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
          label: c => ` ${c.parsed.y.toLocaleString()} W`,
        },
      },
    },
    scales: {
      x: {
        ticks: {
          color: '#64748b',
          font: { size: 8 },
          maxRotation: 0,
          callback: (_, i) => WEEK_LABELS[i] || null,
          maxTicksLimit: 5,
        },
        grid: { display: false },
      },
      y: {
        min: 0,
        max: yMax,
        ticks: {
          color: '#64748b',
          font: { size: 8 },
          maxTicksLimit: 4,
          callback: v => v === 0 ? '0W' : `${(v / 1000).toFixed(1)}k`,
        },
        grid: { color: 'rgba(51,65,85,0.25)' },
      },
    },
  };
}

function initWeekCharts() {
  const container = document.getElementById('week-charts');
  container.innerHTML = Array.from({ length: 7 }, (_, i) => `
    <div class="week-day-card" id="wdc-${i}">
      <div class="week-day-name" id="wdn-${i}">—</div>
      <div class="week-day-date" id="wdd-${i}">—</div>
      <div class="week-chart-wrap"><canvas id="wc-${i}"></canvas></div>
    </div>
  `).join('');

  for (let i = 0; i < 7; i++) {
    weekCharts.push(new Chart(document.getElementById(`wc-${i}`), {
      type: 'line',
      data: {
        labels: WEEK_LABELS,
        datasets: [{
          data: [],
          borderColor: '#2dd4bf',
          backgroundColor: 'rgba(45,212,191,0.07)',
          borderWidth: 1,
          fill: true,
          tension: 0.2,
          pointRadius: 0,
        }],
      },
      options: makeChartOptions(0),
    }));
  }
}

function renderWeekPreview() {
  if (!dataset || !weekCharts.length) return;

  const totalDays  = dataset.length / MINUTES_PER_DAY;
  const totalWeeks = Math.ceil(totalDays / 7);
  setText('preview-week', `Week ${weekIndex + 1} of ${totalWeeks}`);

  // Collect this week's days
  const weekDays = [];
  for (let d = 0; d < 7; d++) {
    const dayIdx = weekIndex * 7 + d;
    if (dayIdx >= totalDays) break;
    weekDays.push({ dayIdx, rows: dataset.slice(dayIdx * MINUTES_PER_DAY, (dayIdx + 1) * MINUTES_PER_DAY) });
  }

  // Shared Y-axis max across the week
  const yMax = weekDays.reduce((max, { rows }) => {
    const dayMax = rows.reduce((m, r) => Math.max(m, r.watts_total), 0);
    return Math.max(max, dayMax);
  }, 0);
  const yMaxRounded = Math.ceil(yMax / 500) * 500;

  for (let i = 0; i < 7; i++) {
    const card = document.getElementById(`wdc-${i}`);
    if (i >= weekDays.length) {
      card.style.visibility = 'hidden';
      continue;
    }
    card.style.visibility = 'visible';

    const { rows } = weekDays[i];
    const { date, day_of_week } = rows[0];

    document.getElementById(`wdn-${i}`).textContent = day_of_week.slice(0, 3);
    document.getElementById(`wdd-${i}`).textContent = date.slice(5).replace('-', '/');

    weekCharts[i].data.datasets[0].data = rows.map(r => r.watts_total);
    weekCharts[i].options.scales.y.max  = yMaxRounded;
    weekCharts[i].update('none');
  }
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

// ─── Save to database ───

async function saveToDatabase() {
  if (!dataset) return;

  const btn = document.getElementById('btn-save-db');
  const status = document.getElementById('db-status');

  btn.disabled = true;
  btn.textContent = 'Saving…';
  status.textContent = '';
  status.className = 'db-status';

  // Pre-group into one object per day (much smaller payload than 131k flat rows)
  const byDate = new Map();
  for (const row of dataset) {
    if (!byDate.has(row.date)) {
      byDate.set(row.date, {
        date: row.date,
        day_of_week: row.day_of_week,
        watts_series: [],
        price_series: generatePricesForDate(row.date),
      });
    }
    byDate.get(row.date).watts_series.push(row.watts_total);
  }

  try {
    const res = await fetch('/api/households/1/consumption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ days: [...byDate.values()] }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    const { saved } = await res.json();
    status.textContent = `Saved ${saved} days`;
    status.classList.add('db-status--ok');
  } catch (e) {
    status.textContent = `Save failed: ${e.message}`;
    status.classList.add('db-status--err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save to database';
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
