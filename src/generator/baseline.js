// Always-on baseline load (fridge cycling, standby, router, lighting).
// Values in watts by hour of day — typical Belgian household.
const HOUR_PROFILE = [
  280, 265, 255, 250, 255, 270, // 00–05h
  330, 390, 420, 390, 370, 360, // 06–11h
  380, 370, 350, 340, 360, 400, // 12–17h
  450, 460, 430, 410, 370, 320, // 18–23h
];

// Seasonal multiplier by month (0=Jan … 11=Dec).
// Winter high (heating, lights on longer), summer low.
const SEASONAL = [1.30, 1.25, 1.10, 0.95, 0.85, 0.80, 0.80, 0.82, 0.90, 1.00, 1.15, 1.30];

/**
 * Returns the baseline wattage for a given 15-min slot and calendar month.
 * @param {number} slot  0–95
 * @param {number} month 0–11
 */
export function baselineWatts(slot, month) {
  const hour = Math.floor(slot / 4);
  return HOUR_PROFILE[hour] * SEASONAL[month];
}

// Seasonal factor for heat pump cycling (inverse of general seasonal — more heating in winter).
export const HEAT_PUMP_SEASONAL = [1.6, 1.5, 1.2, 0.7, 0.3, 0.1, 0.1, 0.2, 0.5, 0.9, 1.2, 1.5];
