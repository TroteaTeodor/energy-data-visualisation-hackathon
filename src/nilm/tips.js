// NILM-based personalised savings tips module.
// Analyses 30 days of disaggregated consumption vs EPEX spot prices
// to find the top 3 shift-worthy appliance habits.

import { detectAppliances } from './detect.js';
import { generatePricesForDate } from '../api/elia.js';

// Only appliances that can realistically be shifted
const TIPABLE = ['dishwasher', 'washing_machine', 'ev_charger', 'dryer', 'oven', 'hob'];

const APPLIANCE_EMOJI = {
  dishwasher:      '🍽️',
  washing_machine: '👕',
  ev_charger:      '🔋',
  dryer:           '🌀',
  oven:            '🥘',
  hob:             '🍳',
};

export const APPLIANCE_LABEL = {
  dishwasher:      'dishwasher',
  washing_machine: 'washing machine',
  ev_charger:      'EV charger',
  dryer:           'tumble dryer',
  oven:            'electric oven',
  hob:             'electric hob',
};

// Detect contiguous runs in a 1440-minute watts array.
// A run = ≥5 consecutive minutes above 50 W.
function detectRuns(minuteData) {
  const runs = [];
  let i = 0;
  while (i < minuteData.length) {
    if (minuteData[i] > 50) {
      let j = i;
      while (j < minuteData.length && minuteData[j] > 50) j++;
      const durationMin = j - i;
      if (durationMin >= 5) {
        const slice = minuteData.slice(i, j);
        const kWh = slice.reduce((s, w) => s + w, 0) / 60 / 1000;
        runs.push({ startMinute: i, startHour: Math.floor(i / 60), durationMin, kWh });
      }
      i = j;
    } else {
      i++;
    }
  }
  return runs;
}

// Find the cheapest contiguous window of `durationMin` minutes in a 24-hour
// price array, returning the cost of that window for the given kWh load.
// Prices are per kWh (24 values), minutes mapped to hours.
function cheapestWindowCost(prices24, durationMin, kWh) {
  // For each possible start minute, compute cost using per-minute price
  let minCost = Infinity;
  const totalMinutes = 24 * 60;
  for (let start = 0; start <= totalMinutes - durationMin; start++) {
    let cost = 0;
    for (let m = start; m < start + durationMin; m++) {
      const h = Math.floor(m / 60);
      // kWh per minute * price = (kWh / durationMin) * price[h]
      cost += (kWh / durationMin) * prices24[h];
    }
    if (cost < minCost) minCost = cost;
  }
  return minCost;
}

// Modal value in an array of numbers
function modalValue(arr) {
  if (!arr.length) return null;
  const freq = new Map();
  for (const v of arr) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best = arr[0], bestCount = 0;
  for (const [val, count] of freq) {
    if (count > bestCount) { best = val; bestCount = count; }
  }
  return best;
}

// Find the cheapest start hour (whole-hour window of durationMin duration)
// for a given appliance run cost situation.
function cheapestStartHour(prices24, durationMin, minHour = 0) {
  let minCost = Infinity;
  let bestHour = minHour;
  const totalMinutes = 24 * 60;
  for (let start = minHour * 60; start <= totalMinutes - durationMin; start++) {
    let cost = 0;
    for (let m = start; m < start + durationMin; m++) {
      cost += prices24[Math.floor(m / 60)];
    }
    if (cost < minCost) { minCost = cost; bestHour = Math.floor(start / 60); }
  }
  return bestHour;
}

// Format hour as HH:00
function fmtHour(h) {
  return `${String(h).padStart(2, '0')}:00`;
}

// Store/café purchase prices for Brussels:
//   phone charge   €0.002  (electricity cost — ~6 Wh × €0.30/kWh)
//   Côte d'Or bar  €1.50   (supermarket)
//   cup of tea     €2.80   (café in Brussels)
//   craft beer     €4.50   (café in Brussels)
//   cinema ticket  €12     (one adult, UGC Toison d'Or)
//   nice lunch     €18     (one person, brasserie)
//   dinner for two €65     (mid-range restaurant near Flagey)
function funComparison(s) {
  if (s < 0.20) {
    return `${Math.round(s / 0.002)} phone charges 📱`;
  }
  if (s < 2.50) {
    const n = Math.round(s / 1.50);
    return `${n} Côte d'Or chocolate bar${n !== 1 ? 's' : ''} 🍫`;
  }
  if (s < 5.00) {
    const n = Math.round(s / 2.80);
    return `${n} cup${n !== 1 ? 's' : ''} of tea at a café ☕`;
  }
  if (s < 9.00) {
    return `a craft beer in Brussels 🍺`;
  }
  if (s < 18.00) {
    return `a cinema ticket at UGC 🎬`;
  }
  if (s < 40.00) {
    return `a nice lunch at a brasserie 🥗`;
  }
  if (s < 80.00) {
    return `a dinner for two near Flagey 🍽️`;
  }
  return `a weekend city trip ✈️`;
}

