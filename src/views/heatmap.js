import 'leaflet';

let map = null;
let circlesLayer = null;
let legendAdded = false;

export async function initHeatmapView() {
  const container = document.getElementById('view-heatmap');
  container.innerHTML = `
    <div id="heatmap-info">
      <h3>🏙️ Brussels Energy Consumption by Commune</h3>
      <p>Estimated from national load · population-weighted</p>
    </div>
    <div id="brussels-map"></div>
  `;

  map = L.map('brussels-map', {
    center: [50.85, 4.35],
    zoom: 11,
    zoomControl: true,
  });
  window.__heatmapInstance = map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 13,
  }).addTo(map);

  circlesLayer = L.layerGroup().addTo(map);

  // Legend (once)
  if (!legendAdded) {
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', '');
      div.style.background = 'rgba(17,24,39,0.9)';
      div.style.padding = '10px 12px';
      div.style.borderRadius = '8px';
      div.style.border = '1px solid #334155';
      div.style.color = '#f1f5f9';
      div.style.fontSize = '12px';
      div.style.lineHeight = '1.6';
      div.innerHTML = '<b style="color:#2dd4bf">Consumption</b><br>' +
        '<span style="color:#2EAB9E">●</span> Low<br>' +
        '<span style="color:#4ECDC4">●</span> Medium-Low<br>' +
        '<span style="color:#7B2D8E">●</span> Medium<br>' +
        '<span style="color:#F5C842">●</span> Medium-High<br>' +
        '<span style="color:#E8772E">●</span> High';
      return div;
    };
    legend.addTo(map);
    legendAdded = true;
  }

  map.on('resize', () => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 300);
}

const COMMUNES = [
  { name: 'Brussels (Centre)', pop: 185000, lat: 50.8503, lng: 4.3517 },
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
  { name: 'St-Josse-ten-Noode', pop: 27000, lat: 50.8500, lng: 4.3667 },
  { name: 'Ganshoren', pop: 25000, lat: 50.8667, lng: 4.3000 },
  { name: 'Berchem-Ste-Agathe', pop: 25000, lat: 50.8667, lng: 4.2833 },
  { name: 'Watermael-Boitsfort', pop: 25000, lat: 50.8000, lng: 4.4167 },
  { name: 'Koekelberg', pop: 22000, lat: 50.8500, lng: 4.3167 },
];

const TOTAL_POP = COMMUNES.reduce((s, c) => s + c.pop, 0);

function getColor(val) {
  return val > 0.7 ? '#E8772E' :
         val > 0.5 ? '#F5C842' :
         val > 0.35 ? '#7B2D8E' :
         val > 0.2 ? '#4ECDC4' :
                    '#2EAB9E';
}

export function updateHeatmapView(state) {
  if (!circlesLayer) return;
  circlesLayer.clearLayers();

  const { totalMw } = state;
  if (!totalMw) return;

  const brusselsMw = totalMw * 0.1;
  const avgPerCapita = brusselsMw / TOTAL_POP;

  const estimates = COMMUNES.map(c => ({ name: c.name, mw: c.pop * avgPerCapita }));
  const maxMw = Math.max(...estimates.map(e => e.mw));
  const minMw = Math.min(...estimates.map(e => e.mw));
  const range = maxMw - minMw || 1;

  for (const c of COMMUNES) {
    const estimatedMw = c.pop * avgPerCapita;
    const intensity = Math.max(0, Math.min(1, (estimatedMw - minMw) / range));

    const circle = L.circle([c.lat, c.lng], {
      radius: Math.sqrt(c.pop / Math.PI) * 35,
      color: getColor(intensity),
      fillColor: getColor(intensity),
      fillOpacity: 0.65,
      weight: 1.5,
    }).addTo(circlesLayer);

    circle.bindTooltip(`
      <b>${c.name}</b><br>
      Population: ${c.pop.toLocaleString()}<br>
      Est. consumption: <b>${estimatedMw.toFixed(1)} MW</b>
    `, { direction: 'top' });
  }
}
