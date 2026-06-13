// Appliance definitions — grootverbruikers only.
// timeWindows: [startSlot, endSlot] where slot = 15-min index (0=00:00, 95=23:45).
// dayWeights: [Sun, Mon, Tue, Wed, Thu, Fri, Sat] — relative probability multiplier.
// frequency: base probability of running on any given day.
// durationSlots: how many 15-min slots one run takes.

export const APPLIANCES = [
  {
    id: 'dishwasher',
    name: 'Dishwasher',
    watts: 1200,
    durationSlots: 6,           // 90 min
    timeWindows: [[68, 86]],    // 17h–21h30 start window
    dayWeights: [0.7, 0.8, 0.8, 0.8, 0.8, 0.9, 0.7],
    frequency: 0.7,
    enabled: true,
  },
  {
    id: 'washing_machine',
    name: 'Washing Machine',
    watts: 2000,
    durationSlots: 6,           // 90 min
    timeWindows: [[24, 52]],    // 06h–13h start window
    dayWeights: [0.9, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0],
    frequency: 0.4,
    enabled: true,
  },
  {
    id: 'dryer',
    name: 'Tumble Dryer',
    watts: 2500,
    durationSlots: 4,           // 60 min
    timeWindows: [[28, 60]],    // 07h–15h (usually follows wash)
    dayWeights: [0.9, 0.4, 0.4, 0.4, 0.4, 0.9, 1.0],
    frequency: 0.3,
    enabled: true,
  },
  {
    id: 'oven',
    name: 'Electric Oven',
    watts: 2000,
    durationSlots: 4,           // 60 min
    timeWindows: [[64, 80]],    // 16h–20h
    dayWeights: [1.0, 0.6, 0.6, 0.7, 0.7, 1.0, 1.0],
    frequency: 0.45,
    enabled: true,
  },
  {
    id: 'hob',
    name: 'Electric Hob',
    watts: 1500,
    durationSlots: 2,           // 30 min avg
    timeWindows: [[44, 52], [64, 76]], // 11h–13h or 16h–19h
    dayWeights: [1.0, 0.8, 0.8, 0.8, 0.8, 1.0, 1.0],
    frequency: 0.8,
    enabled: true,
  },
  {
    id: 'ev_charger',
    name: 'EV Charger',
    watts: 7400,
    durationSlots: 16,          // 4h typical overnight charge
    timeWindows: [[80, 88]],    // 20h–22h start (runs into night)
    dayWeights: [0.7, 0.9, 0.9, 0.9, 0.9, 0.8, 0.7],
    frequency: 0.8,
    enabled: true,
  },
  {
    id: 'heat_pump',
    name: 'Heat Pump / Boiler',
    watts: 1500,
    durationSlots: 3,           // ~45 min per cycle
    timeWindows: [[0, 92]],     // any time
    dayWeights: [1, 1, 1, 1, 1, 1, 1],
    frequency: 1.0,
    enabled: true,
    cyclic: true,               // runs multiple short cycles per day
    cyclesPerDay: 4,            // base; scaled by seasonal factor
  },
  {
    id: 'microwave',
    name: 'Microwave',
    watts: 900,
    durationSlots: 1,           // ~15 min
    timeWindows: [[24, 32], [44, 52], [64, 76]], // morning / lunch / dinner
    dayWeights: [1, 1, 1, 1, 1, 1, 1],
    frequency: 0.85,
    enabled: true,
  },
];
