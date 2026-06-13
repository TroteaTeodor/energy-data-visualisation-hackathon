import 'leaflet';
// refreshEliaData is injected after init to avoid circular imports
let refreshEliaData = null;
export function setEliaRefresher(fn) { refreshEliaData = fn; }

const FLUVIUS_STREET_URL = 'https://opendata.fluvius.be/api/explore/v2.1/catalog/datasets/1_03-verbruiksgegevens-op-straatniveau/records';
let map = null;
let gridLayer = null;
let fallbackLayer = null;
let entryLayer = null;
let markerLayer = null;
let legendAdded = false;
let currentLoadRatio = 0.55;
let currentLoadMw = 0;
let streetConsumptionCache = null;
let fullBelgiumGridLoaded = false;
let belgiumGridFeatures = [];
let belgiumGridTopology = null;  // Map<featureIdx, Set<featureIdx>>
let snappedGenerationSites = [];
let snappedEntryPoints = [];
let activeLinePopup = null;   // { tags, latlng }
let activePopupRef = null;    // actual Leaflet popup object — updated directly
let userMarker = null;
let pathLayer = null;
let userLocation = null;
let showOnlyMyPath = false;

const BELGIUM_BOUNDS = {
  south: 49.5,
  west: 2.3,
  north: 51.6,
  east: 6.5,
};

const FALLBACK_GRID_LINES = [
  { from: { lat: 51.35, lng: 4.28 }, to: { lat: 51.05, lng: 3.72 }, label: 'Zandvliet → Gent', voltage: 380000 },
  { from: { lat: 51.05, lng: 3.72 }, to: { lat: 50.60, lng: 3.10 }, label: 'Gent → Avelin (FR)', voltage: 380000 },
  { from: { lat: 50.60, lng: 3.10 }, to: { lat: 50.45, lng: 5.00 }, label: 'Avelin → Gramme', voltage: 380000 },
  { from: { lat: 50.45, lng: 5.00 }, to: { lat: 50.45, lng: 4.35 }, label: 'Gramme → Bruegel', voltage: 380000 },
  { from: { lat: 50.45, lng: 5.00 }, to: { lat: 50.75, lng: 5.70 }, label: 'Gramme → Lixhe (DE)', voltage: 380000 },
  { from: { lat: 50.45, lng: 4.35 }, to: { lat: 51.00, lng: 4.15 }, label: 'Bruegel → Mercator', voltage: 380000 },
  { from: { lat: 51.00, lng: 4.15 }, to: { lat: 51.35, lng: 4.28 }, label: 'Mercator → Zandvliet', voltage: 380000 },
  { from: { lat: 51.35, lng: 4.28 }, to: { lat: 51.35, lng: 5.45 }, label: 'Zandvliet → Van Eyck (NL)', voltage: 380000 },
  { from: { lat: 51.05, lng: 3.72 }, to: { lat: 50.95, lng: 4.35 }, label: 'Gent → Brussels', voltage: 220000 },
  { from: { lat: 51.00, lng: 4.15 }, to: { lat: 50.85, lng: 4.35 }, label: 'Mercator → Brussels', voltage: 220000 },
  { from: { lat: 50.45, lng: 4.35 }, to: { lat: 50.85, lng: 4.35 }, label: 'Bruegel → Brussels', voltage: 220000 },
  { from: { lat: 51.20, lng: 2.80 }, to: { lat: 51.05, lng: 3.72 }, label: 'NemoLink → Gent', voltage: 1000000, power: 'cable' },
];

const ENTRY_POINTS = [
  { lat: 50.50, lng: 3.15, country: 'France', name: 'Avelin', cap: '~5 GW', color: '#2dd4bf' },
  { lat: 51.35, lng: 5.50, country: 'Netherlands', name: 'Van Eyck', cap: '~3.5 GW', color: '#2dd4bf' },
  { lat: 50.72, lng: 5.75, country: 'Germany', name: 'Lixhe / Oberzier', cap: '~2.5 GW', color: '#2dd4bf' },
  { lat: 51.20, lng: 2.80, country: 'UK', name: 'NemoLink (HVDC)', cap: '~1 GW', color: '#f97316' },
  { lat: 49.55, lng: 6.00, country: 'Luxembourg', name: 'Schifflange', cap: '~0.5 GW', color: '#2dd4bf' },
];

