import { getCurrentMix, computeMixPercentages, checkMyths } from './api/elia.js';
import { initClock, updateGenMix, updateStats, updateBestHours, showMyth, storeDashboardState } from './views/dashboard.js';
import { initMap, updateHeatmap, updateFlows, updateMapAttribution, invalidateMap } from './views/map.js';
import { updateConsumption, initConsumption } from './views/consumption.js';
import { initGeneration } from './views/generation.js';

// ─── State ───
let state = { mix: {}, totalMw: 0, mixPct: [], myths: [] };

// ─── Live indicator ───
const liveDot = document.querySelector('.live-dot');
const liveText = document.getElementById('live-text');
const footerStatus = document.getElementById('footer-status');

function setStatus(status, msg) {
  liveDot.className = 'live-dot';
  if (status === 'ok') {
    liveDot.style.background = '#4ade80';
    liveText.textContent = 'Live';
    footerStatus.textContent = msg || 'Connected';
    footerStatus.className = 'ok';
  } else if (status === 'loading') {
    liveDot.style.background = '#fbbf24';
    liveText.textContent = 'Loading';
    footerStatus.textContent = msg || 'Fetching data...';
    footerStatus.className = '';
  } else {
    liveDot.style.background = '#ef4444';
    liveText.textContent = 'Error';
    footerStatus.textContent = msg || 'Using demo data';
    footerStatus.className = 'err';
  }
}

// ─── Main update loop ───
async function updateAll() {
  setStatus('loading');
  try {
    const raw = await getCurrentMix();
    const { entries, total } = computeMixPercentages(raw);
    state.mix = raw;
    state.totalMw = total;
    state.mixPct = entries;
    state.myths = checkMyths(raw, total);

    storeDashboardState(entries, total);
    updateGenMix(entries);
    updateStats(total, entries);
    updateBestHours();
    showMyth(state.myths);
    updateHeatmap(total);
    updateFlows(raw);
    updateConsumption(total);

    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    updateMapAttribution(timeStr);

    setStatus('ok', `Updated ${timeStr}`);
  } catch (err) {
    console.error('Update failed:', err);
    setStatus('error');
  }
}

// ─── Tab navigation ───
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  const views = document.querySelectorAll('.view');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const name = tab.dataset.view;
      tabs.forEach(t => t.classList.toggle('active', t === tab));
      views.forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
      if (name === 'overview') invalidateMap();
      if (name === 'consumption') initConsumption();
    });
  });
}

// ─── Init ───
async function init() {
  setStatus('loading', 'Connecting to grid...');

  initTabs();
  initClock();
  initGeneration();
  await initMap();

  // Initial data load
  await updateAll();

  // Poll every 5 min
  setInterval(updateAll, 5 * 60 * 1000);
}

init();
