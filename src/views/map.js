import 'leaflet';

let map = null;
let circlesLayer = null;
let flowLayer = null;
let markerLayer = null;
let legendAdded = false;

export async function initMap() {
  const container = document.getElementById('map');
  if (!container) return;

  map = L.map('map', {
    center: [50.85, 4.35],
    zoom: 10,
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 14,
  }).addTo(map);

  circlesLayer = L.layerGroup().addTo(map);
  flowLayer = L.layerGroup().addTo(map);
  markerLayer = L.layerGroup().addTo(map);

  // Generation site markers
  const sites = [
    { lat: 51.32, lng: 4.27, label: 'Doel Nuclear', type: 'nuclear', cap: '2.9 GW' },
    { lat: 50.53, lng: 5.27, label: 'Tihange Nuclear', type: 'nuclear', cap: '3.0 GW' },
    { lat: 51.50, lng: 2.80, label: 'North Sea Wind', type: 'wind', cap: '2.2 GW' },
    { lat: 51.05, lng: 3.72, label: 'Ringvaart Gas', type: 'gas', cap: '0.9 GW' },
    { lat: 50.95, lng: 4.35, label: 'Drogenbos Gas', type: 'gas', cap: '0.5 GW' },
    { lat: 50.63, lng: 5.58, label: 'Coô Gas Plant', type: 'gas', cap: '1.1 GW' },
  ];

  const iconColors = { nuclear: '#a78bfa', wind: '#2dd4bf', gas: '#f97316' };
  const iconLabels = { nuclear: 'N', wind: 'W', gas: 'G' };

  for (const s of sites) {
    const c = iconColors[s.type] || '#64748b';
    const label = iconLabels[s.type] || '?';
    const icon = L.divIcon({
      html: `<div style="width:22px;height:22px;border-radius:50%;background:${c};border:2px solid rgba(255,255,255,0.8);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;box-shadow:0 0 8px ${c}66">${label}</div>`,
      className: '',
      iconSize: [22, 22],
    });
    const m = L.marker([s.lat, s.lng], { icon }).addTo(markerLayer);
    m.bindTooltip(`<b>${s.label}</b><br>Capacity: ${s.cap}`);
  }

  // Heatmap legend
  if (!legendAdded) {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', '');
      div.style.background = 'rgba(15,23,42,0.9)';
      div.style.padding = '8px 10px';
      div.style.borderRadius = '6px';
      div.style.border = '1px solid #334155';
      div.style.color = '#f1f5f9';
      div.style.fontSize = '11px';
      div.style.lineHeight = '1.5';
      div.innerHTML = '<b style="color:#2dd4bf">Consumption</b><br>' +
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

  map.on('resize', () => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 300);
}

// ─── Brussels communes ───
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
      radius: Math.sqrt(c.pop / Math.PI) * 30,
      color: heatColor(intensity),
      fillColor: heatColor(intensity),
      fillOpacity: 0.6,
      weight: 1.5,
    }).addTo(circlesLayer).bindTooltip(
      `<b>${c.name}</b><br>Pop: ${c.pop.toLocaleString()}<br>Est: <b>${mw.toFixed(1)} MW</b>`,
      { direction: 'top' }
    );
  }
}

// ─── Import/Export Flow Arrows ───
let lastArrowState = null;

export function updateFlows(mix) {
  if (!flowLayer) return;
  flowLayer.clearLayers();

  const gasPct = mix['Natural Gas']?.pct || 0;
  const renPct = (mix['Solar']?.pct || 0) + (mix['Wind Offshore']?.pct || 0) + (mix['Wind Onshore']?.pct || 0);

  let importMw = 1800, exportMw = 1500;
  if (gasPct > 30) { importMw = 2800; exportMw = 800; }
  else if (renPct > 30) { importMw = 1200; exportMw = 2400; }

  const borders = [
    { lat: 48.6, lng: 4.5, country: 'France', imp: importMw * 0.35, exp: exportMw * 0.25 },
    { lat: 51.8, lng: 5.2, country: 'Netherlands', imp: importMw * 0.30, exp: exportMw * 0.30 },
    { lat: 51.0, lng: 7.0, country: 'Germany', imp: importMw * 0.20, exp: exportMw * 0.30 },
    { lat: 51.4, lng: 1.2, country: 'UK', imp: importMw * 0.10, exp: exportMw * 0.10 },
    { lat: 49.7, lng: 6.2, country: 'Luxembourg', imp: importMw * 0.05, exp: exportMw * 0.05 },
  ];

  const beLat = 50.85, beLng = 4.35;

  for (const b of borders) {
    if (b.imp > 80) addFlowArrow(b.lat, b.lng, beLat, beLng, b.imp, '#2dd4bf', `${b.country}`);
    if (b.exp > 80) addFlowArrow(beLat, beLng, b.lat, b.lng, b.exp, '#f87171', `${b.country}`);
  }
}

function addFlowArrow(lat1, lng1, lat2, lng2, mw, color, label) {
  const weight = Math.max(2, Math.min(7, mw / 400));
  L.polyline([L.latLng(lat1, lng1), L.latLng(lat2, lng2)], {
    color, weight, opacity: 0.55, dashArray: '6, 5',
  }).addTo(flowLayer);

  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  const lbl = L.divIcon({
    html: `<div style="font-size:10px;color:#f1f5f9;font-weight:600;background:rgba(15,23,42,0.85);padding:2px 6px;border-radius:4px;border:1px solid ${color};white-space:nowrap">${Math.round(mw).toLocaleString()} MW → ${label}</div>`,
    className: '', iconSize: [0, 0],
  });
  L.marker([midLat, midLng], { icon: lbl, interactive: false }).addTo(flowLayer);
}

export function updateMapAttribution(timestamp) {
  const ts = document.getElementById('map-timestamp');
  if (ts) ts.textContent = `Updated: ${timestamp}`;
}
