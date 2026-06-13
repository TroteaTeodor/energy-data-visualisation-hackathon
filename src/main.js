import { getCurrentMix, computeMixPercentages, checkMyths } from './api/elia.js';
import { initClockView, updateClockView, __clockStore } from './views/clock.js';
import { initMapView, updateMapView } from './views/map.js';
import { initHeatmapView, updateHeatmapView } from './views/heatmap.js';

// Tab navigation
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
  });
});

// State
let state = { mix: {}, totalMw: 0, mixPct: [], myths: [] };

// Poll data & update all views
async function updateAll() {
  try {
    const raw = await getCurrentMix();
    const { entries, total } = computeMixPercentages(raw);
    state.mix = raw;
    state.totalMw = total;
    state.mixPct = entries;
    state.myths = checkMyths(raw, total);

    updateClockView(state);
    __clockStore(state.mixPct, state.totalMw);
    updateMapView(state);
    updateHeatmapView(state);
    showMythCards(state.myths);
  } catch (err) {
    console.error('Update failed:', err);
  }
}

// Myth card display
let mythIndex = 0;
function showMythCards(myths) {
  const card = document.getElementById('myth-card');
  if (!myths.length) { card.classList.add('hidden'); return; }
  
  const m = myths[mythIndex % myths.length];
  card.innerHTML = `
    <button class="myth-close" onclick="this.parentElement.classList.add('hidden')">×</button>
    <div class="myth-title">${m.icon} ${m.title}</div>
    <div class="myth-text">${m.text}</div>
  `;
  card.classList.remove('hidden');
  mythIndex = (mythIndex + 1) % myths.length;
}

// Cycle myths every 8s
setInterval(() => {
  if (state.myths.length) showMythCards(state.myths);
}, 8000);

// Init
async function init() {
  await initClockView();
  await initMapView();
  await initHeatmapView();
  await updateAll();
  setInterval(updateAll, 5 * 60 * 1000);
}

init();