const GENERATION_SITES = [
  { lat: 51.32, lng: 4.27, label: 'Doel Nuclear', type: 'nuclear', cap: '2.9 GW' },
  { lat: 50.53, lng: 5.27, label: 'Tihange Nuclear', type: 'nuclear', cap: '3.0 GW' },
  { lat: 51.50, lng: 3.20, label: 'North Sea Wind', type: 'wind', cap: '2.2 GW' },
  { lat: 51.05, lng: 3.72, label: 'Ringvaart Gas', type: 'gas', cap: '0.9 GW' },
  { lat: 50.95, lng: 4.35, label: 'Drogenbos Gas', type: 'gas', cap: '0.5 GW' },
  { lat: 50.63, lng: 5.58, label: 'Coô Pumped Storage', type: 'storage', cap: '1.1 GW' },
];

export async function initMap() {
  const container = document.getElementById('map');
  if (!container) return;

  map = L.map('map', {
    center: [50.85, 4.35],
    zoom: 9,
    minZoom: 7,
    maxZoom: 18,
    zoomControl: true,
    attributionControl: false,
    preferCanvas: true,
  });

  map.createPane('gridPane');
  map.getPane('gridPane').style.zIndex = 450;
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://carto.com">CARTO</a>',
  }).addTo(map);

  gridLayer = L.layerGroup().addTo(map);
  fallbackLayer = L.layerGroup().addTo(map);
  entryLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  pathLayer = L.layerGroup().addTo(map);

  drawFallbackGrid();
  drawEntryPoints();
  drawGenerationSites();
  addLegend();
  loadStreetConsumptionContext();
  loadFullBelgiumGrid();
  initLocationFeature();

  map.on('resize', () => map.invalidateSize());
  window.addEventListener('resize', () => setTimeout(() => map?.invalidateSize(), 100));
  window.addEventListener('orientationchange', () => setTimeout(() => map?.invalidateSize(), 400));
  setTimeout(() => map.invalidateSize(), 300);
}

async function loadFullBelgiumGrid() {
  if (fullBelgiumGridLoaded) return;

  updateGridStatus('Loading Belgium power grid…');

  try {
    const response = await fetch('/belgium_grid.geojson');
    if (!response.ok) throw new Error(`Failed to load grid data: ${response.status}`);

    const geojson = await response.json();
    const features = geojson.features || [];

    belgiumGridFeatures = features;
    belgiumGridTopology = buildGridTopology(features);
    snappedGenerationSites = GENERATION_SITES.map(site => {
      const snap = snapToNearestGridLine(L.latLng(site.lat, site.lng));
      return { ...site, snapPoint: snap.point, snapFeatureIdx: snap.featureIdx };
    });
    snappedEntryPoints = ENTRY_POINTS.map(ep => {
      const snap = snapToNearestGridLine(L.latLng(ep.lat, ep.lng));
      return { ...ep, label: `${ep.country} · ${ep.name}`, type: 'import', snapPoint: snap.point, snapFeatureIdx: snap.featureIdx };
    });
    map.removeLayer(fallbackLayer); // real grid loaded, fallback lines not needed
    drawBelgiumGridGeoJSON(features);
    fullBelgiumGridLoaded = true;
    updateGridStatus(`${features.length.toLocaleString()} power lines · click for details`);
  } catch (error) {
    console.warn('Belgium grid load failed, showing fallback:', error);
    promoteFallbackGridAsPrimary();
    updateGridStatus('Belgium power grid');
  }
}

function promoteFallbackGridAsPrimary() {
  fallbackLayer.getLayers().forEach(layer => {
    layer.setStyle({ opacity: 0.85 });
    if (layer.options && !layer.options.powerTags) {
      layer.off('click');
      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        const fallbackData = FALLBACK_GRID_LINES.find(line =>
          Math.abs(line.from.lat - layer.getLatLngs()[0][0]) < 0.01
        );
        if (fallbackData) showFallbackLineDetails(fallbackData);
      });
    }
  });
}

function drawBelgiumGridGeoJSON(features) {
  gridLayer.clearLayers();
  fallbackLayer.getLayers().forEach(layer => layer.setStyle?.({ opacity: 0.15 }));

  for (const feature of features) {
    if (feature.geometry?.type !== 'LineString') continue;

    const coords = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const tags = feature.properties || {};
    const style = getPowerLineStyle(tags);

    const line = L.polyline(coords, { ...style, pane: 'gridPane', powerTags: tags })
      .addTo(gridLayer);

    line.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      showLineDetailsFromOSM(tags, e.latlng);
    });
  }
}


