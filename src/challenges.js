/* ═══════════════════════════════════════════════════════════════
   WINTER ARC — challenge engine

   One rule governs this file: it is PURE. No DOM, no fetch, no
   localStorage, no Date.now() of its own — `now` is always passed in.
   That is what lets `node test/engine.js` exercise it against fixtures,
   what makes a day-rollover reproducible instead of a race, and what
   would let the Swift app reimplement it verbatim later.

   Progress is always RECOMPUTED FROM SCRATCH, never incremented. There
   is no `xp += 10` anywhere. Editing or deleting a past workout simply
   re-derives, which is the only way backfill can work correctly.

   Loaded before app.js; exposes the `ChallengeEngine` global.
   ═══════════════════════════════════════════════════════════════ */
const ChallengeEngine = (() => {
  'use strict';

  const WA = (typeof WinterArc !== 'undefined') ? WinterArc : require('./winter.js');
  const { dateStr, todayStr, addDays, daysBetween, weekStart, HABITS } = WA;

  /* ── Set-level helpers ─────────────────────────────────────
     Mirrors of isCardioSet() and getSetWeightVal() in app.js. They are
     duplicated rather than imported because app.js is a closed IIFE and
     exposes neither — test/engine.js asserts the mirrors stay exact, so
     a divergence fails the build rather than quietly changing volume.  */

  function isCardioSet(s) {
    return !!s && (s.cardio === true || s.mins != null || s.km != null ||
                   s.kcal != null || s.incline != null || s.speed != null || s.hr != null);
  }

  function setWeight(s) {
    if (!s || isCardioSet(s)) return 0;
    const w = parseFloat(s.weight);
    if (!isNaN(w)) return w;
    const m = /level\s*(\d+)/i.exec(s.notes || '');
    return m ? parseFloat(m[1]) : 0;
  }

  const setReps = s => (s && !isCardioSet(s)) ? (parseInt(s.reps, 10) || 0) : 0;
  const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

  function isRest(w) { return !w || w.dayType === 'Rest Day'; }

  /* ── Per-day facts ─────────────────────────────────────────
     Every metric is a function of ONE day's data. Windowing and
     aggregation are handled separately, so adding a metric never
     touches the aggregators and vice versa.                        */

  function dayFacts(workout, checkin, goals) {
    const f = {
      workouts: 0, volume: 0, sets: 0, heaviest: 0, exercises: 0,
      cardioMins: 0, cardioKm: 0, cardioKcal: 0
    };
    if (workout && !isRest(workout)) {
      f.workouts = 1;
      (workout.exercises || []).forEach(ex => {
        f.exercises++;
        (ex.sets || []).forEach(s => {
          f.sets++;
          if (isCardioSet(s)) {
            f.cardioMins += num(s.mins);
            f.cardioKm += num(s.km);
            f.cardioKcal += num(s.kcal);
          } else {
            const w = setWeight(s);
            f.volume += w * setReps(s);
            if (w > f.heaviest) f.heaviest = w;
          }
        });
      });
    }
    HABITS.forEach(h => { f[h.key] = checkin ? num(checkin[h.key]) : 0; });
    f.sleepQ = checkin ? num(checkin.sleepQ) : 0;

    // Did the athlete write anything in the check-in note today? Backs the
    // "Lock In" discipline challenge (log one uncomfortable thing daily) —
    // deliberately just "wrote something", not a word-count threshold, so
    // the metric can't be gamed by padding but also can't be more
    // judgmental than "did you show up and write it down".
    f.discomfortLogged = (checkin && String(checkin.note || '').trim().length > 0) ? 1 : 0;

    // Objectives are themselves a metric, so "no zero days" and
    // "complete every objective for a week" are ordinary challenges.
    const obj = objectivesForDay(f, goals);
    f.objectivesDone = obj.filter(o => o.done).length;
    f.objectivesTotal = obj.length;
    f.perfectDay = (f.objectivesDone === obj.length) ? 1 : 0;
    f.activeDay = (f.objectivesDone > 0) ? 1 : 0;
    f._objectives = obj;
    return f;
  }

  /* ── Daily objectives ──────────────────────────────────────
     Exactly four, permanently. Enough to read as a plan, few enough to
     finish. A fifth habit REPLACES one; it does not extend the list.

     "Move" is deliberately satisfiable three ways, and "Recover" two.
     A rest day where you slept well and walked still counts as active —
     which is both physiologically right and the main defence against
     the all-or-nothing collapse that kills streak mechanics.          */

  const OBJECTIVES = [
    {
      id: 'move', label: 'Move', icon: 'dumbbell',
      hint: 'Train, or hit your step goal, or 15 min of cardio',
      test: (f, g) => f.workouts > 0 || f.steps >= g.steps || f.cardioMins >= 15,
      progress: (f, g) => f.workouts > 0 ? 1 : Math.max(f.steps / (g.steps || 1), f.cardioMins / 15)
    },
    {
      id: 'fuel', label: 'Fuel', icon: 'protein',
      hint: 'Reach your protein target',
      test: (f, g) => f.proteinG >= g.proteinG,
      progress: (f, g) => f.proteinG / (g.proteinG || 1)
    },
    {
      id: 'hydrate', label: 'Hydrate', icon: 'droplet',
      hint: 'Reach your water target',
      test: (f, g) => f.waterMl >= g.waterMl,
      progress: (f, g) => f.waterMl / (g.waterMl || 1)
    },
    {
      id: 'recover', label: 'Recover', icon: 'moon',
      hint: 'Sleep your target hours, or do your mobility',
      test: (f, g) => f.sleepH >= g.sleepH || f.mobilityMin >= g.mobilityMin,
      progress: (f, g) => Math.max(f.sleepH / (g.sleepH || 1), f.mobilityMin / (g.mobilityMin || 1))
    }
  ];

  function objectivesForDay(facts, goals) {
    const g = goals || WA.defaultGoals();
    return OBJECTIVES.map(o => ({
      id: o.id, label: o.label, icon: o.icon, hint: o.hint,
      done: !!o.test(facts, g),
      pct: Math.max(0, Math.min(100, o.progress(facts, g) * 100))
    }));
  }

  /* ── Context ───────────────────────────────────────────────
     Index the raw inputs once. Every evaluation below reads this, so a
     season's worth of challenges costs one pass over the data, not one
     pass per challenge.                                              */

  function buildContext(input) {
    const goals = Object.assign(WA.defaultGoals(), input.goals || {});
    const today = input.now ? dateStr(input.now) : todayStr();

    const byDate = {};
    (input.workouts || []).forEach(w => { if (w && w.date) byDate[w.date] = w; });
    const checkins = input.checkins || {};

    // Union of every day that has anything on it, plus today.
    const days = new Set([...Object.keys(byDate), ...Object.keys(checkins), today]);
    const facts = {};
    days.forEach(d => { facts[d] = dayFacts(byDate[d], checkins[d], goals); });

    return {
      today, goals, facts,
      workoutsByDate: byDate,
      checkins,
      season: input.season || WA.season(),
      freezeUsed: input.freezeUsed || {},
      firstDay: [...days].sort()[0] || today
    };
  }

  function factsOn(ctx, day) {
    return ctx.facts[day] || dayFacts(null, null, ctx.goals);
  }

  /* ── Windows ───────────────────────────────────────────────
     A window resolves to an inclusive [from, to] pair of local day
     strings. Never Date objects — string comparison is what makes DST
     and offset changes structurally unable to shift a boundary.      */

  function resolveWindow(win, ctx) {
    const to = ctx.today;
    const w = win || { kind: 'season' };
    switch (w.kind) {
      case 'rolling':      return { from: addDays(to, -(Math.max(1, w.days | 0) - 1)), to };
      case 'calendarWeek': return { from: weekStart(to), to };
      case 'fixed':        return { from: w.start, to: w.end < to ? w.end : to, hardEnd: w.end };
      case 'allTime':      return { from: ctx.firstDay, to };
      case 'season':
      default: {
        const s = ctx.season;
        if (!s) return { from: ctx.firstDay, to };
        return { from: s.start, to: s.end < to ? s.end : to, hardEnd: s.end };
      }
    }
  }

  function daysIn(range) {
    const out = [];
    if (!range.from || !range.to || range.from > range.to) return out;
    let d = range.from;
    // Guard against a malformed range spinning forever.
    for (let i = 0; i <= 2000 && d <= range.to; i++) { out.push(d); d = addDays(d, 1); }
    return out;
  }

  /* ── Aggregators ───────────────────────────────────────────
     Five, each small enough to read in one go. A challenge is a metric
     plus one of these plus a window — which is why the seven challenge
     types the product asks for need no bespoke code.                 */

  const AGGREGATORS = {
    // Total across the window.
    sum: (vals) => vals.reduce((a, b) => a + b, 0),

    // How many days met a per-day threshold.
    daysMeeting: (vals, def) => vals.filter(v => cmp(v, def.op, def.perDay != null ? def.perDay : 1)).length,

    // Best single day.
    max: (vals) => vals.reduce((a, b) => (b > a ? b : a), 0),

    // Mean across the window (days with no data count as zero).
    avg: (vals) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0),

    // The run ending at the last COMPLETED day of the window. Today is
    // pending, not failed — it only extends the run, never breaks it.
    streak: (vals, def, days, ctx) => {
      const perDay = def.perDay != null ? def.perDay : 1;
      const hit = i => cmp(vals[i], def.op, perDay);

      let i = days.length - 1;
      // Today is pending: if it is not yet met, start from yesterday.
      if (i >= 0 && days[i] === ctx.today && !hit(i)) i--;

      let run = 0, usedFreeze = false;
      while (i >= 0) {
        if (hit(i)) { run++; usedFreeze = false; i--; continue; }
        // One freeze may bridge a single blank day, and never two in a row.
        if (def.allowFreeze && ctx.freezeUsed[days[i]] && !usedFreeze) {
          usedFreeze = true; i--; continue;
        }
        break;
      }
      return run;
    }
  };

  function cmp(v, op, t) {
    switch (op) {
      case '>':  return v > t;
      case '=':  return v === t;
      case '<':  return v < t;
      case '<=': return v <= t;
      case '>=':
      default:   return v >= t;
    }
  }

  /* ── Evaluate ──────────────────────────────────────────────
     The whole public surface for a single challenge.                 */

  function evaluate(def, ctx) {
    if (!def || !def.metric) return null;
    if (!AGGREGATORS[def.agg]) return null;

    const range = resolveWindow(def.window, ctx);
    const days = daysIn(range);
    const vals = days.map(d => num(factsOn(ctx, d)[def.metric]));

    const value = AGGREGATORS[def.agg](vals, def, days, ctx);
    const target = (def.target == null) ? null : num(def.target);

    // A null target means a pure race (rank by value), not a threshold.
    const pct = target ? Math.max(0, Math.min(100, (value / target) * 100)) : 0;
    const done = target != null && value >= target;

    // The first day the target was reached — used for the "Completed on"
    // chip and to keep a completion sticky across later edits.
    let doneOn = null;
    if (done && def.agg === 'sum') {
      let run = 0;
      for (let i = 0; i < days.length; i++) {
        run += vals[i];
        if (run >= target) { doneOn = days[i]; break; }
      }
    } else if (done) {
      doneOn = range.to;
    }

    const expired = !!range.hardEnd && ctx.today > range.hardEnd;

    return {
      id: def.id, value, target, pct, done, doneOn, expired,
      daysLeft: range.hardEnd ? Math.max(0, daysBetween(ctx.today, range.hardEnd)) : null,
      from: range.from, to: range.to,
      series: vals,
      days
    };
  }

  /* ── Streak ────────────────────────────────────────────────
     The season-level streak, separate from any challenge. A day counts
     on ANY objective, not on a workout.                              */

  function streakState(ctx) {
    const def = { metric: 'activeDay', agg: 'streak', op: '>=', perDay: 1, allowFreeze: true };
    const all = { kind: 'allTime' };
    const cur = evaluate(Object.assign({ id: '_streak', window: all }, def), ctx);

    // Best run anywhere in the record.
    const days = daysIn(resolveWindow(all, ctx));
    let best = 0, run = 0;
    days.forEach(d => {
      if (factsOn(ctx, d).activeDay) { run++; if (run > best) best = run; }
      else if (!ctx.freezeUsed[d]) run = 0;
    });

    const todayDone = factsOn(ctx, ctx.today).activeDay > 0;
    return {
      current: cur ? cur.value : 0,
      best: Math.max(best, cur ? cur.value : 0),
      todayDone,
      // "At risk" only means: you have a run going and today is still blank.
      atRisk: !todayDone && (cur ? cur.value : 0) > 0,
      lastDay: ctx.today
    };
  }

  /* ── XP ────────────────────────────────────────────────────
     Derived from the record, so it self-corrects when data is edited.
     Challenge awards are added by the caller and are monotone: a badge
     is never revoked for a data correction.                          */

  function dailyXp(facts) {
    const X = WA.XP;
    const objectives = facts._objectives || [];
    let xp = 0;
    objectives.forEach(o => { if (o.done) xp += (o.id === 'move' ? 20 : 10); });
    if (objectives.length && facts.objectivesDone === objectives.length) xp += X.allObjectives;
    // Effort bonus, capped so a single heavy session can't dominate a week.
    xp += Math.min(30, Math.floor(facts.volume / 1500));
    return xp;
  }

  function xpFromRecord(ctx) {
    let total = 0;
    daysIn(resolveWindow({ kind: 'allTime' }, ctx)).forEach(d => { total += dailyXp(factsOn(ctx, d)); });
    return total;
  }

  /* ── Catalogue ─────────────────────────────────────────────
     Built-in challenges are plain data, and a friend-created challenge
     uses the identical shape — which is why "custom challenges" needs
     no new code, only a form and a validator.                        */

  const CATALOGUE = [
    { id: 'wa_no_zero_30', cat: 'consistency', name: '30 Days, No Zeros', icon: 'flame',
      desc: 'Complete at least one objective every day for 30 days.',
      metric: 'activeDay', agg: 'streak', op: '>=', perDay: 1, target: 30,
      window: { kind: 'season' }, allowFreeze: true, xp: 600, badge: 'no_zero_30', scope: 'seasonal' },

    { id: 'wa_streak_7', cat: 'consistency', name: '7-Day Streak', icon: 'flame',
      desc: 'Seven days in a row with something logged.',
      metric: 'activeDay', agg: 'streak', op: '>=', perDay: 1, target: 7,
      window: { kind: 'season' }, allowFreeze: true, xp: 150, badge: 'streak_7', scope: 'weekly' },

    { id: 'wa_workouts_season', cat: 'workouts', name: 'Most Workouts', icon: 'dumbbell',
      desc: 'Log as many sessions as you can this season.',
      metric: 'workouts', agg: 'sum', target: null,
      window: { kind: 'season' }, mode: 'versus', xp: 0, scope: 'seasonal' },

    { id: 'wa_week_volume', cat: 'strength', name: 'Weekly Strength Goal', icon: 'weight',
      desc: 'Move 40,000 kg of total volume this week.',
      metric: 'volume', agg: 'sum', target: 40000,
      window: { kind: 'calendarWeek' }, xp: 150, badge: 'iron_week', scope: 'weekly' },

    { id: 'wa_cardio_7', cat: 'cardio', name: 'Cardio 150', icon: 'heart',
      desc: '150 minutes of cardio in seven days.',
      metric: 'cardioMins', agg: 'sum', target: 150,
      window: { kind: 'rolling', days: 7 }, xp: 150, badge: 'cardio_150', scope: 'weekly' },

    { id: 'wa_steps_week', cat: 'cardio', name: 'Step Challenge', icon: 'steps',
      desc: '70,000 steps in seven days.',
      metric: 'steps', agg: 'sum', target: 70000,
      window: { kind: 'rolling', days: 7 }, xp: 150, badge: 'steps_70k', scope: 'weekly' },

    { id: 'wa_hydrate_7', cat: 'hydration', name: 'Hydration Week', icon: 'droplet',
      desc: 'Hit your water target seven days running.',
      metric: 'waterMl', agg: 'streak', op: '>=', perDay: null, target: 7,
      window: { kind: 'season' }, allowFreeze: false, xp: 120, badge: 'hydration_7', scope: 'weekly' },

    { id: 'wa_sleep_7', cat: 'recovery', name: 'Sleep Debt Cleared', icon: 'moon',
      desc: 'Meet your sleep target on seven days this month.',
      metric: 'sleepH', agg: 'daysMeeting', op: '>=', perDay: null, target: 7,
      window: { kind: 'rolling', days: 30 }, xp: 120, badge: 'sleep_7', scope: 'weekly' },

    { id: 'wa_mobility_10', cat: 'mobility', name: 'Ten Days Loose', icon: 'stretch',
      desc: 'Do your mobility work on ten days this season.',
      metric: 'mobilityMin', agg: 'daysMeeting', op: '>=', perDay: null, target: 10,
      window: { kind: 'season' }, xp: 150, badge: 'mobility_10', scope: 'seasonal' },

    { id: 'wa_protein_14', cat: 'nutrition', name: 'Protein Fortnight', icon: 'protein',
      desc: 'Reach your protein target on fourteen days this season.',
      metric: 'proteinG', agg: 'daysMeeting', op: '>=', perDay: null, target: 14,
      window: { kind: 'season' }, xp: 200, badge: 'protein_14', scope: 'seasonal' },

    { id: 'wa_perfect_5', cat: 'discipline', name: 'Five Perfect Days', icon: 'star',
      desc: 'Complete all four objectives on five days.',
      metric: 'perfectDay', agg: 'daysMeeting', op: '>=', perDay: 1, target: 5,
      window: { kind: 'season' }, xp: 250, badge: 'perfect_5', scope: 'seasonal' },

    { id: 'wa_season_finish', cat: 'season', name: 'Finish the Arc', icon: 'summit',
      desc: 'Stay active for 60 days of the season.',
      metric: 'activeDay', agg: 'daysMeeting', op: '>=', perDay: 1, target: 60,
      window: { kind: 'season' }, xp: 1000, badge: 'arc_complete', scope: 'seasonal' },

    // The whole-cohort discipline challenge: one uncomfortable thing,
    // logged, every day of the season. Dates are explicit rather than
    // `window:{kind:'season'}` so the start date is unambiguous wherever
    // this descriptor is read — the UI, a debug dump, a future export —
    // even if the season object it launched alongside later changes.
    { id: 'wa_lockin_daily', cat: 'discipline', name: 'Lock In', icon: 'flame',
      desc: 'One genuinely uncomfortable thing, every day. Write it in your check-in note — no excuses. Sep 1 – Dec 1.',
      metric: 'discomfortLogged', agg: 'streak', op: '>=', perDay: 1, target: 92,
      window: { kind: 'fixed', start: '2026-09-01', end: '2026-12-01' },
      allowFreeze: true, xp: 500, badge: 'lockin_92', scope: 'seasonal' }
  ];

  /* A per-day threshold of `null` means "use the athlete's own goal for
     this metric" — so the hydration and sleep challenges scale with the
     targets they set during onboarding rather than a hard-coded number. */
  function resolveDef(def, ctx) {
    if (def.perDay !== null || !def.metric) return def;
    const g = ctx.goals[def.metric];
    return (g == null) ? def : Object.assign({}, def, { perDay: g });
  }

  /* ── Validation ────────────────────────────────────────────
     A friend-created challenge is untrusted data from another account.
     It is validated against the registries before it is ever evaluated
     or rendered.                                                      */

  const METRIC_IDS = ['workouts', 'volume', 'sets', 'heaviest', 'exercises',
    'cardioMins', 'cardioKm', 'cardioKcal', 'activeDay', 'perfectDay',
    'objectivesDone', 'sleepQ', 'discomfortLogged'].concat(HABITS.map(h => h.key));

  function validate(def) {
    const errs = [];
    if (!def || typeof def !== 'object') return ['not an object'];
    if (!def.name || String(def.name).length > 60) errs.push('name must be 1-60 characters');
    if (def.desc && String(def.desc).length > 200) errs.push('description must be under 200 characters');
    if (METRIC_IDS.indexOf(def.metric) === -1) errs.push(`unknown metric "${def.metric}"`);
    if (!AGGREGATORS[def.agg]) errs.push(`unknown aggregator "${def.agg}"`);
    if (def.target != null && (!isFinite(def.target) || def.target <= 0)) errs.push('target must be a positive number');
    const kinds = ['rolling', 'calendarWeek', 'season', 'fixed', 'allTime'];
    if (def.window && kinds.indexOf(def.window.kind) === -1) errs.push(`unknown window "${def.window.kind}"`);
    if (def.window && def.window.kind === 'fixed' && !(def.window.start && def.window.end)) {
      errs.push('a fixed window needs a start and an end');
    }
    return errs;
  }

  /* ── Summary ───────────────────────────────────────────────
     One call for everything the Arc dashboard renders.               */

  function summary(input) {
    const ctx = buildContext(input);
    const today = factsOn(ctx, ctx.today);
    const defs = (input.challenges && input.challenges.length) ? input.challenges : CATALOGUE;

    const challenges = defs
      .map(d => {
        const r = evaluate(resolveDef(d, ctx), ctx);
        return r ? Object.assign({ def: d }, r) : null;
      })
      .filter(Boolean);

    const streak = streakState(ctx);
    const derivedXp = xpFromRecord(ctx);
    const awardXp = challenges.reduce((a, c) => a + (c.done ? (c.def.xp || 0) : 0), 0);
    const xp = derivedXp + awardXp;

    const s = ctx.season;
    return {
      today: ctx.today,
      season: s,
      day: s ? WA.seasonDay(ctx.today, s.id) : 0,
      seasonLength: s ? WA.seasonLength(s.id) : 0,
      phase: s ? WA.seasonPhase(ctx.today, s.id) : 'none',
      daysLeft: s ? WA.daysLeft(ctx.today, s.id) : 0,
      objectives: today._objectives,
      objectivesDone: today.objectivesDone,
      objectivesTotal: today.objectivesTotal,
      facts: today,
      streak,
      xp,
      derivedXp,
      awardXp,
      level: WA.levelProgress(xp),
      challenges,
      badges: challenges.filter(c => c.done && c.def.badge).map(c => c.def.badge)
    };
  }

  return Object.freeze({
    // primitives (exported for tests and for app.js reuse)
    isCardioSet, setWeight, dayFacts, objectivesForDay,
    // core
    buildContext, resolveWindow, daysIn, evaluate, streakState,
    dailyXp, xpFromRecord, summary,
    // data
    OBJECTIVES, AGGREGATORS, CATALOGUE, METRIC_IDS, validate, resolveDef
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChallengeEngine;
