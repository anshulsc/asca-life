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
      freezeCap: Math.max(0, (input.freezeCap != null ? input.freezeCap : FREEZE_CAP) | 0),
      firstDay: [...days].sort()[0] || today
    };
  }

  function factsOn(ctx, day) {
    return ctx.facts[day] || dayFacts(null, null, ctx.goals);
  }

  /* ── Streak freezes — state & chronology ───────────────────
     Everything about freezes is derived from scratch here, on every
     recompute. Pure and deterministic: no DOM, no Date.now(), the
     caller passes `now` through buildContext. */

  const FREEZE_CAP = 2;

  // Classify the blank days of the record. A THREATENING day is entirely
  // blank (zero objectives met) and sits inside — or at the open end of —
  // a real run of active days, which is exactly when an auto-spent freeze
  // has a streak to save. Days before the first active day have no run to
  // threaten and are excluded. An interior gap is threatening whenever a
  // hit follows it; the trailing edge contributes at most its newest blank
  // day (a second consecutive trailing blank breaks the run outright, and
  // an older one is unreachable behind it).
  function classifyFreezes(ctx, days, hits) {
    const n = days.length;
    const posterior = new Array(n).fill(0), anterior = new Array(n).fill(0);
    let r = 0;
    for (let i = n - 1; i >= 0; i--) { if (hits[i]) r++; posterior[i] = r; }
    let leading = 0;
    for (let i = 0; i < n; i++) { anterior[i] = leading; if (hits[i]) leading++; }

    const out = { gap: [], threatening: [], todayPending: false, trailingGap: null };
    days.forEach((d, i) => {
      if (hits[i]) return;
      if (posterior[i] > 0 && anterior[i] > 0) { out.gap.push(d); return; }
      if (d === ctx.today) { out.todayPending = true; return; }  // today pending isn't a threat
      // Newest blank of the trailing edge — the first one reached walking
      // the ascending days that has nothing but blanks after it.
      if (posterior[i] === 0 && !out.trailingGap) out.trailingGap = d;
    });
    // Threatening = interior gaps + the newest trailing blank, oldest first,
    // same order the walk below visits them in (from today backwards).
    out.threatening = out.gap.concat(out.trailingGap ? [out.trailingGap] : []);
    return out;
  }

  // One backward walk from today that both the spend rule and the streak
  // aggregator share the shape of: from the CANDIDATE blank days
  // (threatSet), collect exactly those a freeze bridges on the final
  // streak walk — active days reset the not-two-in-a-row flag. Days with
  // a manual freeze on record are marked hit BEFORE this walk runs, so
  // they always bridge (recorded intent beats the auto rules), and any
  // remaining candidate is reachable only where a manual mark didn't
  // already absorb the slot. Affordability is then enforced
  // chronologically: a spend happens only if earned freezes outnumber
  // the spends before it — and the ledger quotes what the UI shows
  // ("Freeze used Mon · 1 left").
  function walkFreezeLedger(days, hitIdx, threatSet, earnAt, cap) {
    const autoSpend = [];
    let i = days.length - 1, usedFreeze = false;
    while (i >= 0) {
      if (hitIdx.has(i)) { usedFreeze = false; i--; continue; }
      if (threatSet.has(days[i]) && !usedFreeze) { autoSpend.push(days[i]); usedFreeze = true; i--; continue; }
      i--;
    }
    autoSpend.reverse(); // oldest first
    const earnedBefore = new Array(days.length).fill(0);
    let e = 0;
    days.forEach((d, i) => {
      const earnedOn = earnAt[d] != null ? Math.min(cap, earnAt[d]) : e;
      if (earnedOn > e) e = earnedOn;
      earnedBefore[i] = e;
    });
    // Affordability, chronological: a spend only happens if the bank —
    // freezes earned through that day, minus those already spent — has
    // one to give. An empty bank breaks the streak, as it should.
    const ledger = {};
    const spent = [];
    autoSpend.forEach(d => {
      const i = days.indexOf(d);
      if (i < 0) return;
      const bank = earnedBefore[i] - spent.length;
      if (bank <= 0) return;
      ledger[d] = bank - 1; // remaining after this spend — what the UI quotes
      spent.push(d);
    });
    return { autoSpend: spent, ledger };
  }

  // Earliest day each freeze bank is earned: one per 7 CONSECUTIVE
  // perfect days, up to the cap. `runLen` is the current consecutive
  // perfect-day count; every time it passes a multiple of 7, that day
  // banks a freeze (day 8 of a 14-day run pays the second). Earns settle
  // overnight — today's contribution to the run can't pay out until
  // tomorrow — so a single recompute can never earn and spend the same
  // freeze, whether the transition happened at a midnight rollover or at
  // a check-in tap.
  function freezeEarnAt(ctx, days) {
    const cap = ctx.freezeCap;
    const earnAt = {};
    if (!cap) return earnAt;
    let earned = 0, runLen = 0, prevPerfect = false;
    days.forEach(d => {
      if (d === ctx.today) return;              // today's run settles tomorrow
      if (earned >= cap) return;
      const f = factsOn(ctx, d);
      runLen = f.perfectDay ? (prevPerfect ? runLen + 1 : 1) : 0;
      prevPerfect = !!f.perfectDay;
      if (runLen > 0 && runLen % 7 === 0) { earnAt[d] = ++earned; }
    });
    return earnAt;
  }

  // The whole freeze state, derived from scratch on every recompute —
  // this function is THE definition of "how many freezes do I have":
  //   freezesLeft   = clamp(min(cap, earned-to-date) − auto-spends, 0, cap)
  //   effectiveUsed = manual freezeUsed ∪ auto-spends that saved
  //                   (manual maps are always honoured: a manual day is
  //                   counted even where an auto-spend would refuse —
  //                   recorded intent beats the auto rules)
  // Input.freezeUsed stays accepted by buildContext for manual/external
  // records and for tests; nothing is ever written back into it.
  function freezePlan(ctx) {
    const days = daysIn(resolveWindow({ kind: 'allTime' }, ctx));
    const hits = days.map(d => factsOn(ctx, d).activeDay > 0);
    const cls = classifyFreezes(ctx, days, hits);
    const earnAt = freezeEarnAt(ctx, days);

    const manualUsed = ctx.freezeUsed || {};
    const effectiveUsed = Object.assign({}, manualUsed);

    // Indices the backward walk treats as "run continues": active days
    // plus every freeze already on record.
    const hitIdx = new Set();
    days.forEach((d, i) => { if (hits[i] || effectiveUsed[d]) hitIdx.add(i); });

    const threats = new Set(cls.threatening.filter(d => !effectiveUsed[d]));
    const walk = walkFreezeLedger(days, hitIdx, threats, earnAt, ctx.freezeCap);
    walk.autoSpend.forEach(d => { effectiveUsed[d] = true; });

    const earned = Math.min(ctx.freezeCap, Object.keys(earnAt).filter(d => d <= ctx.today).length);
    const spentTotal = Object.keys(effectiveUsed).length;
    const left = Math.max(0, Math.min(ctx.freezeCap, earned - spentTotal));

    return {
      days, hits, cls, earnAt,
      manualUsed, effectiveUsed, spentTotal, freezesLeft: left,
      // walk.autoSpend is exactly the set of NEW spends — manual days were
      // excluded from `threats`, so they can never appear in the walk.
      newSpends: walk.autoSpend,
      newSpendSet: new Set(walk.autoSpend),
      spendLedger: walk.ledger
    };
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
    // Freezes come from ctx.freezePlan().effectiveUsed when the plan is
    // cached on the context (i.e. the allTime season streak, which
    // streakState primes), or straight from ctx.freezeUsed otherwise —
    // manual marks always count, auto-spends only ever apply to the
    // season-level streak, never to per-challenge freeze windows.
    streak: (vals, def, days, ctx) => {
      const plan = ctx._frozenPlan || null;
      const frozen = d => !!(plan ? plan.effectiveUsed[d] : (def.allowFreeze && ctx.freezeUsed[d]));
      const perDay = def.perDay != null ? def.perDay : 1;
      // Auto-spent freezes (only present when the freeze plan is primed,
      // i.e. the allTime season streak) count WITHIN the run — the spend
      // exists to save it. Manual marks stay bridge-only: they keep a run
      // alive across the frozen day but the blank day itself still earns
      // nothing, which is what stops two stacked manual freezes from
      // letting the walk coast through a double gap.
      const hit = i => cmp(vals[i], def.op, perDay) ||
                       (plan ? (!!plan.newSpendSet && plan.newSpendSet.has(days[i])) : false);

      let i = days.length - 1;
      // Today is pending: if it is not yet met, start from yesterday.
      if (i >= 0 && days[i] === ctx.today && !hit(i)) i--;

      let run = 0, usedFreeze = false;
      while (i >= 0) {
        if (hit(i)) { run++; usedFreeze = false; i--; continue; }
        // One freeze may bridge a single blank day, and never two in a row.
        if (def.allowFreeze && !usedFreeze && frozen(days[i])) {
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
     on ANY objective, not on a workout. Freezes enter here via
     freezePlan(): a re-derivation of every earned/spent freeze from the
     record itself (see the block above), cached on the ctx so the streak
     aggregator below reads the SAME effective freeze map — an auto-spent
     freeze extends the streak on the very recompute that spends it.   */

  function streakState(ctx) {
    const plan = ctx._frozenPlan || freezePlan(ctx);
    ctx._frozenPlan = plan; // cached: evaluate() and summary() share one plan per ctx
    const def = { metric: 'activeDay', agg: 'streak', op: '>=', perDay: 1, allowFreeze: true };
    const all = { kind: 'allTime' };
    const cur = evaluate(Object.assign({ id: '_streak', window: all }, def), ctx);

    // Best run anywhere in the record. Same rule as the aggregator:
    // auto-spent days count inside the run (that's the point of the
    // spend); manual-only freezes bridge without counting.
    let best = 0, run = 0;
    plan.days.forEach(d => {
      if (factsOn(ctx, d).activeDay || plan.newSpendSet.has(d)) { run++; if (run > best) best = run; }
      else if (!plan.effectiveUsed[d]) run = 0;
    });

    const todayDone = factsOn(ctx, ctx.today).activeDay > 0;
    return {
      current: cur ? cur.value : 0,
      best: Math.max(best, cur ? cur.value : 0),
      todayDone,
      // "At risk" only means: you have a run going and today is still blank.
      atRisk: !todayDone && (cur ? cur.value : 0) > 0,
      lastDay: ctx.today,
      // Freeze state, fully derived — the app persists this but never
      // writes it back into the engine.
      freezesLeft: plan.freezesLeft,
      freezeUsed: plan.effectiveUsed,
      freezesEarned: Math.min(ctx.freezeCap, Object.keys(plan.earnAt).length),
      freezeCap: ctx.freezeCap,
      freezeSpends: plan.spendLedger
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

  /* ── Weekly digest ─────────────────────────────────────────
     One plain-words week-in-review, fully local. The calendar week
     (Mon→today), season-gated so days before enrolment never leak in.
     The sentence assembly stays in app.js (DOM-adjacent); this returns
     only the numbers it needs.                                       */

  function weeklyDigest(ctx) {
    const to = ctx.today;
    const from = weekStart(to);
    const days = daysIn({ from, to }).filter(d => {
      const s = ctx.season;
      return !s || (d >= s.start && d <= s.end);
    });
    const facts = days.map(d => factsOn(ctx, d));

    const workouts = facts.reduce((a, f) => a + f.workouts, 0);
    const sleepVals = facts.filter(f => f.sleepH > 0).map(f => f.sleepH);
    const sleepAvg = sleepVals.length ? sleepVals.reduce((a, b) => a + b, 0) / sleepVals.length : 0;
    const sleepDays = sleepVals.length;
    const loggedDays = facts.filter(f => f.activeDay || f.objectivesDone > 0).length;

    // Best day = most objectives met, volume as the tiebreak; null when
    // the whole week is blank.
    let bestDay = null;
    days.forEach((d, i) => {
      const f = facts[i];
      if (f.objectivesDone <= 0) return;
      if (!bestDay || f.objectivesDone > bestDay.objectivesDone ||
          (f.objectivesDone === bestDay.objectivesDone && f.volume > bestDay.volume)) {
        bestDay = { date: d, objectivesDone: f.objectivesDone, volume: f.volume };
      }
    });

    // Weakest habit = habit furthest under its goal on the days it was
    // logged; a habit never logged this week is the weakest of all.
    let weakest = null;
    HABITS.forEach(h => {
      const vals = facts.map(f => f[h.key]).filter(v => v > 0);
      const goal = ctx.goals[h.key] || h.goal || 1;
      const hit = vals.length > 0 && vals.every(v => v >= goal);
      if (hit) return;
      const avgPct = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) / goal : 0;
      if (!weakest || avgPct < weakest.avgPct) {
        weakest = { key: h.key, label: h.label, goal, avgPct: Math.round(avgPct * 100), loggedDays: vals.length };
      }
    });

    return {
      from, to, days: days.length,
      workouts, workoutsGoal: ctx.goals.workoutsPerWeek || 5,
      sleepAvg: Math.round(sleepAvg * 10) / 10, sleepGoal: ctx.goals.sleepH, sleepDays,
      loggedDays, bestDay, weakest
    };
  }

  return Object.freeze({
    // primitives (exported for tests and for app.js reuse)
    isCardioSet, setWeight, dayFacts, objectivesForDay,
    // core
    buildContext, resolveWindow, daysIn, evaluate, streakState,
    dailyXp, xpFromRecord, summary,
    // freezes + digest
    FREEZE_CAP, freezePlan, weeklyDigest,
    // data
    OBJECTIVES, AGGREGATORS, CATALOGUE, METRIC_IDS, validate, resolveDef
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ChallengeEngine;
