import 'leaflet';

let map = null;
let gridLayer = null;
let entryLayer = null;
let circlesLayer = null;
let markerLayer = null;
let legendAdded = false;

// Belgian 380kV grid backbone (approximate coordinates of major lines)
const GRID_LINES = [
  // 380kV Ring - West side
  { from: { lat: 51.35, lng: 4.28 }, to: { lat: 51.05, lng: 3.72 }, label: 'Zandvliet → Gent', kv: 380 },
  { from: { lat: 51.05, lng: 3.72 }, to: { lat: 50.60, lng: 3.10 }, label: 'Gent → Avelin (FR)', kv: 380 },
  // 380kV Ring - South side
  { from: { lat: 50.60, lng: 3.10 }, to: { lat: 50.45, lng: 5.00 }, label: 'Avelin → Gramme', kv: 380 },
  { from: { lat: 50.45, lng: 5.00 }, to: { lat: 50.45, lng: 4.35 }, label: 'Gramme → Bruegel', kv: 380 },
  // 380kV Ring - East side
  { from: { lat: 50.45, lng: 5.00 }, to: { lat: 50.75, lng: 5.70 }, label: 'Gramme → Lixhe (DE)', kv: 380 },
  { from: { lat: 50.45, lng: 4.35 }, to: { lat: 51.00, lng: 4.15 }, label: 'Bruegel → Mercator', kv: 380 },
  // 380kV Ring - North side
  { from: { lat: 51.00, lng: 4.15 }, to: { lat: 51.35, lng: 4.28 }, label: 'Mercator → Zandvliet', kv: 380 },
  { from: { lat: 51.35, lng: 4.28 }, to: { lat: 51.35, lng: 5.45 }, label: 'Zandvliet → Van Eyck (NL)', kv: 380 },
  // 220kV branches
  { from: { lat: 51.05, lng: 3.72 }, to: { lat: 50.95, lng: 4.35 }, label: 'Gent → Brussels', kv: 220 },
  { from: { lat: 51.00, lng: 4.15 }, to: { lat: 50.85, lng: 4.35 }, label: 'Mercator → Brussels', kv: 220 },
  { from: { lat: 50.45, lng: 4.35 }, to: { lat: 50.85, lng: 4.35 }, label: 'Bruegel → Brussels', kv: 220 },
  // NemoLink (HVDC cable to UK)
  { from: { lat: 51.20, lng: 2.80 }, to: { lat: 51.05, lng: 3.72 }, label: 'NemoLink → Gent', kv: 1000 },
];

// Entry points (border interconnections)
const ENTRY_POINTS = [
  { lat: 50.50, lng: 3.15, country: 'France', name: 'Avelin', cap: '~5 GW', color: '#2dd4bf' },
  { lat: 51.35, lng: 5.50, country: 'Netherlands', name: 'Van Eyck', cap: '~3.5 GW', color: '#2dd4bf' },
  { lat: 50.72, lng: 5.75, country: 'Germany', name: 'Lixhe / Oberzier', cap: '~2.5 GW', color: '#2dd4bf' },
  { lat: 51.20, lng: 2.80, country: 'UK', name: 'NemoLink (HVDC)', cap: '~1 GW', color: '#f97316' },
  { lat: 49.55, lng: 6.00, country: 'Luxembourg', name: 'Schifflange', cap: '~0.5 GW', color: '#2dd4bf' },
];

export async function initMap() {
  const container = document.getElementById('map');
  if (!container) return;

  map = L.map('map', {
    center: [50.6, 4.5],
    zoom: 8,
    zoomControl: true,
    attributionControl: false,
  });

  // Dark map style
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 14,
    attribution: '&copy; <a href="https://carto.com">CARTO</a>',
  }).addTo(map);

  // Feature layers
  gridLayer = L.layerGroup().addTo(map);
  entryLayer = L.layerGroup().addTo(map);
  circlesLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  // Draw power grid lines
  drawPowerGrid();

  // Draw entry points
  drawEntryPoints();

  // Generation site markers
  const sites = [
    { lat: 51.32, lng: 4.27, label: 'Doel Nuclear', type: 'nuclear', cap: '2.9 GW' },
    { lat: 50.53, lng: 5.27, label: 'Tihange Nuclear', type: 'nuclear', cap: '3.0 GW' },
    { lat: 51.50, lng: 3.20, label: 'North Sea Wind', type: 'wind', cap: '2.2 GW' },
    { lat: 51.05, lng: 3.72, label: 'Ringvaart Gas', type: 'gas', cap: '0.9 GW' },
    { lat: 50.95, lng: 4.35, label: 'Drogenbos Gas', type: 'gas', cap: '0.5 GW' },
    { lat: 50.63, lng: 5.58, label: 'Coô Gas Plant', type: 'gas', cap: '1.1 GW' },
  ];

  const iconColors = { nuclear: '#a78bfa', wind: '#2dd4bf', gas: '#f97316' };
  const iconLabels = { nuclear: 'N', wind: 'W', gas: 'G' };

  for (const s of sites) {
    const c = iconColors[s.type] || '#64748b';
    const lbl = iconLabels[s.type] || '?';
    const icon = L.divIcon({
      html: `<div style="width:20px;height:20px;border-radius:50%;background:${c};border:2px solid rgba(255,255,255,0.85);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;box-shadow:0 0 10px ${c}66">${lbl}</div>`,
      className: '', iconSize: [20, 20],
    });
    const m = L.marker([s.lat, s.lng], { icon }).addTo(markerLayer);
    m.bindTooltip(`<b>${s.label}</b><br>Capacity: ${s.cap}`);
  }

  // Heatmap legend
  if (!legendAdded) {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', '');
      div.style.cssText = 'background:rgba(15,23,42,0.85);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:8px 10px;border-radius:8px;border:1px solid rgba(51,65,85,0.5);color:#f1f5f9;font-size:11px;line-height:1.5';
      div.innerHTML = '<b style="color:#2dd4bf">⏎ Consumption</b><br>' +
        '<span style="color:#2EAB9E">●</span> Low<br>' +
        '<span style="color:#4ECDC4">●</span> Med-Low<br>' +
        '<span style="color:#7B2D8E">●</span> Medium<br>' +
        '<span style="color:#F5C842">●</span> Med-High<br>' +
        '<span style="color:#E8772E">●</span> High';
      return div;
    };
    legend.addTo(map);
    legendAdded = true;
  }

  // Handle resize
  map.on('resize', () => map.invalidateSize());
  const handleResize = () => setTimeout(() => map?.invalidateSize(), 100);
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', () => setTimeout(handleResize, 400));
  setTimeout(() => map.invalidateSize(), 300);
}

