import { gaussianNoise } from './noise.js';

/**
 * Decides which appliances run on a given day and when.
 *
 * @param {object[]} appliances    Appliance config array
 * @param {Date}     date          The day being scheduled
 * @param {number}   heatFactor    Seasonal multiplier for heat pump cycles (1 = baseline)
 * @returns {{ applianceId, startSlot, durationSlots }[]}
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
        const maxStart = 96 - app.durationSlots;
        const startSlot = Math.floor(Math.random() * maxStart);
        events.push({ applianceId: app.id, startSlot, durationSlots: app.durationSlots });
      }
      continue;
    }

    // ── Regular appliances: probability check then pick time window ──
    const prob = app.frequency * app.dayWeights[dayOfWeek];
    if (Math.random() > prob) continue;

    const window = app.timeWindows[Math.floor(Math.random() * app.timeWindows.length)];
    const [winStart, winEnd] = window;
    const maxStart = Math.min(winEnd, 96 - app.durationSlots);
    if (maxStart < winStart) continue;

    const startSlot = winStart + Math.floor(Math.random() * (maxStart - winStart + 1));
    events.push({ applianceId: app.id, startSlot, durationSlots: app.durationSlots });
  }

  return events;
}