function getPowerLineStyle(tags) {
  const voltage = parseVoltage(tags.voltage);
  const powerType = tags.power || 'line';
  const isStreetLevel = powerType === 'minor_line' || voltage < 70000;
  const isCable = powerType === 'cable';

  return {
    color: getVoltageColor(voltage, powerType),
    weight: getLineWeight(voltage, powerType),
    opacity: isStreetLevel ? 0.55 : 0.82,
    dashArray: isCable ? '4, 6' : undefined,
    lineCap: 'round',
    lineJoin: 'round',
  };
}

function getVoltageColor(voltage, powerType) {
  if (powerType === 'cable') return '#f97316';
  if (voltage >= 380000) return '#a78bfa';
  if (voltage >= 220000) return '#60a5fa';
  if (voltage >= 70000) return '#2dd4bf';
  if (voltage > 0) return '#facc15';
  return '#64748b';
}


function getLineWeight(voltage, powerType) {
  if (powerType === 'minor_line') return 1.8;
  if (voltage >= 380000) return 5;
  if (voltage >= 220000) return 4;
  if (voltage >= 70000) return 3.2;
  return 2.2;
}

function parseVoltage(voltageTag) {
  if (!voltageTag) return 0;
  const firstVoltage = String(voltageTag).split(';')[0].trim();
  const numericVoltage = Number(firstVoltage.replace(/[^\d.]/g, ''));
  return Number.isFinite(numericVoltage) ? numericVoltage : 0;
}

function buildLineTooltip(tags) {
  const voltage = parseVoltage(tags.voltage);
  const voltageText = voltage ? `${Math.round(voltage / 1000)} kV` : 'Unknown voltage';
  const name = tags.name || tags.ref || 'Power line';
  const type = tags.power === 'minor_line' ? 'Distribution' : tags.power === 'cable' ? 'Cable' : 'Transmission';
  return `<b>${escapeHtml(name)}</b><br>${type} · ${voltageText} · <i>click for details</i>`;
}

function drawFallbackGrid() {
  for (const line of FALLBACK_GRID_LINES) {
    const style = {
      color: getVoltageColor(line.voltage, line.power),
      weight: getLineWeight(line.voltage, line.power),
      opacity: 0.2,
      dashArray: line.power === 'cable' ? '4, 6' : undefined,
      pane: 'gridPane',
      lineCap: 'round',
    };

    const polyline = L.polyline(
      [[line.from.lat, line.from.lng], [line.to.lat, line.to.lng]],
      { ...style, fallbackLineData: line }
    ).addTo(fallbackLayer);

    polyline.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      showFallbackLineDetails(e.target.options.fallbackLineData);
    });
  }
}

