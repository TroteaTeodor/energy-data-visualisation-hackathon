// Box-Muller transform — gaussian-distributed random number.
export function gaussianNoise(mean = 0, std = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Generates a per-minute wattage array from a phase definition list.
 * Supports two phase types:
 *   - Simple:      { duration, watts }
 *   - Thermostat:  { duration, watts, thermostat: true, onMin, offMin, offWatts }
 *     → alternates onMin minutes at `watts` and offMin minutes at `offWatts`,
 *       cycling for the full `duration`. Models oven/boiler temp regulation.
 *
 * @param {object[]} phases
 * @returns {number[]}  Per-minute wattage values (length = sum of phase durations)
 */
export function phaseProfile(phases) {
  const result = [];
  for (const phase of phases) {
    if (phase.thermostat) {
      let t = 0;
      while (t < phase.duration) {
        const onLen = Math.min(phase.onMin, phase.duration - t);
        for (let i = 0; i < onLen; i++) {
          result.push(Math.max(0, phase.watts * (1 + gaussianNoise(0, 0.03))));
          t++;
        }
        const offLen = Math.min(phase.offMin, phase.duration - t);
        for (let i = 0; i < offLen; i++) {
          result.push(Math.max(0, (phase.offWatts ?? 50) * (1 + gaussianNoise(0, 0.03))));
          t++;
        }
      }
    } else {
      for (let i = 0; i < phase.duration; i++) {
        result.push(Math.max(0, phase.watts * (1 + gaussianNoise(0, 0.04))));
      }
    }
  }
  return result;
}

/**
 * Simple ramp-up / plateau / ramp-down profile for flat appliances (EV charger etc.).
 * Adds ±5% per-minute jitter for realism.
 *
 * @param {number} watts
 * @param {number} durationMinutes
 * @returns {number[]}
 */
export function rampProfile(watts, durationMinutes) {
  const ramp = Math.max(1, Math.floor(durationMinutes * 0.05)); // 5% ramp
  return Array.from({ length: durationMinutes }, (_, i) => {
    let factor = 1;
    if (i < ramp) factor = 0.6 + 0.4 * (i / ramp);
    else if (i >= durationMinutes - ramp) factor = 0.6 + 0.4 * ((durationMinutes - 1 - i) / ramp);
    return Math.max(0, watts * factor * (1 + gaussianNoise(0, 0.05)));
  });
}
