/* ═══════════════════════════════════════════════════════════════
   NUTRITION ENGINE — every calorie/macro/TDEE/trend calculation
   in the app lives here, exactly once (section 20 of the spec).

   Deliberately pure — no DOM, no fetch, no localStorage, no
   Date.now() (dates are always passed in as local "YYYY-MM-DD"
   strings, matching WinterArc's day-key rule). That purity is what
   lets node test/nutrition.js exercise every formula here, and what
   keeps the UI layer (nutrition.js) free of duplicated math.

   Units: all nutrients are grams unless stated; fibre ("fiber") is
   tracked as "g" like the other macros. Micronutrients are an open
   string→number map {sodium_mg: 400, ...} carried through every
   scaling operation untouched.

   Loaded after winter.js (E needs only its own helpers — it takes
   day-key strings, it never builds them). Exposes `NutritionEngine`;
   the module.exports guard at the bottom is what test/nutrition.js
   requires.
   ═══════════════════════════════════════════════════════════════ */
const NutritionEngine = (() => {
  'use strict';

  /* ── Constants ────────────────────────────────────────────── */

  // Energy stored/released per kg of body-mass change. ~7,700 kcal/kg
  // is the standard approximation for adipose tissue; it is itself an
  // estimate (real tissue is not 100% fat), which is one more reason
  // every TDEE/timeline figure in the app is labelled an estimate.
  const KCAL_PER_KG = 7700;

  // Macro energy densities, kcal per gram (Atwater factors).
  const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };

  // Never recommend a daily target below these floors — too-low
  // intakes are a health risk, not a faster diet.
  const MIN_KCAL = { m: 1500, f: 1200 };

  // A deficit above this fraction of estimated TDEE gets an
  // "aggressive" warning regardless of absolute size.
  const AGGRESSIVE_DEFICIT_FRAC = 0.25;

  // A planned rate of change above this fraction of current body
  // weight per week gets the same warning.
  const AGGRESSIVE_RATE_FRAC = 0.01;

  // Observed-TDEE estimation (see observedTDEE below) refuses to
  // speak with less data than this — fewer points and a single
  // salty meal masquerades as a metabolism finding.
  const OBSERVED_MIN_DAYS = 10;

  // Protein guidance ranges, g per kg body weight per day. Weight-
  // LOSS dieters sit at the top of the evidence range because protein
  // protects lean mass in a deficit. Labelled in the UI as a
  // recommendation, not a medical requirement.
  const PROTEIN_RANGE = { lose: [1.8, 2.2], maintain: [1.6, 2.2], gain: [1.6, 2.2] };

  // Fat floor so the remaining-calories-go-to-carbs split never
  // starves fat-soluble-vitamin absorption and hormonal needs.
  const FAT_FLOOR_G_PER_KG = 0.8;

  // Simple activity multipliers for the 5-level picker, in display
  // order. These are the classic Harris–Benedict-era activity factors
  // and are exactly what the UI shows next to each level.
  const ACTIVITY_LEVELS = [
    { key: 'sedentary',  label: 'Sedentary',         mult: 1.2,   desc: 'Desk job, little or no exercise' },
    { key: 'light',      label: 'Lightly active',    mult: 1.375, desc: 'Light exercise 1–3 days/week' },
    { key: 'moderate',   label: 'Moderately active', mult: 1.55,  desc: 'Exercise 3–5 days/week' },
    { key: 'very',       label: 'Very active',       mult: 1.725, desc: 'Hard exercise 6–7 days/week' },
    { key: 'extreme',    label: 'Extremely active',  mult: 1.9,   desc: 'Physical job + daily training' }
  ];

  // Meal slots offered by default; the day page lets the user add
  // free-form custom meals on top of these.
  const DEFAULT_MEALS = ['breakfast', 'lunch', 'dinner', 'snacks'];

  /* ── Number hygiene ─────────────────────────────────────────
     Storage keeps raw numbers; ONLY display layers round. round1 is
     the single rounding helper so "12.299999" never reaches the DOM. */

  function round1(x) { return Math.round((Number(x) || 0) * 10) / 10; }

  // Display formatter: integers stay integer-looking, everything else
  // gets at most one decimal. kcal are conventionally shown whole.
  function fmt(x, dp) {
    const n = Number(x);
    if (!isFinite(n)) return '0';
    if (dp === 0) return String(Math.round(n));
    const r = round1(n);
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }

  /* ── Nutrient records ───────────────────────────────────────
     A nutrients object is { kcal, protein, carbs, fat, fiber, micros? }.
     `micros` is an optional flat {key: number} map (e.g. sodium_mg).
     Every scaling/totalling function here is generic over the numeric
     keys present — adding a nutrient never touches the engine. */

  const NUTRIENT_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];

  function emptyNutrients() {
    return { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, micros: {} };
  }

  function addNutrients(acc, n) {
    if (!n) return acc;
    NUTRIENT_KEYS.forEach(k => { acc[k] += (Number(n[k]) || 0); });
    if (n.micros) Object.keys(n.micros).forEach(k => {
      acc.micros[k] = (acc.micros[k] || 0) + (Number(n.micros[k]) || 0);
    });
    return acc;
  }

  function cloneNutrients(n) {
    const out = emptyNutrients();
    NUTRIENT_KEYS.forEach(k => { out[k] = Number(n && n[k]) || 0; });
    if (n && n.micros) Object.keys(n.micros).forEach(k => { out.micros[k] = Number(n.micros[k]) || 0; });
    return out;
  }

  function scaleNutrients(n, factor) {
    const out = emptyNutrients();
    if (!n) return out;
    NUTRIENT_KEYS.forEach(k => { out[k] = (Number(n[k]) || 0) * factor; });
    if (n.micros) Object.keys(n.micros).forEach(k => { out.micros[k] = (Number(n.micros[k]) || 0) * factor; });
    return out;
  }

  /* ── Food model ─────────────────────────────────────────────
     A saved food declares ONE authoritative basis for its numbers:

       basis 'per100g'    per100 = nutrients per 100 g (package label style)
       basis 'perServing' per100 = nutrients per servingSize grams,
                          servingSize REQUIRED — used both for "servings"
                          units and for normalising to grams
       basis 'piece'      per100 = nutrients per (pieceSizeG)-gram piece,
                          pieceSizeG REQUIRED

     In every case `per100` is the record's stored nutrient map, and
     `unitGrams(food)` tells you how many grams those numbers describe.
     Callers never peek at basis except through nutrientsFor / toGrams,
     so a future barcode/product source only has to produce a record in
     this shape (section 15 hook: the `source` field is metadata only —
     'package' | 'estimated' | ... — and never changes the math). */

  const UNITS = ['g', 'kg', 'ml', 'l', 'piece', 'slice', 'egg', 'tbsp', 'tsp', 'serving'];

  // How many grams the food's stored nutrient map describes.
  function basisGrams(food) {
    if (!food) return null;
    if (food.basis === 'per100g') return 100;
    if (food.basis === 'perServing') return Number(food.servingSize) > 0 ? Number(food.servingSize) : null;
    if (food.basis === 'piece') return Number(food.pieceSize) > 0 ? Number(food.pieceSize) : null;
    return null;
  }

  /* Convert a logged quantity+unit into grams of the food, so nutrient
     scaling is ALWAYS per-gram underneath. Throws with a readable
     reason instead of guessing when the food record lacks the data a
     unit needs (the UI turns that into a prompt — section 14: never
     silently invent a value). */
  function toGrams(qty, unit, food) {
    const q = Number(qty);
    if (!isFinite(q) || q < 0) throw new Error('quantity must be a non-negative number');
    switch (unit) {
      case 'g': return q;
      case 'kg': return q * 1000;
      case 'ml': return q;            // water-like density ≈ 1 g/ml
      case 'l': return q * 1000;
      case 'piece':
      case 'slice':
      case 'egg': {
        const g = Number(food && food.pieceSize);
        if (!(g > 0)) throw new Error(`"${food && food.name || 'this food'}" needs a grams-per-piece value to use "${unit}"`);
        return q * g;
      }
      case 'tbsp': {
        const g = Number(food && food.tbspG);
        if (!(g > 0)) throw new Error(`"${food && food.name || 'this food'}" needs grams-per-tablespoon`);
        return q * g;
      }
      case 'tsp': {
        const g = Number(food && (food.tspG || (Number(food.tbspG) / 3)));
        if (!(g > 0)) throw new Error(`"${food && food.name || 'this food'}" needs grams-per-teaspoon (or per-tablespoon)`);
        return q * g;
      }
      case 'serving': {
        const g = Number(food && food.servingSize);
        if (!(g > 0)) throw new Error(`"${food && food.name || 'this food'}" needs a serving size in grams`);
        return q * g;
      }
      default: throw new Error(`unknown unit "${unit}"`);
    }
  }

  // The core identity of the whole tracker:
  //   consumed nutrient = stored value × grams eaten ÷ grams the value describes
  // Returns the nutrient map for `grams` of `food`.
  function nutrientsFor(food, grams) {
    const bg = basisGrams(food);
    if (!(bg > 0)) throw new Error(`"${food && food.name || 'food'}" has an incomplete basis (needs per-100g, serving size, or piece weight)`);
    const g = Number(grams);
    if (!isFinite(g) || g < 0) throw new Error('grams must be a non-negative number');
    return scaleNutrients(food.per100, g / bg);
  }

  // Convenience: quantity+unit straight to nutrients.
  function nutrientsForPortion(food, qty, unit) {
    return nutrientsFor(food, toGrams(qty, unit, food));
  }

  /* Raw → cooked (section 10). Cooking moves WATER, not energy:
     the nutrients in `rawG` grams raw end up spread over `cookedG`
     grams cooked. So per-100g-cooked = raw nutrients × 100 / cookedG.
     Returns a per-100 g basis for the cooked state. rawG/cookedG must
     both be measured on the same batch. */
  function cookedPer100(food, rawG, cookedG) {
    const r = Number(rawG), c = Number(cookedG);
    if (!(r > 0) || !(c > 0)) throw new Error('raw and cooked weights must both be positive');
    const totalRaw = nutrientsForPortion(food, r, 'g'); // everything in the batch
    return scaleNutrients(totalRaw, 100 / c);
  }

  /* ── Recipes (section 9) ────────────────────────────────────
     An ingredient is { food, qty, unit } after resolution, or the
     raw record { foodId|inline:{...food}, qty, unit } from storage —
     resolveRecipeIngredients() handles both. Each ingredient may also
     carry state:'cooked' with the food's own rawToCooked ratio applied
     — but only when the food actually declares one; otherwise state is
     ignored rather than guessed. */

  function resolveRecipeIngredients(recipe, foodsById) {
    return (recipe.ingredients || []).map(ing => {
      let food = null;
      if (ing.foodId) {
        food = foodsById && foodsById[ing.foodId];
        if (!food) throw new Error(`recipe "${recipe.name}" references a deleted food`);
      } else if (ing.inline) {
        food = ing.inline;
      }
      if (!food) throw new Error(`recipe "${recipe.name}" has an ingredient without a food`);
      return Object.assign({}, ing, { food });
    });
  }

  function recipeTotals(recipe, foodsById) {
    const acc = emptyNutrients();
    resolveRecipeIngredients(recipe, foodsById).forEach(ing => addNutrients(acc, nutrientsForPortion(ing.food, ing.qty, ing.unit)));
    return acc;
  }

  function perServingNutrients(recipe, foodsById) {
    const s = Number(recipe.servings);
    if (!(s > 0)) throw new Error(`recipe "${recipe.name}" needs a servings count ≥ 1`);
    return scaleNutrients(recipeTotals(recipe, foodsById), 1 / s);
  }

  /* ── Day totals (sections 5/11/12) ──────────────────────────
     A day record is { meals: {slot: [entry]}, quickAdds: [entry] }.
     Each entry ALREADY stores its resolved nutrient snapshot (taken at
     log time, so later edits to a food or recipe never rewrite history)
     — totalling is a pure sum of snapshots, never a re-derivation. */

  function entryNutrients(entry) {
    return entry && entry.nutrients ? entry.nutrients : emptyNutrients();
  }

  function mealTotals(day, slot) {
    const acc = emptyNutrients();
    const entries = (day && day.meals && day.meals[slot]) || [];
    entries.forEach(e => addNutrients(acc, entryNutrients(e)));
    return acc;
  }

  function dailyTotals(day) {
    const acc = emptyNutrients();
    if (!day) return acc;
    Object.keys(day.meals || {}).forEach(slot => addNutrients(acc, mealTotals(day, slot)));
    (day.quickAdds || []).forEach(q => addNutrients(acc, entryNutrients(q)));
    return acc;
  }

  /* ── BMR / TDEE (section 2) ───────────────────────────────── */

  // Mifflin–St Jeor (1990) — the default equation: works for everyone,
  // needs no body-fat estimate.
  //   men:   10·kg + 6.25·cm − 5·age + 5
  //   women: 10·kg + 6.25·cm − 5·age − 161
  function bmrMifflin(p) {
    const kg = Number(p.weight), cm = Number(p.heightCm), age = Number(p.age);
    if (!(kg > 0) || !(cm > 0) || !(age > 0 && age < 120)) throw new Error('BMR needs weight, height and age');
    const base = 10 * kg + 6.25 * cm - 5 * age;
    return p.sex === 'f' ? base - 161 : base + 5;
  }

  // Katch–McArdle — more individualised, but ONLY meaningful with a
  // body-fat %: BMR = 370 + 21.6 × leanMassKg. Throws without one
  // rather than pretending a guessed body-fat helped.
  function bmrKatch(p) {
    const kg = Number(p.weight), bf = Number(p.bodyFatPct);
    if (!(kg > 0)) throw new Error('Katch–McArdle needs weight');
    if (!(bf > 0 && bf < 60)) throw new Error('Katch–McArdle needs a body-fat % between 0 and 60');
    const lean = kg * (1 - bf / 100);
    return 370 + 21.6 * lean;
  }

  /* Detailed-activity estimate (section 1). Translates steps +
     sessions into an average daily energy expenditure on top of BMR,
     then back into an equivalent multiplier so the UI can compare it
     to the simple picker. Deliberately simple and TRANSPARENT — each
     line's kcal contribution is shown to the user, nothing is hidden:
       steps        ≈ 0.04 kcal per step (walking), daily
       gym session  ≈ 5 kcal/min × duration (moderate lifting)
       cardio       ≈ intensity kcal/min (light 7, moderate 10, hard 13)
     Sessions are per week → divided by 7 into a daily average. */
  const CARDIO_KCAL_PER_MIN = { light: 7, moderate: 10, hard: 13 };
  const GYM_KCAL_PER_MIN = 5;
  const KCAL_PER_STEP = 0.04;

  function detailedActivity(d) {
    const out = { stepsKcal: 0, gymKcalPerDay: 0, cardioKcalPerDay: 0, dailyExtra: 0 };
    out.stepsKcal = (Math.max(0, Number(d.stepsPerDay) || 0)) * KCAL_PER_STEP;
    const gymMin = (Math.max(0, Number(d.gymSessionsPerWeek) || 0)) * (Math.max(0, Number(d.gymMinutes) || 0));
    out.gymKcalPerDay = gymMin * GYM_KCAL_PER_MIN / 7;
    const cardMin = (Math.max(0, Number(d.cardioSessionsPerWeek) || 0)) * (Math.max(0, Number(d.cardioMinutes) || 0));
    const rate = CARDIO_KCAL_PER_MIN[d.cardioIntensity] || CARDIO_KCAL_PER_MIN.moderate;
    out.cardioKcalPerDay = cardMin * rate / 7;
    out.dailyExtra = out.stepsKcal + out.gymKcalPerDay + out.cardioKcalPerDay;
    return out;
  }

  /* The one TDEE entry point the UI uses. Returns every method's
     number side by side (section 2: show the calculation, never one
     pretended-exact figure):
       { bmr: {mifflin, katch?}, activity: {mult, source, detail?},
         tdee: [{key, label, kcal}], recommendedKcal, recommendedKey,
         uncertaintyNote } */
  function tdeeReport(profile, activity) {
    const p = Object.assign({}, profile);
    if (!(Number(p.weight) > 0)) throw new Error('TDEE report needs current weight (log one first)');
    const mifflin = bmrMifflin(p);
    let katch = null;
    try { katch = bmrKatch(p); } catch (_) { /* no usable body-fat % — fine, Mifflin stands alone */ }

    let mult = 1.2, sourceLabel = 'Sedentary (default — pick your activity level below)', detail = null;
    if (activity && activity.mode === 'detailed' && activity.detail) {
      detail = detailedActivity(activity.detail);
      // Solve TDEE = BMR + NEAT-ish extra: express as multiplier of BMR.
      mult = (mifflin + detail.dailyExtra) / mifflin;
      sourceLabel = 'Computed from your steps + sessions';
    } else if (activity && activity.mode && activity.mode !== 'detailed') {
      const lvl = ACTIVITY_LEVELS.find(l => l.key === activity.mode);
      if (lvl) { mult = lvl.mult; sourceLabel = `${lvl.label} × ${lvl.mult}`; }
    }

    const tdee = [{ key: 'mifflin', label: 'Mifflin–St Jeor', kcal: mifflin * mult }];
    if (katch != null) tdee.push({ key: 'katch', label: 'Katch–McArdle (uses your body-fat %)', kcal: katch * mult });

    // When both exist, average them — single best starting number while
    // still showing each method's own figure.
    const recommendedKey = tdee.length > 1 ? 'average' : 'mifflin';
    const recommendedKcal = tdee.reduce((s, t) => s + t.kcal, 0) / tdee.length;

    return {
      bmr: Object.assign({ mifflin }, katch != null ? { katch } : {}),
      activity: { mult, sourceLabel, detail },
      tdee,
      recommendedKey,
      recommendedKcal,
      uncertaintyNote: 'Every equation here is a population estimate — real maintenance typically sits within ±10–15% of it. Log food and weight for ~2–3 weeks and the Trends tab’s observed-maintenance estimate will refine this number from your actual data.'
    };
  }

  /* ── Goal planning (section 3) ──────────────────────────────
     goals = { kind: 'maintain'|'lose'|'gain'|'custom',
               rateKgPerWk?, deficitKcal?, surplusKcal?, customKcal?,
               targetWeightKcal only via profile }.
     Returns { targetKcal, weeklyDeltaKcal, rateKgPerWk, weeksToTarget|null,
               warnings:[{level,text}] }. Warnings always carry the WHY. */

  function goalPlan(tdeeKcal, goals, profile) {
    const out = { targetKcal: null, weeklyDeltaKcal: 0, rateKgPerWk: 0, weeksToTarget: null, warnings: [] };
    const tdee = Number(tdeeKcal);
    if (!(tdee > 0)) { out.warnings.push({ level: 'info', text: 'Complete your profile (sex, age, height, weight) to unlock calorie targets.' }); return out; }
    const kg = Number(profile.weight) || 0;
    const targetKg = Number(profile.targetWeight) || 0;
    const sex = profile.sex === 'f' ? 'f' : 'm';
    const floor = MIN_KCAL[sex];

    let delta = 0; // daily kcal delta vs TDEE (negative = deficit)
    switch (goals && goals.kind) {
      case 'maintain': break;
      case 'custom':
        out.targetKcal = Math.max(0, Number(goals.customKcal) || 0);
        delta = out.targetKcal - tdee;
        break;
      case 'gain':
        delta = Number(goals.surplusKcal) > 0 ? Number(goals.surplusKcal)
              : Number(goals.rateKgPerWk) > 0 ? Number(goals.rateKgPerWk) * KCAL_PER_KG / 7
              : 300; // lean default
        break;
      case 'lose':
      default:
        if (Number(goals && goals.rateKgPerWk) > 0) delta = -goals.rateKgPerWk * KCAL_PER_KG / 7;
        else delta = -(Number(goals && goals.deficitKcal) > 0 ? Number(goals.deficitKcal) : 500);
        break;
    }
    if (out.targetKcal == null) out.targetKcal = tdee + delta;
    out.weeklyDeltaKcal = delta * 7;
    out.rateKgPerWk = out.weeklyDeltaKcal / KCAL_PER_KG;

    // Time to target — only meaningful when the delta points AT the target.
    if (targetKg > 0 && kg > 0 && Math.sign(targetKg - kg) === Math.sign(delta) && delta !== 0) {
      out.weeksToTarget = Math.abs(targetKg - kg) / Math.abs(out.rateKgPerWk);
    }

    // Guardrails (section 3: never silently bless an aggressive plan).
    if (goals && goals.kind !== 'maintain') {
      if (Math.abs(delta) > AGGRESSIVE_DEFICIT_FRAC * tdee) {
        out.warnings.push({ level: 'warn', text: `This is a ${fmt(Math.abs(delta) / tdee * 100, 0)}% ${delta < 0 ? 'deficit' : 'surplus'} relative to maintenance — beyond ~25% the risk of muscle loss, fatigue and rebound grows faster than the results do.` });
      }
      if (kg > 0 && Math.abs(out.rateKgPerWk) > AGGRESSIVE_RATE_FRAC * kg) {
        out.warnings.push({ level: 'warn', text: `${fmt(Math.abs(out.rateKgPerWk), 2)} kg/week is faster than ~1% of your body weight per week — the common ceiling for mostly-fat loss with training performance intact.` });
      }
      if (out.targetKcal < floor) {
        out.warnings.push({ level: 'warn', text: `The target lands below ${floor} kcal/day, a commonly used minimum for ${sex === 'f' ? 'women' : 'men'}. Consider a smaller deficit and more patience — or discuss a faster plan with a professional.` });
      }
    }
    return out;
  }

  /* ── Macro targets (section 19) ───────────────────────────── */

  function proteinRecommendation(profile, goalKind) {
    const kg = Number(profile.weight);
    if (!(kg > 0)) return null;
    const kind = PROTEIN_RANGE[goalKind] ? goalKind : 'maintain';
    const [lo, hi] = PROTEIN_RANGE[kind];
    return { low: Math.round(lo * kg), high: Math.round(hi * kg), mid: Math.round((lo + hi) / 2 * kg), perKg: [lo, hi] };
  }

  /* Derived macro split for a calorie target: protein from the
     recommendation (explicit override wins), fat at the floor unless
     overridden, carbs get whatever calories remain. All user-editable. */
  function macroTargets(targetKcal, profile, goals) {
    const prec = proteinRecommendation(profile, goals && goals.kind === 'gain' ? 'gain' : (goals && goals.kind === 'lose' ? 'lose' : 'maintain'));
    const kg = Number(profile.weight) || 0;
    const explicit = (goals && goals.macroTargets) || {};
    const protein = Number(explicit.protein) > 0 ? Number(explicit.protein)
                  : Number(goals && goals.proteinTargetG) > 0 ? Number(goals.proteinTargetG)
                  : (prec ? prec.mid : 0);
    const fat = Number(explicit.fat) > 0 ? Number(explicit.fat) : round1(kg * FAT_FLOOR_G_PER_KG);
    const carbsKcalLeft = Math.max(0, (Number(targetKcal) || 0) - protein * KCAL_PER_G.protein - fat * KCAL_PER_G.fat);
    const carbs = Number(explicit.carbs) > 0 ? Number(explicit.carbs) : round1(carbsKcalLeft / KCAL_PER_G.carbs);
    return {
      kcal: Number(targetKcal) || 0,
      protein, carbs, fat,
      fiber: Number(explicit.fiber) > 0 ? Number(explicit.fiber) : 30,
      proteinSource: Number(explicit.protein) > 0 || Number(goals && goals.proteinTargetG) > 0 ? 'yours' : (prec ? 'recommended' : 'none'),
      proteinRecommendation: prec
    };
  }

  /* ── Weight trends (section 17) ─────────────────────────────
     Weights come in as an array of {date, kg} sorted ascending.
     Rolling averages tolerate gaps (missed mornings) by averaging the
     available points inside the window — the date arithmetic is done
     on LOCAL day keys, never Date/UTC. daysBetweenFn is the injected
     local-day differ (WinterArc.daysBetween in the app,
     test/shimmed in node). */

  function rollingAverage(series, windowDays, asOfDate, daysBetweenFn) {
    if (!Array.isArray(series) || !series.length || !asOfDate) return null;
    const vals = series.filter(p => {
      const span = daysBetweenFn(p.date, asOfDate);
      return span >= 0 && span < windowDays;
    }).map(p => Number(p.kg)).filter(x => isFinite(x));
    if (!vals.length) return null;
    return vals.reduce((s, x) => s + x, 0) / vals.length;
  }

  // kg/week from least-squares slope against REAL dates (day keys), so
  // gappy logs don't distort the rate. daysBetweenFn is the injected
  // local-day differ (WinterArc.daysBetween in the app).
  function trendSlopeKgPerWeek(series, daysBetweenFn) {
    if (!Array.isArray(series) || series.length < 7) return null;
    const d0 = series[0].date;
    const pts = series
      .map(p => ({ x: daysBetweenFn(d0, p.date), y: Number(p.kg) }))
      .filter(p => isFinite(p.y) && isFinite(p.x));
    if (pts.length < 7) return null;
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p.y, 0) / n;
    let num = 0, den = 0;
    pts.forEach(p => { num += (p.x - mx) * (p.y - my); den += (p.x - mx) * (p.x - mx); });
    if (!den) return null;
    return round1(num / den * 7 * 10) / 10;
  }

  /* ── Observed maintenance (section 4) ───────────────────────
     The estimate that actually adapts:
       observedTDEE ≈ mean daily intake − (Δ trend weight × 7700 / days)
     If you ate 2,300 kcal/day on average and your weight TREND was flat,
     your real maintenance is ≈2,300 — whatever the equation said.

     The window is the trailing LOOKBACK days ending at todayKey
     (default 21). Weight change is measured between the 7-day rolling
     average at the window's edges — so a single salty dinner or a
     dehydrated morning cannot land inside an energy-balance estimate.
     Refuses to answer below OBSERVED_MIN_DAYS days of overlap. */
  const OBSERVED_LOOKBACK = 21;

  // Trailing-window mean helper, symmetric on both edges.
  function meanInWindow(series, from, to) {
    const vals = series.filter(p => p.date >= from && p.date <= to)
      .map(p => Number(p.kg != null ? p.kg : p.kcal)).filter(x => isFinite(x) && x > 0);
    if (!vals.length) return null;
    return vals.reduce((s, x) => s + x, 0) / vals.length;
  }

  function observedTDEE(intakeSeries, weightSeries, todayKey, addDaysFn, daysBetweenFn) {
    const intake = (intakeSeries || []).filter(p => Number(p.kcal) > 0);
    const weights = (weightSeries || []).filter(p => Number(p.kg) > 0)
      .filter(p => !todayKey || p.date <= todayKey);
    const winStart = addDaysFn(todayKey, -(OBSERVED_LOOKBACK - 1));
    const winEnd = todayKey;
    const winIntake = intake.filter(p => p.date >= winStart && p.date <= winEnd);
    const winWeights = weights.filter(p => p.date >= winStart && p.date <= winEnd);
    const daysLogged = winIntake.length;
    const edgeOk = meanInWindow(winWeights, winStart, addDaysFn(winStart, 6)) != null
                && meanInWindow(winWeights, addDaysFn(winEnd, -6), winEnd) != null;
    if (daysLogged < OBSERVED_MIN_DAYS || winWeights.length < OBSERVED_MIN_DAYS || !edgeOk) {
      return {
        kcal: null, days: daysLogged, spanDays: OBSERVED_LOOKBACK, confidence: 'none',
        reason: `needs ≥${OBSERVED_MIN_DAYS} days of intake AND weigh-ins across the window, including near both its ends (have ${daysLogged} intake days, ${winWeights.length} weigh-ins over ${OBSERVED_LOOKBACK} days)`
      };
    }
    const avgIntake = winIntake.reduce((s, p) => s + Number(p.kcal), 0) / daysLogged;
    // Each 7-day edge mean is centered on the mean DATE of the points it
    // contains; dividing the trend delta by that actual elapsed distance
    // (not the full window span) removes the systematic bias that edge
    // smoothing would otherwise introduce.
    const edgeStats = (from, to) => {
      const pts = winWeights.filter(p => p.date >= from && p.date <= to);
      if (!pts.length) return null;
      const kg = pts.reduce((s, p) => s + Number(p.kg), 0) / pts.length;
      const dayIdx = pts.reduce((s, p) => s + daysBetweenFn(winStart, p.date), 0) / pts.length;
      return { kg, dayIdx };
    };
    const eStart = edgeStats(winStart, addDaysFn(winStart, 6));
    const eEnd = edgeStats(addDaysFn(winEnd, -6), winEnd);
    const elapsed = Math.max(1, eEnd.dayIdx - eStart.dayIdx);
    const deltaKg = eEnd.kg - eStart.kg;
    const dailyDeltaKcal = deltaKg * KCAL_PER_KG / elapsed;
    const kcal = avgIntake - dailyDeltaKcal;
    return {
      kcal, days: daysLogged, spanDays: daysBetweenFn(winStart, winEnd) + 1,
      avgIntake, deltaKg,
      confidence: daysLogged >= OBSERVED_LOOKBACK - 3 ? 'ok' : 'low',
      reason: `based on ${daysLogged} intake days and ${winWeights.length} weigh-ins over the last ${OBSERVED_LOOKBACK} days`
    };
  }

  /* Weekly aggregates for the Trends tab (section 16). */
  function weeklyAverages(days, dateKeys) {
    const acc = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, loggedDays: 0 };
    (dateKeys || []).forEach(dk => {
      const day = days && days[dk];
      if (!day) return;
      const t = dailyTotals(day);
      if (t.kcal <= 0) return; // untouched day — don't dilute the average
      acc.loggedDays++;
      addNutrients(acc, t);
    });
    const d = Math.max(1, acc.loggedDays);
    return {
      kcal: acc.kcal / d, protein: acc.protein / d, carbs: acc.carbs / d,
      fat: acc.fat / d, fiber: acc.fiber / d, loggedDays: acc.loggedDays
    };
  }

  /* ── Exports ──────────────────────────────────────────────── */

  return Object.freeze({
    KCAL_PER_KG, KCAL_PER_G, MIN_KCAL, ACTIVITY_LEVELS, DEFAULT_MEALS, UNITS,
    OBSERVED_MIN_DAYS, OBSERVED_LOOKBACK, PROTEIN_RANGE,
    round1, fmt,
    emptyNutrients, addNutrients, cloneNutrients, scaleNutrients,
    basisGrams, toGrams, nutrientsFor, nutrientsForPortion, cookedPer100,
    resolveRecipeIngredients, recipeTotals, perServingNutrients,
    entryNutrients, mealTotals, dailyTotals,
    bmrMifflin, bmrKatch, detailedActivity, CARDIO_KCAL_PER_MIN, tdeeReport,
    goalPlan, proteinRecommendation, macroTargets,
    rollingAverage, trendSlopeKgPerWeek, observedTDEE, weeklyAverages
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NutritionEngine;