function drawEntryPoints() {
  for (const entryPoint of ENTRY_POINTS) {
    L.circleMarker([entryPoint.lat, entryPoint.lng], {
      radius: 10,
      color: entryPoint.color,
      fillColor: entryPoint.color,
      fillOpacity: 0.25,
      weight: 2,
    }).addTo(entryLayer);

    L.circleMarker([entryPoint.lat, entryPoint.lng], {
      radius: 4,
      color: entryPoint.color,
      fillColor: entryPoint.color,
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(entryLayer);

    const icon = L.divIcon({
      html: `<div class="map-label" style="border-color:${entryPoint.color}55">${entryPoint.country} · ${entryPoint.name}</div>`,
      className: '',
      iconSize: [0, 0],
    });
    L.marker([entryPoint.lat + 0.12, entryPoint.lng], { icon, interactive: false }).addTo(entryLayer);
  }
}

// ─── Brussels communes heatmap ───
export const COMMUNES = [
  { name: 'Brussels Centre', pop: 185000, lat: 50.8503, lng: 4.3517 },
  { name: 'Schaerbeek', pop: 133000, lat: 50.8673, lng: 4.3833 },
  { name: 'Anderlecht', pop: 120000, lat: 50.8333, lng: 4.3000 },
  { name: 'Molenbeek', pop: 98000, lat: 50.8500, lng: 4.3167 },
  { name: 'Ixelles', pop: 87000, lat: 50.8322, lng: 4.3667 },
  { name: 'Uccle', pop: 83000, lat: 50.8000, lng: 4.3333 },
  { name: 'Woluwe-St-Lambert', pop: 58000, lat: 50.8500, lng: 4.4167 },
  { name: 'Forest', pop: 56000, lat: 50.8167, lng: 4.3167 },
  { name: 'Jette', pop: 52000, lat: 50.8667, lng: 4.3167 },
  { name: 'St-Gilles', pop: 50000, lat: 50.8167, lng: 4.3500 },
  { name: 'Etterbeek', pop: 48000, lat: 50.8333, lng: 4.3833 },
  { name: 'Evere', pop: 42000, lat: 50.8667, lng: 4.4000 },
  { name: 'Woluwe-St-Pierre', pop: 42000, lat: 50.8333, lng: 4.4333 },
  { name: 'Auderghem', pop: 34000, lat: 50.8167, lng: 4.4333 },
  { name: 'St-Josse', pop: 27000, lat: 50.8500, lng: 4.3667 },
  { name: 'Ganshoren', pop: 25000, lat: 50.8667, lng: 4.3000 },
  { name: 'Berchem-Ste-Agathe', pop: 25000, lat: 50.8667, lng: 4.2833 },
  { name: 'Watermael-Boitsfort', pop: 25000, lat: 50.8000, lng: 4.4167 },
  { name: 'Koekelberg', pop: 22000, lat: 50.8500, lng: 4.3167 },
];
const TOTAL_POP = COMMUNES.reduce((s, c) => s + c.pop, 0);

function drawGenerationSites() {
  const iconColors = { nuclear: '#a78bfa', wind: '#2dd4bf', gas: '#f97316', storage: '#60a5fa' };
  const iconLabels = { nuclear: 'N', wind: 'W', gas: 'G', storage: 'S' };

  for (const site of GENERATION_SITES) {
    const color = iconColors[site.type] || '#64748b';
    const label = iconLabels[site.type] || '?';
    const icon = L.divIcon({
      html: `<div class="plant-marker" style="background:${color};box-shadow:0 0 12px ${color}77">${label}</div>`,
      className: '',
      iconSize: [22, 22],
    });

    L.marker([site.lat, site.lng], { icon })
      .addTo(markerLayer)
      .bindTooltip(`<b>${site.label}</b><br>Capacity: ${site.cap}`);
  }
}

function addLegend() {
  if (legendAdded) return;

  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div', 'grid-legend');
    div.innerHTML = `
      <b>Power grid</b>
      <span><i style="background:#a78bfa"></i>380 kV</span>
      <span><i style="background:#60a5fa"></i>220 kV</span>
      <span><i style="background:#2dd4bf"></i>High voltage</span>
      <span><i style="background:#facc15"></i>Street distribution</span>
      <span><i style="background:#f97316"></i>Cable / high load</span>
      <small>Geometry: OpenStreetMap power infrastructure</small>
    `;
    return div;
  };
  legend.addTo(map);
  legendAdded = true;
}

async function loadStreetConsumptionContext() {
  const panel = document.getElementById('street-consumption');
  if (!panel) return;

  panel.innerHTML = '<div class="source-note">Loading Fluvius street consumption…</div>';

  try {
    if (!streetConsumptionCache) {
      const url = new URL(FLUVIUS_STREET_URL);
      url.searchParams.set('limit', '5');
      url.searchParams.set('select', 'hoofdgemeente,straat,afname_kwh,injectie_kwh,aantal_toegangspunten');
      url.searchParams.set('where', "energie='Elektriciteit' AND verbruiksjaar=date'2024'");
      url.searchParams.set('order_by', 'afname_kwh DESC');

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Fluvius ${response.status}`);
      const payload = await response.json();
      streetConsumptionCache = payload.results || [];
    }

    panel.innerHTML = streetConsumptionCache.map(record => `
      <div class="street-row">
        <span>${escapeHtml(record.straat)}, ${escapeHtml(record.hoofdgemeente)}</span>
        <strong>${formatKwh(record.afname_kwh)}</strong>
      </div>
    `).join('') || '<div class="source-note">No Fluvius street rows returned.</div>';
  } catch (error) {
    console.warn('Fluvius street consumption failed:', error);
    panel.innerHTML = '<div class="source-note">Fluvius street consumption unavailable in this browser session.</div>';
  }
}

function updateGridStatus(text) {
  const status = document.getElementById('grid-layer-status');
  if (status) status.textContent = text;

  const viewLabel = document.getElementById('map-view-label');
  if (viewLabel) viewLabel.textContent = `Belgium · ${text}`;
}

function formatKwh(value) {
  const numericValue = Number(value) || 0;
  if (numericValue >= 1000000) return `${(numericValue / 1000000).toFixed(1)} GWh`;
  return `${Math.round(numericValue / 1000).toLocaleString()} MWh`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function updateHeatmap(totalMw) {
  currentLoadMw = Number(totalMw) || 0;
  currentLoadRatio = Math.max(0.18, Math.min(1, currentLoadMw / 13500));
  // Refresh open line popup directly via stored reference
  if (activePopupRef && activeLinePopup) {
    activePopupRef.setContent(buildLinePopupHtml(activeLinePopup.tags));
  }
}

export function updateFlows() {
  if (!entryLayer) return;
}

// Recalculate map size — call after the map's tab becomes visible
export function invalidateMap() {
  if (map) setTimeout(() => map.invalidateSize(), 50);
}

export function updateMapAttribution(timestamp) {
  const timestampElement = document.getElementById('map-timestamp');
  if (timestampElement) {
    timestampElement.textContent = `Updated: ${timestamp} · Load ${currentLoadMw.toLocaleString()} MW`;
  }
}

function showFallbackLineDetails(lineData) {
  const detailsHtml = `
    <div class="line-details-popup">
      <h3>${escapeHtml(lineData.label)}</h3>
      <div class="details-grid">
        <span class="detail-label">Voltage:</span>
        <span class="detail-value">${Math.round(lineData.voltage / 1000)} kV</span>
        <span class="detail-label">Type:</span>
        <span class="detail-value">${lineData.power === 'cable' ? 'HVDC Cable' : 'Transmission line'}</span>
        <span class="detail-label">Grid load:</span>
        <span class="detail-value">${Math.round(currentLoadRatio * 100)}% of capacity</span>
        <span class="detail-label">Current demand:</span>
        <span class="detail-value">${currentLoadMw.toLocaleString()} MW</span>
      </div>
    </div>
  `;

  L.popup()
    .setLatLng([
      (lineData.from.lat + lineData.to.lat) / 2,
      (lineData.from.lng + lineData.to.lng) / 2
    ])
    .setContent(detailsHtml)
    .openOn(map);
}

// ─── Location & My Energy Path ────────────────────────────────────────────────

function initLocationFeature() {
  const searchBtn = document.getElementById('search-btn');
  const locateBtn = document.getElementById('locate-btn');
  const addressInput = document.getElementById('address-input');
  const toggleGridBtn = document.getElementById('toggle-grid-btn');
  const togglePathBtn = document.getElementById('toggle-path-btn');

  addressInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') runAddressSearch(addressInput.value.trim());
  });
  searchBtn?.addEventListener('click', () => runAddressSearch(addressInput?.value.trim()));

  locateBtn?.addEventListener('click', () => {
    if (!navigator.geolocation) { setLocationStatus('Geolocation not supported'); return; }
    setLocationStatus('Getting your location…');
    navigator.geolocation.getCurrentPosition(
      pos => setUserLocation(L.latLng(pos.coords.latitude, pos.coords.longitude)),
      () => setLocationStatus('Location access denied')
    );
  });

  toggleGridBtn?.addEventListener('click', () => {
    if (showOnlyMyPath) {
      showOnlyMyPath = false;
      gridLayer.eachLayer(l => { if (l.options?.powerTags) l.setStyle(getPowerLineStyle(l.options.powerTags)); });
      toggleGridBtn.classList.add('active');
      togglePathBtn.classList.remove('active');
    }
  });

  togglePathBtn?.addEventListener('click', () => {
    if (!showOnlyMyPath) {
      showOnlyMyPath = true;
      // Make lines transparent but keep them on the map so clicks still work
      gridLayer.eachLayer(l => { if (l.options?.powerTags) l.setStyle({ opacity: 0, weight: 8 }); });
      togglePathBtn.classList.add('active');
      toggleGridBtn.classList.remove('active');
    }
  });
}

async function runAddressSearch(query) {
  if (!query) return;
  setLocationStatus('Searching…');
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=be&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const results = await res.json();
    if (!results.length) { setLocationStatus('Address not found in Belgium'); return; }
    const { lat, lon, display_name } = results[0];
    setUserLocation(L.latLng(parseFloat(lat), parseFloat(lon)), display_name);
  } catch {
    setLocationStatus('Search failed — check connection');
  }
}

async function setUserLocation(latlng, label = null) {
  userLocation = latlng;
  map.setView(latlng, Math.max(map.getZoom(), 13));

  if (userMarker) map.removeLayer(userMarker);
  const icon = L.divIcon({
    html: `<div class="user-marker"><div class="user-marker-inner"></div><div class="user-marker-pulse"></div></div>`,
    className: '',
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
  userMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map);
  if (label) userMarker.bindTooltip(label.split(',')[0], { permanent: false });

  if (!belgiumGridFeatures.length) { setLocationStatus('Grid still loading…'); return; }

  setLocationStatus('Finding your energy path…');
  await new Promise(r => setTimeout(r, 0));

  const snap = snapToNearestGridLine(latlng);
  const energySite = findNearestGenerationSite(latlng);

  const allSources = [...snappedGenerationSites, ...snappedEntryPoints];
  const allPaths = allSources.map(site => ({
    site,
    indices: belgiumGridTopology && snap.featureIdx >= 0 && site.snapFeatureIdx >= 0
      ? walkGridToSource(snap.featureIdx, site.snapFeatureIdx)
      : [snap.featureIdx],
  }));

  drawConnectionPath(latlng, snap, allPaths);
  setLocationStatus('');
  showPathInfo(snap, allSources, latlng);
  document.getElementById('toggle-row')?.classList.remove('hidden');
}

function snapToNearestGridLine(latlng) {
  let bestDist = Infinity;
  let bestPoint = null;
  let bestTags = {};
  let bestCoords = null;
  let bestFeatureIdx = -1;

  belgiumGridFeatures.forEach((feature, idx) => {
    if (feature.geometry?.type !== 'LineString') return;
    const coords = feature.geometry.coordinates;

    for (let i = 0; i < coords.length - 1; i++) {
      const a = [coords[i][1], coords[i][0]];
      const b = [coords[i + 1][1], coords[i + 1][0]];
      const closest = closestPointOnSegment([latlng.lat, latlng.lng], a, b);
      const dist = latlng.distanceTo(L.latLng(closest[0], closest[1]));
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = closest;
        bestTags = feature.properties || {};
        bestCoords = coords.map(([lng, lat]) => [lat, lng]);
        bestFeatureIdx = idx;
      }
    }
  });

  return { point: bestPoint, tags: bestTags, lineCoords: bestCoords, dist: bestDist, featureIdx: bestFeatureIdx };
}

function buildGridTopology(features) {
  // Spatial bucket: ~500m cells, connect endpoints within 350m of each other
  const CELL = 0.005;
  const CONNECT_DIST = 350;

  const buckets = new Map();
  const endpoints = [];

  features.forEach((feature, idx) => {
    if (feature.geometry?.type !== 'LineString') return;
    const coords = feature.geometry.coordinates;
    for (const pt of [coords[0], coords[coords.length - 1]]) {
      const lat = pt[1], lng = pt[0];
      const key = `${Math.floor(lat / CELL)},${Math.floor(lng / CELL)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      const epIdx = endpoints.length;
      endpoints.push({ lat, lng, featureIdx: idx });
      buckets.get(key).push(epIdx);
    }
  });

  const adj = new Map();
  for (let i = 0; i < endpoints.length; i++) {
    const { lat, lng, featureIdx } = endpoints[i];
    for (let dlat = -1; dlat <= 1; dlat++) {
      for (let dlng = -1; dlng <= 1; dlng++) {
        const key = `${Math.floor(lat / CELL) + dlat},${Math.floor(lng / CELL) + dlng}`;
        for (const j of (buckets.get(key) || [])) {
          if (i === j) continue;
          const ep2 = endpoints[j];
          if (ep2.featureIdx === featureIdx) continue;
          if (L.latLng(lat, lng).distanceTo(L.latLng(ep2.lat, ep2.lng)) <= CONNECT_DIST) {
            if (!adj.has(featureIdx)) adj.set(featureIdx, new Set());
            if (!adj.has(ep2.featureIdx)) adj.set(ep2.featureIdx, new Set());
            adj.get(featureIdx).add(ep2.featureIdx);
            adj.get(ep2.featureIdx).add(featureIdx);
          }
        }
      }
    }
  }
  return adj;
}

function featureMidpointLatlng(idx) {
  const coords = belgiumGridFeatures[idx]?.geometry?.coordinates;
  if (!coords) return null;
  const mid = coords[Math.floor(coords.length / 2)];
  return L.latLng(mid[1], mid[0]);
}

function walkGridToSource(startFeatureIdx, targetFeatureIdx) {
  if (startFeatureIdx === targetFeatureIdx) return [startFeatureIdx];

  const targetMid = featureMidpointLatlng(targetFeatureIdx);
  if (!targetMid) return [startFeatureIdx];

  // Greedy best-first search (A*-lite): always expand the frontier node closest to target
  const visited = new Set([startFeatureIdx]);
  const frontier = [{ dist: Infinity, idx: startFeatureIdx, path: [startFeatureIdx] }];
  const MAX_EXPLORED = 800;
  let explored = 0;

  while (frontier.length > 0 && explored < MAX_EXPLORED) {
    frontier.sort((a, b) => a.dist - b.dist);
    const { idx, path } = frontier.shift();
    explored++;

    if (idx === targetFeatureIdx) return path;

    for (const nextIdx of (belgiumGridTopology.get(idx) || new Set())) {
      if (visited.has(nextIdx)) continue;
      visited.add(nextIdx);
      const mid = featureMidpointLatlng(nextIdx);
      const dist = mid ? mid.distanceTo(targetMid) : Infinity;
      frontier.push({ dist, idx: nextIdx, path: [...path, nextIdx] });
    }
  }

  // Return the partial path that got closest
  frontier.sort((a, b) => a.dist - b.dist);
  return frontier.length ? frontier[0].path : [startFeatureIdx];
}

function closestPointOnSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return a;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return [a[0] + t * dx, a[1] + t * dy];
}

