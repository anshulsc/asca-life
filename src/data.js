/* ═══════════════════════════════════════════════════════════════
   ASCA GYM — Exercise Library & Historical Data
   Unified naming, proper gym terminology, backward-compatible aliases
   ═══════════════════════════════════════════════════════════════ */

const EXERCISE_LIBRARY = {
  "Pull": [
    "Lat Pulldown",
    "Seated Cable Row",
    "Machine-Assisted Pull-Up",
    "Cable Bicep Curl",
    "Straight-Arm Lat Pulldown",
    "Dumbbell Preacher Curl",
    "Dumbbell Hammer Curl",
    "Cable Pullover",
    "Machine Row",
    "Dumbbell Shrugs"
  ],
  "Push": [
    "Chest Press",
    "Pec Deck Fly",
    "Machine-Assisted Dip",
    "Incline Dumbbell Press",
    "Tricep Rope Pushdown",
    "Tricep Pushdown",
    "Reverse Grip Tricep Pushdown",
    "Cable Overhead Tricep Extension",
    "Single-Arm Overhead Tricep Extension"
  ],
  "Legs": [
    "Leg Extension",
    "Leg Curl",
    "Seated Leg Curl",
    "Leg Press",
    "Calf Raises",
    "Squats",
    "Lunges"
  ],
  "Shoulders": [
    "Shoulder Press",
    "Lateral Raises",
    "Front Raises",
    "Face Pull",
    "Reverse Pec Deck Fly"
  ],
  "Core": [
    "Machine Crunch",
    "Leg Raises",
    "Knee Raises",
    "Wrist Curl"
  ]
};

// Alias map: maps old/variant names → canonical name (backward compat)
const EXERCISE_ALIASES = {
  // Pull aliases
  "lat pull down": "Lat Pulldown",
  "lat pulldown": "Lat Pulldown",
  "rows": "Seated Cable Row",
  "rows (slow)": "Seated Cable Row",
  "seated cable row": "Seated Cable Row",
  "seated row": "Seated Cable Row",
  "cable row": "Seated Cable Row",
  "assisted pull ups": "Machine-Assisted Pull-Up",
  "assisted pull-ups": "Machine-Assisted Pull-Up",
  "machine-assisted pull-up": "Machine-Assisted Pull-Up",
  "pull ups": "Machine-Assisted Pull-Up",
  "cable bicep curl": "Cable Bicep Curl",
  "cable assisted bicep curl": "Cable Bicep Curl",
  "cables assisted bicep curl": "Cable Bicep Curl",
  "cable assisted bar curls": "Cable Bicep Curl",
  "cable assisted bar curl": "Cable Bicep Curl",
  "lat cable": "Straight-Arm Lat Pulldown",
  "lat pull cable": "Straight-Arm Lat Pulldown",
  "straight-arm lat pulldown": "Straight-Arm Lat Pulldown",
  "straight arm pulldown": "Straight-Arm Lat Pulldown",
  "db preacher curl": "Dumbbell Preacher Curl",
  "db preacher curl (single)": "Dumbbell Preacher Curl",
  "dumbbell preacher curl": "Dumbbell Preacher Curl",
  "hammer curl": "Dumbbell Hammer Curl",
  "dumbbell hammer curl": "Dumbbell Hammer Curl",
  "cable pull over": "Cable Pullover",
  "cable pullover": "Cable Pullover",
  "assisted row": "Machine Row",
  "machine row": "Machine Row",
  "shrugs": "Dumbbell Shrugs",
  "dumbbell shrugs": "Dumbbell Shrugs",

  // Push aliases
  "chest press": "Chest Press",
  "vertical chest press": "Chest Press",
  "butterfly": "Pec Deck Fly",
  "pec deck fly": "Pec Deck Fly",
  "pec deck": "Pec Deck Fly",
  "pec fly": "Pec Deck Fly",
  "assisted dips": "Machine-Assisted Dip",
  "machine-assisted dip": "Machine-Assisted Dip",
  "dips": "Machine-Assisted Dip",
  "incline db press": "Incline Dumbbell Press",
  "incline dumbbell press": "Incline Dumbbell Press",
  "tricep extension": "Tricep Rope Pushdown",
  "tricep rope pushdown": "Tricep Rope Pushdown",
  "tricep push": "Tricep Pushdown",
  "tricep pushdown": "Tricep Pushdown",
  "tricep bar opp": "Reverse Grip Tricep Pushdown",
  "reverse grip tricep pushdown": "Reverse Grip Tricep Pushdown",
  "tricep overhead": "Cable Overhead Tricep Extension",
  "cable overhead tricep extension": "Cable Overhead Tricep Extension",
  "tricep single arm oh": "Single-Arm Overhead Tricep Extension",
  "tricep single arm overhead (db)": "Single-Arm Overhead Tricep Extension",
  "tricep single arm overhead": "Single-Arm Overhead Tricep Extension",
  "single-arm overhead tricep extension": "Single-Arm Overhead Tricep Extension",

  // Shoulders aliases — unified single/both
  "shoulder press": "Shoulder Press",
  "shoulder press vertical": "Shoulder Press",
  "reverse deck": "Reverse Pec Deck Fly",
  "reverse deck single": "Reverse Pec Deck Fly",
  "reverse deck (single arm)": "Reverse Pec Deck Fly",
  "reverse deck single arm": "Reverse Pec Deck Fly",
  "reverse pec deck fly": "Reverse Pec Deck Fly",

  // Legs aliases
  "leg press": "Leg Press",
  "leg press vertical": "Leg Press",
  "leg flexion": "Seated Leg Curl",
  "seated leg curl": "Seated Leg Curl",
  "calves raises": "Calf Raises",
  "calf raises": "Calf Raises",

  // Core aliases
  "ab crunches": "Machine Crunch",
  "abs crunches vertical": "Machine Crunch",
  "ab crunches vertical": "Machine Crunch",
  "machine crunch": "Machine Crunch",
  "abs leg raises": "Leg Raises",
  "abs knee raises": "Knee Raises",
  "forearms": "Wrist Curl",
  "wrist curl": "Wrist Curl"
};

