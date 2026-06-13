// Always-on baseline load (standby, router, lighting — excluding fridge, which is cycled separately).
// Watts by hour of day — typical Belgian household.
const HOUR_PROFILE = [
  180, 165, 155, 150, 155, 170, // 00–05h  (deep night)
  230, 310, 360, 320, 290, 275, // 06–11h  (morning)
  295, 280, 265, 255, 275, 320, // 12–17h  (afternoon)
  380, 390, 360, 340, 300, 240, // 18–23h  (evening)
];

// Seasonal multiplier by month (0=Jan … 11=Dec).
// Winter: more lighting + heating standby. Summer: less.
export const SEASONAL = [1.30, 1.25, 1.10, 0.95, 0.85, 0.80, 0.80, 0.82, 0.90, 1.00, 1.15, 1.30];

// Heat pump cycling intensity by month — peaks in winter, near-zero in summer.
export const HEAT_PUMP_SEASONAL = [1.6, 1.5, 1.2, 0.7, 0.3, 0.1, 0.1, 0.2, 0.5, 0.9, 1.2, 1.5];

/**
 * Returns baseline wattage for a given minute of the day and calendar month.
 * @param {number} minute  0–1439
 * @param {number} month   0–11
 */
export function baselineWatts(minute, month) {
  const hour = Math.floor(minute / 60);
  return HOUR_PROFILE[hour] * SEASONAL[month];
}