function findNearestGenerationSite(latlng) {
  const sites = snappedGenerationSites.length ? snappedGenerationSites : GENERATION_SITES;
  let best = null, bestDist = Infinity;
  for (const site of sites) {
    const dist = latlng.distanceTo(L.latLng(site.lat, site.lng));
    if (dist < bestDist) { bestDist = dist; best = { ...site, dist: bestDist }; }
  }
  return best;
}

const SITE_COLORS = { nuclear: '#a78bfa', wind: '#2dd4bf', gas: '#f97316', storage: '#60a5fa', import: '#e2e8f0' };

function drawConnectionPath(userLatlng, snap, allPaths) {
  pathLayer.clearLayers();

  // Collect which feature indices belong to which source colours.
  // A segment shared by multiple paths gets the colour of whichever was assigned first.
  const drawnFeatures = new Map(); // featureIdx → color

  for (const { site, indices } of allPaths) {
    const color = SITE_COLORS[site.type] || '#64748b';
    for (const idx of indices) {
      if (!drawnFeatures.has(idx)) drawnFeatures.set(idx, color);
    }
  }

  // Draw each unique feature once
  for (const [idx, color] of drawnFeatures) {
    const feature = belgiumGridFeatures[idx];
    if (feature?.geometry?.type !== 'LineString') continue;
    const coords = feature.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    L.polyline(coords, { color, weight: 2.5, opacity: 0.95, pane: 'gridPane', lineCap: 'round' }).addTo(pathLayer);
  }

  // Dot + dashed connector at each source's grid snap point → actual marker
  for (const { site } of allPaths) {
    if (!site.snapPoint) continue;
    const color = SITE_COLORS[site.type] || '#64748b';
    L.circleMarker(site.snapPoint, {
      radius: 5, color: '#ffffff', fillColor: color, fillOpacity: 1, weight: 2, pane: 'gridPane',
    }).addTo(pathLayer);
    // Short dashed line from snap point to the actual source location
    L.polyline([site.snapPoint, [site.lat, site.lng]], {
      color, weight: 1.5, opacity: 0.6, dashArray: '4 6', pane: 'gridPane',
    }).addTo(pathLayer);
  }

  // Dashed: user → their snap point on the grid
  L.polyline([userLatlng, snap.point], {
    color: '#ffffff', weight: 2, opacity: 0.85, dashArray: '5 7', pane: 'gridPane',
  }).addTo(pathLayer);

  // User snap dot
  L.circleMarker(snap.point, {
    radius: 7, color: '#ffffff', fillColor: '#2dd4bf', fillOpacity: 1, weight: 2, pane: 'gridPane',
  }).addTo(pathLayer);
}