function canonicalName(name) {
  const key = name.toLowerCase().trim();
  return EXERCISE_ALIASES[key] || name;
}

const DAY_TYPES = [
  "Pull", "Push", "Legs", "Shoulders", "Upper",
  "Pull + Shoulders", "Push + Shoulders",
  "Legs + Shoulders", "Shoulders + Lower",
  "Full Body", "Rest Day"
];

// Workout Routines Config (for Dropset-style routine cards)
const DEFAULT_ROUTINES = [
  { name: "Pull", muscles: "Back + Biceps", day: "Monday", color: "var(--c-blue)" },
  { name: "Push", muscles: "Chest + Triceps", day: "Tuesday", color: "var(--c-red)" },
  { name: "Shoulders", muscles: "Delts + Traps", day: "Wednesday", color: "var(--c-orange)" },
  { name: "Legs", muscles: "Quads + Hams + Calves", day: "Thursday", color: "var(--c-green)" },
  { name: "Upper", muscles: "Chest + Back + Arms", day: "Friday", color: "var(--c-purple)" }
];

// Historical data — with canonical names applied
const HISTORICAL_DATA = [
  {
    date: "2026-06-08", dayType: "Pull",
    exercises: [
      { name: "Lat Pulldown", sets: [
        { weight: 52, reps: 9, notes: "" },
        { weight: 52, reps: 9, notes: "" },
        { weight: 52, reps: 9, notes: "Something happened in last set" }
      ]},
      { name: "Seated Cable Row", sets: [
        { weight: 45, reps: 12, notes: "" },
        { weight: 45, reps: 12, notes: "" },
        { weight: 45, reps: 12, notes: "" }
      ]},
      { name: "Machine-Assisted Pull-Up", sets: [
        { weight: null, reps: 10, notes: "Level 6" },
        { weight: null, reps: 10, notes: "Level 6" },
        { weight: null, reps: 11, notes: "Level 6" }
      ]},
      { name: "Straight-Arm Lat Pulldown", sets: [
        { weight: 22.5, reps: 10, notes: "Level 9" },
        { weight: 22.5, reps: 10, notes: "Level 9" },
        { weight: 22.5, reps: 10, notes: "Level 9" }
      ]}
    ]
  },
  {
    date: "2026-06-07", dayType: "Push",
    exercises: [
      { name: "Chest Press", sets: [
        { weight: 40, reps: 12, notes: "Level 8" },
        { weight: 40, reps: 11, notes: "Level 8" },
        { weight: 40, reps: 9, notes: "Level 8" }
      ]},
      { name: "Pec Deck Fly", sets: [
        { weight: 35, reps: 10, notes: "Level 7" },
        { weight: 35, reps: 8, notes: "Level 7" },
        { weight: 35, reps: 8, notes: "Level 7" }
      ]},
      { name: "Machine-Assisted Dip", sets: [
        { weight: null, reps: 10, notes: "Level 4" },
        { weight: null, reps: 10, notes: "Level 4" },
        { weight: null, reps: 9, notes: "Level 4" }
      ]},
      { name: "Tricep Pushdown", sets: [
        { weight: 30, reps: 12, notes: "Level 12" },
        { weight: 30, reps: 12, notes: "Level 12" }
      ]},
      { name: "Cable Overhead Tricep Extension", sets: [
        { weight: 20, reps: 12, notes: "Level 8" },
        { weight: 20, reps: 12, notes: "Level 8" }
      ]},
      { name: "Wrist Curl", sets: [{ weight: null, reps: null, notes: "" }]}
    ]
  },
  {
    date: "2026-06-05", dayType: "Shoulders + Lower",
    exercises: [
      { name: "Shoulder Press", sets: [
        { weight: 30, reps: 12, notes: "Level 6" },
        { weight: 30, reps: 12, notes: "Level 6" },
        { weight: 30, reps: 10, notes: "Level 6" }
      ]},
      { name: "Reverse Pec Deck Fly", sets: [
        { weight: null, reps: 12, notes: "Level 9" },
        { weight: null, reps: 12, notes: "Level 9" },
        { weight: null, reps: 11, notes: "Level 9" }
      ]},
      { name: "Leg Raises", sets: [
        { weight: null, reps: 12, notes: "" },
        { weight: null, reps: 12, notes: "" },
        { weight: null, reps: 7, notes: "" }
      ]},
      { name: "Knee Raises", sets: [
        { weight: null, reps: 10, notes: "" },
        { weight: null, reps: 10, notes: "" }
      ]},
      { name: "Lateral Raises", sets: [
        { weight: null, reps: 12, notes: "Level 4" },
        { weight: null, reps: 12, notes: "Level 4" }
      ]},
      { name: "Face Pull", sets: [
        { weight: 25, reps: 12, notes: "" },
        { weight: 25, reps: 12, notes: "" }
      ]},
      { name: "Cable Bicep Curl", sets: [
        { weight: 22.5, reps: 12, notes: "Level 9" },
        { weight: 25, reps: 12, notes: "Level 10" },
        { weight: 25, reps: 12, notes: "Level 10" }
      ]},
      { name: "Wrist Curl", sets: [
        { weight: 35, reps: 12, notes: "Level 14" },
        { weight: 35, reps: 12, notes: "Level 14" },
        { weight: 35, reps: 12, notes: "Level 14" }
      ]},
      { name: "Machine Crunch", sets: [{ weight: null, reps: null, notes: "" }]}
    ]
  },
  {
    date: "2026-06-03", dayType: "Upper",
    exercises: [
      { name: "Lat Pulldown", sets: [
        { weight: 52, reps: 9, notes: "" },
        { weight: 52, reps: 9, notes: "" },
        { weight: 52, reps: 6, notes: "Drop to 43kg: 4 reps" },
        { weight: 52, reps: 9, notes: "" }
      ]},
      { name: "Seated Cable Row", sets: [
        { weight: 50, reps: 11, notes: "Slow" },
        { weight: 50, reps: 11, notes: "Slow" }
      ]},
      { name: "Chest Press", sets: [
        { weight: 40, reps: 11, notes: "Level 8" },
        { weight: 40, reps: 11, notes: "Level 8" }
      ]},
      { name: "Pec Deck Fly", sets: [
        { weight: 35, reps: 12, notes: "Level 7" },
        { weight: 35, reps: 10, notes: "Level 7" }
      ]},
      { name: "Machine-Assisted Dip", sets: [
        { weight: null, reps: 10, notes: "Level 4" },
        { weight: null, reps: 7, notes: "Level 4" }
      ]},
      { name: "Straight-Arm Lat Pulldown", sets: [
        { weight: 22.5, reps: 12, notes: "Level 9" },
        { weight: 22.5, reps: 8, notes: "Level 9" }
      ]},
      { name: "Tricep Pushdown", sets: [
        { weight: 30, reps: 8, notes: "Level 12" },
        { weight: 30, reps: 7, notes: "Level 12" }
      ]},
      { name: "Reverse Grip Tricep Pushdown", sets: [
        { weight: 35, reps: 7, notes: "Level 14" },
        { weight: 35, reps: 7, notes: "Level 14" }
      ]},
      { name: "Cable Overhead Tricep Extension", sets: [
        { weight: 20, reps: 10, notes: "Level 8" },
        { weight: 20, reps: 8, notes: "Level 8" }
      ]},
      { name: "Wrist Curl", sets: [{ weight: 35, reps: 12, notes: "Level 14" }]}
    ]
  },
  {
    date: "2026-06-02", dayType: "Legs + Shoulders",
    exercises: [
      { name: "Leg Extension", sets: [
        { weight: 30, reps: 12, notes: "" },
        { weight: 35, reps: 12, notes: "" },
        { weight: 35, reps: 12, notes: "" }
      ]},
      { name: "Leg Curl", sets: [
        { weight: 20, reps: 12, notes: "" },
        { weight: 20, reps: 12, notes: "" },
        { weight: 20, reps: 12, notes: "" }
      ]},
      { name: "Seated Leg Curl", sets: [
        { weight: null, reps: 12, notes: "Level 6" },
        { weight: null, reps: 12, notes: "Level 6" }
      ]},
      { name: "Leg Press", sets: [
        { weight: 85, reps: 12, notes: "" },
        { weight: 85, reps: 12, notes: "" },
        { weight: 85, reps: 12, notes: "" }
      ]},
      { name: "Calf Raises", sets: [
        { weight: 15, reps: 12, notes: "" },
        { weight: 15, reps: 12, notes: "" },
        { weight: 15, reps: 12, notes: "" }
      ]},
      { name: "Reverse Pec Deck Fly", sets: [
        { weight: null, reps: 12, notes: "Level 8, Single-arm" },
        { weight: null, reps: 12, notes: "Level 8, Single-arm" }
      ]},
      { name: "Lateral Raises", sets: [
        { weight: null, reps: 12, notes: "Level 4" },
        { weight: null, reps: 12, notes: "Level 4" },
        { weight: null, reps: 12, notes: "Level 4" }
      ]},
      { name: "Dumbbell Shrugs", sets: [{ weight: 20, reps: 12, notes: "" }]}
    ]
  },
  {
    date: "2026-06-01", dayType: "Pull",
    exercises: [
      { name: "Seated Cable Row", sets: [
        { weight: 50, reps: 12, notes: "" },
        { weight: 50, reps: 12, notes: "" },
        { weight: 50, reps: 12, notes: "" }
      ]},
      { name: "Lat Pulldown", sets: [
        { weight: 52, reps: 9, notes: "" },
        { weight: 52, reps: 9, notes: "" },
        { weight: 52, reps: 9, notes: "" }
      ]},
      { name: "Machine-Assisted Pull-Up", sets: [
        { weight: null, reps: 8, notes: "Level 6" },
        { weight: null, reps: 8, notes: "Level 6" },
        { weight: null, reps: 8, notes: "Level 6" }
      ]},
      { name: "Cable Bicep Curl", sets: [
        { weight: 22.5, reps: 12, notes: "Level 9" },
        { weight: 22.5, reps: 12, notes: "Level 9" },
        { weight: 22.5, reps: 12, notes: "Level 9" }
      ]},
      { name: "Straight-Arm Lat Pulldown", sets: [
        { weight: 22.5, reps: 12, notes: "Level 9" },
        { weight: 22.5, reps: 11, notes: "Level 9" },
        { weight: 22.5, reps: 10, notes: "Level 9" }
      ]},
      { name: "Dumbbell Preacher Curl", sets: [
        { weight: 7, reps: 9, notes: "Single arm" },
        { weight: 7, reps: 9, notes: "" },
        { weight: 7, reps: 6, notes: "" }
      ]},
      { name: "Dumbbell Hammer Curl", sets: [
        { weight: 8, reps: 12, notes: "" },
        { weight: 8, reps: 12, notes: "" },
        { weight: 8, reps: null, notes: "Till failure" }
      ]},
      { name: "Machine Crunch", sets: [{ weight: null, reps: 12, notes: "Level 7" }]}
    ]
  },
  {
    date: "2026-05-30", dayType: "Push",
    exercises: [
      { name: "Chest Press", sets: [
        { weight: 35, reps: 12, notes: "" },
        { weight: 35, reps: 12, notes: "" },
        { weight: 35, reps: 12, notes: "" }
      ]},
      { name: "Pec Deck Fly", sets: [
        { weight: 30, reps: 12, notes: "" },
        { weight: 30, reps: 12, notes: "" },
        { weight: 30, reps: 12, notes: "" }
      ]},
      { name: "Machine-Assisted Dip", sets: [
        { weight: null, reps: 12, notes: "Level 5" },
        { weight: null, reps: 12, notes: "Level 5" },
        { weight: null, reps: 12, notes: "Level 5" }
      ]},
      { name: "Incline Dumbbell Press", sets: [
        { weight: 9, reps: 12, notes: "" },
        { weight: 9, reps: 12, notes: "" },
        { weight: 9, reps: 12, notes: "" }
      ]},
      { name: "Tricep Rope Pushdown", sets: [
        { weight: 25, reps: 12, notes: "Level 10" },
        { weight: 30, reps: 10, notes: "Level 12" },
        { weight: 30, reps: 10, notes: "Level 12" }
      ]},
      { name: "Reverse Grip Tricep Pushdown", sets: [
        { weight: 35, reps: 8, notes: "Level 14" },
        { weight: 35, reps: 9, notes: "Level 14" },
        { weight: 35, reps: 10, notes: "Level 14" }
      ]},
      { name: "Cable Overhead Tricep Extension", sets: [
        { weight: 20, reps: 8, notes: "Level 8" },
        { weight: 20, reps: 8, notes: "Level 8" },
        { weight: 20, reps: 8, notes: "Level 8" }
      ]},
      { name: "Machine Crunch", sets: [{ weight: null, reps: 12, notes: "Level 7" }]}
    ]
  },
  {
    date: "2026-05-28", dayType: "Pull + Shoulders",
    exercises: [
      { name: "Lat Pulldown", sets: [
        { weight: 52, reps: 8, notes: "" },
        { weight: 52, reps: 9, notes: "" },
        { weight: 52, reps: 8, notes: "" }
      ]},
      { name: "Seated Cable Row", sets: [
        { weight: 45, reps: 12, notes: "" },
        { weight: 45, reps: 12, notes: "" },
        { weight: 45, reps: 12, notes: "" }
      ]},
      { name: "Machine-Assisted Pull-Up", sets: [
        { weight: null, reps: 8, notes: "Level 6" },
        { weight: null, reps: 7, notes: "Level 6" },
        { weight: null, reps: 4, notes: "Level 6" }
      ]},
      { name: "Reverse Pec Deck Fly", sets: [
        { weight: null, reps: 10, notes: "Level 8, Single-arm" },
        { weight: null, reps: 10, notes: "Level 8, Single-arm" },
        { weight: null, reps: 10, notes: "Level 8, Single-arm" }
      ]},
      { name: "Shoulder Press", sets: [
        { weight: 30, reps: 6, notes: "Light" },
        { weight: 30, reps: 6, notes: "Light" },
        { weight: 30, reps: 6, notes: "Light" }
      ]},
      { name: "Straight-Arm Lat Pulldown", sets: [
        { weight: 20, reps: 12, notes: "Level 8" },
        { weight: 22.5, reps: 9, notes: "Level 9" },
        { weight: 22.5, reps: 8, notes: "Level 9" }
      ]},
      { name: "Cable Bicep Curl", sets: [
        { weight: 22.5, reps: 15, notes: "Level 9" },
        { weight: 22.5, reps: 12, notes: "Level 9" },
        { weight: 22.5, reps: 10, notes: "Level 9" }
      ]},
      { name: "Machine Crunch", sets: [{ weight: null, reps: null, notes: "Level 6" }]}
    ]
  },
  {
    date: "2026-05-27", dayType: "Upper",
    exercises: [
      { name: "Chest Press", sets: [
        { weight: 30, reps: 12, notes: "" },
        { weight: 30, reps: 12, notes: "" },
        { weight: 30, reps: 12, notes: "" }
      ]},
      { name: "Pec Deck Fly", sets: [
        { weight: 30, reps: 12, notes: "" },
        { weight: 30, reps: 12, notes: "" },
        { weight: 30, reps: 9, notes: "" }
      ]},
      { name: "Machine-Assisted Dip", sets: [
        { weight: null, reps: 12, notes: "Level 6" },
        { weight: null, reps: 7, notes: "Level 5" },
        { weight: null, reps: 11, notes: "Level 5" }
      ]},
      { name: "Tricep Pushdown", sets: [
        { weight: 20, reps: 9, notes: "Level 8" },
        { weight: 20, reps: 12, notes: "Level 8" },
        { weight: 20, reps: 12, notes: "Level 8" }
      ]},
      { name: "Single-Arm Overhead Tricep Extension", sets: [
        { weight: 6, reps: 7, notes: "DB" },
        { weight: 6, reps: 10, notes: "" },
        { weight: 6, reps: 12, notes: "" }
      ]},
      { name: "Reverse Grip Tricep Pushdown", sets: [
        { weight: 30, reps: 12, notes: "" },
        { weight: 35, reps: 12, notes: "" }
      ]},
      { name: "Machine Crunch", sets: [
        { weight: null, reps: 10, notes: "Level 6" },
        { weight: null, reps: 10, notes: "Level 6" },
        { weight: null, reps: 10, notes: "Level 6" }
      ]}
    ]
  },
  {
    date: "2026-05-25", dayType: "Legs + Shoulders",
    exercises: [
      { name: "Shoulder Press", sets: [
        { weight: 25, reps: 12, notes: "" },
        { weight: 25, reps: 12, notes: "" },
        { weight: 25, reps: 12, notes: "" }
      ]},
      { name: "Lateral Raises", sets: [
        { weight: null, reps: 12, notes: "Level 3" },
        { weight: null, reps: 12, notes: "Level 3" },
        { weight: null, reps: null, notes: "Level 3, till failure" }
      ]},
      { name: "Front Raises", sets: [
        { weight: 8, reps: 12, notes: "" },
        { weight: 8, reps: 12, notes: "" },
        { weight: 8, reps: 12, notes: "" }
      ]},
      { name: "Face Pull", sets: [
        { weight: 25, reps: 16, notes: "" },
        { weight: 30, reps: 18, notes: "" },
        { weight: 35, reps: 15, notes: "" }
      ]},
      { name: "Reverse Pec Deck Fly", sets: [
        { weight: null, reps: 8, notes: "Level 8" },
        { weight: null, reps: 8, notes: "Level 8" },
        { weight: null, reps: 8, notes: "Level 8" }
      ]},
      { name: "Leg Extension", sets: [
        { weight: 25, reps: 12, notes: "" },
        { weight: 25, reps: 12, notes: "" },
        { weight: 25, reps: 12, notes: "" }
      ]},
      { name: "Leg Press", sets: [
        { weight: 69, reps: 12, notes: "" },
        { weight: 77, reps: 12, notes: "" },
        { weight: 77, reps: 12, notes: "" }
      ]},
      { name: "Calf Raises", sets: [
        { weight: 10, reps: 12, notes: "" },
        { weight: 10, reps: 12, notes: "" },
        { weight: 10, reps: 12, notes: "" }
      ]},
      { name: "Machine Crunch", sets: [
        { weight: null, reps: 12, notes: "Level 5" },
        { weight: null, reps: 12, notes: "Level 5" },
        { weight: null, reps: 10, notes: "Level 5" }
      ]}
    ]
  },
  {
    date: "2026-05-24", dayType: "Pull",
    exercises: [
      { name: "Lat Pulldown", sets: [
        { weight: 43, reps: 12, notes: "" },
        { weight: 43, reps: 12, notes: "" },
        { weight: 43, reps: 12, notes: "" }
      ]},
      { name: "Machine Row", sets: [
        { weight: 34, reps: 16, notes: "" },
        { weight: 43, reps: 12, notes: "" },
        { weight: 43, reps: 12, notes: "" }
      ]},
      { name: "Machine-Assisted Pull-Up", sets: [
        { weight: null, reps: 12, notes: "Level 7" },
        { weight: null, reps: 8, notes: "Level 6" },
        { weight: null, reps: 8, notes: "Level 6" }
      ]},
      { name: "Seated Cable Row", sets: [
        { weight: 40, reps: 12, notes: "" },
        { weight: 40, reps: 12, notes: "" },
        { weight: 40, reps: 12, notes: "" }
      ]},
      { name: "Cable Pullover", sets: [
        { weight: null, reps: 12, notes: "Level 7" },
        { weight: null, reps: 11, notes: "Level 7" },
        { weight: null, reps: 8, notes: "Level 7" }
      ]},
      { name: "Cable Bicep Curl", sets: [
        { weight: null, reps: 12, notes: "Level 8" },
        { weight: null, reps: 12, notes: "Level 8" }
      ]},
      { name: "Dumbbell Shrugs", sets: [
        { weight: 20, reps: 12, notes: "" },
        { weight: 20, reps: 8, notes: "" }
      ]},
      { name: "Machine Crunch", sets: [
        { weight: null, reps: 12, notes: "Level 4" },
        { weight: null, reps: 12, notes: "Level 4" },
        { weight: null, reps: null, notes: "Level 4, till failure" }
      ]}
    ]
  },
  {
    date: "2026-05-22", dayType: "Push",
    exercises: [
      { name: "Chest Press", sets: [
        { weight: 25, reps: 10, notes: "Level 5" },
        { weight: 25, reps: 12, notes: "Level 5" },
        { weight: 25, reps: 12, notes: "Level 5" }
      ]},
      { name: "Pec Deck Fly", sets: [
        { weight: 25, reps: 12, notes: "Level 5" },
        { weight: 25, reps: 12, notes: "Level 5" },
        { weight: 25, reps: 12, notes: "Level 5" }
      ]},
      { name: "Incline Dumbbell Press", sets: [
        { weight: 8, reps: 12, notes: "" },
        { weight: 8, reps: 12, notes: "" },
        { weight: 8, reps: 12, notes: "" }
      ]},
      { name: "Tricep Rope Pushdown", sets: [
        { weight: 25, reps: 20, notes: "" },
        { weight: 25, reps: 20, notes: "" },
        { weight: 25, reps: 20, notes: "" }
      ]},
      { name: "Cable Overhead Tricep Extension", sets: [{ weight: 10, reps: 10, notes: "" }]},
      { name: "Machine Crunch", sets: [
        { weight: null, reps: 12, notes: "Level 3" },
        { weight: null, reps: 12, notes: "Level 3" },
        { weight: null, reps: 12, notes: "Level 3" }
      ]}
    ]
  }
];
