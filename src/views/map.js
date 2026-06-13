import 'leaflet';

let map = null;
let arrows = [];
let markers = [];
let markerLayer = null;
let flowLayer = null;
let lastDir = null; // stable direction data

export async function initMapView() {
  const container = document.getElementById('view-map');
  container.innerHTML = `
    <div id="map-sidebar">
      <h3>⚡ Cross-Border Flows</h3>
      <div id="flow-list">
        <span class="flow-item">Loading flows...</span>
      </div>
    </div>
    <div id="world-map"></div>
  `;

  map = L.map('world-map', {
    center: [50.85, 4.35],
    zoom: 7,
    zoomControl: true,
  });
  window.__mapInstance = map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 12,
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);
  flowLayer = L.layerGroup().addTo(map);

  // Generation site markers
  const sites = [
    { lat: 51.32, lng: 4.27, label: 'Doel Nuclear', type: 'nuclear', cap: '~2.9 GW' },
    { lat: 50.53, lng: 5.27, label: 'Tihange Nuclear', type: 'nuclear', cap: '~3.0 GW' },
    { lat: 51.50, lng: 2.80, label: 'North Sea Wind Farms', type: 'wind', cap: '~2.2 GW' },
    { lat: 51.05, lng: 3.72, label: 'Ringvaart Gas Plant', type: 'gas', cap: '~0.9 GW' },
    { lat: 50.95, lng: 4.35, label: 'Drogenbos Gas Plant', type: 'gas', cap: '~0.5 GW' },
    { lat: 50.63, lng: 5.58, label: 'Coô Power Plant', type: 'gas', cap: '~1.1 GW' },
  ];

  for (const s of sites) {
    const colors = { nuclear: '#7B2D8E', wind: '#4ECDC4', gas: '#E8772E' };
    const c = colors[s.type] || '#64748b';
    const icon = L.divIcon({
      html: `<div style="width:14px;height:14px;border-radius:50%;background:${c};border:2px solid rgba(255,255,255,0.8);box-shadow:0 0 8px ${c}44"></div>`,
      className: '',
      iconSize: [14, 14],
    });
    const m = L.marker([s.lat, s.lng], { icon }).addTo(markerLayer);
    m.bindTooltip(`<b>${s.label}</b><br>Capacity: ${s.cap}`, { direction: 'top', offset: [0, -8] });
    markers.push(m);
  }

  map.on('resize', () => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 300);
}

function computeDirection(mix) {
  // Stable: derive from mix percentages, no random
  const gasPct = mix['Natural Gas']?.pct || 0;
  const renPct = (mix['Solar']?.pct || 0) + (mix['Wind Offshore']?.pct || 0) + (mix['Wind Onshore']?.pct || 0);
  const total = mix['Natural Gas']?.mw || 0;

  // Belgium typically imports when gas is high, exports when renewables are high
  if (gasPct > 30) return { importMw: 2800, exportMw: 800 };
  if (renPct > 30) return { importMw: 1200, exportMw: 2400 };
  return { importMw: 1800, exportMw: 1500 };
}

function drawArrow(lat1, lng1, lat2, lng2, mw, color, label) {
  const points = [L.latLng(lat1, lng1), L.latLng(lat2, lng2)];
  const weight = Math.max(2, Math.min(8, mw / 350));
  const polyline = L.polyline(points, {
    color, weight, opacity: 0.6,
    dashArray: '6, 5',
  });

  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  const labelIcon = L.divIcon({
    html: `<div style="font-size:11px;color:#f1f5f9;font-weight:600;background:rgba(7,11,21,0.85);padding:2px 8px;border-radius:6px;border:1px solid ${color}">${label} ${Math.round(mw).toLocaleString()} MW</div>`,
    className: '',
    iconSize: [0, 0],
  });
  const labelMarker = L.marker([midLat, midLng], { icon: labelIcon, interactive: false });

  return { polyline, labelMarker };
}

export function updateMapView(state) {
  if (!flowLayer) return;
  flowLayer.clearLayers();

  const { mix } = state;
  lastDir = computeDirection(mix);
  const dir = lastDir;

  const borders = [
    { lat: 48.6, lng: 4.5, country: 'France', imp: dir.importMw * 0.35, exp: dir.exportMw * 0.25 },
    { lat: 51.8, lng: 5.2, country: 'Netherlands', imp: dir.importMw * 0.30, exp: dir.exportMw * 0.30 },
    { lat: 51.0, lng: 7.0, country: 'Germany', imp: dir.importMw * 0.20, exp: dir.exportMw * 0.30 },
    { lat: 51.4, lng: 1.2, country: 'UK (NemoLink)', imp: dir.importMw * 0.10, exp: dir.exportMw * 0.10 },
    { lat: 49.7, lng: 6.2, country: 'Luxembourg', imp: dir.importMw * 0.05, exp: dir.exportMw * 0.05 },
  ];

  const beLat = 50.85, beLng = 4.35;

  for (const b of borders) {
    if (b.imp > 80) {
      flowLayer.addLayer(drawArrow(b.lat, b.lng, beLat, beLng, b.imp, '#2dd4bf', `→ ${b.country}`).polyline);
      flowLayer.addLayer(drawArrow(b.lat, b.lng, beLat, beLng, b.imp, '#2dd4bf', `→ ${b.country}`).labelMarker);
    }
    if (b.exp > 80) {
      flowLayer.addLayer(drawArrow(beLat, beLng, b.lat, b.lng, b.exp, '#f87171', `← ${b.country}`).polyline);
      flowLayer.addLayer(drawArrow(beLat, beLng, b.lat, b.lng, b.exp, '#f87171', `← ${b.country}`).labelMarker);
    }
  }

  // Sidebar
  const flowList = document.getElementById('flow-list');
  const totalImport = borders.reduce((s, b) => s + b.imp, 0);
  const totalExport = borders.reduce((s, b) => s + b.exp, 0);
  const net = totalImport - totalExport;

  flowList.innerHTML = `
    <span class="flow-item highlight">Net: <strong>${Math.abs(Math.round(net)).toLocaleString()} MW</strong> ${net > 0 ? 'import' : 'export'}</span>
    <span class="flow-item" style="border-color:#2dd4bf">⬇ Import: <strong>${Math.round(totalImport).toLocaleString()} MW</strong></span>
    <span class="flow-item" style="border-color:#f87171">⬆ Export: <strong>${Math.round(totalExport).toLocaleString()} MW</strong></span>
    ${borders.map(b => `
      <span class="flow-item">${b.country}: ${Math.round(b.imp).toLocaleString()}↓ / ${Math.round(b.exp).toLocaleString()}↑</span>
    `).join('')}
  `;
}
