// Elia Open Data API client
const BASE = 'https://opendata.elia.be/api/explore/v2.1/catalog/datasets';

const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchDataset(datasetId, params = {}) {
  const cacheKey = datasetId + JSON.stringify(params);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  const url = new URL(`${BASE}/${datasetId}/records`);
  url.searchParams.set('limit', String(params.limit || 100));
  if (params.refine) url.searchParams.set('refine', params.refine);
  if (params.order_by) url.searchParams.set('order_by', params.order_by);

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    cache.set(cacheKey, { data: json, ts: Date.now() });
    return json;
  } catch (err) {
    console.warn(`Elia API fetch failed for ${datasetId}:`, err.message);
    return null;
  }
}

export async function getGenerationMix() {
  const data = await fetchDataset('ods201', { limit: 100, order_by: 'datetime desc' });
  return data?.results || null;
}

export async function getDayAheadSchedule() {
  const data = await fetchDataset('ods034', { limit: 200, order_by: 'datetime desc' });
  return data?.results || null;
}

export async function getCrossBorder() {
  const data = await fetchDataset('ods007', { limit: 50, order_by: 'datetime desc' });
  return data?.results || null;
}

// Demo data: plausible Belgian grid mix
export function getDemoMix() {
  const now = new Date();
  const hour = now.getHours();
  // Solar peaks midday, wind varies, gas fills gaps
  const solarFactor = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
  const windFactor = 0.5 + Math.random() * 0.5;
  
  return {
    'Nuclear': { fuel: 'Nuclear', mw: 3900, datetime: now.toISOString() },
    'Natural Gas': { fuel: 'Natural Gas', mw: 1800 + Math.random() * 400, datetime: now.toISOString() },
    'Solar': { fuel: 'Solar', mw: solarFactor * 2800, datetime: now.toISOString() },
    'Wind Offshore': { fuel: 'Wind Offshore', mw: windFactor * 1200, datetime: now.toISOString() },
    'Wind Onshore': { fuel: 'Wind Onshore', mw: windFactor * 800, datetime: now.toISOString() },
    'Biofuels': { fuel: 'Biofuels', mw: 400 + Math.random() * 100, datetime: now.toISOString() },
    'Water': { fuel: 'Water', mw: 200 + Math.random() * 50, datetime: now.toISOString() },
    'Other': { fuel: 'Other', mw: 150, datetime: now.toISOString() },
  };
}

export async function getCurrentMix() {
  const records = await getGenerationMix();
  
  if (!records) {
    console.log('Using demo data (API unavailable)');
    return getDemoMix();
  }
  
  if (!records.length) return {};

  const latest = {};
  for (const r of records) {
    const fuel = r.fueltypepublication;
    if (fuel && r.generatedpower != null) {
      if (!latest[fuel] || new Date(r.datetime) > new Date(latest[fuel].datetime)) {
        latest[fuel] = { fuel, mw: r.generatedpower, datetime: r.datetime };
      }
    }
  }
  return Object.keys(latest).length ? latest : getDemoMix();
}

export function computeMixPercentages(mix) {
  const entries = Object.values(mix).filter(e => e.mw > 0);
  const total = entries.reduce((s, e) => s + e.mw, 0);
  if (!total) return { entries: [], total: 0 };
  return {
    entries: entries.sort((a, b) => b.mw - a.mw).map(e => ({ ...e, pct: (e.mw / total) * 100 })),
    total
  };
}

export const FUEL_COLORS = {
  'Nuclear': '#7B2D8E',
  'Natural Gas': '#E8772E',
  'Solar': '#F5C842',
  'Wind Offshore': '#4ECDC4',
  'Wind Onshore': '#2EAB9E',
  'Biofuels': '#5D9B5D',
  'Water': '#3B8BD4',
  'Other': '#64748b',
  'Other Fossil Fuels': '#A0522D',
  'Energy storage': '#D4A574',
};

// ─── CO₂ & fuel classification (shared across views) ───
export const CO2_FACTORS = {
  'Natural Gas': 490, 'Nuclear': 12, 'Solar': 45, 'Wind Offshore': 11,
  'Wind Onshore': 11, 'Biofuels': 230, 'Water': 24, 'Other Fossil Fuels': 820,
  'Other': 300, 'Energy storage': 100,
};

export const RENEWABLE_FUELS = ['Solar', 'Wind Offshore', 'Wind Onshore', 'Water', 'Biofuels'];
export const FOSSIL_FUELS = ['Natural Gas', 'Other Fossil Fuels'];

// Weighted CO₂ intensity (g/kWh) from a list of { fuel, pct } entries
export function computeCo2(mixPct) {
  let total = 0, covered = 0;
  for (const e of mixPct) {
    total += e.pct * (CO2_FACTORS[e.fuel] ?? 100);
    covered += e.pct;
  }
  return covered > 0 ? total / covered : 0;
}

export function categorizeMix(mixPct) {
  let renewable = 0, nuclear = 0, fossil = 0, other = 0;
  for (const e of mixPct) {
    if (RENEWABLE_FUELS.includes(e.fuel)) renewable += e.pct;
    else if (e.fuel === 'Nuclear') nuclear += e.pct;
    else if (FOSSIL_FUELS.includes(e.fuel)) fossil += e.pct;
    else other += e.pct;
  }
  return { renewable, nuclear, fossil, other };
}

export function checkMyths(mix, totalMw) {
  const gasPct = mix['Natural Gas']?.pct || 0;
  const solarPct = mix['Solar']?.pct || 0;
  const nuclearPct = mix['Nuclear']?.pct || 0;
  const renPct = (mix['Solar']?.pct || 0) + (mix['Wind Offshore']?.pct || 0) + (mix['Wind Onshore']?.pct || 0);
  const myths = [];

  if (gasPct > 30) {
    myths.push({
      icon: '🔥', severity: 'high',
      title: 'Gas is dominating the mix',
      text: `${gasPct.toFixed(0)}% of Belgium's power comes from gas right now. That's the most expensive and carbon-intensive source in the mix. Shifting demand to off-peak hours could reduce gas reliance.`
    });
  }
  if (solarPct > 15) {
    myths.push({
      icon: '☀️', severity: 'low',
      title: 'Solar is going strong',
      text: `Solar provides ${solarPct.toFixed(0)}% of our power right now. Midday is the best time to run high-consumption appliances!`
    });
  }
  if (renPct > 35) {
    myths.push({
      icon: '🌱', severity: 'low',
      title: 'Grid is running clean',
      text: `Renewables cover ${renPct.toFixed(0)}% of demand. Contrary to the myth that "renewables can't keep the lights on" — right now they're doing exactly that.`
    });
  }
  if (nuclearPct > 30 && gasPct < 20) {
    myths.push({
      icon: '⚛️', severity: 'medium',
      title: 'Nuclear is carrying baseload',
      text: `Nuclear provides ${nuclearPct.toFixed(0)}% right now. But with aging plants, Belgium can't rely on it forever — efficiency and renewables are the sustainable path.`
    });
  }
  if (gasPct < 15 && renPct > 30 && nuclearPct < 30) {
    myths.push({
      icon: '💡', severity: 'info',
      title: 'Myth busted: renewables ARE reliable',
      text: 'Critics say renewables are too intermittent. Yet right now they supply most of our power. Cross-border interconnections smooth out the variability.'
    });
  }
  return myths;
}