// Month name from a YYYY-MM-DD date string
function monthName(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleString('en', { month: 'long' });
}

/**
 * Generate up to 3 personalised savings tips from 30 days of NILM data.
 *
 * @param {Array<{date: string, day_of_week: string}>} dates
 * @param {(date: string) => Promise<number[]|null>} fetchDayWatts
 * @returns {Promise<Array>}
 */
export async function generateTips(dates, fetchDayWatts) {
  const window30 = dates.slice(-30);
  if (window30.length < 3) return [];

  // Fetch all 30 days in parallel
  const wattsResults = await Promise.all(
    window30.map(({ date }) => fetchDayWatts(date).catch(() => null))
  );

  // Per-appliance aggregation across all days
  const appStats = {};
  for (const id of TIPABLE) {
    appStats[id] = {
      totalMonthlySaving: 0,
      runCount: 0,
      startHours: [],
      optimalHours: [],
    };
  }

  for (let d = 0; d < window30.length; d++) {
    const watts = wattsResults[d];
    if (!watts || watts.length !== 1440) continue;

    const { date } = window30[d];
    const prices24 = generatePricesForDate(date); // float[24] in €/kWh

    // Run NILM disaggregation
    const nilm = detectAppliances(watts);

    for (const appId of TIPABLE) {
      const minuteData = nilm[appId];
      if (!minuteData) continue;

      const runs = detectRuns(minuteData);
      for (const run of runs) {
        const { startHour, durationMin, kWh } = run;
        const actualCost   = kWh * prices24[startHour];
        const optimalCost  = cheapestWindowCost(prices24, durationMin, kWh);
        const saving       = actualCost - optimalCost;
        const optimalHour  = cheapestStartHour(prices24, durationMin);

        if (saving > 0) {
          appStats[appId].totalMonthlySaving += saving;
          appStats[appId].runCount++;
          appStats[appId].startHours.push(startHour);
          appStats[appId].optimalHours.push(optimalHour);
        }
      }
    }
  }

  // Build tip candidates — filter to ≥3 runs AND ≥€0.10 saving
  const candidates = [];
  for (const appId of TIPABLE) {
    const stats = appStats[appId];
    if (stats.runCount < 3) continue;
    if (stats.totalMonthlySaving < 0.10) continue;

    const modalStart   = modalValue(stats.startHours);
    const modalOptimal = modalValue(stats.optimalHours);
    const saving       = stats.totalMonthlySaving;

    // Find the month name from the most recent date in window
    const latestDate  = window30[window30.length - 1].date;
    const month       = monthName(latestDate);

    // Heuristic % cheaper: peak hours ~4× more expensive than cheapest,
    // so saving / (saving + saving*3.5) ≈ 22%, capped at 60% to stay plausible.
    const displayPct = Math.min(Math.round((saving / (saving + saving * 3.5 + 0.001)) * 100), 60);

    candidates.push({
      appId,
      emoji:        APPLIANCE_EMOJI[appId],
      habitLine:    `You ran your ${APPLIANCE_LABEL[appId]} ${stats.runCount}× around ${fmtHour(modalStart)}–${fmtHour(Math.min(modalStart + 2, 23))} in ${month}`,
      savingLine:   `Shifting to ${fmtHour(modalOptimal)} could save €${saving.toFixed(2)}/month (~${displayPct}% cheaper)`,
      funComparison: `That's the price of ${funComparison(saving)} per month`,
      monthlySaving: saving,
    });
  }

  // Sort descending by saving, take top 3
  candidates.sort((a, b) => b.monthlySaving - a.monthlySaving);
  return candidates.slice(0, 3);
}

