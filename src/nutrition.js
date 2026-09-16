/* ═══════════════════════════════════════════════════════════════
   NUTRITION UI — state, rendering and event wiring for the
   Calorie & Nutrition tab (#vNut).

   Layering is deliberate and matches the rest of the app:
     nutrition-engine.js — every formula (pure, node-tested)
     nutrition-sync.js   — RTDB reads/targeted PATCHes (no DOM)
     THIS FILE           — localStorage cache, DOM, events. NO math
                           beyond shuffling numbers the engine computed.

   Dependencies arrive via AscaNutrition.init(deps) from app.js —
   { toast, encryptStr, decryptStr, getBodyWeight, noteBodyWeight,
     WinterArc } — because app.js is an IIFE and exposes nothing.
   Day keys are ALWAYS WinterArc.dateStr-local "YYYY-MM-DD" (the bug
   winter.js's header exists to prevent applies here exactly).

   Storage: localStorage 'asca_gym_nutrition' (encryptStr'd like the
   workouts cache) is the offline-first live copy; nutrition/{userId}
   in RTDB is the durable record. Writes go local → persist → debounced
   flush of dirty subpaths; boot merges cloud under local (NutritionSync
   .mergeCloud), same policy as fbRestore's "local wins".
   ═══════════════════════════════════════════════════════════════ */
