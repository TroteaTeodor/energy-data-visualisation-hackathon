import { APPLIANCES } from './appliances.js';
import { baselineWatts, HEAT_PUMP_SEASONAL } from './baseline.js';
import { gaussianNoise, phaseProfile, rampProfile } from './noise.js';
import { scheduleDay } from './scheduler.js';
import { generateEvProfile } from './ev.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MINUTES_PER_DAY = 1440;

// Fridge compressor cycling: kicks on every 20–28 min, runs for 10–15 min at ~150W.
// This is deliberately kept out of the appliance list — it's a background signature,
// not a user-controlled load, but important for NILM baseline realism.
function generateFridgeCycles() {
  const cycles = [];
  let t = Math.floor(Math.random() * 20);
  while (t < MINUTES_PER_DAY) {
    const duration = 10 + Math.floor(Math.random() * 6);   // 10–15 min on
    cycles.push({ start: t, duration });
    t += duration + 18 + Math.floor(Math.random() * 10);   // 18–27 min off
  }
  return cycles;
}

// Returns per-minute wattage array for an appliance event.
function buildProfile(app) {
  return app.phases
    ? phaseProfile(app.phases)
    : rampProfile(app.watts, app.durationMinutes);
}

/**
 * Generates a full synthetic household consumption dataset at 1-minute resolution.
 *
 * @param {object}   options
 * @param {Date}     [options.startDate]   First day (default: 3 months ago)
 * @param {number}   [options.days]        Number of days (default: 91)
 * @param {object[]} [options.appliances]  Appliance config (default: built-in list)
 *
 * @returns {object[]}  1440 × days rows:
 *   { timestamp, date, day_of_week, minute, watts_total, appliances: { [id]: boolean } }
 */
export function generateDataset(options = {}) {
  const defaultStart = new Date();
  defaultStart.setMonth(defaultStart.getMonth() - 3);
  defaultStart.setHours(0, 0, 0, 0);
  // Snap back to Monday of that week (getDay: 0=Sun, 1=Mon … 6=Sat)
  const dow = defaultStart.getDay();
  defaultStart.setDate(defaultStart.getDate() - (dow === 0 ? 6 : dow - 1));

  const {
    startDate = defaultStart,
    days = 91,
    appliances = APPLIANCES,
  } = options;

  const rows = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + d);

    const month      = date.getMonth();
    const dateStr    = date.toISOString().slice(0, 10);
    const dayName    = DAY_NAMES[date.getDay()];
    const heatFactor = HEAT_PUMP_SEASONAL[month];

    // ── EV: generate a per-day CC/CV profile so duration varies ──
    const evApp    = appliances.find(a => a.id === 'ev_charger' && a.enabled);
    const evToday  = evApp ? generateEvProfile(evApp.watts) : null;

    // Provide scheduler with today's EV duration (varies by start/target SoC)
    const dailyAppliances = appliances.map(a =>
      a.id === 'ev_charger' && evToday
        ? { ...a, durationMinutes: evToday.durationMinutes }
        : a
    );

    // ── Schedule events for this day ──
    const events   = scheduleDay(dailyAppliances, date, heatFactor);
    const fridgeCycles = generateFridgeCycles();

    // ── 1440-minute wattage array ──
    const slots  = new Float32Array(MINUTES_PER_DAY);
    const states = Object.fromEntries(appliances.map(a => [a.id, new Uint8Array(MINUTES_PER_DAY)]));

    // Layer 1: baseline (standby, lighting, etc.) + gaussian noise
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      slots[m] = baselineWatts(m, month) + gaussianNoise(0, 12);
    }

    // Layer 2: fridge cycling
    for (const cycle of fridgeCycles) {
      for (let i = 0; i < cycle.duration; i++) {
        const m = cycle.start + i;
        if (m >= MINUTES_PER_DAY) break;
        slots[m] += 150 * (1 + gaussianNoise(0, 0.06));
      }
    }

    // Layer 3: appliance events with realistic per-minute profiles
    for (const event of events) {
      const app = appliances.find(a => a.id === event.applianceId);
      if (!app) continue;
      // EV uses today's CC/CV profile; all others use phase/ramp profiles
      const profile = (app.id === 'ev_charger' && evToday)
        ? evToday.profile
        : buildProfile(app);
      for (let i = 0; i < event.durationMinutes; i++) {
        const m = event.startMinute + i;
        if (m >= MINUTES_PER_DAY) break;
        slots[m] += profile[i] ?? 0;
        states[event.applianceId][m] = 1;
      }
    }

    // ── Emit one row per minute ──
    for (let m = 0; m < MINUTES_PER_DAY; m++) {
      const h   = Math.floor(m / 60);
      const min = m % 60;
      const timestamp = `${dateStr}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;

      rows.push({
        timestamp,
        date: dateStr,
        day_of_week: dayName,
        minute: m,
        watts_total: Math.max(0, Math.round(slots[m])),
        appliances: Object.fromEntries(appliances.map(a => [a.id, states[a.id][m] === 1])),
      });
    }
  }

  return rows;
}