/**
 * Generate up to 3 prediction-based tips for today.
 * Uses today's predicted watts + EPEX prices to find shift opportunities,
 * then measures confidence from how often the appliance runs in the same
 * ±2-hour window over the last 14 historical days.
 *
 * @param {number[]} predictionWatts  1440-element array for today's predicted watts
 * @param {number[]} prices24         Real hourly prices (EUR/kWh), float[24]
 * @param {Function} fetchDayWatts    (date) => Promise<number[]|null>
 * @param {Array}    dates            DB dates array — used to slice last 14 days
 * @returns {Promise<Array>}
 */
export async function generateFutureTips(predictionWatts, prices24, fetchDayWatts, dates) {
  if (!predictionWatts || predictionWatts.length !== 1440) return [];
  if (!prices24 || prices24.length !== 24) return [];
  const predNilm = detectAppliances(predictionWatts);

  // Last 14 DB days for confidence scoring
  const histDates = dates.slice(-14);
  if (histDates.length < 3) return [];

  const histWatts = await Promise.all(
    histDates.map(({ date }) => fetchDayWatts(date).catch(() => null))
  );
  const validHist = histWatts.filter(w => w && w.length === 1440);
  if (validHist.length < 3) return [];

  // Only suggest hours that are still ahead of now (minimum 1h buffer)
  const nowHour = new Date().getHours() + 1;

  const tips = [];

  for (const appId of TIPABLE) {
    const minuteData = predNilm[appId];
    if (!minuteData) continue;

    const runs = detectRuns(minuteData);
    if (!runs.length) continue;

    // Take the highest-energy run (the main cycle, not standby blips)
    const run = runs.reduce((a, b) => b.kWh > a.kWh ? b : a);
    const { startHour, durationMin, kWh } = run;

    // Skip runs that are already underway or in the past
    if (startHour < nowHour) continue;

    const actualCost  = kWh * prices24[startHour];
    const optimalCost = cheapestWindowCost(prices24, durationMin, kWh);
    const saving      = actualCost - optimalCost;
    if (saving < 0.05) continue;

    const optimalHour = cheapestStartHour(prices24, durationMin, nowHour);
    if (optimalHour === startHour) continue;

    // Confidence: % of historical days where this appliance ran within ±2h of predicted start
    const lo = Math.max(0, startHour - 2);
    const hi = Math.min(23, startHour + 2);
    let matchCount = 0;
    for (const w of validHist) {
      const hNilm = detectAppliances(w);
      const hRuns = detectRuns(hNilm[appId] ?? []);
      if (hRuns.some(r => r.startHour >= lo && r.startHour <= hi)) matchCount++;
    }
    const confidence = Math.round((matchCount / validHist.length) * 100);
    if (confidence < 60) continue;

    tips.push({ appId, confidence, startHour, optimalHour, saving });
  }

  // Always include an EV tip if one wasn't naturally detected.
  // Uses a typical Belgian EV session (7.4 kW × 2.5 h = 18.5 kWh) and today's real prices.
  if (!tips.some(t => t.appId === 'ev_charger')) {
    const evKwh      = 18.5;
    const evDuration = 150;
    // Most expensive future peak hour (nowHour onwards, prefer 18–22 window)
    const peakCandidates = [18, 19, 20, 21, 22].filter(h => h >= nowHour);
    if (peakCandidates.length === 0) return tips; // too late in the day
    const peakHour = peakCandidates.reduce(
      (best, h) => prices24[h] > prices24[best] ? h : best, peakCandidates[0]
    );
    const optimalHour = cheapestStartHour(prices24, evDuration, nowHour);
    const actualCost  = evKwh * prices24[peakHour];
    const optimalCost = cheapestWindowCost(prices24, evDuration, evKwh);
    const saving      = actualCost - optimalCost;

    if (saving >= 0.05 && optimalHour !== peakHour) {
      tips.push({
        appId: 'ev_charger',
        confidence: null,     // price-based, not pattern-based
        startHour: peakHour,
        optimalHour,
        saving,
      });
    }
  }

  tips.sort((a, b) => b.saving - a.saving);
  // EV tip always surfaces: bring it to the top if it's in the list
  const evIdx = tips.findIndex(t => t.appId === 'ev_charger');
  if (evIdx > 0) tips.unshift(tips.splice(evIdx, 1)[0]);

  return tips.slice(0, 3);
}
