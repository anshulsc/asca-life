/* ═══════════════════════════════════════════════════════════════
   Nutrition engine tests — run from test/run.js (runNutritionTests).

   Same discipline as the Winter Arc suite: no DOM, no network — just
   the pure functions where the logic that is easy to get quietly wrong
   actually lives. Dates go through WinterArc's local-day helpers so
   the engine experiences exactly the date arithmetic the app uses.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

module.exports = function runNutritionTests(ctx) {
  const { eq, ok, section, W } = ctx;
  const E = require(require('path').join(__dirname, '..', 'src', 'nutrition-engine.js'));

  const close = (label, got, want, tol) =>
    ok(`${label} (got ${got}, want ≈${want})`, Math.abs(got - want) <= (tol == null ? 0.51 : tol));

  /* ── Per-100g scaling (sections 7/20) ────────────────────────
     The core identity: consumed = stored × grams ÷ basis grams. */

  section('per-100g scaling');
  const bread = {
    name: 'Whole wheat bread', basis: 'per100g',
    per100: { kcal: 250, protein: 9, carbs: 42, fat: 3.5, fiber: 6 }
  };
  const b180 = E.nutrientsForPortion(bread, 180, 'g');
  eq('bread 180g kcal', E.round1(b180.kcal), 450);
  eq('bread 180g protein', E.round1(b180.protein), 16.2);
  eq('bread 180g carbs', E.round1(b180.carbs), 75.6);
  eq('bread 180g fat', E.round1(b180.fat), 6.3);
  eq('bread 0g is zero', E.nutrientsForPortion(bread, 0, 'g').kcal, 0);

  // Generic over nutrient keys: a micronutrient map rides along untouched.
  const breadMg = Object.assign({}, bread, { per100: Object.assign({}, bread.per100, { micros: { sodium_mg: 400 } }) });
  close('micros scale with grams', E.nutrientsForPortion(breadMg, 180, 'g').micros.sodium_mg, 720);

  /* ── Unit conversion (section 6) ───────────────────────────── */

  section('unit conversion');
  eq('g passthrough', E.toGrams(150, 'g', bread), 150);
  eq('kg × 1000', E.toGrams(0.25, 'kg', bread), 250);
  eq('ml ≈ g', E.toGrams(250, 'ml', bread), 250);
  eq('l × 1000', E.toGrams(0.5, 'l', bread), 500);

  const eggs = { name: 'Eggs', basis: 'piece', pieceSize: 55, per100: { kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8, fiber: 0 } };
  eq('piece × pieceSize', E.toGrams(2, 'egg', eggs), 110);
  close('2 eggs kcal', E.nutrientsForPortion(eggs, 2, 'egg').kcal, 144);

  const whey = { name: 'Whey', basis: 'perServing', servingSize: 30, per100: { kcal: 120, protein: 24, carbs: 3, fat: 1, fiber: 0 } };
  eq('serving × servingSize', E.toGrams(1.5, 'serving', whey), 45);
  close('1.5 scoops protein', E.nutrientsForPortion(whey, 1.5, 'serving').protein, 36);

  const oil = { name: 'Olive oil', basis: 'per100g', tbspG: 13.5, per100: { kcal: 884, protein: 0, carbs: 0, fat: 100, fiber: 0 } };
  close('1 tbsp oil kcal', E.nutrientsForPortion(oil, 1, 'tbsp').kcal, 119.3);
  close('1 tsp derives from tbsp/3', E.nutrientsForPortion(oil, 1, 'tsp').kcal, 119.3 / 3);

  // Unconvertible units must THROW with a readable reason (section 14:
  // never silently invent a conversion).
  ['piece', 'slice', 'tbsp', 'serving'].forEach(u => {
    let threw = false;
    try { E.toGrams(1, u, bread); } catch (e) { threw = /needs/.test(e.message); }
    ok(`bread "${u}" without size data throws a "needs …" error`, threw);
  });
  let unknownThrew = false;
  try { E.toGrams(1, 'handful', bread); } catch (e) { unknownThrew = true; }
  ok('unknown unit throws', unknownThrew);

  /* ── Recipes & servings (section 9) ────────────────────────── */

  section('recipes');
  const chicken = { name: 'Chicken breast', basis: 'per100g', per100: { kcal: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0 } };
  const riceRaw = { name: 'Rice (raw)', basis: 'per100g', per100: { kcal: 365, protein: 7.1, carbs: 80, fat: 0.7, fiber: 1.3 } };
  const veg    = { name: 'Vegetables', basis: 'per100g', per100: { kcal: 35, protein: 2, carbs: 6, fat: 0.3, fiber: 2.5 } };
  const foods = { chicken, rice: riceRaw, oil, veg };

  const recipe = {
    name: 'Chicken Rice', servings: 3,
    ingredients: [
      { foodId: 'chicken', qty: 250, unit: 'g' },
      { foodId: 'rice', qty: 150, unit: 'g' },
      { foodId: 'oil', qty: 10, unit: 'g' },
      { foodId: 'veg', qty: 100, unit: 'g' }
    ]
  };
  const rt = E.recipeTotals(recipe, foods);
  close('recipe total kcal', rt.kcal, 250 * 1.65 + 150 * 3.65 + 10 * 8.84 + 100 * 0.35, 0.6);
  const srv = E.perServingNutrients(recipe, foods);
  close('per-serving kcal = total/3', srv.kcal, rt.kcal / 3, 0.6);
  close('per-serving protein = total/3', srv.protein, rt.protein / 3, 0.6);

  const inlineRecipe = { name: 'One-off', servings: 1, ingredients: [{ inline: bread, qty: 50, unit: 'g' }] };
  eq('inline ingredient works without the food DB', E.perServingNutrients(inlineRecipe, {}).kcal, 125);

  let deletedFoodThrew = false;
  try { E.recipeTotals(recipe, {}); } catch (e) { deletedFoodThrew = /deleted food/.test(e.message); }
  ok('recipe with a deleted food throws (UI prompts instead of guessing)', deletedFoodThrew);

  /* ── Raw vs cooked (section 10) ──────────────────────────────
     500 g raw rice → 1,400 g cooked. Energy is CONSERVED; only the
     water moved. Per-100g cooked must use the raw batch's nutrients. */

  section('raw vs cooked');
  const cookedRice = E.cookedPer100(riceRaw, 500, 1400);
  close('cooked rice per-100g kcal', cookedRice.kcal, 500 * 3.65 * 100 / 1400);
  close('calories conserved across cooking',
    E.nutrientsForPortion(riceRaw, 500, 'g').kcal,
    E.nutrientsForPortion({ name: 'cooked', basis: 'per100g', per100: cookedRice }, 1400, 'g').kcal, 0.6);

  /* ── Day totals (sections 5/11/12) ─────────────────────────── */

  section('day totals');
  const day = {
    meals: {
      breakfast: [
        { label: 'Oats 80g', nutrients: { kcal: 304, protein: 10, carbs: 54, fat: 6, fiber: 8 } },
        { label: 'Banana', nutrients: { kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, fiber: 3.1 } }
      ],
      lunch: [{ label: 'Chicken Rice 1 serving', nutrients: { kcal: 400, protein: 30, carbs: 45, fat: 10, fiber: 2 } }]
    },
    quickAdds: [{ nutrients: { kcal: 500, protein: 0, carbs: 0, fat: 0, fiber: 0 } }]
  };
  close('breakfast subtotal', E.mealTotals(day, 'breakfast').kcal, 409);
  close('day total includes quick add', E.dailyTotals(day).kcal, 1309);
  close('day fiber totals', E.dailyTotals(day).fiber, 13.1);
  eq('empty day is zero', E.dailyTotals(null).kcal, 0);

  /* ── BMR / TDEE (section 2) ────────────────────────────────── */

  section('BMR / TDEE');
  const prof = { sex: 'm', age: 28, heightCm: 178, weight: 75 };
  // Mifflin: 10·75 + 6.25·178 − 5·28 + 5 = 1727.5
  close('Mifflin male', E.bmrMifflin(prof), 750 + 1112.5 - 140 + 5);
  close('Mifflin female', E.bmrMifflin(Object.assign({}, prof, { sex: 'f' })), 750 + 1112.5 - 140 - 161);

  // Katch: 370 + 21.6 × 75 × 0.85 = 1747
  close('Katch with 15% bf', E.bmrKatch(Object.assign({}, prof, { bodyFatPct: 15 })), 370 + 21.6 * 75 * 0.85);
  let katchThrew = false;
  try { E.bmrKatch(prof); } catch (e) { katchThrew = true; }
  ok('Katch refuses without body-fat %', katchThrew);

  const rep1 = E.tdeeReport(prof, { mode: 'moderate' });
  close('TDEE Mifflin × moderate 1.55', rep1.tdee[0].kcal, 1727.5 * 1.55, 1);
  eq('single method → recommended = mifflin', rep1.recommendedKey, 'mifflin');
  ok('activity multiplier surfaced', rep1.activity.mult === 1.55 && /Moderately/.test(rep1.activity.sourceLabel));
  ok('uncertainty note present', /±10–15%/.test(rep1.uncertaintyNote));

  const rep2 = E.tdeeReport(Object.assign({}, prof, { bodyFatPct: 15 }), { mode: 'moderate' });
  eq('two methods → both shown', rep2.tdee.length, 2);
  eq('two methods → recommendation is the average', rep2.recommendedKey, 'average');
  close('average of the two', rep2.recommendedKcal, (rep2.tdee[0].kcal + rep2.tdee[1].kcal) / 2, 1);

  // Detailed activity: 10k steps + 4×60min gym/wk → extra = 400 + 171.4 ≈ 571/day
  const det = E.detailedActivity({ stepsPerDay: 10000, gymSessionsPerWeek: 4, gymMinutes: 60, cardioSessionsPerWeek: 0, cardioMinutes: 0, cardioIntensity: 'moderate' });
  close('steps contribute 400 kcal', det.stepsKcal, 400);
  close('gym averaged /7', det.gymKcalPerDay, 5 * 240 / 7);
  const rep3 = E.tdeeReport(prof, { mode: 'detailed', detail: { stepsPerDay: 10000, gymSessionsPerWeek: 4, gymMinutes: 60 } });
  close('detailed mode: TDEE ≈ BMR + extra', rep3.tdee[0].kcal, 1727.5 + det.dailyExtra, 1.5);
  ok('detailed mode labelled as computed', /steps \+ sessions/.test(rep3.activity.sourceLabel));

  /* ── Goal planning (section 3) ─────────────────────────────── */

  section('goal planning');
  const tdee = 2600;
  const lose05 = E.goalPlan(tdee, { kind: 'lose', rateKgPerWk: 0.5 }, prof);
  close('0.5 kg/wk = 550 kcal/day deficit', tdee - lose05.targetKcal, 0.5 * 7700 / 7, 1);
  close('weekly deficit = 7 × daily', lose05.weeklyDeltaKcal, -3850, 5);
  close('rate echoes back', lose05.rateKgPerWk, -0.5, 0.01);
  close('weeks to 5-kg target', E.goalPlan(tdee, { kind: 'lose', rateKgPerWk: 0.5 }, Object.assign({}, prof, { targetWeight: 70 })).weeksToTarget, 10, 0.1);

  const loseDef = E.goalPlan(tdee, { kind: 'lose', deficitKcal: 300 }, prof);
  close('direct deficit honoured', tdee - loseDef.targetKcal, 300);
  close('implied rate from deficit', loseDef.rateKgPerWk, -300 * 7 / 7700, 0.005);

  eq('maintain = TDEE, no warnings', E.goalPlan(tdee, { kind: 'maintain' }, prof).warnings.length, 0);

  const custom = E.goalPlan(tdee, { kind: 'custom', customKcal: 2200 }, prof);
  eq('custom target honoured', custom.targetKcal, 2200);

  // Guardrails.
  const hardCut = E.goalPlan(tdee, { kind: 'lose', deficitKcal: 900 }, prof);
  ok('>25% deficit warns', hardCut.warnings.some(w => /25%/.test(w.text)));
  const fastRate = E.goalPlan(tdee, { kind: 'lose', rateKgPerWk: 1.2 }, prof);
  ok('>1% bodyweight/wk warns', fastRate.warnings.some(w => /1%/.test(w.text)));
  const floorCut = E.goalPlan(1600, { kind: 'lose', deficitKcal: 500 }, prof);
  ok('below minimum-calorie floor warns (male 1500)', floorCut.warnings.some(w => /1500/.test(w.text)));
  const floorCutF = E.goalPlan(1600, { kind: 'lose', deficitKcal: 500 }, Object.assign({}, prof, { sex: 'f' }));
  ok('floor is 1200 for women, 1100 warns', floorCutF.warnings.some(w => /1200/.test(w.text)));

  /* ── Protein & macros (section 19) ─────────────────────────── */

  section('protein & macro targets');
  const pLose = E.proteinRecommendation(prof, 'lose');
  eq('lose range 1.8–2.2 g/kg', [pLose.low, pLose.high], [135, 165]);
  const mt = E.macroTargets(2400, prof, { kind: 'lose' });
  eq('protein = recommendation midpoint', mt.protein, pLose.mid);
  eq('fat floor 0.8 g/kg', mt.fat, 60);
  close('carbs fill the remainder', mt.carbs, (2400 - mt.protein * 4 - 60 * 9) / 4, 0.6);
  eq('labelled a recommendation', mt.proteinSource, 'recommended');
  const mtFixed = E.macroTargets(2400, prof, { kind: 'lose', proteinTargetG: 140 });
  eq('explicit protein target wins', mtFixed.protein, 140);
  eq('explicit protein labelled yours', mtFixed.proteinSource, 'yours');

  /* ── Weight trends (section 17) ────────────────────────────── */

  section('weight trends');
  // Noisy series around a flat ~74.8 – a rolling average must sit near
  // the TRUE level, not chase daily water swings.
  const noisy = [];
  for (let i = 0; i < 14; i++) noisy.push({ date: W.addDays('2026-09-01', i), kg: 74.8 + [0.6, -0.3, 0.8, -0.5, 0.2, -0.7, 0.4][i % 7] });
  close('7-day average is near the true level', E.rollingAverage(noisy, 7, '2026-09-14', W.daysBetween), 74.8, 0.35);
  eq('average over a gapless window has a value', E.rollingAverage(noisy, 7, '2026-09-14', W.daysBetween) != null, true);
  eq('empty window → null, not NaN', E.rollingAverage([], 7, '2026-09-14', W.daysBetween), null);

  // A real downward slope: 0.1 kg/day steady ⇒ ~-0.7 kg/week.
  const slopeSeries = [];
  for (let i = 0; i < 21; i++) slopeSeries.push({ date: W.addDays('2026-09-01', i), kg: 76 - 0.1 * i });
  close('steady slope ≈ −0.7 kg/wk', E.trendSlopeKgPerWeek(slopeSeries, W.daysBetween), -0.7, 0.05);
  eq('slope needs ≥7 points', E.trendSlopeKgPerWeek(slopeSeries.slice(0, 6), W.daysBetween), null);

  /* ── Observed maintenance (section 4) ────────────────────────
     21 days at 2,300 kcal/day with a FLAT weight trend ⇒ observed
     maintenance ≈ 2,300 kcal. The estimator, not the equation, should
     converge on the truth of the synthetic data. */

  section('observed TDEE');
  const flatW = [], flatIn = [];
  for (let i = 0; i < 21; i++) {
    const d = W.addDays('2026-08-25', i);
    flatW.push({ date: d, kg: 75 + [0.3, -0.2, 0.4, -0.3, 0.1, -0.4, 0.2][i % 7] });
    flatIn.push({ date: d, kcal: 2300 + (i % 5) * 40 - 80 }); // ±100 noise, mean 2300
  }
  const obs = E.observedTDEE(flatIn, flatW, '2026-09-14', W.addDays, W.daysBetween);
  ok('flat trend → estimate exists', obs.kcal != null);
  close('flat trend ⇒ observed ≈ intake', obs.kcal, 2300, 60);
  eq('fully-logged 21 days earns "ok" confidence', obs.confidence, 'ok');
  ok('methodology string cites the window', /21 days/.test(obs.reason));

  // A genuine deficit: lose 0.1 kg/day while eating 2000 ⇒ observed
  // ≈ 2000 + 0.1·7700 ≈ 2770.
  const cutW = [], cutIn = [];
  for (let i = 0; i < 21; i++) {
    const d = W.addDays('2026-08-25', i);
    cutW.push({ date: d, kg: 80 - 0.1 * i });
    cutIn.push({ date: d, kcal: 2000 });
  }
  // A genuine deficit: 80 kg falling 0.1 kg/day while eating 2000 kcal
  // ⇒ true maintenance 2000 + 0.1×7700 = 2770. Edge means sit at the
  // mean dates of their windows (day 3 and day 17), so dividing the
  // trend delta by that ACTUAL elapsed distance recovers the slope:
  //   Δ = −1.4 kg over 14 days ⇒ 2000 + 1.4×7700/14 = 2770 ✓
  close('deficit ⇒ observed recovers true maintenance',
    E.observedTDEE(cutIn, cutW, '2026-09-14', W.addDays, W.daysBetween).kcal, 2770, 30);

  // Insufficient data must refuse LOUDLY, not emit a confident number.
  const thin = E.observedTDEE(flatIn.slice(0, 5), flatW.slice(0, 5), '2026-09-14', W.addDays, W.daysBetween);
  eq('thin data → no estimate', thin.kcal, null);
  ok('thin data explains itself', /needs ≥10 days/.test(thin.reason) && /have 5 intake days/.test(thin.reason));

  /* ── Weekly averages (section 16) ──────────────────────────── */

  section('weekly averages');
  const days = {
    '2026-09-08': day,
    '2026-09-09': { meals: { dinner: [{ nutrients: { kcal: 2100, protein: 140, carbs: 200, fat: 70, fiber: 25 } }] }, quickAdds: [] }
  };
  const wa = E.weeklyAverages(days, ['2026-09-08', '2026-09-09', '2026-09-10']);
  eq('untouched days are skipped, not averaged as zero', wa.loggedDays, 2);
  close('avg kcal over logged days', wa.kcal, (1309 + 2100) / 2, 0.6);

  /* ── Number hygiene (section 20) ───────────────────────────── */

  section('number hygiene');
  eq('fmt kills float dust', E.fmt(0.1 + 0.2, 1), '0.3');
  eq('fmt integers stay integer-looking', E.fmt(450, 1), '450');
  eq('fmt dp=0 rounds', E.fmt(2677.6, 0), '2678');
  eq('round1', E.round1(16.2499), 16.2);
};