function showPathInfo(snap, sites, userLatlng) {
  const el = document.getElementById('path-info');
  if (!el) return;

  const voltage = parseVoltage(snap.tags.voltage);
  const voltageText = voltage ? `${Math.round(voltage / 1000)} kV` : '—';
  const operator = snap.tags.operator || 'Elia';
  const nearestSite = sites.reduce((best, s) => {
    const d = userLatlng.distanceTo(L.latLng(s.lat, s.lng));
    return d < best.d ? { s, d } : best;
  }, { s: sites[0], d: Infinity }).s;
  const nearestColor = SITE_COLORS[nearestSite?.type] || '#64748b';
  const nearestDist = nearestSite ? userLatlng.distanceTo(L.latLng(nearestSite.lat, nearestSite.lng)) : 0;

  el.innerHTML = `
    <div class="path-info-row">
      <div class="path-info-icon" style="background:rgba(45,212,191,0.15);border-color:#2dd4bf">⬡</div>
      <div class="path-info-text">
        <div class="path-info-label">Grid connection</div>
        <div class="path-info-value">${voltageText} · ${escapeHtml(operator)}</div>
        <div class="path-info-dist">${(snap.dist / 1000).toFixed(2)} km from you</div>
      </div>
    </div>
    <div class="path-info-divider"></div>
    <div class="path-info-row">
      <div class="path-info-icon" style="background:${nearestColor}22;border-color:${nearestColor}">⚡</div>
      <div class="path-info-text">
        <div class="path-info-label">Nearest source</div>
        <div class="path-info-value" style="color:${nearestColor}">${escapeHtml(nearestSite?.label || '—')}</div>
        <div class="path-info-dist">${(nearestDist / 1000).toFixed(1)} km${nearestSite?.cap ? ' · ' + nearestSite.cap : ''}</div>
      </div>
    </div>
  `;
  el.classList.remove('hidden');
}

