import { getHourlyImbalancePrices } from '../api/elia.js';

let priceData = [];
let loaded = false;
let rafId = null;

export function initPricePanel() {
  // Called by main.js tab switch when "prices" view becomes active
}

export async function loadPriceData() {
  if (loaded) {
    renderPriceChart();
    return;
  }

  const dateEl = document.getElementById('price-date');
  if (dateEl) dateEl.textContent = 'Loading…';

  priceData = await getHourlyImbalancePrices();
  loaded = true;

  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-BE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  }

  updatePriceStats();
  renderPriceChart();
}

function updatePriceStats() {
  if (!priceData.length) return;

  const now = new Date();
  const currentHour = now.getHours();
  const current = priceData.find(d => d.hour === currentHour);

  const prices = priceData.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  const minEntry = priceData.find(d => d.price === minPrice);
  const maxEntry = priceData.find(d => d.price === maxPrice);

  const fmt = p => `€${p.toFixed(3)}`;
  const fmtH = h => `${String(h).padStart(2, '0')}:00`;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('price-current', current ? fmt(current.price) : '—');
  set('price-min-time', minEntry ? fmtH(minEntry.hour) : '—');
  set('price-min-val', fmt(minPrice) + '/kWh');
  set('price-max-time', maxEntry ? fmtH(maxEntry.hour) : '—');
  set('price-max-val', fmt(maxPrice) + '/kWh');
  set('price-avg', fmt(avgPrice));

  const cheapHours = priceData
    .filter(d => d.price < avgPrice * 0.85)
    .map(d => fmtH(d.hour));

  const tipEl = document.getElementById('price-tip');
  if (tipEl) {
    if (cheapHours.length) {
      const saving = Math.round((1 - minPrice / avgPrice) * 100);
      tipEl.innerHTML = `💡 <strong>Best time to run appliances:</strong> ${cheapHours.slice(0, 4).join(', ')} — up to ${saving}% cheaper than the daily average`;
    } else {
      tipEl.innerHTML = `⚡ Prices are relatively stable today.`;
    }
  }
}

export function renderPriceChart() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(_drawChart);
}

function _drawChart() {
  const canvas = document.getElementById('price-chart-canvas');
  if (!canvas || !priceData.length) return;

  const DPR = window.devicePixelRatio || 1;
  const cW = canvas.offsetWidth;
  const cH = canvas.offsetHeight;
  if (!cW || !cH) return;

  canvas.width = cW * DPR;
  canvas.height = cH * DPR;
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  const PAD = { top: 44, right: 16, bottom: 36, left: 52 };
  const chartW = cW - PAD.left - PAD.right;
  const chartH = cH - PAD.top - PAD.bottom;

  const prices = priceData.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const range = maxPrice - minPrice || 0.001;
  const yMin = Math.max(0, minPrice - range * 0.1);
  const yMax = maxPrice + range * 0.12;
  const yRange = yMax - yMin;

  const currentHour = new Date().getHours();

  const sorted = [...prices].sort((a, b) => a - b);
  const cheapThresh = sorted[Math.floor(sorted.length * 0.28)];
  const expThresh = sorted[Math.floor(sorted.length * 0.78)];

  const barW = chartW / 24;
  const gap = Math.max(1.5, barW * 0.14);

  // Y-axis gridlines
  ctx.font = `11px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textAlign = 'right';
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + (yRange / yTicks) * i;
    const y = PAD.top + chartH - (i / yTicks) * chartH;
    ctx.strokeStyle = 'rgba(51,65,85,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + chartW, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#64748b';
    ctx.fillText(`€${v.toFixed(2)}`, PAD.left - 5, y + 4);
  }

  let minIdx = 0, maxIdx = 0;
  priceData.forEach((d, i) => {
    if (d.price <= priceData[minIdx].price) minIdx = i;
    if (d.price >= priceData[maxIdx].price) maxIdx = i;
  });

  // Draw bars
  priceData.forEach((d, i) => {
    const x = PAD.left + i * barW + gap / 2;
    const w = barW - gap;
    const barH = Math.max(2, ((d.price - yMin) / yRange) * chartH);
    const y = PAD.top + chartH - barH;

    let color;
    if (d.price <= cheapThresh) color = '#a78bfa';
    else if (d.price >= expThresh) color = '#f97316';
    else color = '#1a6b5e';

    ctx.globalAlpha = d.isActual ? 1 : 0.42;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, barH, [3, 3, 0, 0]);
    else ctx.rect(x, y, w, barH);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Current hour highlight
    if (i === currentHour) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - 1, y - 1, w + 2, barH + 1, [3, 3, 0, 0]);
      else ctx.rect(x - 1, y - 1, w + 2, barH + 1);
      ctx.stroke();
    }

    // Hour labels every 3h
    if (i % 3 === 0) {
      ctx.fillStyle = i === currentHour ? '#cbd5e1' : '#475569';
      ctx.textAlign = 'center';
      ctx.font = `10px -apple-system, sans-serif`;
      ctx.fillText(String(i).padStart(2, '0'), x + w / 2, PAD.top + chartH + 18);
    }
  });

  // Callout helper
  function drawCallout(idx, label, bgColor) {
    const d = priceData[idx];
    const barH = Math.max(2, ((d.price - yMin) / yRange) * chartH);
    const bx = PAD.left + idx * barW + barW / 2;
    const by = PAD.top + chartH - barH - 10;

    ctx.font = `bold 11px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    const tw = ctx.measureText(label).width;
    const bw = tw + 14; const bh = 18;
    const cx = Math.max(PAD.left + bw / 2 + 2, Math.min(PAD.left + chartW - bw / 2 - 2, bx));
    const cy = Math.max(PAD.top + bh / 2 + 2, by - bh / 2);

    ctx.strokeStyle = bgColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.moveTo(bx, PAD.top + chartH - barH); ctx.lineTo(cx, cy + bh / 2); ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.fillStyle = bgColor;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - bw / 2, cy - bh / 2, bw, bh, 5);
    else ctx.rect(cx - bw / 2, cy - bh / 2, bw, bh);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, cx, cy + 4);
  }

  const fmt = p => `€${p.toFixed(2)}`;
  drawCallout(maxIdx, fmt(priceData[maxIdx].price), '#ea6c10');
  drawCallout(minIdx, fmt(priceData[minIdx].price), '#7c3aed');
}
