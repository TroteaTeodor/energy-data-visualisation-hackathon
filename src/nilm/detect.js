// NILM — rule-based appliance disaggregation.
// Detection finds event windows; assignment uses the appliance's characteristic
// phase profile (from the same config used to generate the data), clipped to the
// actual residual. This ensures the WM shows phases, the EV shows CC/CV, etc.,
// and the small_consumers layer always contains the real baseline + fridge + lighting.

import { APPLIANCES } from '../generator/appliances.js';
import { generateEvProfile } from '../generator/ev.js';

export const APPLIANCE_ORDER = [
  'small_consumers',
  'fridge',
  'heat_pump',
  'microwave',
  'hob',
  'dishwasher',
  'washing_machine',
  'oven',
  'dryer',
  'ev_charger',
];

export const APPLIANCE_META = {
  ev_charger:      { label: 'EV Charger',      color: '#2dd4bf' },
  dryer:           { label: 'Tumble Dryer',     color: '#ec4899' },
  oven:            { label: 'Electric Oven',    color: '#ef4444' },
  washing_machine: { label: 'Washing Machine',  color: '#3b82f6' },
  dishwasher:      { label: 'Dishwasher',       color: '#8b5cf6' },
  hob:             { label: 'Electric Hob',     color: '#f97316' },
  heat_pump:       { label: 'Heat Pump',        color: '#0ea5e9' },
  microwave:       { label: 'Microwave',        color: '#6fe600' },
  fridge:          { label: 'Fridge',           color: '#7dd3fc' },
  small_consumers: { label: 'Small consumers',  color: '#f59e0b' },
};

// ── Build noiseless characteristic profiles from the appliance config ──

function noiselessPhaseProfile(phases) {
  const result = [];
  for (const phase of phases) {
    if (phase.thermostat) {
      let t = 0;
      while (t < phase.duration) {
        const onLen = Math.min(phase.onMin, phase.duration - t);
        for (let i = 0; i < onLen; i++) { result.push(phase.watts); t++; }
        const offLen = Math.min(phase.offMin, phase.duration - t);
        for (let i = 0; i < offLen; i++) { result.push(phase.offWatts ?? 50); t++; }
      }
    } else {
      for (let i = 0; i < phase.duration; i++) result.push(phase.watts);
    }
  }
  return result;
}

function noiselessRampProfile(watts, durationMinutes) {
  const ramp = Math.max(1, Math.floor(durationMinutes * 0.05));
  return Array.from({ length: durationMinutes }, (_, i) => {
    if (i < ramp) return Math.round(watts * (0.6 + 0.4 * (i / ramp)));
    if (i >= durationMinutes - ramp) return Math.round(watts * (0.6 + 0.4 * ((durationMinutes - 1 - i) / ramp)));
    return watts;
  });
}

// Build a lookup: applianceId → { profile: number[], watts: number }
const APP_CONFIG = Object.fromEntries(
  APPLIANCES.map(app => {
    let profile;
    if (app.id === 'ev_charger') {
      // Use a fixed CC/CV shape (startSoc=30%, targetSoc=85%)
      profile = generateEvProfile(app.watts, { startSoc: 0.30, targetSoc: 0.85 })?.profile ?? [];
    } else if (app.phases) {
      profile = noiselessPhaseProfile(app.phases);
    } else {
      profile = noiselessRampProfile(app.watts, app.durationMinutes);
    }
    return [app.id, { profile, watts: app.watts }];
  })
);

/**
 * Decompose a 1440-element watts array into per-appliance contributions.
 * Returns { [applianceId]: number[] } for all ids in APPLIANCE_META.
 */
