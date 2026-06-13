import { FUEL_COLORS } from '../api/elia.js';

let lastMixPct = [];
let lastTotalMw = 0;

export function storeClockState(mixPct, totalMw) {
  lastMixPct = mixPct;
  lastTotalMw = totalMw;
}

export async function initClockView() {
  const container = document.getElementById('view-clock');
  container.innerHTML = `
    <div id="clock-canvas-wrapper">
      <div id="clock-container">
        <canvas id="clock-canvas" width="480" height="480"></canvas>
      </div>
      <div id="clock-stats">
        <div class="stat-card">
          <div class="stat-value" id="stat-load">—</div>
          <div class="stat-label">Total Load</div>
          <div class="stat-unit">MW</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="stat-co2">—</div>
          <div class="stat-label">CO₂ Intensity</div>
          <div class="stat-unit">g/kWh</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="stat-renewable">—</div>
          <div class="stat-label">Renewable</div>
          <div class="stat-unit">%</div>
        </div>
      </div>
      <div id="fuel-legend"></div>
    </div>
  `;
  drawClock([]);
}

const CO2_FACTORS = {
  'Natural Gas': 490, 'Nuclear': 12, 'Solar': 45,
  'Wind Offshore': 11, 'Wind Onshore': 11, 'Biofuels': 230,
  'Water': 24, 'Other Fossil Fuels': 820, 'Other': 300,
  'Energy storage': 100
};

function estimateCO2(mixPct) {
  let total = 0, covered = 0;
  for (const e of mixPct) {
    const f = CO2_FACTORS[e.fuel] || 100;
    total += e.pct * f;
    covered += e.pct;
  }
  return covered > 0 ? total / covered : 0;
}

export function updateClockView(state) {
  const { totalMw, mixPct } = state;
  document.getElementById('stat-load').textContent = totalMw ? Math.round(totalMw).toLocaleString() : '—';
  const co2 = estimateCO2(mixPct);
  document.getElementById('stat-co2').textContent = co2 ? Math.round(co2) : '—';
  const renPct = mixPct
    .filter(e => ['Solar','Wind Offshore','Wind Onshore','Water','Biofuels'].includes(e.fuel))
    .reduce((s, e) => s + e.pct, 0);
  document.getElementById('stat-renewable').textContent = renPct ? renPct.toFixed(1) : '—';
  drawClock(mixPct, totalMw);

  const legend = document.getElementById('fuel-legend');
  legend.innerHTML = mixPct.map(e => `
    <div class="fuel-legend-item">
      <span class="fuel-legend-dot" style="background:${FUEL_COLORS[e.fuel] || '#888'}"></span>
      ${e.fuel}
      <span class="fuel-legend-pct">${e.pct.toFixed(1)}%</span>
    </div>
  `).join('');
}

function drawClock(mixPct, totalMw) {
  const canvas = document.getElementById('clock-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // Responsive: respect display size
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const displaySize = Math.min(rect.width, 480);
  canvas.width = displaySize * dpr;
  canvas.height = displaySize * dpr;
  ctx.scale(dpr, dpr);

  const W = displaySize, H = displaySize;
  const cx = W/2, cy = H/2;
  const outerR = W * 0.44;
  const innerR = W * 0.24;
  const donutR = W * 0.36;

  ctx.clearRect(0, 0, W, H);

  // Outer ring - 24h markers
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  for (let h = 0; h < 24; h++) {
    const angle = (h / 24) * Math.PI * 2 - Math.PI/2;
    const len = h % 3 === 0 ? 12 : 6;
    const x1 = cx + Math.cos(angle) * outerR;
    const y1 = cy + Math.sin(angle) * outerR;
    const x2 = cx + Math.cos(angle) * (outerR - len);
    const y2 = cy + Math.sin(angle) * (outerR - len);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

    if (h % 3 === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = `${W * 0.028}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lr = outerR - W * 0.06;
      ctx.fillText(h + 'h', cx + Math.cos(angle) * lr, cy + Math.sin(angle) * lr);
    }
  }

  // Donut - generation mix
  if (mixPct && mixPct.length) {
    let startAngle = -Math.PI / 2;
    for (const e of mixPct) {
      const sliceAngle = (e.pct / 100) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, donutR, startAngle, startAngle + sliceAngle);
      ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = FUEL_COLORS[e.fuel] || '#64748b';
      ctx.fill();
      startAngle += sliceAngle;
    }

    // Donut borders
    ctx.beginPath(); ctx.arc(cx, cy, donutR, 0, Math.PI * 2);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Empty state on donut
    ctx.beginPath(); ctx.arc(cx, cy, donutR, 0, Math.PI * 2);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
  }

  // Center
  if (totalMw) {
    ctx.fillStyle = '#f1f5f9';
    ctx.font = `bold ${W * 0.065}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(totalMw).toLocaleString(), cx, cy - W * 0.02);

    ctx.fillStyle = '#64748b';
    ctx.font = `${W * 0.03}px sans-serif`;
    ctx.fillText('MW', cx, cy + W * 0.06);
  } else {
    ctx.fillStyle = '#64748b';
    ctx.font = `${W * 0.04}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', cx, cy);
  }

  // Current time
  const now = new Date();
  const timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  ctx.fillStyle = '#64748b';
  ctx.font = `${W * 0.032}px sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(timeStr, cx, cy + W * 0.12);

  // Sweep hand
  const hours = now.getHours() + now.getMinutes() / 60;
  const handAngle = (hours / 24) * Math.PI * 2 - Math.PI/2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(handAngle) * (donutR - W * 0.02), cy + Math.sin(handAngle) * (donutR - W * 0.02));
  ctx.strokeStyle = '#2dd4bf';
  ctx.lineWidth = 2.5; ctx.shadowBlur = 8; ctx.shadowColor = 'rgba(45, 212, 191, 0.3)';
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Hand center dot
  ctx.beginPath(); ctx.arc(cx, cy, W * 0.015, 0, Math.PI * 2);
  ctx.fillStyle = '#2dd4bf';
  ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, W * 0.006, 0, Math.PI * 2);
  ctx.fillStyle = '#070b15';
  ctx.fill();
}

// Redraw hand every 30s
setInterval(() => {
  if (document.getElementById('view-clock')?.classList.contains('active')) {
    drawClock(lastMixPct, lastTotalMw);
  }
}, 10000);