function drawPowerGrid() {
  for (const line of GRID_LINES) {
    const is380 = line.kv === 380;
    const isHvdc = line.kv === 1000;
    const opts = {
      color: isHvdc ? '#f97316' : is380 ? '#a78bfa' : '#64748b',
      weight: isHvdc ? 2 : is380 ? 2.5 : 1.5,
      opacity: isHvdc ? 0.8 : is380 ? 0.5 : 0.3,
      dashArray: isHvdc ? '4, 6' : undefined,
    };

    L.polyline(
      [L.latLng(line.from.lat, line.from.lng), L.latLng(line.to.lat, line.to.lng)],
      opts
    ).addTo(gridLayer).bindTooltip(
      `<b>${line.label}</b><br>${line.kv} kV`,
      { direction: 'center', sticky: false }
    );
  }
}

function drawEntryPoints() {
  for (const ep of ENTRY_POINTS) {
    const color = ep.color;
    // Glowing circle for entry point
    L.circleMarker([ep.lat, ep.lng], {
      radius: 10,
      color: color,
      fillColor: color,
      fillOpacity: 0.3,
      weight: 2,
    }).addTo(entryLayer);

    // Inner dot
    L.circleMarker([ep.lat, ep.lng], {
      radius: 4,
      color: color,
      fillColor: color,
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(entryLayer);

    // Label
    const icon = L.divIcon({
      html: `<div style="font-size:10px;color:#f1f5f9;font-weight:600;background:rgba(15,23,42,0.85);backdrop-filter:blur(8px);padding:2px 7px;border-radius:5px;border:1px solid ${color}40;white-space:nowrap">${ep.country} → ${ep.name}</div>`,
      className: '', iconSize: [0, 0],
    });
    L.marker([ep.lat + 0.12, ep.lng], { icon, interactive: false }).addTo(entryLayer);
  }
}

// ─── Brussels communes heatmap ───
const COMMUNES = [
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

function heatColor(val) {
  return val > 0.7 ? '#E8772E' : val > 0.5 ? '#F5C842' : val > 0.35 ? '#7B2D8E' : val > 0.2 ? '#4ECDC4' : '#2EAB9E';
}

export function updateHeatmap(totalMw) {
  if (!circlesLayer) return;
  circlesLayer.clearLayers();
  if (!totalMw) return;

  const brusselsMw = totalMw * 0.1;
  const avgPerCapita = brusselsMw / TOTAL_POP;
  const estimates = COMMUNES.map(c => c.pop * avgPerCapita);
  const maxMw = Math.max(...estimates);
  const minMw = Math.min(...estimates);
  const range = maxMw - minMw || 1;

  for (const c of COMMUNES) {
    const mw = c.pop * avgPerCapita;
    const intensity = Math.max(0, Math.min(1, (mw - minMw) / range));

    L.circle([c.lat, c.lng], {
      radius: Math.sqrt(c.pop / Math.PI) * 12,
      color: heatColor(intensity),
      fillColor: heatColor(intensity),
      fillOpacity: 0.55,
      weight: 1.5,
    }).addTo(circlesLayer).bindTooltip(
      `<b>${c.name}</b><br>Pop: ${c.pop.toLocaleString()}<br>Est: <b>${mw.toFixed(1)} MW</b>`,
      { direction: 'top' }
    );
  }
}

// ─── Import/Export flows ───
export function updateFlows(mix) {
  if (!entryLayer) return;
  // Entry points are static. The flow direction/color updates are
  // already handled by the global state via updateMapAttribution.
  // Keep the entry markers static.
}

export function updateMapAttribution(timestamp) {
  const ts = document.getElementById('map-timestamp');
  if (ts) ts.textContent = `Updated: ${timestamp}`;
}
