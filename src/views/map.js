import 'leaflet';

let map = null;
let arrows = [];
let markers = [];

export async function initMapView() {
  const container = document.getElementById('view-map');
  container.innerHTML = `
    <div id="map-sidebar">
      <h3>⚡ Import / Export Flows</h3>
      <div id="flow-list">
        <div class="flow-item" style="color:#4ECDC4">Loading flows...</div>
      </div>
    </div>
    <div id="world-map"></div>
  `;

  map = L.map('world-map').setView([50.85, 4.35], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 10
  }).addTo(map);

  // Generation site markers
  const sites = [
    { lat: 51.32, lng: 4.27, label: 'Doel Nuclear', type: 'nuclear' },
    { lat: 50.53, lng: 5.27, label: 'Tihange Nuclear', type: 'nuclear' },
    { lat: 51.50, lng: 2.80, label: 'North Sea Wind', type: 'wind' },
    { lat: 51.05, lng: 3.72, label: 'Gas Plant (Gent)', type: 'gas' },
    { lat: 50.95, lng: 4.35, label: 'Gas Plant (Brussels)', type: 'gas' },
  ];

  const iconColors = { nuclear: '#7B2D8E', wind: '#4ECDC4', gas: '#E8772E' };
  for (const s of sites) {
    const icon = L.divIcon({
      html: `<div style="width:16px;height:16px;border-radius:50%;background:${iconColors[s.type]};border:2px solid #fff;opacity:0.9"></div>`,
      className: '',
      iconSize: [16, 16]
    });
    const m = L.marker([s.lat, s.lng], { icon }).addTo(map);
    m.bindPopup(`<b>${s.label}</b><br>Type: ${s.type}`);
    markers.push(m);
  }

  setTimeout(() => map.invalidateSize(), 200);
}

function getDirection(mix) {
  // Infer import/export from gas/renewable balance
  const gasPct = mix['Natural Gas']?.pct || 0;
  const renPct = (mix['Solar']?.pct || 0) + (mix['Wind Offshore']?.pct || 0) + (mix['Wind Onshore']?.pct || 0);
  if (gasPct > 30) return { importMw: 2500 + Math.random() * 500, exportMw: 500 + Math.random() * 300 };
  if (renPct > 25) return { importMw: 800 + Math.random() * 300, exportMw: 2000 + Math.random() * 500 };
  return { importMw: 1500 + Math.random() * 500, exportMw: 1200 + Math.random() * 400 };
}

function drawArrow(lat1, lng1, lat2, lng2, mw, color, label) {
  const points = [L.latLng(lat1, lng1), L.latLng(lat2, lng2)];
  const polyline = L.polyline(points, {
    color, weight: Math.max(2, Math.min(8, mw / 400)),
    opacity: 0.7, dashArray: '8, 6'
  }).addTo(map);
  
  // Midpoint label
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;
  const icon = L.divIcon({
    html: `<div style="font-size:11px;color:${color};font-weight:600;background:rgba(10,14,26,0.8);padding:2px 6px;border-radius:4px;white-space:nowrap">${label} ${Math.round(mw)} MW</div>`,
    className: '',
    iconSize: [80, 20]
  });
  const labelMarker = L.marker([midLat, midLng], { icon, interactive: false }).addTo(map);
  
  return { polyline, labelMarker };
}

export function updateMapView(state) {
  // Clear old arrows
  arrows.forEach(a => { map?.removeLayer(a.polyline); map?.removeLayer(a.labelMarker); });
  arrows = [];

  const { mix } = state;
  const dir = getDirection(mix);

  // Flow arrows from neighboring countries to Belgium center
  const borders = [
    { lat: 49.0, lng: 5.0, country: 'France', importMw: dir.importMw * 0.35, exportMw: dir.exportMw * 0.25 },
    { lat: 51.5, lng: 5.5, country: 'Netherlands', importMw: dir.importMw * 0.30, exportMw: dir.exportMw * 0.30 },
    { lat: 50.8, lng: 6.5, country: 'Germany', importMw: dir.importMw * 0.20, exportMw: dir.exportMw * 0.30 },
    { lat: 51.2, lng: 1.5, country: 'UK', importMw: dir.importMw * 0.10, exportMw: dir.exportMw * 0.10 },
    { lat: 49.8, lng: 6.0, country: 'Luxembourg', importMw: dir.importMw * 0.05, exportMw: dir.exportMw * 0.05 },
  ];

  const beLat = 50.85, beLng = 4.35;
  
  for (const b of borders) {
    if (b.importMw > 100) {
      arrows.push(drawArrow(b.lat, b.lng, beLat, beLng, b.importMw, '#4ECDC4', `↑ ${b.country}`));
    }
    if (b.exportMw > 100) {
      arrows.push(drawArrow(beLat, beLng, b.lat, b.lng, b.exportMw, '#E8772E', `↓ ${b.country}`));
    }
  }

  // Update sidebar
  const flowList = document.getElementById('flow-list');
  const totalImport = borders.reduce((s, b) => s + b.importMw, 0);
  const totalExport = borders.reduce((s, b) => s + b.exportMw, 0);
  flowList.innerHTML = `
    <div class="flow-item"><span style="color:#4ECDC4">⬇ Import:</span> <strong>${Math.round(totalImport).toLocaleString()} MW</strong></div>
    <div class="flow-item"><span style="color:#E8772E">⬆ Export:</span> <strong>${Math.round(totalExport).toLocaleString()} MW</strong></div>
    <div class="flow-item">Net: <strong>${Math.round(totalImport - totalExport).toLocaleString()} MW</strong></div>
    ${borders.map(b => `
      <div class="flow-item">${b.country}: ${Math.round(b.importMw)}↑ / ${Math.round(b.exportMw)}↓</div>
    `).join('')}
  `;
}
