import { FUEL_COLORS } from '../api/elia.js';

export async function initClockView() {
  const container = document.getElementById('view-clock');
  container.innerHTML = `
    <div id="clock-canvas-wrapper">
      <div id="clock-container">
        <canvas id="clock-canvas" width="500" height="500"></canvas>
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
  drawClock({ totalMw: 0, mixPct: [] });
}

// Estimate CO₂ based on fuel mix (g/kWh)
function estimateCO2(mixPct) {
  const factors = { 'Natural Gas': 490, 'Nuclear': 12, 'Solar': 45, 'Wind Offshore': 11, 'Wind Onshore': 11, 'Biofuels': 230, 'Water': 24, 'Other Fossil Fuels': 820, 'Other': 300, 'Energy storage': 100 };
  let total = 0;
  let covered = 0;
  for (const e of mixPct) {
    const f = factors[e.fuel] || 100;
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
  
  const renewable = mixPct.filter(e => ['Solar','Wind Offshore','Wind Onshore','Water','Biofuels'].includes(e.fuel));
  const renPct = renewable.reduce((s, e) => s + e.pct, 0);
  document.getElementById('stat-renewable').textContent = renPct ? renPct.toFixed(1) : '—';

  drawClock(state);
  
  // Legend
  const legend = document.getElementById('fuel-legend');
  legend.innerHTML = mixPct.map(e => `
    <div class="fuel-legend-item">
      <span class="fuel-legend-dot" style="background:${FUEL_COLORS[e.fuel] || '#888'}"></span>
      ${e.fuel} ${e.pct.toFixed(1)}%
    </div>
  `).join('');
}

function drawClock({ mixPct, totalMw }) {
  const canvas = document.getElementById('clock-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 500, H = 500, cx = W/2, cy = H/2, outerR = 220, innerR = 120;
  
  ctx.clearRect(0, 0, W, H);
  
  // Outer ring - 24h markers
  ctx.strokeStyle = '#2a3560';
  ctx.lineWidth = 2;
  for (let h = 0; h < 24; h++) {
    const angle = (h / 24) * Math.PI * 2 - Math.PI/2;
    const len = h % 3 === 0 ? 15 : 8;
    const x1 = cx + Math.cos(angle) * outerR;
    const y1 = cy + Math.sin(angle) * outerR;
    const x2 = cx + Math.cos(angle) * (outerR - len);
    const y2 = cy + Math.sin(angle) * (outerR - len);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    
    // Hour labels
    if (h % 3 === 0) {
      ctx.fillStyle = '#8892b0';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const labelR = outerR - 28;
      ctx.fillText(h + 'h', cx + Math.cos(angle) * labelR, cy + Math.sin(angle) * labelR);
    }
  }
  
  // Donut - generation mix
  if (mixPct.length) {
    let startAngle = -Math.PI / 2;
    for (const e of mixPct) {
      const sliceAngle = (e.pct / 100) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR - 30, startAngle, startAngle + sliceAngle);
      ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = FUEL_COLORS[e.fuel] || '#888';
      ctx.fill();
      startAngle += sliceAngle;
    }
    
    // Ring border
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 30, 0, Math.PI * 2);
    ctx.strokeStyle = '#2a3560';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  // Center text
  ctx.fillStyle = '#e8edf5';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(totalMw ? Math.round(totalMw).toLocaleString() + ' MW' : 'Loading...', cx, cy);
  
  // Current hour text
  const now = new Date();
  ctx.font = '14px sans-serif';
  ctx.fillStyle = '#8892b0';
  ctx.fillText(now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0'), cx, cy + 40);
  
  // Sweep hand
  const hours = now.getHours() + now.getMinutes() / 60;
  const handAngle = (hours / 24) * Math.PI * 2 - Math.PI/2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(handAngle) * (outerR - 50), cy + Math.sin(handAngle) * (outerR - 50));
  ctx.strokeStyle = '#4ECDC4';
  ctx.lineWidth = 3;
  ctx.stroke();
  
  // Hand center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#4ECDC4';
  ctx.fill();
}

// Redraw every 30s to update the hand
setInterval(() => {
  if (document.getElementById('view-clock').classList.contains('active')) {
    const canvas = document.getElementById('clock-canvas');
    if (canvas) drawClock({ mixPct: window.__lastMixPct || [], totalMw: window.__lastTotalMw || 0 });
  }
}, 30000);

export function __clockStore(mixPct, totalMw) {
  window.__lastMixPct = mixPct;
  window.__lastTotalMw = totalMw;
}
