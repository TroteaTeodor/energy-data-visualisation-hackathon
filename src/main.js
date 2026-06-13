import { getCurrentMix, computeMixPercentages, checkMyths } from './api/elia.js';
import { initClockView, updateClockView, storeClockState } from './views/clock.js';
import { initMapView, updateMapView } from './views/map.js';
import { initHeatmapView, updateHeatmapView } from './views/heatmap.js';

// ─── State ───
let state = { mix: {}, totalMw: 0, mixPct: [], myths: [] };
let dataSource = 'connecting';

// ─── Loading bar ───
const loadingBar = document.getElementById('loading-bar');
let loadTimer = null;
function showLoading(on) {
  loadingBar.classList.toggle('active', on);
}

// ─── Live indicator ───
const liveDot = document.querySelector('.live-dot');
const liveText = document.getElementById('live-text');
const footerStatus = document.getElementById('footer-status');

function setLiveStatus(status) {
  liveDot.className = 'live-dot';
  if (status === 'ok') {
    liveDot.classList.add('ok');
    liveText.textContent = 'LIVE';
    footerStatus.textContent = 'Data updated just now';
    footerStatus.className = 'footer-status ok';
  } else if (status === 'loading') {
    liveDot.classList.add('loading');
    liveText.textContent = 'LOADING';
    footerStatus.textContent = 'Fetching grid data...';
    footerStatus.className = 'footer-status';
  } else {
    liveDot.classList.add('error');
    liveText.textContent = 'ERROR';
    footerStatus.textContent = 'Using simulated data (API unreachable)';
    footerStatus.className = 'footer-status err';
  }
}

// ─── Tab navigation with map resize ───
const tabViews = {};

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    const viewId = `view-${btn.dataset.view}`;
    document.getElementById(viewId).classList.add('active');

    // Trigger Leaflet map resize when switching to map/heatmap
    setTimeout(() => {
      if (btn.dataset.view === 'map' && window.__mapInstance) {
        window.__mapInstance.invalidateSize();
      }
      if (btn.dataset.view === 'heatmap' && window.__heatmapInstance) {
        window.__heatmapInstance.invalidateSize();
      }
    }, 100);
  });
});

// ─── Poll data ───
async function updateAll() {
  showLoading(true);
  setLiveStatus('loading');
  try {
    const raw = await getCurrentMix();
    const { entries, total } = computeMixPercentages(raw);
    state.mix = raw;
    state.totalMw = total;
    state.mixPct = entries;
    state.myths = checkMyths(raw, total);

    storeClockState(entries, total);
    updateClockView(state);
    updateMapView(state);
    updateHeatmapView(state);
    showMythCards(state.myths);

    dataSource = 'live';
    setLiveStatus('ok');
  } catch (err) {
    console.error('Update failed:', err);
    setLiveStatus('error');
  } finally {
    showLoading(false);
  }
}

// ─── Myth card display ───
let mythIndex = 0;
let mythInterval = null;

function showMythCards(myths) {
  const card = document.getElementById('myth-card');
  const icon = document.getElementById('myth-icon');
  const title = document.getElementById('myth-title');
  const text = document.getElementById('myth-text');
  const closeBtn = document.getElementById('myth-close');

  if (!myths.length) {
    card.classList.add('hidden');
    if (mythInterval) clearInterval(mythInterval);
    return;
  }

  const m = myths[mythIndex % myths.length];
  icon.textContent = m.icon;
  title.textContent = m.title;
  text.textContent = m.text;
  card.classList.remove('hidden');
  mythIndex = (mythIndex + 1) % myths.length;

  // Close handler
  closeBtn.onclick = () => card.classList.add('hidden');

  // Cycle myths
  if (mythInterval) clearInterval(mythInterval);
  mythInterval = setInterval(() => {
    const m2 = state.myths[mythIndex % state.myths.length];
    if (m2) {
      icon.textContent = m2.icon;
      title.textContent = m2.title;
      text.textContent = m2.text;
      card.classList.remove('hidden');
      mythIndex = (mythIndex + 1) % state.myths.length;
    }
  }, 8000);
}

// ─── Init ───
async function init() {
  setLiveStatus('loading');
  showLoading(true);

  await initClockView();
  await initMapView();
  await initHeatmapView();

  await updateAll();

  // Poll every 5 minutes
  setInterval(updateAll, 5 * 60 * 1000);

  // Update timestamp every 30s
  setInterval(() => {
    if (dataSource === 'live') {
      const now = new Date();
      footerStatus.textContent = `Updated ${now.toLocaleTimeString()}`;
    }
  }, 30000);
}

init();