function setLocationStatus(text) {
  const el = document.getElementById('location-status');
  if (el) el.textContent = text;
}

function estimateLineLoad(tags) {
  const voltage = parseVoltage(tags.voltage);
  const circuits = Math.max(1, parseInt(tags.circuits) || 1);
  const isCable = tags.power === 'cable';

  // Thermal capacity per circuit by voltage level (standard Belgian grid values)
  let mwPerCircuit;
  if (voltage >= 380000)      mwPerCircuit = 1400;
  else if (voltage >= 220000) mwPerCircuit = 700;
  else if (voltage >= 150000) mwPerCircuit = 450;
  else if (voltage >= 70000)  mwPerCircuit = 180;
  else if (voltage >= 30000)  mwPerCircuit = 60;
  else                        mwPerCircuit = 20;

  if (isCable) mwPerCircuit *= 0.75; // cables derate vs. overhead

  const capacity = mwPerCircuit * circuits;
  const flow = Math.round(capacity * currentLoadRatio);
  const pct = Math.round(currentLoadRatio * 100);
  return { capacity: Math.round(capacity), flow, pct };
}

function buildLinePopupHtml(tags) {
  const voltage = parseVoltage(tags.voltage);
  const voltageText = voltage ? `${Math.round(voltage / 1000)} kV` : 'Unknown';
  const operator = tags.operator || tags.owner || 'Unknown';
  const name = tags.name || tags.ref || 'Power line';
  const powerType = tags.power === 'minor_line' ? 'Distribution' : tags.power === 'cable' ? 'HVDC Cable' : 'Transmission';
  const circuits = parseInt(tags.circuits) || 1;
  const color = getVoltageColor(voltage, tags.power);
  const { capacity, flow, pct } = estimateLineLoad(tags);

  // Load bar color
  const barColor = pct >= 85 ? '#ef4444' : pct >= 65 ? '#f97316' : pct >= 40 ? '#fbbf24' : '#4ade80';

  return `
    <div class="line-details-popup">
      <h3 style="color:${color}">${escapeHtml(name)}</h3>
      <div class="details-grid">
        <span class="detail-label">Voltage</span>
        <span class="detail-value" style="color:${color}">${voltageText}</span>
        <span class="detail-label">Type</span>
        <span class="detail-value">${powerType}</span>
        <span class="detail-label">Operator</span>
        <span class="detail-value">${escapeHtml(operator)}</span>
        <span class="detail-label">Circuits</span>
        <span class="detail-value">${circuits}</span>
        <span class="detail-label">Capacity</span>
        <span class="detail-value">~${capacity.toLocaleString()} MW</span>
      </div>
      <div class="popup-load-section">
        <div class="popup-load-label">
          <span>Estimated load</span>
          <span style="color:${barColor};font-weight:700">~${flow.toLocaleString()} MW · ${pct}%</span>
        </div>
        <div class="popup-load-track">
          <div class="popup-load-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
        <div class="popup-load-note">Based on national grid utilisation · updates live</div>
      </div>
    </div>
  `;
}

function showLineDetailsFromOSM(tags, latlng) {
  activeLinePopup = { tags, latlng };

  if (!activePopupRef) {
    activePopupRef = L.popup({ autoClose: false, closeOnClick: false });
    // Only clear refs when the user explicitly closes the popup
    activePopupRef.on('remove', () => { activeLinePopup = null; activePopupRef = null; });
  }

  activePopupRef
    .setLatLng(latlng)
    .setContent(buildLinePopupHtml(tags))
    .openOn(map);

  // Fetch fresh Elia data so the load value is current on click
  if (refreshEliaData) refreshEliaData();
}
