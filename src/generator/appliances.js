// Appliance definitions — grootverbruikers only.
// timeWindows: [startMin, endMin] in minutes from midnight (0 = 00:00, 1439 = 23:59).
// dayWeights:  [Sun, Mon, Tue, Wed, Thu, Fri, Sat] — relative probability multiplier.
// frequency:   base probability of running on any given day.
// durationMinutes: total run length in minutes — must match sum of phase durations.
// phases:      per-minute power profile (see noise.js → phaseProfile).
//              null = simple ramp profile (EV, dryer).

export const APPLIANCES = [
  {
    id: 'washing_machine',
    name: 'Washing Machine',
    watts: 1400,
    durationMinutes: 90,
    timeWindows: [[360, 780]],       // 06h–13h start
    dayWeights: [0.9, 0.5, 0.5, 0.5, 0.5, 1.0, 1.0],
    frequency: 0.4,
    enabled: true,
    phases: [
      { duration: 5,  watts: 200  }, // cold fill
      { duration: 15, watts: 1400 }, // water heating
      { duration: 20, watts: 350  }, // main wash
      { duration: 10, watts: 1350 }, // rinse heat
      { duration: 15, watts: 270  }, // rinse
      { duration: 10, watts: 200  }, // spin
      { duration: 5,  watts: 100  }, // drain
      { duration: 10, watts: 60   }, // coast / end
    ],
  },
  {
    id: 'dryer',
    name: 'Tumble Dryer',
    watts: 1600,
    durationMinutes: 60,
    timeWindows: [[420, 900]],       // 07h–15h
    dayWeights: [0.9, 0.4, 0.4, 0.4, 0.4, 0.9, 1.0],
    frequency: 0.3,
    enabled: true,
    phases: [
      { duration: 5,  watts: 950  }, // heat up
      { duration: 50, watts: 1600 }, // tumble
      { duration: 5,  watts: 250  }, // cool-down
    ],
  },
  {
    id: 'dishwasher',
    name: 'Dishwasher',
    watts: 1200,
    durationMinutes: 90,
    timeWindows: [[1020, 1290]],     // 17h–21h30 start
    dayWeights: [0.7, 0.8, 0.8, 0.8, 0.8, 0.9, 0.7],
    frequency: 0.7,
    enabled: true,
    phases: [
      { duration: 5,  watts: 350  }, // pre-rinse
      { duration: 20, watts: 1300 }, // main wash + heat
      { duration: 15, watts: 480  }, // wash plateau
      { duration: 10, watts: 1200 }, // reheat
      { duration: 15, watts: 380  }, // rinse
      { duration: 20, watts: 850  }, // heated dry
      { duration: 5,  watts: 180  }, // cool-down
    ],
  },
  {
    id: 'oven',
    name: 'Electric Oven',
    watts: 2000,
    durationMinutes: 60,
    timeWindows: [[960, 1200]],      // 16h–20h
    dayWeights: [1.0, 0.6, 0.6, 0.7, 0.7, 1.0, 1.0],
    frequency: 0.45,
    enabled: true,
    phases: [
      { duration: 12, watts: 2000 },   // full preheat
      // thermostat cycling: 2 min on @ 1900W, 1 min off @ 350W (element holding temp)
      { duration: 48, watts: 1900, thermostat: true, onMin: 2, offMin: 1, offWatts: 350 },
    ],
  },
  {
    id: 'hob',
    name: 'Electric Hob',
    watts: 1500,
    durationMinutes: 30,
    timeWindows: [[660, 780], [960, 1140]], // 11h–13h or 16h–19h
    dayWeights: [1.0, 0.8, 0.8, 0.8, 0.8, 1.0, 1.0],
    frequency: 0.8,
    enabled: true,
    phases: [
      { duration: 2,  watts: 1500 }, // ramp to temp
      { duration: 15, watts: 1400 }, // active cooking
      { duration: 8,  watts: 700  }, // simmer
      { duration: 5,  watts: 300  }, // winding down
    ],
  },
  {
    id: 'ev_charger',
    name: 'EV Charger',
    watts: 7400,
    durationMinutes: 240,            // 4h typical
    timeWindows: [[1200, 1320]],     // 20h–22h start
    dayWeights: [0.7, 0.9, 0.9, 0.9, 0.9, 0.8, 0.7],
    frequency: 0.8,
    enabled: true,
    phases: null,                    // flat constant load — simple ramp profile
  },
  {
    id: 'heat_pump',
    name: 'Heat Pump / Boiler',
    watts: 1500,
    durationMinutes: 45,
    timeWindows: [[0, 1395]],        // any time
    dayWeights: [1, 1, 1, 1, 1, 1, 1],
    frequency: 1.0,
    enabled: true,
    cyclic: true,                    // multiple short cycles per day
    cyclesPerDay: 4,                 // base; scaled by seasonal factor
    phases: [
      { duration: 2,  watts: 800  }, // startup
      { duration: 40, watts: 1500 }, // running
      { duration: 3,  watts: 500  }, // shutdown
    ],
  },
  {
    id: 'microwave',
    name: 'Microwave',
    watts: 900,
    durationMinutes: 5,
    timeWindows: [[360, 480], [660, 780], [960, 1140]], // morning / lunch / dinner
    dayWeights: [1, 1, 1, 1, 1, 1, 1],
    frequency: 0.85,
    enabled: true,
    phases: [
      { duration: 5, watts: 950 }, // constant magnetron power
    ],
  },
];
