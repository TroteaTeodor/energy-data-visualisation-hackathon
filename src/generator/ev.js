import { gaussianNoise } from './noise.js';

const BATTERY_KWH = 60;   // typical EV (VW ID.3 / Renault Megane E-Tech)
const CC_THRESHOLD = 0.78; // CC→CV transition at 78% SoC
const CV_LAMBDA    = 0.02; // decay rate — power halves roughly every 35 min in CV phase
const CV_CUTOFF_W  = 400;  // charger stops when power tapers this low

/**
 * Generates a per-minute CC/CV EV charging profile for one session.
 *
 * CC phase: constant full power until SoC hits CC_THRESHOLD.
 * CV phase: exponential taper until target SoC is reached or power < CV_CUTOFF_W.
 *
 * Starting SoC: 20–65% (never empty — real daily driver)
 * Target SoC:   78–92% (never full — preserves battery health)
 *
 * @param {number} chargerWatts  Nameplate charger power (default 7400 W / 7.4 kW wallbox)
 * @returns {{ durationMinutes: number, profile: number[] } | null}
 *          null if the car is already above target (no session needed)
 */
/**
 * @param {number} chargerWatts
 * @param {{ startSoc?: number, targetSoc?: number }} [opts]
 *   Pass fixed values for a deterministic display profile; omit for random generation.
 */
export function generateEvProfile(chargerWatts = 7400, opts = {}) {
  const chargerKw = chargerWatts / 1000;

  const startSoc  = opts.startSoc  ?? (0.20 + Math.random() * 0.45);
  const targetSoc = opts.targetSoc ?? (0.78 + Math.random() * 0.14);

  if (startSoc >= targetSoc) return null; // battery already at target, skip

  const profile = [];
  let soc = startSoc;

  // ── CC phase: full power ──
  const ccEnd = Math.min(CC_THRESHOLD, targetSoc);
  while (soc < ccEnd) {
    const kwhPerMin = chargerKw / 60;
    soc = Math.min(soc + kwhPerMin / BATTERY_KWH, ccEnd);
    // Minimal jitter on EV — charger hardware is very stable
    profile.push(Math.round(chargerWatts * (1 + gaussianNoise(0, 0.008))));
  }

  // ── CV phase: exponential taper ──
  if (soc < targetSoc) {
    let t = 0;
    let cvPower = chargerWatts;
    while (soc < targetSoc && cvPower > CV_CUTOFF_W) {
      cvPower = chargerWatts * Math.exp(-CV_LAMBDA * t);
      soc += (cvPower / 1000) / 60 / BATTERY_KWH;
      profile.push(Math.max(0, Math.round(cvPower)));
      t++;
    }
  }

  return { durationMinutes: profile.length, profile };
}
