// Elia Open Data API client
const BASE = 'https://opendata.elia.be/api/explore/v2.1/catalog/datasets';

// Cache with 5-minute TTL
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchDataset(datasetId, params = {}) {
  const cacheKey = datasetId + JSON.stringify(params);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const url = new URL(`${BASE}/${datasetId}/records`);
  url.searchParams.set('limit', params.limit || 100);
  if (params.refine) url.searchParams.set('refine', params.refine);
  if (params.order_by) url.searchParams.set('order_by', params.order_by);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Elia API error: ${res.status}`);
  const json = await res.json();
  
  cache.set(cacheKey, { data: json, ts: Date.now() });
  return json;
}

// Generation mix (actual) by fuel type
export async function getGenerationMix() {
  const data = await fetchDataset('ods201', { limit: 200, order_by: 'datetime desc' });
  return data.results || [];
}

// Day-ahead generation schedule
export async function getDayAheadSchedule() {
  const data = await fetchDataset('ods034', { limit: 200, order_by: 'datetime desc' });
  return data.results || [];
}

// Cross-border transfer capacity
export async function getCrossBorder() {
  const data = await fetchDataset('ods007', { limit: 50, order_by: 'datetime desc' });
  return data.results || [];
}

// Latest generation data aggregated by fuel type
export async function getCurrentMix() {
  const records = await getGenerationMix();
  if (!records.length) return {};
  
  // Group by fuel type, get latest for each
  const latest = {};
  for (const r of records) {
    const fuel = r.fueltypepublication;
    if (fuel && r.generatedpower != null) {
      if (!latest[fuel] || new Date(r.datetime) > new Date(latest[fuel].datetime)) {
        latest[fuel] = { fuel, mw: r.generatedpower, datetime: r.datetime };
      }
    }
  }
  return latest;
}

// Aggregate into mix percentages
export function computeMixPercentages(mix) {
  const entries = Object.values(mix).filter(e => e.mw > 0);
  const total = entries.reduce((s, e) => s + e.mw, 0);
  if (!total) return { entries: [], total: 0 };
  
  return {
    entries: entries.map(e => ({ ...e, pct: (e.mw / total) * 100 })),
    total
  };
}

// Fuel colors
export const FUEL_COLORS = {
  'Nuclear': '#7B2D8E',
  'Natural Gas': '#E8772E',
  'Solar': '#F5C842',
  'Wind Offshore': '#4ECDC4',
  'Wind Onshore': '#2EAB9E',
  'Biofuels': '#5D9B5D',
  'Water': '#3B8BD4',
  'Other': '#95A5A6',
  'Other Fossil Fuels': '#A0522D',
  'Energy storage': '#D4A574'
};

export const FUEL_LABELS = Object.keys(FUEL_COLORS);

// Myth-busting rules
export function checkMyths(mix, totalMw) {
  const gasPct = mix['Natural Gas']?.pct || 0;
  const solarPct = mix['Solar']?.pct || 0;
  const nuclearPct = mix['Nuclear']?.pct || 0;
  const renewablePct = (mix['Solar']?.pct || 0) + (mix['Wind Offshore']?.pct || 0) + (mix['Wind Onshore']?.pct || 0);
  const myths = [];
  
  if (gasPct > 35) {
    myths.push({ icon: '🔥', title: 'Gas is peaking!', text: `${gasPct.toFixed(0)}% of our power is from gas right now. That's expensive and carbon-intensive.`, severity: 'high' });
  }
  if (solarPct > 20) {
    myths.push({ icon: '☀️', title: 'Solar is shining!', text: `Solar is providing ${solarPct.toFixed(0)}% of Belgium's power.`, severity: 'low' });
  }
  if (renewablePct < 10 && nuclearPct > 30) {
    myths.push({ icon: '⚛️', title: 'Nuclear carries the load', text: `Nuclear is providing ${nuclearPct.toFixed(0)}% — but it's not 24/7 baseload anymore.`, severity: 'medium' });
  }
  return myths;
}