export function detectAppliances(watts) {
  const n = watts.length;
  const res = Float32Array.from(watts); // mutable residual

  const out = {};
  for (const k of Object.keys(APPLIANCE_META)) out[k] = new Float32Array(n);

  // ── Baseline curve ──
  // Rolling minimum over a ±30-min window on the ORIGINAL signal.
  // This captures the time-varying floor (standby, lighting, fridge between cycles)
  // that's always present regardless of which appliances are running.
  // We never let appliance assignments eat into this floor — it always stays
  // in small_consumers so that layer is always visible.
  const baselineCurve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let min = Infinity;
    for (let k = Math.max(0, i - 30); k <= Math.min(n - 1, i + 30); k++) {
      if (watts[k] < min) min = watts[k];
    }
    baselineCurve[i] = min;
  }

  // ── Helpers ──

  function smoothed() {
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0, cnt = 0;
      for (let k = Math.max(0, i - 3); k <= Math.min(n - 1, i + 3); k++) { sum += res[k]; cnt++; }
      s[i] = sum / cnt;
    }
    return s;
  }

  // Assign using the appliance's characteristic profile shape, clipped to residual.
  // The baseline floor is always preserved — appliances can only claim watts
  // above it, so small_consumers always has something to show.
  function assignWithProfile(appId, eventStart, eventEnd) {
    const cfg = APP_CONFIG[appId];
    if (!cfg) return;

    const { profile, watts: nameplate } = cfg;
    const eventLen = eventEnd - eventStart;

    for (let i = 0; i < eventLen && eventStart + i < n; i++) {
      const m = eventStart + i;
      const floor    = baselineCurve[m];
      const expected = profile[Math.min(i, profile.length - 1)] ?? nameplate;
      // Never claim below the baseline floor
      const w = Math.min(Math.max(0, res[m] - floor), expected, nameplate);
      out[appId][m] += w;
      res[m] = Math.max(0, res[m] - w);
    }
  }

  function findEvents({ minW, maxW, minDur, maxDur, tw, maxEv = 5, gap = 6, hyst = 0.25 }) {
    const s = smoothed();
    const events = [];
    let m = tw ? tw[0] : 0;
    const mEnd = tw ? Math.min(tw[1], n) : n;

    while (m < mEnd && events.length < maxEv) {
      if (s[m] < minW || s[m] > maxW) { m++; continue; }

      const start = m;
      let end = m;
      let gapCount = 0;

      for (let j = m + 1; j < Math.min(n, m + maxDur + gap + 5); j++) {
        if (s[j] < minW * hyst) {
          if (++gapCount >= gap) break;
        } else {
          gapCount = 0;
          if (s[j] <= maxW * 1.1) end = j;
        }
      }

      const dur = end - start + 1;
      if (dur >= minDur) {
        events.push({ start, end: Math.min(end + 1, start + maxDur) });
        m = end + 1;
      } else {
        m++;
      }
    }
    return events;
  }

  // Simple assign for appliances without a characteristic profile (e.g. fridge)
  function assignFlat(key, start, end, cap) {
    for (let m = start; m < Math.min(end, n); m++) {
      const floor = baselineCurve[m];
      const w = Math.min(Math.max(0, res[m] - floor), cap);
      out[key][m] += w;
      res[m] = Math.max(0, res[m] - w);
    }
  }

  // ── Detections ──
  // Order matters: each pass subtracts from the residual before the next runs.
  // Most distinctive / least ambiguous appliances go first.

  // Fridge: detected FIRST because it's the most repetitive pattern in the signal.
  // Short pulses of ~150W every 20-28 min all day long.
  // Require at least 8 events to confirm the pattern (nothing else repeats like this).
  const fridgeEvents = findEvents({ minW: 80, maxW: 250, minDur: 8, maxDur: 18, maxEv: 60, gap: 3, hyst: 0.4 });
  if (fridgeEvents.length >= 8) {
    fridgeEvents.forEach(e => assignFlat('fridge', e.start, e.end, 200));
  }

  // EV: unmistakable — nothing else draws 6+ kW for hours
  findEvents({ minW: 5500, maxW: 9000, minDur: 60, maxDur: 300, tw: [1080, 1440], maxEv: 2 })
    .forEach(e => assignWithProfile('ev_charger', e.start, e.end));

  // Oven: preheat phase hits 2000W for ~12 min — no other appliance does this.
  // Detect before dryer so the 2000W signature isn't mistaken for a sustained dryer load.
  findEvents({ minW: 1200, maxW: 2200, minDur: 50, maxDur: 75, tw: [900, 1300], maxEv: 2 })
    .forEach(e => assignWithProfile('oven', e.start, e.end));

  // Washing machine: multi-phase, morning window — claim before dryer runs
  findEvents({ minW: 200, maxW: 1500, minDur: 80, maxDur: 105, tw: [300, 840], maxEv: 2, hyst: 0.1, gap: 12 })
    .forEach(e => assignWithProfile('washing_machine', e.start, e.end));

  // Dishwasher: evening window — claim before dryer runs
  findEvents({ minW: 250, maxW: 1400, minDur: 85, maxDur: 100, tw: [1000, 1380], maxEv: 2, hyst: 0.1, gap: 12 })
    .forEach(e => assignWithProfile('dishwasher', e.start, e.end));

  // Heat pump: cyclic throughout day — detect before dryer to avoid being swallowed
  findEvents({ minW: 1200, maxW: 1650, minDur: 40, maxDur: 52, maxEv: 6 })
    .forEach(e => assignWithProfile('heat_pump', e.start, e.end));

  // Hob: medium-high power, cooking windows
  findEvents({ minW: 1100, maxW: 1600, minDur: 20, maxDur: 35, maxEv: 3 })
    .forEach(e => assignWithProfile('hob', e.start, e.end));

  // Dryer: runs last among high-power appliances — everything ambiguous is already claimed.
  // Time window 07h–15h prevents evening mis-attribution.
  // minW raised to 1500W to avoid WM rinse-heat phase (1350W + baseline).
  findEvents({ minW: 1500, maxW: 1750, minDur: 50, maxDur: 75, tw: [420, 900], maxEv: 2 })
    .forEach(e => assignWithProfile('dryer', e.start, e.end));

  // Microwave: short high-power burst
  findEvents({ minW: 850, maxW: 1050, minDur: 2, maxDur: 7, maxEv: 6 })
    .forEach(e => assignWithProfile('microwave', e.start, e.end));

  // Remainder = standby + fridge cycling + lighting + undetected loads
  for (let m = 0; m < n; m++) out.small_consumers[m] = Math.max(0, res[m]);

  return Object.fromEntries(
    Object.entries(out).map(([k, v]) => [k, Array.from(v).map(w => Math.round(w))])
  );
}
