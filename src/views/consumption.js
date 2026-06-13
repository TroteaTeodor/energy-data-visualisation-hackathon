import Chart from 'chart.js/auto';
import { COMMUNES } from './map.js';

let curve = null;

const TOTAL_POP = COMMUNES.reduce((s, c) => s + c.pop, 0);
const BRUSSELS_SHARE = 0.1; // Brussels ≈ 10% of national load

// Typical Belgian daily demand shape (normalized 0..1), midnight → 23h.
// Low overnight, morning ramp, midday plateau, evening peak ~19h.
const LOAD_PROFILE = [
  0.62, 0.58, 0.55, 0.54, 0.55, 0.60, 0.70, 0.82,
  0.90, 0.93, 0.94, 0.95, 0.93, 0.90, 0.88, 0.89,
  0.92, 0.96, 1.00, 0.99, 0.94, 0.86, 0.76, 0.68,
];

export function updateConsumption(totalMw) {
  const hour = new Date().getHours();
  const nowFactor = LOAD_PROFILE[hour] || 1;

  // ── Stat cards ──
  setText('con-total', totalMw ? Math.round(totalMw).toLocaleString() : '—');
  const brusselsMw = totalMw * BRUSSELS_SHARE;
  setText('con-brussels', totalMw ? Math.round(brusselsMw).toLocaleString() : '—');
  const perCapita = totalMw ? (brusselsMw * 1e6) / TOTAL_POP : 0; // W per person
  setText('con-percapita', totalMw ? Math.round(perCapita).toLocaleString() : '—');
  setText('con-peak', totalMw ? Math.round(nowFactor * 100) : '—');

  // ── 24h demand curve (scaled so current hour ≈ current load) ──
  const canvas = document.getElementById('con-curve');
  if (canvas && totalMw) {
    const scale = totalMw / nowFactor;
    const data = LOAD_PROFILE.map(f => Math.round(f * scale));
    const labels = LOAD_PROFILE.map((_, h) => `${String(h).padStart(2, '0')}:00`);
    const colors = LOAD_PROFILE.map((_, h) => (h === hour ? '#2dd4bf' : 'rgba(45,212,191,0.35)'));

    if (!curve) {
      curve = new Chart(canvas, {
        type: 'bar',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 3, label: 'Load' }] },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (c) => ` ${c.parsed.y.toLocaleString()} MW` } },
          },
          scales: {
            x: { ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { display: false } },
            y: { ticks: { color: '#64748b', font: { size: 10 }, callback: (v) => `${(v / 1000).toFixed(0)}k` }, grid: { color: 'rgba(51,65,85,0.3)' } },
          },
        },
      });
    } else {
      curve.data.datasets[0].data = data;
      curve.data.datasets[0].backgroundColor = colors;
      curve.update();
    }
  }

  // ── Brussels communes breakdown ──
  const list = document.getElementById('con-communes');
  if (list) {
    if (!totalMw) {
      list.innerHTML = '<div class="gen-mix-empty">Waiting for data...</div>';
      return;
    }
    const perCap = brusselsMw / TOTAL_POP;
    const rows = COMMUNES.map(c => ({ name: c.name, pop: c.pop, mw: c.pop * perCap }))
      .sort((a, b) => b.mw - a.mw);
    const maxMw = rows[0]?.mw || 1;
    list.innerHTML = rows.map(r => `
      <div class="breakdown-row commune-row">
        <span class="bd-name">${r.name}</span>
        <div class="cat-track"><div class="cat-fill" style="width:${(r.mw / maxMw) * 100}%;background:#3B8BD4"></div></div>
        <span class="bd-mw">${r.mw.toFixed(1)} MW</span>
      </div>`).join('');
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}
