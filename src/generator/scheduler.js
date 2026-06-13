import { gaussianNoise } from './noise.js';

const MINUTES_PER_DAY = 1440;

/**
 * Decides which appliances run on a given day and when.
 *
 * @param {object[]} appliances
 * @param {Date}     date
 * @param {number}   heatFactor  Seasonal multiplier for heat pump cycle count
 * @returns {{ applianceId, startMinute, durationMinutes }[]}
 */
export function scheduleDay(appliances, date, heatFactor = 1) {
  const dayOfWeek = date.getDay(); // 0=Sun … 6=Sat
  const events = [];

  for (const app of appliances) {
    if (!app.enabled) continue;

    // ── Heat pump: multiple short cycles, count scales with season ──
    if (app.cyclic) {
      const cycles = Math.max(0, Math.round(app.cyclesPerDay * heatFactor + gaussianNoise(0, 0.5)));
      for (let c = 0; c < cycles; c++) {
        const maxStart = MINUTES_PER_DAY - app.durationMinutes;
        const startMinute = Math.floor(Math.random() * maxStart);
        events.push({ applianceId: app.id, startMinute, durationMinutes: app.durationMinutes });
      }
      continue;
    }

    // ── Regular appliances ──
    const prob = app.frequency * app.dayWeights[dayOfWeek];
    if (Math.random() > prob) continue;

    const window = app.timeWindows[Math.floor(Math.random() * app.timeWindows.length)];
    const [winStart, winEnd] = window;
    const maxStart = Math.min(winEnd, MINUTES_PER_DAY - app.durationMinutes);
    if (maxStart < winStart) continue;

    const startMinute = winStart + Math.floor(Math.random() * (maxStart - winStart + 1));
    events.push({ applianceId: app.id, startMinute, durationMinutes: app.durationMinutes });
  }

  return events;
}
