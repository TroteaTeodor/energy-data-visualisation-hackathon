import 'leaflet';

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

  drawFallbackGrid();
  drawEntryPoints();
  drawGenerationSites();
  addLegend();
  loadStreetConsumptionContext();
  loadFullBelgiumGrid();

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

    line.bindTooltip(buildLineTooltip(tags), { sticky: true, direction: 'top' });

    line.on('click', (e) => {
      L.DomEvent.stopPropagation(e);
      showLineDetailsFromOSM(tags, e.latlng);
    });
  }
}


function getPowerLineStyle(tags) {
  const voltage = parseVoltage(tags.voltage);
  const powerType = tags.power || 'line';
  const stressColor = getStressColor(currentLoadRatio);
  const baseColor = getVoltageColor(voltage, powerType);
  const isStreetLevel = powerType === 'minor_line' || voltage < 70000;
  const isCable = powerType === 'cable';
  const stressBoost = 0.55 + currentLoadRatio * 0.45;

  return {
    color: currentLoadRatio > 0.78 ? stressColor : baseColor,
    weight: getLineWeight(voltage, powerType),
    opacity: Math.min(1, (isStreetLevel ? 0.58 : 0.84) * stressBoost + 0.16),
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

function getStressColor(loadRatio) {
  if (loadRatio >= 0.86) return '#ef4444';
  if (loadRatio >= 0.72) return '#f97316';
  if (loadRatio >= 0.58) return '#facc15';
  return '#2dd4bf';
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
  const voltageText = voltage ? `${Math.round(voltage / 1000)} kV` : 'Voltage unknown';
  const operator = tags.operator || tags.owner || 'Operator unknown';
  const name = tags.name || tags.ref || 'Power infrastructure';
  const type = tags.power === 'minor_line' ? 'distribution line' : tags.power || 'line';
  const stress = Math.round(currentLoadRatio * 100);

  return `
    <b>${escapeHtml(name)}</b><br>
    ${escapeHtml(type)} · ${voltageText}<br>
    ${escapeHtml(operator)}<br>
    Live national load stress: <b>${stress}%</b>
  `;
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

    polyline.bindTooltip(
      `<b>${line.label}</b><br>${Math.round(line.voltage / 1000)} kV<br><i>Click for details</i>`,
      { direction: 'center', sticky: false }
    );

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

  if (gridLayer) {
    gridLayer.eachLayer(layer => {
      const tags = layer.options?.powerTags;
      if (tags) layer.setStyle(getPowerLineStyle(tags));
    });
  }

}

export function updateFlows() {
  if (!entryLayer) return;
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

function showLineDetailsFromOSM(tags, latlng) {
  const voltage = parseVoltage(tags.voltage);
  const voltageText = voltage ? `${Math.round(voltage / 1000)} kV` : 'Voltage unknown';
  const operator = tags.operator || tags.owner || 'Operator unknown';
  const name = tags.name || tags.ref || 'Power line';
  const powerType = tags.power === 'minor_line' ? 'Distribution line' : tags.power === 'cable' ? 'Cable' : 'Transmission line';

  const detailsHtml = `
    <div class="line-details-popup">
      <h3>${escapeHtml(name)}</h3>
      <div class="details-grid">
        <span class="detail-label">Voltage:</span>
        <span class="detail-value">${voltageText}</span>
        <span class="detail-label">Type:</span>
        <span class="detail-value">${powerType}</span>
        <span class="detail-label">Operator:</span>
        <span class="detail-value">${escapeHtml(operator)}</span>
        <span class="detail-label">Grid load:</span>
        <span class="detail-value">${Math.round(currentLoadRatio * 100)}%</span>
      </div>
    </div>
  `;

  L.popup()
    .setLatLng(latlng)
    .setContent(detailsHtml)
    .openOn(map);
}