const AscaNutrition = (() => {
  'use strict';

  const LS_KEY = 'asca_gym_nutrition';
  const E = () => NutritionEngine;
  const W = () => WinterArc;

  let toast = m => console.log('[nutrition]', m);
  let encryptStr = s => s, decryptStr = s => s;
  let deps = {};

  /* ── State ──────────────────────────────────────────────────
     One object, mirrored 1:1 with nutrition/{userId}. Meals are keyed
     by slot id ('breakfast' … or 'c_<slug>' for custom meals); human
     names for custom slots live in state.mealNames.
     Day entries snapshot resolved nutrients AT LOG TIME
     (entry.nutrients) — later edits to a food/recipe never rewrite the
     history you actually ate (section 14: a logged number is a fact). */

  let state = null;
  function emptyState() {
    return {
      profile: null,        // { sex, age, heightCm, weight, targetWeight, bodyFatPct? }
      goals: null,          // { kind, rateKgPerWk?, deficitKcal?, surplusKcal?, customKcal?, proteinTargetG?, macroTargets? }
      activity: { mode: 'sedentary' }, // { mode }|{ mode:'detailed', detail:{…} }
      foods: {},            // id → {id, name, basis, per100, servingSize?, pieceSize?, tbspG?, rawToCooked?, source, barcode?, ts}
      recipes: {},          // id → {id, name, servings, ingredients:[{foodId|inline, qty, unit}], ts}
      days: {},             // 'YYYY-MM-DD' → { meals:{slot:[entry]}, quickAdds:[entry] }
      weights: {},          // 'YYYY-MM-DD' → kg   (dated series — this is the weight log)
      measurements: {},     // 'YYYY-MM-DD' → { waist?, neck?, chest?, arms?, hips?, thighs? } (cm)
      mealNames: {},
      mealNames: {},        // slot → display name for custom meals
      startedWeight: null   // first logged weight, for goal progress (section 18)
    };
  }

  let dirty = {};           // subpaths pending flush: 'profile','goals','foods/x','days/2026-09-16',…
  let flushTimer = null;
  let curDate = null;       // selected day on the Today screen
  let curSection = 'today'; // today | trends | foods | plan
  let sheet = null;         // open bottom-sheet context

  /* ── Persistence ──────────────────────────────────────────── */

  function load() {
    state = emptyState();
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(decryptStr(raw));
        state = Object.assign(emptyState(), parsed || {});
      }
    } catch (_) { state = emptyState(); }
    curDate = W().todayStr();
  }

  function persist() {
    try { localStorage.setItem(LS_KEY, encryptStr(JSON.stringify(state))); } catch (_) {}
  }

  function markDirty(sub) { dirty[sub] = true; scheduleFlush(); }

  function scheduleFlush() {
    persist();
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1200);
  }

  // PATCH each dirty subpath — never a node-wide write (arc-sync rule).
  async function flush() {
    if (!NutritionSync.connected()) return;
    const subs = Object.keys(dirty); dirty = {};
    for (const sub of subs) {
      try {
        if (sub === 'profile') await NutritionSync.writeProfile(state.profile);
        else if (sub === 'goals') await NutritionSync.writeGoals(state.goals);
        else if (sub.startsWith('foods/')) {
          const id = sub.slice(6);
          if (state.foods[id]) await NutritionSync.writeFood(id, state.foods[id]);
          else await NutritionSync.deleteFood(id);
        }
        else if (sub.startsWith('recipes/')) {
          const id = sub.slice(8);
          if (state.recipes[id]) await NutritionSync.writeRecipe(id, state.recipes[id]);
          else await NutritionSync.deleteRecipe(id);
        }
        else if (sub.startsWith('days/')) await NutritionSync.writeDay(sub.slice(5), state.days[sub.slice(5)] || {});
        else if (sub.startsWith('weights/')) {
          const d = sub.slice(8);
          if (state.weights[d] != null) await NutritionSync.writeWeight(d, state.weights[d]);
          else await NutritionSync.deleteWeight(d);
        }
        else if (sub.startsWith('measurements/')) await NutritionSync.writeMeasurements(sub.slice(13), state.measurements[sub.slice(13)] || {});
        else if (sub === 'mealNames') await NutritionSync.writeMeta('mealNames', state.mealNames);
        else if (sub === 'activity') await NutritionSync.writeMeta('activity', state.activity);
      } catch (_) { dirty[sub] = true; } // stays dirty — next flush retries
    }
    if (NutritionSync.wasDenied()) {
      toast('Nutrition sync needs the updated database rules (Settings → Developer Console)', 'error', { durationMs: 5000 });
    }
  }

  /* Boot: pull the cloud node once, let local win on overlap, then
     flush anything the merge brought in that local lacked. */
  async function restore() {
    if (!NutritionSync.connected()) return;
    try {
      const cloud = await NutritionSync.readAll();
      if (!cloud) return;
      const hadLocal = !!(state.profile || Object.keys(state.days).length);
      state = NutritionSync.mergeCloud(state, cloud);
      // cloud.startedWeight lands in profile-synced territory — keep the
      // earliest known starting weight either side knew about.
      if (cloud.startedWeight != null && (state.startedWeight == null || cloud.startedWeight < state.startedWeight)) {
        state.startedWeight = cloud.startedWeight;
      }
      persist();
      seedStarterFoods();
      if (!hadLocal && (cloud.profile || cloud.days)) {
        // Fresh device: push the merged union back so nothing cloud-only
        // (e.g. foods from another device) is missing anywhere.
        if (state.profile) dirty.profile = true;
        if (state.goals) dirty.goals = true;
        if (state.mealNames && Object.keys(state.mealNames).length) dirty.mealNames = true;
        if (state.activity) dirty.activity = true;
        Object.keys(state.foods).forEach(id => dirty[`foods/${id}`] = true);
        Object.keys(state.recipes).forEach(id => dirty[`recipes/${id}`] = true);
        Object.keys(state.days).forEach(d => dirty[`days/${d}`] = true);
        Object.keys(state.weights).forEach(d => dirty[`weights/${d}`] = true);
        scheduleFlush();
      }
      render();
    } catch (_) {}
  }

  /* ── Small state helpers ──────────────────────────────────── */

  function uid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* Starter pack — my own staples, entered from the photographed package
     labels (2026-09-16) and marked source:user (section 14). Keyed by
     owner so nobody else's library is touched; stable ids keep the seed
     idempotent across devices (merge dedupes by id, not by name). User
     edits/deletes win over the seed everywhere:
       same device: name-match skip
       fresh device (local empty): cloud copy — edited or not — survives
         and the name-skip blocks the untouched original from duplicating
       deleted on a fresh device: gone — no local copy exists to merge
         back up, so a re-seed can't resurrect it.
     Eggs use a standard per-large-egg value (source:estimated, labeled
     as such in the UI) until the package gets photographed. */
  const STARTER_OWNER = 'anshulsc';
  const STARTER_FOODS = [
    { id: 'seed-toast', name: 'Whole Wheat Toast (EDEKA Weizenvollkorntoast)', basis: 'per100g', pieceSize: 25,
      per100: { kcal: 234, protein: 10.0, carbs: 40.5, fat: 2.0, fiber: 10.0,
        micros: { satfat_g: 0.3, sugar_g: 4.5, sodium_mg: 400 } } },
    { id: 'seed-muesli', name: 'Vollkorn Müsli (Lidl)', basis: 'per100g',
      per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7.0, fiber: 10.0,
        micros: { satfat_g: 1.3, sugar_g: 10.0, sodium_mg: 5 } } },
    { id: 'seed-milk', name: 'Fettarme Milch 1.5% (EDEKA)', basis: 'per100g',
      per100: { kcal: 47, protein: 3.5, carbs: 4.9, fat: 1.5, fiber: 0,
        micros: { satfat_g: 1.0, sugar_g: 4.9, sodium_mg: 52 } } },
    { id: 'seed-egg', name: 'Egg', basis: 'piece', pieceSize: 55, source: 'estimated',
      per100: { kcal: 70, protein: 6.3, carbs: 0.4, fat: 4.8, fiber: 0, micros: {} } }
  ];
  /* Recipes built from the starter foods above. Same id/name dedupe:
     a user's edit or delete of the seeded recipe wins and is never
     silently resurrected on another boot or device. */
  const STARTER_RECIPES = [
    { id: 'seed-french-toast', name: 'French Toast', servings: 1,
      ingredients: [
        { foodId: 'seed-toast', qty: 4, unit: 'slice' },
        { foodId: 'seed-egg', qty: 2, unit: 'egg' }
      ] }
  ];
  let seededStarter = false; // once per boot — protect seedsWith on later renders

  function seedsWith(list, f) {
    return list.some(x => x.id === f.id) ||
      list.some(x => x.name.toLowerCase() === f.name.toLowerCase());
  }

  function seedStarterFoods() {
    if (seededStarter) return;
    seededStarter = true;
    let uid = '';
    try { uid = (NutritionSync.myId && NutritionSync.myId()) || ''; } catch (_) {}
    if (uid !== STARTER_OWNER) return;
    const foods = Object.values(state.foods);
    let added = 0;
    for (const f of STARTER_FOODS) {
      if (seedsWith(foods, f)) continue;
      state.foods[f.id] = Object.assign({ source: 'user', ts: Date.now() }, f);
      foods.push(f); // subsequent seeds see this one too
      markDirty(`foods/${f.id}`);
      added++;
    }
    const recipes = Object.values(state.recipes);
    for (const r of STARTER_RECIPES) {
      if (seedsWith(recipes, r)) continue;
      state.recipes[r.id] = Object.assign({ ts: Date.now() }, r);
      recipes.push(r);
      markDirty(`recipes/${r.id}`);
      added++;
    }
    if (added) render();
  }

  function dayRecord(date) {
    if (!state.days[date]) state.days[date] = { meals: {}, quickAdds: [] };
    if (!state.days[date].meals) state.days[date].meals = {};
    if (!state.days[date].quickAdds) state.days[date].quickAdds = [];
    return state.days[date];
  }

  function mealsFor(date) {
    // Default four, then any custom slots present in names or data.
    const slots = E().DEFAULT_MEALS.slice();
    const seen = new Set(slots);
    [Object.keys(state.mealNames), Object.keys(dayRecord(date).meals)].flat().forEach(s => {
      if (!seen.has(s)) { seen.add(s); slots.push(s); }
    });
    return slots;
  }

  function mealLabel(slot) {
    return state.mealNames[slot] || slot.charAt(0).toUpperCase() + slot.slice(1);
  }

  function weightSeriesAsc() {
    return Object.keys(state.weights).sort().map(d => ({ date: d, kg: Number(state.weights[d]) }));
  }

  function latestWeight() {
    const ws = weightSeriesAsc();
    return ws.length ? ws[ws.length - 1] : null;
  }

  function currentProfile() {
    // Current weight for TDEE prefers the freshest logged weigh-in over
    // the profile form's snapshot — the profile editor writes both.
    const lw = latestWeight();
    return Object.assign({}, state.profile || {}, lw ? { weight: lw.kg } : {});
  }

  /* The plan as live numbers: TDEE report + goal target + macros.
     Returns nulls where inputs are missing — the UI shows setup nudges
     instead of pretending. One derivation only: TARGETS() everywhere. */
  function targets() {
    const prof = currentProfile();
    let report = null;
    try { report = E().tdeeReport(prof, state.activity); } catch (_) {}
    const plan = report ? E().goalPlan(report.recommendedKcal, state.goals || { kind: 'maintain' }, prof) : null;
    const macros = plan && plan.targetKcal ? E().macroTargets(plan.targetKcal, prof, state.goals || {}) : null;
    return { profile: prof, report, plan, macros };
  }

  function observedMaintenance() {
    const today = W().todayStr();
    const inStart = W().addDays(today, -(E().OBSERVED_LOOKBACK - 1));
    const intake = Object.keys(state.days).sort()
      .map(d => ({ date: d, kcal: E().dailyTotals(state.days[d]).kcal }))
      .filter(p => p.kcal > 0 && p.date >= inStart && p.date <= today);
    return E().observedTDEE(intake, weightSeriesAsc(), today, W().addDays, W().daysBetween);
  }

  /* ── Generic DOM helpers (nutrition.js is standalone — these
     stay local rather than reaching into app.js's closure) ──── */

  const $ = id => document.getElementById(id);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }
  function openSheet(id) { const b = $(id); if (b) b.classList.add('open'); }
  function closeSheet(id) { const b = $(id); if (b) b.classList.remove('open'); }

  /* Sheet backgrounds close on backdrop tap — same convention as the
     mini-profile sheet in app.js (the sheet system is .open, matching
     .mini-profile-bg.open in the stylesheet). */
  function bindSheetBackdrop(id, onClose) {
    const bg = $(id);
    if (bg) bg.addEventListener('click', e => {
      if (e.target === bg) { if (onClose) onClose(); bg.classList.remove('open'); }
    });
  }

  const num = id => { const v = parseFloat($(id) && $(id).value); return isFinite(v) ? v : null; };

  function numLabel(x, unit, dp) {
    return x == null || !isFinite(x) ? '—' : `${E().fmt(x, dp == null ? 0 : dp)}${unit ? ' ' + unit : ''}`;
  }

  /* ── Canvas sparkline (drawChart idiom from app.js: DPR-aware,
     axis hairlines, dots + smoothed line) ───────────────────── */

  function drawSpark(canvas, series, opts = {}) {
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 300, height: 120 };
    canvas.width = rect.width * dpr; canvas.height = (rect.height || 120) * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width, h = rect.height || 120;
    ctx.clearRect(0, 0, w, h);
    if (!series.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '600 9px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(opts.emptyText || 'No data yet', w / 2, h / 2);
      return;
    }
    const pad = { top: 8, right: 8, bottom: 14, left: 8 };
    const cw = w - pad.left - pad.right, ch = h - pad.top - pad.bottom;
    const xs = series.map((p, i) => pad.left + (cw / Math.max(series.length - 1, 1)) * i);
    const allY = series.map(p => p.y).concat(series.map(p => p.avg).filter(v => v != null));
    let min = Math.min(...allY), max = Math.max(...allY);
    if (min === max) { min -= 1; max += 1; }
    const span = max - min; min -= span * 0.08; max += span * 0.08;
    const Y = v => pad.top + ch - ((v - min) / (max - min)) * ch;
    const color = opts.color || '#0A84FF';

    // Weight-style cards draw raw dots + a 7-day average line over them;
    // plain series draw a single smoothed line. Water noise is visible
    // but never presented AS the trend (section 17).
    if (series.some(p => p.avg != null)) {
      series.forEach((p, i) => {
        ctx.beginPath(); ctx.arc(xs[i], Y(p.y), 2.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
      });
      const avgPts = series.map((p, i) => p.avg != null ? { x: xs[i], y: Y(p.avg) } : null).filter(Boolean);
      if (avgPts.length > 1) {
        ctx.beginPath(); ctx.moveTo(avgPts[0].x, avgPts[0].y);
        for (let i = 1; i < avgPts.length; i++) {
          const cx = (avgPts[i - 1].x + avgPts[i].x) / 2;
          ctx.bezierCurveTo(cx, avgPts[i - 1].y, cx, avgPts[i].y, avgPts[i].x, avgPts[i].y);
        }
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      }
    } else if (series.length > 1) {
      const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
      grad.addColorStop(0, color + '2E'); grad.addColorStop(1, color + '00');
      ctx.beginPath(); ctx.moveTo(xs[0], Y(series[0].y));
      for (let i = 1; i < series.length; i++) {
        const cx = (xs[i - 1] + xs[i]) / 2;
        ctx.bezierCurveTo(cx, Y(series[i - 1].y), cx, Y(series[i].y), xs[i], Y(series[i].y));
      }
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      ctx.lineTo(xs[xs.length - 1], h - pad.bottom); ctx.lineTo(xs[0], h - pad.bottom);
      ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    }
    // End labels: first + last day so the axis reads without chrome.
    ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.font = '600 8px "JetBrains Mono", monospace';
    ctx.textAlign = 'left'; ctx.fillText(series[0].label || '', pad.left, h - 3);
    ctx.textAlign = 'right'; ctx.fillText(series[series.length - 1].label || '', w - pad.right, h - 3);
  }

  const dayLabel = d => {
    const dt = W().parseDay(d);
    return dt ? dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d;
  };

  /* ── Render: frame ────────────────────────────────────────── */

  function render() {
    if (!state) return;
    const root = $('vNut');
    if (!root) return;
    ['today', 'trends', 'foods', 'plan'].forEach(s => {
      const pane = $('nutPane' + s.charAt(0).toUpperCase() + s.slice(1));
      if (pane) pane.style.display = s === curSection ? '' : 'none';
      const tab = document.querySelector(`#nutSubTabs [data-nut="${s}"]`);
      if (tab) tab.classList.toggle('on', s === curSection);
    });
    if (curSection === 'today') renderToday();
    else if (curSection === 'trends') renderTrends();
    else if (curSection === 'foods') renderFoods();
    else renderPlan();
  }

  /* ── TODAY (sections 5/11/12/21/22) ───────────────────────── */

  function renderToday() {
    $('nutDateLabel').textContent =
      curDate === W().todayStr() ? 'Today' : dayLabel(curDate);

    const t = targets();
    const totals = E().dailyTotals(state.days[curDate]);
    const tgtKcal = t.macros ? t.macros.kcal : 0;

    // Header ring: consumed / target, remaining or over.
    // Calorie ring + "Net" line, including today's logged exercise burn
    // (the link to the workout side: cardio sets and lifting sessions
    // logged on the Log tab surface here).
    const burn = deps.exerciseBurnForDate ? deps.exerciseBurnForDate(curDate) : null;
    const burnKcal = burn ? burn.kcal : 0;
    $('nutKcalNum').textContent = E().fmt(totals.kcal, 0);
    $('nutKcalTarget').textContent = tgtKcal ? `/ ${E().fmt(tgtKcal, 0)} kcal` : '/ — kcal';
    const pct = tgtKcal > 0 ? Math.min(1, totals.kcal / tgtKcal) : 0;
    const ring = $('nutKcalRingFill');
    if (ring) ring.style.strokeDashoffset = String(163.36 * (1 - pct));
    const remain = $('nutKcalRemain');
    if (!tgtKcal) { remain.textContent = 'Set up your plan for a target'; remain.className = 'nut-kcal-remain'; }
    else {
      // The target was set against TDEE-which-already-includes-activity,
      // so "remaining" stays intake-vs-target; exercise burn is shown
      // separately and shifted to the NET line instead of re-inflating
      // the budget (no double-counting).
      const left = tgtKcal - totals.kcal;
      remain.textContent = left >= 0 ? `${E().fmt(left, 0)} kcal remaining` : `${E().fmt(-left, 0)} kcal over target`;
      remain.className = 'nut-kcal-remain' + (left < 0 ? ' over' : '');
    }
    const burnRow = $('nutBurnRow');
    if (burnKcal > 0) {
      const srcBits = [];
      if (burn.cardio.kcal || burn.cardio.mins) srcBits.push(`cardio ${burn.cardio.kcal ? burn.cardio.kcal + ' kcal' + (burn.cardio.mins ? ' · ' + burn.cardio.mins + ' min' : '') : burn.cardio.mins + ' min'}`);
      if (burn.liftKcal) srcBits.push(`~${burn.liftKcal} kcal lifting${burn.liftSessions > 1 ? ' × ' + burn.liftSessions : ''}`);
      burnRow.textContent = `🏃 −${burnKcal} kcal active today (${srcBits.join(', ')}) → net ≈ ${E().fmt(totals.kcal - burnKcal, 0)} kcal`;
      burnRow.style.display = '';
    } else burnRow.style.display = 'none';

    // Macro bars — protein first and visually emphasized (section 19).
    const macroRow = (id, name, used, tgt, accent) => {
      const row = $(id); if (!row) return;
      const pctm = tgt > 0 ? Math.min(1, used / tgt) : 0;
      row.querySelector('.nut-macro-nums').textContent = `${E().fmt(used, 0)} / ${tgt ? E().fmt(tgt, 0) : '—'} g`;
      const fill = row.querySelector('.nut-macro-fill');
      fill.style.width = (pctm * 100).toFixed(1) + '%';
      fill.classList.toggle('over', tgt > 0 && used > tgt * 1.05 && name !== 'Protein'); // protein overage is fine
    };
    macroRow('nutMacroP', 'Protein', totals.protein, t.macros && t.macros.protein);
    macroRow('nutMacroC', 'Carbs', totals.carbs, t.macros && t.macros.carbs);
    macroRow('nutMacroF', 'Fat', totals.fat, t.macros && t.macros.fat);
    macroRow('nutMacroFi', 'Fiber', totals.fiber, t.macros && t.macros.fiber);

    // Meals.
    const list = $('nutMealList');
    const day = state.days[curDate];
    list.innerHTML = mealsFor(curDate).map(slot => {
      const entries = (day && day.meals[slot]) || [];
      const mt = E().mealTotals(day, slot);
      const rows = entries.map((e, i) => `
        <div class="nut-entry" data-slot="${esc(slot)}" data-idx="${i}">
          <span class="nut-entry-name">${esc(e.label)}${e.source === 'estimated' ? ' <span class="nut-src-badge est">~est</span>' : ''}</span>
          <span class="nut-entry-kcal nut-num">${E().fmt(e.nutrients.kcal, 0)} kcal</span>
          <button class="nut-entry-del" data-slot="${esc(slot)}" data-idx="${i}" aria-label="Remove">×</button>
        </div>`).join('');
      return `
        <div class="nut-meal" data-meal="${esc(slot)}">
          <div class="nut-meal-head" data-meal="${esc(slot)}">
            <span class="nut-meal-name">${esc(mealLabel(slot))}</span>
            <span class="nut-meal-kcal nut-num">${entries.length ? E().fmt(mt.kcal, 0) + ' kcal' : ''}</span>
            <button class="nut-meal-add" data-meal="${esc(slot)}">+ Add</button>
          </div>
          ${rows}
        </div>`;
    }).join('') + ((day && day.quickAdds.length) ? `
        <div class="nut-meal">
          <div class="nut-meal-head"><span class="nut-meal-name">Quick adds</span>
          <span class="nut-meal-kcal nut-num">${E().fmt(day.quickAdds.reduce((s, q) => s + q.nutrients.kcal, 0), 0)} kcal</span></div>
          ${day.quickAdds.map((q, i) => `
            <div class="nut-entry"><span class="nut-entry-name">${esc(q.label)}</span>
            <span class="nut-entry-kcal nut-num">${E().fmt(q.nutrients.kcal, 0)} kcal</span>
            <button class="nut-qa-del" data-idx="${i}" aria-label="Remove">×</button></div>`).join('')}
        </div>` : '');

    // Weight row: today's number + 7-day trend delta.
    const ws = weightSeriesAsc();
    const today7 = E().rollingAverage(ws, 7, curDate, W().daysBetween);
    const weekAgo7 = E().rollingAverage(ws.filter(p => p.date <= W().addDays(curDate, -7)), 7, W().addDays(curDate, -7), W().daysBetween);
    $('nutWeightNow').textContent = state.weights[curDate] != null ? `${E().fmt(state.weights[curDate], 1)} kg` : (today7 != null ? `~${E().fmt(today7, 1)} kg` : '—');
    const trend = $('nutWeightTrend');
    if (today7 != null && weekAgo7 != null) {
      const d = today7 - weekAgo7;
      trend.textContent = `${d > 0 ? '+' : ''}${E().fmt(d, 1)} kg vs last week's avg`;
    } else trend.textContent = ws.length ? 'Trend appears after ~a week of weigh-ins' : 'Log your weight daily';

    // Goal strip (section 18, compact on Today; full card in Trends).
    const goal = $('nutGoalStrip');
    const targetKg = state.profile && Number(state.profile.targetWeight);
    if (today7 != null && targetKg) {
      const startKg = state.startedWeight != null ? state.startedWeight : ws[0].kg;
      const remaining = today7 - targetKg;
      goal.innerHTML = `<span class="nut-num">${E().fmt(startKg, 1)}</span> start · <span class="nut-num">${E().fmt(today7, 1)}</span> now · <span class="nut-num">${E().fmt(targetKg, 1)}</span> goal — <b>${E().fmt(Math.abs(remaining), 1)} kg ${remaining >= 0 ? 'to lose' : 'to gain'}</b>`;
      goal.style.display = '';
    } else goal.style.display = 'none';

    if (NutritionSync.wasDenied && NutritionSync.wasDenied()) {
      // One-line, non-blocking notice; the full explanation was toasted.
      const n = $('nutSyncNote'); if (n) { n.style.display = ''; }
    }
  }

  /* ── TRENDS (sections 4/16/17/18) ─────────────────────────── */

  function renderTrends() {
    const today = W().todayStr();

    // Weekly averages over the last 7 real days.
    const keys = []; for (let i = 6; i >= 0; i--) keys.push(W().addDays(today, -i));
    const wa = E().weeklyAverages(state.days, keys);
    // Net of exercise: intake minus what the workout log says you burned.
    let weekBurn = 0, burnDays = 0;
    if (deps.exerciseBurnForDate) keys.forEach(d => {
      const b = deps.exerciseBurnForDate(d);
      if (b && b.kcal > 0) { weekBurn += b.kcal; burnDays++; }
    });
    $('nutWeekAvg').innerHTML = wa.loggedDays === 0
      ? '<div class="nut-muted">Log a few days of food to see weekly averages.</div>'
      : `<div class="nut-statgrid">
          ${stat('Avg calories', E().fmt(wa.kcal, 0), 'kcal/d')}
          ${stat('Avg protein', E().fmt(wa.protein, 0), 'g/d')}
          ${stat('Avg carbs', E().fmt(wa.carbs, 0), 'g/d')}
          ${stat('Avg fat', E().fmt(wa.fat, 0), 'g/d')}
          ${stat('Avg fiber', E().fmt(wa.fiber, 0), 'g/d')}
          ${weekBurn > 0 ? stat('Active kcal', E().fmt(weekBurn / Math.max(1, burnDays), 0), `kcal/${burnDays > 1 ? 'workout day' : 'day'}`) : stat('Days logged', wa.loggedDays, '/ 7')}
        </div>`;

    // Weight stats: averages, change, from-start.
    const ws = weightSeriesAsc();
    const avg7 = E().rollingAverage(ws, 7, today, W().daysBetween);
    const avg14 = E().rollingAverage(ws, 14, today, W().daysBetween);
    const prev7 = E().rollingAverage(ws.filter(p => p.date <= W().addDays(today, -7)), 7, W().addDays(today, -7), W().daysBetween);
    const slope = E().trendSlopeKgPerWeek(ws, W().daysBetween);
    const startKg = state.startedWeight != null ? state.startedWeight : (ws[0] && ws[0].kg);
    $('nutWeightStats').innerHTML = !ws.length
      ? '<div class="nut-muted">No weigh-ins yet — log from the Today tab.</div>'
      : `<div class="nut-statgrid">
          ${stat('Current (7-d avg)', avg7 != null ? E().fmt(avg7, 1) : '—', 'kg')}
          ${stat('14-day avg', avg14 != null ? E().fmt(avg14, 1) : '—', 'kg')}
          ${stat('vs previous week', avg7 != null && prev7 != null ? (avg7 - prev7 > 0 ? '+' : '') + E().fmt(avg7 - prev7, 1) : '—', 'kg')}
          ${stat('Trend / week', slope != null ? (slope > 0 ? '+' : '') + E().fmt(slope, 1) : '—', 'kg')}
          ${stat('From start', avg7 != null && startKg != null ? (avg7 - startKg > 0 ? '+' : '') + E().fmt(avg7 - startKg, 1) : '—', 'kg')}
          ${stat('Weigh-ins', ws.length, '')}
        </div>`;

    // Formula vs observed maintenance — the honest two-number view.
    const t = targets();
    const obs = observedMaintenance();
    const formulaKcal = t.report ? t.report.recommendedKcal : null;
    $('nutTdeeCompare').innerHTML = `
      <div class="nut-tdee-line"><span>Formula estimate</span><b class="nut-num">${formulaKcal ? E().fmt(formulaKcal, 0) + ' kcal' : '— set up your plan'}</b></div>
      <div class="nut-tdee-line"><span>Observed maintenance</span><b class="nut-num">${obs.kcal ? '≈ ' + E().fmt(obs.kcal, 0) + ' kcal' : '—'}</b></div>
      <div class="nut-muted">${obs.kcal
        ? esc(obs.reason) + (obs.confidence === 'low' ? ' — treat as directional; more days sharpen it.' : '.')
        : esc(obs.reason) + '.'} Your true maintenance is the intake at which your weight <i>trend</i> (not any single day) holds flat.</div>`;

    // Goal progress + estimated timeline (clearly an estimate).
    const targetKg = state.profile && Number(state.profile.targetWeight);
    if (avg7 != null && targetKg) {
      const remaining = avg7 - targetKg;
      let eta = '';
      const gp = t.plan;
      if (Math.abs(remaining) < 0.05) eta = 'You\'re there.';
      else if (slope != null && Math.sign(slope) !== Math.sign(remaining) && Math.abs(slope) > 0.05)
        eta = `At the current ~${E().fmt(Math.abs(slope), 1)} kg/week trend, roughly ${Math.max(1, Math.round(Math.abs(remaining / slope)))} more weeks — an estimate, and it will move as your trend does.`;
      else if (gp && gp.weeksToTarget)
        eta = `At your planned rate, about ${Math.round(gp.weeksToTarget)} weeks from your current weight — an estimate.`;
      else eta = 'Log weights for ~a week to get a trend-based timeline.';
      $('nutGoalCard').innerHTML = `
        <div class="nut-goal-nums"><span class="nut-num">${E().fmt(startKg, 1)}</span><em>start</em>
          <span class="nut-arrow">→</span>
          <span class="nut-num big">${E().fmt(avg7, 1)}</span><em>now</em>
          <span class="nut-arrow">→</span>
          <span class="nut-num">${E().fmt(targetKg, 1)}</span><em>goal</em></div>
        <div class="nut-goal-left">${E().fmt(Math.abs(remaining), 1)} kg ${remaining >= 0 ? 'remaining' : 'to gain'}</div>
        <div class="nut-muted">${esc(eta)}</div>`;
      $('nutGoalCard').style.display = '';
    } else $('nutGoalCard').style.display = 'none';

    // Sparklines. Weight gets raw dots + 7-day-average line; calories a
    // smoothed single line. Declared as raw `<canvas>` in the markup and
    // drawn here — nothing chart-shaped is hand-positioned HTML.
    const wsRange = ws.filter(p => p.date >= W().addDays(today, -29));
    drawSpark($('nutChartWeight'), wsRange.map(p => ({
      label: dayLabel(p.date), y: p.kg,
      avg: E().rollingAverage(ws, 7, p.date, W().daysBetween)
    })), { color: '#30D158', emptyText: 'Log weight from the Today tab' });

    const calSeries = [];
    for (let i = 29; i >= 0; i--) {
      const d = W().addDays(today, -i);
      const tot = E().dailyTotals(state.days[d]).kcal;
      calSeries.push({ label: dayLabel(d), y: tot });
    }
    drawSpark($('nutChartKcal'), calSeries.filter((p, i) => i === 0 || i === calSeries.length - 1 || p.y > 0), { color: '#FF9F0A', emptyText: 'Log food to see intake' });

    // Exercise burn from the workout log — the "Net" companion to intake.
    const burnSeries = [];
    for (let i = 29; i >= 0; i--) {
      const d = W().addDays(today, -i);
      const b = deps.exerciseBurnForDate ? deps.exerciseBurnForDate(d) : null;
      if (b && b.kcal > 0) burnSeries.push({ label: dayLabel(d), y: b.kcal });
    }
    const burnCard = $('nutBurnCard');
    if (burnSeries.length) {
      burnCard.style.display = '';
      const last7 = burnSeries.slice(-7);
      const wkBurn = last7.reduce((s, p) => s + p.y, 0);
      $('nutBurnWeek').textContent = `${E().fmt(wkBurn, 0)} kcal active across the last ${last7.length} workout day${last7.length === 1 ? '' : 's'} shown`;
      drawSpark($('nutChartBurn'), burnSeries, { color: '#FF375F', emptyText: '' });
    } else burnCard.style.display = 'none';

    // Measurement sparkline + latest-values grid.
    const mkey = $('nutMeasureSelect') ? $('nutMeasureSelect').value : 'waist';
    const mdates = Object.keys(state.measurements).sort();
    const mseries = mdates.map(d => ({ label: dayLabel(d), date: d, y: Number(state.measurements[d][mkey]) }))
      .filter(p => isFinite(p.y) && p.y > 0);
    drawSpark($('nutChartMeasure'), mseries, { color: '#BF5AF2', emptyText: 'No measurements yet' });
    const latestM = mdates.length ? state.measurements[mdates[mdates.length - 1]] : null;
    $('nutMeasureLatest').innerHTML = !latestM
      ? '<div class="nut-muted">Add waist, neck, and more from the Plan tab — history builds here.</div>'
      : `<div class="nut-statgrid">${['waist', 'neck', 'chest', 'arms', 'hips', 'thighs'].map(k =>
          latestM[k] != null ? stat(k.charAt(0).toUpperCase() + k.slice(1), E().fmt(latestM[k], 1), 'cm') : '').join('')}</div>`;
  }

  const stat = (label, val, unit) =>
    `<div class="nut-stat"><div class="nut-stat-val nut-num">${val}</div><div class="nut-stat-label">${esc(label)}${unit ? ` · ${esc(unit)}` : ''}</div></div>`;

  /* ── FOODS (sections 8/9/10/15) ───────────────────────────── */

  function renderFoods() {
    const q = ($('nutFoodSearch') ? $('nutFoodSearch').value : '').trim().toLowerCase();
    const foods = Object.values(state.foods)
      .filter(f => !q || f.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    $('nutFoodList').innerHTML = foods.length ? foods.map(f => {
      const bg = E().basisGrams(f);
      return `<div class="nut-food-row" data-food="${esc(f.id)}">
        <span class="nut-food-name">${esc(f.name)}<span class="nut-src-badge ${f.source === 'estimated' ? 'est' : ''}">${f.source === 'estimated' ? '~est' : 'package'}</span></span>
        <span class="nut-food-meta nut-num">${bg ? E().fmt(f.per100.kcal, 0) + ' kcal / ' + (f.basis === 'per100g' ? '100g' : f.basis === 'perServing' ? E().fmt(f.servingSize, 0) + 'g srv' : E().fmt(f.pieceSize, 0) + 'g pc') : 'incomplete'}</span>
        <button class="nut-food-edit" data-food="${esc(f.id)}">Edit</button>
        <button class="nut-food-del" data-food="${esc(f.id)}" aria-label="Delete">×</button>
      </div>`;
    }).join('') : `<div class="nut-empty">${q ? 'No saved foods match.' : 'No saved foods yet — add the staples you eat often (oats, whey, chicken…). Per-100 g values from the package label are all it takes.'}</div>`;

    const recipes = Object.values(state.recipes)
      .filter(r => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
    $('nutRecipeList').innerHTML = recipes.length ? recipes.map(r => {
      let per = null;
      try { per = E().perServingNutrients(r, state.foods); } catch (_) {}
      return `<div class="nut-food-row" data-recipe="${esc(r.id)}">
        <span class="nut-food-name">${esc(r.name)}</span>
        <span class="nut-food-meta nut-num">${per ? E().fmt(per.kcal, 0) + ' kcal/serving · makes ' + r.servings : 'needs attention'}</span>
        <button class="nut-recipe-log" data-recipe="${esc(r.id)}">Log</button>
        <button class="nut-food-edit" data-recipe="${esc(r.id)}">Edit</button>
        <button class="nut-food-del" data-recipe="${esc(r.id)}" aria-label="Delete">×</button>
      </div>`;
    }).join('') : `<div class="nut-empty">No recipes yet — build one from saved foods, set how many servings it makes, and log a serving in two taps.</div>`;
  }

  /* ── PLAN (sections 1/2/3/19/23) ──────────────────────────── */

  function renderPlan() {
    const p = state.profile || {};
    const g = state.goals || {};
    const a = state.activity || { mode: 'sedentary' };
    $('nutSex').value = p.sex || 'm';
    $('nutAge').value = p.age || '';
    $('nutHeight').value = p.heightCm || '';
    $('nutTargetWeight').value = p.targetWeight || '';
    $('nutBodyFat').value = p.bodyFatPct || '';
    $('nutProfileWeight').value = latestWeight() ? latestWeight().kg : (p.weight || '');

    // Activity picker.
    document.querySelectorAll('#nutActivityOpts [data-act]').forEach(b =>
      b.classList.toggle('on', a.mode === b.dataset.act));
    $('nutActivityDetail').style.display = a.mode === 'detailed' ? '' : 'none';
    if (a.detail) {
      $('nutSteps').value = a.detail.stepsPerDay || '';
      $('nutGymPerWeek').value = a.detail.gymSessionsPerWeek || '';
      $('nutGymMin').value = a.detail.gymMinutes || '';
      $('nutCardioPerWeek').value = a.detail.cardioSessionsPerWeek || '';
      $('nutCardioMin').value = a.detail.cardioMinutes || '';
      $('nutCardioInt').value = a.detail.cardioIntensity || 'moderate';
    }

    // TDEE card — every method's number, inputs, and the caveat.
    const t = targets();
    if (!t.report) {
      $('nutTdeeCard').innerHTML = '<div class="nut-muted">Fill in sex, age, height and log a weight above — the estimate appears here.</div>';
    } else {
      const r = t.report;
      const rows = r.tdee.map(row =>
        `<div class="nut-tdee-line"><span>${esc(row.label)}</span><b class="nut-num">${E().fmt(row.kcal, 0)} kcal</b></div>`).join('');
      $('nutTdeeCard').innerHTML = `
        <div class="nut-tdee-line"><span>Estimated BMR (${r.tdee.length > 1 ? 'Mifflin–St Jeor' : r.tdee[0].label})</span><b class="nut-num">${E().fmt(r.bmr.mifflin, 0)} kcal</b></div>
        ${r.bmr.katch != null ? `<div class="nut-tdee-line"><span>Estimated BMR (Katch–McArdle)</span><b class="nut-num">${E().fmt(r.bmr.katch, 0)} kcal</b></div>` : ''}
        <div class="nut-tdee-line"><span>Activity</span><b>${esc(r.activity.sourceLabel)}</b></div>
        ${r.activity.detail ? `<div class="nut-muted">= ${E().fmt(r.activity.detail.dailyExtra, 0)} kcal/day on top of BMR — ${E().fmt(r.activity.detail.stepsKcal, 0)} from steps, ${E().fmt(r.activity.detail.gymKcalPerDay, 0)} gym, ${E().fmt(r.activity.detail.cardioKcalPerDay, 0)} cardio (daily averages).</div>` : ''}
        ${rows}
        <div class="nut-tdee-line strong"><span>Recommended starting maintenance</span><b class="nut-num">${E().fmt(r.recommendedKcal, 0)} kcal/day</b></div>
        <div class="nut-muted">${esc(r.uncertaintyNote)}</div>`;
    }

    // Goal controls reflect state.
    document.querySelectorAll('#nutGoalKind [data-goal]').forEach(b =>
      b.classList.toggle('on', (g.kind || 'maintain') === b.dataset.goal));
    $('nutGoalLoseOpts').style.display = g.kind === 'lose' ? '' : 'none';
    $('nutGoalGainOpts').style.display = g.kind === 'gain' ? '' : 'none';
    $('nutGoalCustomOpts').style.display = g.kind === 'custom' ? '' : 'none';
    if (g.kind === 'custom') $('nutCustomKcal').value = g.customKcal || '';
    if (g.kind === 'lose') {
      $('nutRateSel').value = g.rateKgPerWk ? String(g.rateKgPerWk) : '';
      $('nutDeficitSel').value = g.deficitKcal ? String(g.deficitKcal) : '';
    }
    if (g.kind === 'gain') $('nutSurplusSel').value = g.surplusKcal ? String(g.surplusKcal) : (g.rateKgPerWk ? String(g.rateKgPerWk) : '');

    // Goal outcome card.
    if (!t.plan || t.plan.targetKcal == null) {
      $('nutGoalOut').innerHTML = '';
    } else {
      const gp = t.plan;
      const cur = latestWeight();
      const targetKg = Number(p.targetWeight) || 0;
      $('nutGoalOut').innerHTML = `
        <div class="nut-tdee-line strong"><span>Daily calorie target</span><b class="nut-num">${E().fmt(gp.targetKcal, 0)} kcal</b></div>
        <div class="nut-tdee-line"><span>Weekly ${gp.weeklyDeltaKcal < 0 ? 'deficit' : 'surplus'}</span><b class="nut-num">${E().fmt(Math.abs(gp.weeklyDeltaKcal), 0)} kcal</b></div>
        <div class="nut-tdee-line"><span>Expected rate</span><b class="nut-num">${gp.rateKgPerWk ? E().fmt(Math.abs(gp.rateKgPerWk), 2) + ' kg/week ' + (gp.rateKgPerWk < 0 ? 'loss' : 'gain') : '—'}</b></div>
        ${gp.weeksToTarget && cur ? `<div class="nut-tdee-line"><span>To ${E().fmt(targetKg, 1)} kg (est.)</span><b class="nut-num">≈ ${Math.ceil(gp.weeksToTarget)} weeks</b></div>` : ''}
        ${gp.warnings.map(w => `<div class="nut-warn">⚠ ${esc(w.text)}</div>`).join('')}`;
    }

    // Macro targets — editable inputs, defaults labelled as recommendation.
    const m = t.macros;
    if (m) {
      $('nutProteinTarget').placeholder = String(m.proteinRecommendation ? m.proteinRecommendation.mid : '');
      if (document.activeElement !== $('nutProteinTarget')) $('nutProteinTarget').value = (g.macroTargets && g.macroTargets.protein) || g.proteinTargetG || '';
      ['Carbs', 'Fat', 'Fiber'].forEach(k => {
        const el = $('nut' + k + 'Target');
        const key = k.toLowerCase();
        if (document.activeElement !== el) el.value = (g.macroTargets && g.macroTargets[key]) || '';
        el.placeholder = String(m[key] || '');
      });
      $('nutMacroNote').innerHTML = m.proteinSource === 'recommended' && m.proteinRecommendation
        ? `Suggested protein: <b>${m.proteinRecommendation.low}–${m.proteinRecommendation.high} g/day</b> (${m.proteinRecommendation.perKg[0]}–${m.proteinRecommendation.perKg[1]} g per kg — a training-nutrition recommendation, not a medical requirement). Leave fields empty to use the computed split.`
        : 'Leave fields empty to use the computed split.';
    }
  }

  /* ── Flows: mutate state → persist + sync → re-render ─────── */

  /* Food editor — create or edit a saved food. `editId` null = new.
     One sheet serves both; field meanings follow the package label the
     user is holding (section 7). */
  function openFoodEditor(editId) {
    const f = editId ? state.foods[editId] : null;
    sheet = { kind: 'food', editId: editId || null, mealSlot: null };
    $('nutFoodSheetTitle').textContent = f ? 'Edit food' : 'New food';
    $('nfName').value = f ? f.name : '';
    $('nfBasis').value = f ? f.basis : 'per100g';
    $('nfKcal').value = f ? f.per100.kcal || '' : '';
    $('nfProtein').value = f ? f.per100.protein || '' : '';
    $('nfCarbs').value = f ? f.per100.carbs || '' : '';
    $('nfFat').value = f ? f.per100.fat || '' : '';
    $('nfFiber').value = f ? (f.per100.fiber || '') : '';
    $('nfServing').value = f && f.servingSize || '';
    $('nfPiece').value = f && f.pieceSize || '';
    $('nfTbsp').value = f && f.tbspG || '';
    $('nfSodium').value = f && f.per100.micros && f.per100.micros.sodium_mg || '';
    $('nfBarcode').value = f && f.barcode || '';
    $('nfSource').value = f ? (f.source || 'package') : 'package';
    // Raw↔cooked conversion (section 10): stored on the food so BOTH
    // states stay loggable with conserved calories.
    $('nfRawG').value = f && f.rawToCooked ? f.rawToCooked.rawG : '';
    $('nfCookedG').value = f && f.rawToCooked ? f.rawToCooked.cookedG : '';
    syncFoodEditorBasis();
    openSheet('nutFoodSheetBg');
  }

  function syncFoodEditorBasis() {
    const b = $('nfBasis').value;
    $('nfBasisHint').textContent = b === 'per100g' ? 'Values below are per 100 g (standard package label).'
      : b === 'perServing' ? 'Values below are per ONE serving — set the serving size in grams.'
      : 'Values below are per ONE piece — set the piece weight in grams.';
    $('nfServingRow').style.display = b === 'perServing' ? '' : 'none';
    $('nfPieceRow').style.display = b === 'piece' ? '' : 'none';
  }

  function saveFoodEditor() {
    const name = $('nfName').value.trim();
    if (!name) { toast('Name the food', 'error'); return; }
    const basis = $('nfBasis').value;
    const f = {
      id: (sheet && sheet.editId) || uid(),
      name, basis, source: $('nfSource').value,
      barcode: $('nfBarcode').value.trim() || undefined, // section 15 hook — stored, looked up later
      per100: {
        kcal: num('nfKcal') || 0, protein: num('nfProtein') || 0,
        carbs: num('nfCarbs') || 0, fat: num('nfFat') || 0, fiber: num('nfFiber') || 0,
        micros: {}
      },
      ts: Date.now()
    };
    const sodium = num('nfSodium');
    if (sodium != null) f.per100.micros.sodium_mg = sodium;
    if (basis === 'perServing') {
      f.servingSize = num('nfServing');
      if (!(f.servingSize > 0)) { toast('Serving size in grams is required for per-serving foods', 'error'); return; }
    }
    if (basis === 'piece') {
      f.pieceSize = num('nfPiece');
      if (!(f.pieceSize > 0)) { toast('Piece weight in grams is required for per-piece foods', 'error'); return; }
    }
    const tbsp = num('nfTbsp'); if (tbsp != null) f.tbspG = tbsp;
    const rawG = num('nfRawG'), cookedG = num('nfCookedG');
    if (rawG != null && cookedG != null) {
      if (rawG > 0 && cookedG > 0) f.rawToCooked = { rawG, cookedG };
      else { toast('Raw and cooked weights must both be positive', 'error'); return; }
    }
    state.foods[f.id] = f;
    markDirty(`foods/${f.id}`);
    closeSheet('nutFoodSheetBg');
    toast(`${name} saved`, 'success');
    if (pendingReturnMeal) {
      // Came from the Add Food flow: bounce straight back with the new
      // food pre-selected instead of dumping the user into Foods.
      const backTo = pendingReturnMeal; pendingReturnMeal = null;
      openAddFood(backTo);
      sheet.foodId = f.id;
      renderAddFoodResults('');
    } else renderFoods();
  }

  /* Add-food sheet (Today): search saved foods → pick → quantity/unit
     → live engine preview → save to the chosen meal slot. The fast path
     of section 21 — three taps for a saved staple. */
  function openAddFood(mealSlot) {
    sheet = { kind: 'add', mealSlot, foodId: null };
    $('afSearch').value = '';
    $('afQty').value = '';
    $('afPreview').innerHTML = '<div class="nut-muted">Pick a food above, enter a quantity.</div>';
    renderAddFoodResults('');
    openSheet('nutAddSheetBg');
    setTimeout(() => $('afSearch').focus(), 120);
  }

  function renderAddFoodResults(q) {
    const query = (q || '').trim().toLowerCase();
    const matches = Object.values(state.foods)
      .filter(f => !query || f.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12);
    $('afResults').innerHTML = matches.length
      ? matches.map(f => `<button class="nut-pick ${sheet.foodId === f.id ? 'on' : ''}" data-pick="${esc(f.id)}">${esc(f.name)}</button>`).join('')
      : `<div class="nut-empty">${Object.keys(state.foods).length ? 'No saved food matches — add it from the Foods tab.' : 'No saved foods yet — add staples from the Foods tab (per-100 g from the package is enough).'}</div>`;
    syncAddPreview();
  }

  function addUnitsFor(food) {
    if (!food) return ['g'];
    const units = ['g'];
    if (food.rawToCooked) units.push('g_cooked');
    if (food.servingSize) units.push('serving');
    if (food.pieceSize) units.push('piece');
    if (food.tbspG) units.push('tbsp', 'tsp');
    units.push('kg', 'ml', 'l');
    return units;
  }

  function unitLabel(u) { return u === 'g_cooked' ? 'g (cooked)' : u; }

  function syncAddPreview() {
    const f = sheet && sheet.foodId ? state.foods[sheet.foodId] : null;
    const sel = $('afUnit');
    if (!f) { sel.innerHTML = ''; return; }
    const units = addUnitsFor(f);
    if (!units.includes(sel.value)) sel.innerHTML = units.map(u => `<option value="${u}">${unitLabel(u)}</option>`).join('');
    const qty = parseFloat($('afQty').value);
    if (!(qty > 0)) { $('afPreview').innerHTML = '<div class="nut-muted">Enter a quantity.</div>'; return; }
    try {
      const n = sel.value === 'g_cooked'
        ? E().scaleNutrients(cookedPer100Safe(f), qty / 100)
        : E().nutrientsForPortion(f, qty, sel.value);
      $('afPreview').innerHTML = `<div class="nut-preview-nums">
        <b class="nut-num">${E().fmt(n.kcal, 0)} kcal</b>
        <span>${E().fmt(n.protein, 1)} g protein</span><span>${E().fmt(n.carbs, 1)} g carbs</span>
        <span>${E().fmt(n.fat, 1)} g fat</span><span>${E().fmt(n.fiber, 1)} g fiber</span></div>
        ${f.source === 'estimated' ? '<div class="nut-muted">~ Estimated values — swap in package numbers for precision (section 14).</div>' : ''}`;
    } catch (e) {
      // A unit the food can't support surfaces as a prompt, never a guess.
      $('afPreview').innerHTML = `<div class="nut-warn">${esc(e.message)}</div>`;
    }
  }

  function cookedPer100Safe(f) {
    return E().cookedPer100(f, f.rawToCooked.rawG, f.rawToCooked.cookedG);
  }

  function saveAddFood() {
    const f = sheet && sheet.foodId ? state.foods[sheet.foodId] : null;
    if (!f) { toast('Pick a food first', 'error'); return; }
    const qty = parseFloat($('afQty').value);
    if (!(qty > 0)) { toast('Enter a quantity', 'error'); return; }
    try {
      const unit = $('afUnit').value;
      const n = unit === 'g_cooked'
        ? E().scaleNutrients(cookedPer100Safe(f), qty / 100)
        : E().nutrientsForPortion(f, qty, unit);
      const entry = {
        id: uid(), label: `${f.name} — ${E().fmt(qty, qty % 1 ? 1 : 0)}${unitLabel(unit)}`,
        kind: 'food', foodId: f.id, source: f.source || 'package',
        qty, unit, nutrients: n, ts: Date.now()
      };
      const day = dayRecord(curDate);
      (day.meals[sheet.mealSlot] = day.meals[sheet.mealSlot] || []).push(entry);
      markDirty(`days/${curDate}`);
      closeSheet('nutAddSheetBg');
      renderToday();
      toast(`${f.name} added to ${mealLabel(sheet.mealSlot)}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  /* Inline child sheet over Add Food: "add fresh" without leaving the
     logging flow. Saves via the same editor logic, then re-opens Add
     Food with the new food pre-selected. */
  let pendingReturnMeal = null;

  function openNewFoodFromAdd() {
    pendingReturnMeal = sheet ? sheet.mealSlot : null;
    closeSheet('nutAddSheetBg');
    openFoodEditor(null);
  }

  /* Recipe builder (section 9). Ingredients snapshot food ids +
     quantities; totals are derived live by the engine and cached into
     the entry's nutrient snapshot when logged. */
  function openRecipeEditor(editId) {
    const r = editId ? state.recipes[editId] : null;
    sheet = { kind: 'recipe', editId: editId || null, ingredients: r ? JSON.parse(JSON.stringify(r.ingredients)) : [] };
    $('nrName').value = r ? r.name : '';
    $('nrServings').value = r ? r.servings : 1;
    $('nrFoodPick').innerHTML = '<option value="">Add ingredient — pick a saved food…</option>' +
      Object.values(state.foods).sort((a, b) => a.name.localeCompare(b.name))
        .map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('');
    renderRecipeEditor();
    openSheet('nutRecipeSheetBg');
  }

  function renderRecipeEditor() {
    const ings = (sheet && sheet.kind === 'recipe') ? sheet.ingredients : [];
    $('nrIngredients').innerHTML = ings.length ? ings.map((ing, i) => {
      const f = state.foods[ing.foodId];
      return `<div class="nut-ing-row">
        <span>${f ? esc(f.name) : '(deleted food)'} — ${E().fmt(ing.qty, 1)} ${esc(ing.unit)}</span>
        <button class="nut-ing-del" data-ing="${i}" aria-label="Remove">×</button></div>`;
    }).join('') : '<div class="nut-muted">No ingredients yet.</div>';

    // Live totals + per-serving preview.
    const preview = { name: 'preview', servings: Math.max(1, parseFloat($('nrServings').value) || 1), ingredients: ings };
    try {
      const tot = E().recipeTotals(preview, state.foods);
      const per = E().perServingNutrients(preview, state.foods);
      $('nrTotals').innerHTML = `<div class="nut-preview-nums">
        <span>Total: <b class="nut-num">${E().fmt(tot.kcal, 0)} kcal</b></span>
        <span>Per serving: <b class="nut-num">${E().fmt(per.kcal, 0)} kcal</b> · P ${E().fmt(per.protein, 1)} · C ${E().fmt(per.carbs, 1)} · F ${E().fmt(per.fat, 1)}</span></div>`;
    } catch (_) { $('nrTotals').innerHTML = ''; }
  }

  function recipeAddIngredient() {
    const fid = $('nrFoodPick').value;
    const qty = parseFloat($('nrQty').value);
    if (!fid || !(qty > 0)) { toast('Pick a food and a quantity', 'error'); return; }
    const f = state.foods[fid];
    let unit = $('nrUnit').value;
    $('nrQty').value = '';
    (sheet.ingredients = sheet.ingredients || []).push({ foodId: fid, qty, unit });
    renderRecipeEditor();
  }

  function syncRecipeUnits() {
    const f = state.foods[$('nrFoodPick').value];
    $('nrUnit').innerHTML = (f ? addUnitsFor(f) : ['g']).map(u => `<option value="${u}">${unitLabel(u)}</option>`).join('');
  }

  function saveRecipeEditor() {
    const name = $('nrName').value.trim();
    const servings = parseFloat($('nrServings').value);
    if (!name) { toast('Name the recipe', 'error'); return; }
    if (!(servings >= 1)) { toast('How many servings does it make?', 'error'); return; }
    const ings = (sheet && sheet.ingredients) || [];
    if (!ings.length) { toast('Add at least one ingredient', 'error'); return; }
    const r = { id: (sheet && sheet.editId) || uid(), name, servings, ingredients: ings, ts: Date.now() };
    state.recipes[r.id] = r;
    markDirty(`recipes/${r.id}`);
    closeSheet('nutRecipeSheetBg');
    renderFoods();
    toast(`${name} saved`, 'success');
  }

  function openLogRecipe(recipeId, mealSlot) {
    const r = state.recipes[recipeId];
    if (!r) return;
    sheet = { kind: 'logRecipe', recipeId, mealSlot: mealSlot || 'snacks' };
    $('rlName').textContent = r.name;
    $('rlServings').value = 1;
    syncLogRecipePreview();
    openSheet('nutRecipeLogBg');
  }

  function syncLogRecipePreview() {
    const r = sheet && state.recipes[sheet.recipeId];
    if (!r) return;
    const s = parseFloat($('rlServings').value);
    if (!(s > 0)) { $('rlPreview').innerHTML = ''; return; }
    try {
      const per = E().perServingNutrients(r, state.foods);
      const n = E().scaleNutrients(per, s);
      $('rlPreview').innerHTML = `<div class="nut-preview-nums"><b class="nut-num">${E().fmt(n.kcal, 0)} kcal</b>
        <span>P ${E().fmt(n.protein, 1)} g</span><span>C ${E().fmt(n.carbs, 1)} g</span><span>F ${E().fmt(n.fat, 1)} g</span></div>`;
    } catch (e) { $('rlPreview').innerHTML = `<div class="nut-warn">${esc(e.message)}</div>`; }
  }

  function saveLogRecipe() {
    const r = sheet && state.recipes[sheet.recipeId];
    const s = parseFloat($('rlServings').value);
    if (!r || !(s > 0)) return;
    try {
      const per = E().perServingNutrients(r, state.foods);
      const entry = {
        id: uid(), label: `${r.name} — ${E().fmt(s, s % 1 ? 1 : 0)} serving${s === 1 ? '' : 's'}`,
        kind: 'recipe', recipeId: r.id, source: 'package',
        servings: s, nutrients: E().scaleNutrients(per, s), ts: Date.now()
      };
      const day = dayRecord(curDate);
      (day.meals[sheet.mealSlot] = day.meals[sheet.mealSlot] || []).push(entry);
      markDirty(`days/${curDate}`);
      closeSheet('nutRecipeLogBg');
      curSection = 'today'; render();
      toast(`${r.name} logged`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  }

  /* Weight logger (section 17). Dated entries; also feeds the app's
     legacy single-value body weight (ASCA Score etc.) through the dep
     app.js handed us — one weigh-in, every surface stays consistent. */
  function openWeightSheet() {
    $('nwDate').value = curDate;
    $('nwKg').value = state.weights[curDate] != null ? state.weights[curDate] : '';
    openSheet('nutWeightSheetBg');
    setTimeout(() => $('nwKg').focus(), 120);
  }

  function saveWeight() {
    const d = $('nwDate').value || curDate;
    const kg = num('nwKg');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { toast('Pick a valid date', 'error'); return; }
    if (kg == null) {
      delete state.weights[d];
      markDirty(`weights/${d}`);
    } else {
      if (!(kg > 20 && kg < 400)) { toast('Enter a plausible weight in kg', 'error'); return; }
      state.weights[d] = kg;
      if (state.startedWeight == null) { state.startedWeight = kg; dirty.profile = true; }
      markDirty(`weights/${d}`);
      if (deps.noteBodyWeight) deps.noteBodyWeight(kg);
    }
    closeSheet('nutWeightSheetBg');
    render();
    toast(kg == null ? 'Weigh-in removed' : 'Weight logged', 'success');
  }

  /* Measurements (section 1): dated, optional per field — only filled
     fields are stored so a waist-only check-in is fine. */
  function openMeasureSheet() {
    $('nmDate').value = W().todayStr();
    ['Waist', 'Neck', 'Chest', 'Arms', 'Hips', 'Thighs'].forEach(k => $('nm' + k).value = '');
    openSheet('nutMeasureSheetBg');
  }

  function saveMeasurements() {
    const d = $('nmDate').value || W().todayStr();
    const rec = {};
    ['waist', 'neck', 'chest', 'arms', 'hips', 'thighs'].forEach(k => {
      const v = num('nm' + k.charAt(0).toUpperCase() + k.slice(1));
      if (v != null && v > 0) rec[k] = v;
    });
    if (!Object.keys(rec).length) { toast('Fill at least one measurement', 'error'); return; }
    state.measurements[d] = rec;
    markDirty(`measurements/${d}`);
    closeSheet('nutMeasureSheetBg');
    toast('Measurements saved', 'success');
  }

  function openQuickAdd() {
    ['qaKcal', 'qaP', 'qaC', 'qaF'].forEach(id => $(id).value = '');
    openSheet('nutQuickSheetBg');
    setTimeout(() => $('qaKcal').focus(), 120);
  }

  function saveQuickAdd() {
    const kcal = num('qaKcal');
    if (!(kcal > 0)) { toast('Calories are the point of Quick Add', 'error'); return; }
    const entry = {
      id: uid(), label: `Quick add — ${E().fmt(kcal, 0)} kcal`,
      kind: 'quickAdd', source: 'package',
      nutrients: { kcal, protein: num('qaP') || 0, carbs: num('qaC') || 0, fat: num('qaF') || 0, fiber: 0, micros: {} },
      ts: Date.now()
    };
    dayRecord(curDate).quickAdds.push(entry);
    markDirty(`days/${curDate}`);
    closeSheet('nutQuickSheetBg');
    renderToday();
    toast(`${E().fmt(kcal, 0)} kcal quick-added`, 'success');
  }

  function quickAddPreset(delta) {
    const entry = {
      id: uid(), label: `Quick add — ${E().fmt(delta, 0)} kcal`, kind: 'quickAdd', source: 'package',
      nutrients: { kcal: delta, protein: 0, carbs: 0, fat: 0, fiber: 0, micros: {} }, ts: Date.now()
    };
    dayRecord(curDate).quickAdds.push(entry);
    markDirty(`days/${curDate}`);
    renderToday();
    toast(`+${delta} kcal`, 'success');
  }

  /* Plan form readers — every edit is live (section 23). */

  function saveProfileFromForm() {
    const prev = state.profile || {};
    state.profile = {
      sex: $('nutSex').value === 'f' ? 'f' : 'm',
      age: num('nutAge'), heightCm: num('nutHeight'),
      weight: num('nutProfileWeight') || (latestWeight() ? latestWeight().kg : null) || prev.weight || null,
      targetWeight: num('nutTargetWeight'),
      bodyFatPct: num('nutBodyFat')
    };
    // A weight entered in Plan also lands in the dated log for today if
    // today has no entry yet — one number, one truth.
    const w = num('nutProfileWeight');
    if (w != null && state.weights[W().todayStr()] == null) {
      state.weights[W().todayStr()] = w;
      if (state.startedWeight == null) state.startedWeight = w;
      markDirty(`weights/${W().todayStr()}`);
      if (deps.noteBodyWeight) deps.noteBodyWeight(w);
    }
    markDirty('profile');
    toast('Profile saved', 'success');
    renderPlan();
  }

  function saveActivity() { markDirty('activity'); renderPlan(); }

  function saveGoalsFromForm() {
    const kind = (state.goals && state.goals.kind) || 'maintain';
    const g = Object.assign({}, state.goals, { kind });
    if (kind === 'lose') {
      g.rateKgPerWk = parseFloat($('nutRateSel').value) || null;
      g.deficitKcal = parseFloat($('nutDeficitSel').value) || null;
      if (g.rateKgPerWk && g.deficitKcal) g.deficitKcal = null; // rate wins; UI clears the other field
    }
    if (kind === 'gain') {
      const v = $('nutSurplusSel').value;
      if (v.endsWith('kcal')) { g.surplusKcal = parseFloat(v); g.rateKgPerWk = null; }
      else { g.rateKgPerWk = parseFloat(v) || null; g.surplusKcal = null; }
    }
    if (kind === 'custom') g.customKcal = num('nutCustomKcal');
    const pt = num('nutProteinTarget'), ct = num('nutCarbsTarget'),
          ft = num('nutFatTarget'), fbt = num('nutFiberTarget');
    g.macroTargets = {};
    if (ct != null) g.macroTargets.carbs = ct;
    if (ft != null) g.macroTargets.fat = ft;
    if (fbt != null) g.macroTargets.fiber = fbt;
    if (pt != null) g.macroTargets.protein = pt;
    if (!Object.keys(g.macroTargets).length) delete g.macroTargets;
    state.goals = g;
    markDirty('goals');
    renderPlan();
  }

  /* ── Event binding ────────────────────────────────────────── */

  function bind() {
    // Section tabs.
    document.querySelectorAll('#nutSubTabs [data-nut]').forEach(b =>
      b.addEventListener('click', () => { curSection = b.dataset.nut; render(); }));

    // Date navigation — day keys are local strings; < / > walk calendar days.
    on('nutPrevDay', 'click', () => { curDate = W().addDays(curDate, -1); renderToday(); });
    on('nutNextDay', 'click', () => { curDate = W().addDays(curDate, 1); renderToday(); });

    // Quick actions.
    on('nutAddFoodBtn', 'click', () => openAddFood('snacks'));
    on('nutAddRecipeBtn', 'click', () => openLogRecipePicker());
    on('nutQuickAddBtn', 'click', openQuickAdd);
    on('nutWeightBtn', 'click', openWeightSheet);
    document.querySelectorAll('#nutQuickPresets [data-kcal]').forEach(b =>
      b.addEventListener('click', () => quickAddPreset(Number(b.dataset.kcal))));

    // Meal-level "add" + entry delete (delegated — list re-renders).
    $('nutMealList').addEventListener('click', e => {
      const add = e.target.closest('.nut-meal-add');
      if (add) { openAddFood(add.dataset.meal); return; }
      const del = e.target.closest('.nut-entry-del');
      if (del) {
        const day = state.days[curDate];
        if (day && day.meals[del.dataset.slot]) {
          day.meals[del.dataset.slot].splice(Number(del.dataset.idx), 1);
          markDirty(`days/${curDate}`); renderToday();
        }
        return;
      }
      const qd = e.target.closest('.nut-qa-del');
      if (qd) {
        const day = state.days[curDate];
        if (day) { day.quickAdds.splice(Number(qd.dataset.idx), 1); markDirty(`days/${curDate}`); renderToday(); }
        return;
      }
      const head = e.target.closest('.nut-meal-head');
      if (head && !e.target.closest('button')) { /* tap-to-collapse reserved */ }
    });
    on('nutAddMealBtn', 'click', () => {
      const name = prompt('Meal name (e.g. Pre-workout)');
      if (!name || !name.trim()) return;
      const slot = 'c_' + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24);
      state.mealNames[slot] = name.trim();
      markDirty('mealNames');
      renderToday();
    });

    // Add-food sheet.
    on('afSearch', 'input', e => renderAddFoodResults(e.target.value));
    on('afResults', 'click', e => {
      const b = e.target.closest('[data-pick]');
      if (b) { sheet.foodId = b.dataset.pick; renderAddFoodResults($('afSearch').value); }
    });
    on('afQty', 'input', syncAddPreview);
    on('afUnit', 'change', syncAddPreview);
    on('afSave', 'click', saveAddFood);
    on('afNewFood', 'click', openNewFoodFromAdd);
    ['nutAddSheetBg', 'nutFoodSheetBg', 'nutRecipeSheetBg', 'nutRecipeLogBg',
     'nutQuickSheetBg', 'nutWeightSheetBg', 'nutMeasureSheetBg', 'nutRecipePickBg']
      .forEach(id => bindSheetBackdrop(id));
    document.querySelectorAll('[data-nut-close]').forEach(b =>
      b.addEventListener('click', () => closeSheet(b.dataset.nutClose)));

    // Food editor.
    on('nfBasis', 'change', syncFoodEditorBasis);
    on('nfSave', 'click', saveFoodEditor);
    on('nutNewFoodBtn', 'click', () => openFoodEditor(null));
    on('nutFoodSearch', 'input', renderFoods);
    $('nutFoodList').addEventListener('click', e => {
      const del = e.target.closest('.nut-food-del');
      if (del) {
        const id = del.dataset.food;
        delete state.foods[id]; markDirty(`foods/${id}`);
        renderFoods(); toast('Food deleted', 'success'); return;
      }
      const ed = e.target.closest('.nut-food-edit');
      if (ed) { openFoodEditor(ed.dataset.food); return; }
      const row = e.target.closest('.nut-food-row');
      if (row) openFoodEditor(row.dataset.food);
    });
    $('nutRecipeList').addEventListener('click', e => {
      const del = e.target.closest('.nut-food-del');
      if (del) {
        const id = del.dataset.recipe;
        delete state.recipes[id]; markDirty(`recipes/${id}`);
        renderFoods(); toast('Recipe deleted', 'success'); return;
      }
      const log = e.target.closest('.nut-recipe-log');
      if (log) { openLogRecipe(log.dataset.recipe); return; }
      const ed = e.target.closest('.nut-food-edit');
      if (ed) openRecipeEditor(ed.dataset.recipe);
    });

    // Recipe builder + log sheet.
    on('nutNewRecipeBtn', 'click', () => openRecipeEditor(null));
    on('nrFoodPick', 'change', syncRecipeUnits);
    on('nrAddIng', 'click', recipeAddIngredient);
    on('nrServings', 'input', renderRecipeEditor);
    on('nrSave', 'click', saveRecipeEditor);
    $('nrIngredients').addEventListener('click', e => {
      const b = e.target.closest('.nut-ing-del');
      if (b) { sheet.ingredients.splice(Number(b.dataset.ing), 1); renderRecipeEditor(); }
    });
    on('rlServings', 'input', syncLogRecipePreview);
    on('rlSave', 'click', saveLogRecipe);

    // Quick add + weight + measurements sheets.
    on('qaSave', 'click', saveQuickAdd);
    on('nwSave', 'click', saveWeight);
    on('nmSave', 'click', saveMeasurements);
    on('nutMeasureBtn', 'click', openMeasureSheet);
    on('nutMeasureSelect', 'change', renderTrends);

    // Plan form.
    on('nutProfileSave', 'click', saveProfileFromForm);
    document.querySelectorAll('#nutActivityOpts [data-act]').forEach(b =>
      b.addEventListener('click', () => {
        state.activity = b.dataset.act === 'detailed'
          ? { mode: 'detailed', detail: readActivityDetail() }
          : { mode: b.dataset.act };
        saveActivity();
      }));
    ['nutSteps', 'nutGymPerWeek', 'nutGymMin', 'nutCardioPerWeek', 'nutCardioMin', 'nutCardioInt']
      .forEach(id => on(id, 'change', () => {
        state.activity = { mode: 'detailed', detail: readActivityDetail() };
        document.querySelectorAll('#nutActivityOpts [data-act]').forEach(b => b.classList.toggle('on', b.dataset.act === 'detailed'));
        saveActivity();
      }));
    document.querySelectorAll('#nutGoalKind [data-goal]').forEach(b =>
      b.addEventListener('click', () => {
        state.goals = Object.assign({}, state.goals, { kind: b.dataset.goal });
        markDirty('goals'); renderPlan();
      }));
    ['nutRateSel', 'nutDeficitSel', 'nutSurplusSel', 'nutCustomKcal',
     'nutProteinTarget', 'nutCarbsTarget', 'nutFatTarget', 'nutFiberTarget']
      .forEach(id => on(id, 'change', saveGoalsFromForm));
    // Choosing a rate clears the deficit box (and vice versa) so the two
    // never conflict — the engine already prefers rate when both exist.
    on('nutRateSel', 'change', () => { $('nutDeficitSel').value = ''; });
    on('nutDeficitSel', 'change', () => { $('nutRateSel').value = ''; });
  }

  function readActivityDetail() {
    return {
      stepsPerDay: num('nutSteps') || 0,
      gymSessionsPerWeek: num('nutGymPerWeek') || 0,
      gymMinutes: num('nutGymMin') || 45,
      cardioSessionsPerWeek: num('nutCardioPerWeek') || 0,
      cardioMinutes: num('nutCardioMin') || 30,
      cardioIntensity: $('nutCardioInt').value || 'moderate'
    };
  }

  // Which saved recipe to log from the Today quick action — a tiny
  // picker sheet rather than a prompt(), so names stay tappable.
  function openLogRecipePicker() {
    const recipes = Object.values(state.recipes).sort((a, b) => a.name.localeCompare(b.name));
    if (!recipes.length) { toast('No recipes yet — build one in the Foods tab', 'error'); return; }
    $('rpList').innerHTML = recipes.map(r =>
      `<button class="nut-pick wide" data-rlog="${esc(r.id)}">${esc(r.name)}</button>`).join('');
    openSheet('nutRecipePickBg');
  }

  /* ── Public surface ───────────────────────────────────────── */

  function init(d) {
    deps = d || {};
    if (deps.toast) toast = deps.toast;
    if (deps.encryptStr) encryptStr = deps.encryptStr;
    if (deps.decryptStr) decryptStr = deps.decryptStr;
    load();
    bind();
    $('nutRecipePickBg').addEventListener('click', e => {
      const b = e.target.closest('[data-rlog]');
      if (b) { closeSheet('nutRecipePickBg'); openLogRecipe(b.dataset.rlog); }
    });
    seedStarterFoods(); // offline-first: local now, cloud merges in restore()
    render();
  }

  return Object.freeze({
    init, render, flush, restore, emptyState,
    // Test seam — mirrors __arcDebug's shape so test/ui.js-style harnesses
    // can drive the tab without Firebase: state in, render, then assert DOM.
    _state: () => state,
    _openAddFood: openAddFood, _targets: targets, _observed: observedMaintenance,
    _setDate: d => { curDate = d; }
  });
})();
