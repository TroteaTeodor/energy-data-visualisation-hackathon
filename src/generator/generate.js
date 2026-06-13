import { APPLIANCES } from './appliances.js';
import { baselineWatts, HEAT_PUMP_SEASONAL } from './baseline.js';
import { gaussianNoise, applianceProfile } from './noise.js';
import { scheduleDay } from './scheduler.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Generates a full synthetic consumption dataset.
 *
 * @param {object}   options
 * @param {Date}     [options.startDate]   First day (default: 3 months ago from today)
 * @param {number}   [options.days]        Number of days (default: 91)
 * @param {object[]} [options.appliances]  Appliance config (default: built-in list)
 *
 * @returns {object[]} Array of 96 * days rows:
 *   { timestamp, date, day_of_week, slot, watts_total, appliances: { [id]: boolean } }
 */
export function generateDataset(options = {}) {
  const defaultStart = new Date();
  defaultStart.setMonth(defaultStart.getMonth() - 3);
  defaultStart.setHours(0, 0, 0, 0);

  const {
    startDate = defaultStart,
    days = 91,
    appliances = APPLIANCES,
  } = options;

  const rows = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + d);

    const month = date.getMonth();
    const dateStr = date.toISOString().slice(0, 10);
    const dayName = DAY_NAMES[date.getDay()];
    const heatFactor = HEAT_PUMP_SEASONAL[month];

    // ── Schedule appliance events for this day ──
    const events = scheduleDay(appliances, date, heatFactor);

    // ── Build 96-slot wattage array ──
    const slots = new Float32Array(96);
    // Appliance ground-truth: which appliances are on per slot
    const states = Object.fromEntries(appliances.map(a => [a.id, new Uint8Array(96)]));

    // Layer 1: baseline + noise
    for (let s = 0; s < 96; s++) {
      slots[s] = baselineWatts(s, month) + gaussianNoise(0, 18);
    }

    // Layer 2: appliance events
    for (const event of events) {
      const app = appliances.find(a => a.id === event.applianceId);
      if (!app) continue;
      const profile = applianceProfile(app.watts, event.durationSlots);
      for (let i = 0; i < event.durationSlots; i++) {
        const s = event.startSlot + i;
        if (s >= 96) break;
        slots[s] += profile[i];
        states[event.applianceId][s] = 1;
      }
    }

    // ── Emit one row per slot ──
    for (let s = 0; s < 96; s++) {
      const h = Math.floor(s / 4);
      const m = (s % 4) * 15;
      const timestamp = `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

      rows.push({
        timestamp,
        date: dateStr,
        day_of_week: dayName,
        slot: s,
        watts_total: Math.max(0, Math.round(slots[s])),
        appliances: Object.fromEntries(appliances.map(a => [a.id, states[a.id][s] === 1])),
      });
    }
  }

  return rows;
}
