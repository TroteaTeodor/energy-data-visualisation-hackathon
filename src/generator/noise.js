// Box-Muller transform — returns a gaussian-distributed random number.
export function gaussianNoise(mean = 0, std = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + std * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Returns a per-slot wattage array for a single appliance run.
 * Adds a short ramp-up/down at the edges and ±5% jitter per slot —
 * making the signature more realistic for NILM to work with later.
 *
 * @param {number} watts         Nameplate wattage
 * @param {number} durationSlots Number of 15-min slots
 * @returns {number[]}
 */
export function applianceProfile(watts, durationSlots) {
  return Array.from({ length: durationSlots }, (_, i) => {
    const ramp = Math.max(1, Math.floor(durationSlots * 0.15));
    let factor = 1;
    if (i < ramp) factor = 0.5 + 0.5 * (i / ramp);
    else if (i >= durationSlots - ramp) factor = 0.5 + 0.5 * ((durationSlots - 1 - i) / ramp);
    const jitter = 1 + gaussianNoise(0, 0.05);
    return Math.max(0, watts * factor * jitter);
  });
}
