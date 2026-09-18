/* ═══════════════════════════════════════════════════════════════
   Challenge engine tests — `node test/engine.js`.

   This is the highest-value test in the repo: src/challenges.js is
   where dates, windows, streaks and completion state actually live,
   and it is pure enough to test properly. Everything below builds
   synthetic workouts/checkins with plain objects and asserts against
   ChallengeEngine's pure functions — no DOM, no build step, no mocks.

   Every fixture date is computed relative to the LIVE season config
   (`day(n)` = the nth day of the current season) rather than hardcoded
   absolute dates. The season moved once already mid-project (Nov 1 ->
   Sep 1) and every hardcoded date in this file went stale at once —
   this is what fixes that permanently rather than just this once.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const path = require('path');
const WA = require(path.join(__dirname, '..', 'src', 'winter.js'));
const CE = require(path.join(__dirname, '..', 'src', 'challenges.js'));

let pass = 0, fail = 0;
const failures = [];
function eq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; return; }
  fail++;
  failures.push({ label, got, want });
}
function ok(label, cond) { eq(label, !!cond, true); }
function section(name) { console.log(`\n\x1b[1m${name}\x1b[0m`); }

/* ── Fixture builders ──────────────────────────────────────── */

const SEASON = WA.season();
// Day n of the live season, as a "YYYY-MM-DD" string (1-based, matching
// WinterArc.seasonDay's own numbering).
const day = n => WA.addDays(SEASON.start, n - 1);
// A local Date object for a day string — what CE.summary()'s `now` wants.
const dateObj = ds => WA.parseDay(ds);

function workout(date, dayType, opts) {
  opts = opts || {};
  const sets = opts.sets || [{ weight: 50, reps: 10, notes: '' }];
  return { date, dayType, exercises: dayType === 'Rest Day' ? [] : [{ name: opts.exercise || 'Bench Press', sets }] };
}

function cardioWorkout(date, mins) {
  return { date, dayType: 'Cardio', exercises: [{ name: 'Treadmill Run', sets: [{ cardio: true, mins, km: null, kcal: null }] }] };
}

function checkin(overrides) {
  return Object.assign(WA.emptyCheckin(), overrides || {});
}

// n consecutive active days ending at `endDate` (inclusive), each with a
// trivial workout — the cheapest way to build a streak fixture.
function consecutiveWorkouts(endDate, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(workout(WA.addDays(endDate, -i), 'Pull'));
  return out;
}

/* ── Empty state ───────────────────────────────────────────── */

section('empty state');
{
  const now = dateObj(day(34));
  const ctx = CE.buildContext({ workouts: [], checkins: {}, now, season: SEASON });
  eq('today resolves', ctx.today, day(34));
  const s = CE.summary({ workouts: [], checkins: {}, now, season: SEASON });
  eq('day of season', s.day, 34);
  eq('no objectives done', s.objectivesDone, 0);
  eq('streak is 0', s.streak.current, 0);
  eq('not at risk with no history', s.streak.atRisk, false);
  eq('xp is 0', s.xp, 0);
  eq('level is 1', s.level.level, 1);
  ok('every catalogue challenge evaluates without throwing',
     s.challenges.length === CE.CATALOGUE.length);
  ok('nothing is done', s.challenges.every(c => !c.done));
}

/* ── One day ───────────────────────────────────────────────── */

section('one day');
{
  const now = dateObj(day(34));
  const workouts = [workout(day(34), 'Pull', { sets: [{ weight: 60, reps: 8, notes: '' }] })];
  const checkins = { [day(34)]: checkin({ waterMl: 3000, proteinG: 140, sleepH: 7, steps: 8000, mobilityMin: 10 }) };
  const s = CE.summary({ workouts, checkins, now, season: SEASON });
  eq('all four objectives done', s.objectivesDone, 4);
  // dailyXp() = per-objective XP (move 20 + 3×10) + allObjectives bonus (25)
  // + a volume-capped effort bonus. A perfect day with a light single-set
  // workout should clear the per-objective + bonus floor of 20+30+25=75.
  ok('perfect day earns at least the per-objective + all-objectives XP', s.derivedXp >= 75);
  eq('streak is 1', s.streak.current, 1);
  ok('today counted done', s.streak.todayDone);
  eq('not at risk', s.streak.atRisk, false);
}

/* ── Streak with a gap ─────────────────────────────────────── */

section('streak with a gap (must break)');
{
  const now = dateObj(day(40));
  // active on day 40, 39, 38; GAP on day 37; active day 36, 35.
  const workouts = [day(40), day(39), day(38), day(36), day(35)]
    .map(d => workout(d, 'Push'));
  const s = CE.summary({ workouts, checkins: {}, now, season: SEASON });
  eq('streak stops at the gap', s.streak.current, 3);
  eq('best streak recorded before the gap check', s.streak.best, 3);
}

/* ── Streak saved by a freeze ──────────────────────────────── */

section('streak saved by exactly one freeze');
{
  const now = dateObj(day(40));
  const workouts = [day(40), day(39), day(37), day(36), day(35)]
    .map(d => workout(d, 'Push')); // day 38 is blank
  const s1 = CE.summary({ workouts, checkins: {}, now, season: SEASON, freezeUsed: {} });
  eq('without a freeze the run stops at the gap', s1.streak.current, 2);

  const s2 = CE.summary({ workouts, checkins: {}, now, season: SEASON, freezeUsed: { [day(38)]: true } });
  eq('with a freeze on the gap day the run bridges it', s2.streak.current, 5);
}

section('two consecutive gaps break the run even with freezes available for both');
{
  const now = dateObj(day(40));
  // active day 40, 39; blank 38, 37 (both freeze-eligible); active 36, 35 —
  // but those two older active days are on the far side of a run-breaking
  // double gap and must NOT be reachable by the walk.
  const workouts = [day(40), day(39), day(36), day(35)].map(d => workout(d, 'Push'));
  const s = CE.summary({
    workouts, checkins: {}, now, season: SEASON,
    freezeUsed: { [day(38)]: true, [day(37)]: true }
  });
  // Day 38 is bridged (one freeze, run holds at 2) but day 37 is a SECOND
  // consecutive blank day — "max one consecutive freeze" means the walk
  // stops there, before ever reaching the active day 36 / day 35.
  eq('run counts only the two days before the double gap', s.streak.current, 2);
}

section('today pending does not break an existing run');
{
  const now = new Date(dateObj(day(40)).getFullYear(), dateObj(day(40)).getMonth(), dateObj(day(40)).getDate(), 9, 0); // day 40, 9am, nothing logged yet today
  const workouts = [day(39), day(38), day(37)].map(d => workout(d, 'Push'));
  const s = CE.summary({ workouts, checkins: {}, now, season: SEASON });
  eq('yesterday\'s run still counts', s.streak.current, 3);
  eq('today not marked done', s.streak.todayDone, false);
  eq('flagged at risk', s.streak.atRisk, true);
}

/* ── Windows ───────────────────────────────────────────────── */

section('window resolution');
{
  const now = dateObj(day(34));
  const ctx = CE.buildContext({ workouts: [], checkins: {}, now, season: SEASON });
  const roll7 = CE.resolveWindow({ kind: 'rolling', days: 7 }, ctx);
  eq('rolling 7 spans exactly 7 days', CE.daysIn(roll7).length, 7);
  eq('rolling 7 ends today', roll7.to, day(34));
  eq('rolling 7 starts 6 days back', roll7.from, WA.addDays(day(34), -6));

  const week = CE.resolveWindow({ kind: 'calendarWeek' }, ctx);
  eq('calendar week starts on Monday', week.from, WA.weekStart(day(34)));

  const season = CE.resolveWindow({ kind: 'season' }, ctx);
  eq('season window starts at season start', season.from, SEASON.start);
  eq('season window is capped at today, not season end', season.to, day(34));

  const wellAfterEnd = dateObj(WA.addDays(SEASON.end, 60));
  const afterEnd = CE.buildContext({ workouts: [], checkins: {}, now: wellAfterEnd, season: SEASON });
  const seasonOver = CE.resolveWindow({ kind: 'season' }, afterEnd);
  eq('season window caps at season end once it has passed', seasonOver.to, SEASON.end);
}

/* ── Aggregators ───────────────────────────────────────────── */

section('aggregators');
{
  const now = dateObj(day(37));
  const workouts = consecutiveWorkouts(day(37), 3).map((w, i) => {
    w.exercises[0].sets = [{ weight: 40 + i * 10, reps: 10, notes: '' }];
    return w;
  });
  const ctx = CE.buildContext({ workouts, checkins: {}, now, season: SEASON });

  const sumDef = { id: 't', metric: 'volume', agg: 'sum', target: 100, window: { kind: 'rolling', days: 7 } };
  const sumR = CE.evaluate(sumDef, ctx);
  eq('sum aggregates volume across the window',
     sumR.value, (40 * 10) + (50 * 10) + (60 * 10));
  ok('sum challenge with a low target is done', sumR.done);

  const maxDef = { id: 't', metric: 'heaviest', agg: 'max', target: 55, window: { kind: 'rolling', days: 7 } };
  const maxR = CE.evaluate(maxDef, ctx);
  eq('max aggregates the best single day', maxR.value, 60);

  const daysMeetingDef = { id: 't', metric: 'workouts', agg: 'daysMeeting', op: '>=', perDay: 1, target: 3, window: { kind: 'rolling', days: 7 } };
  const dmR = CE.evaluate(daysMeetingDef, ctx);
  eq('daysMeeting counts qualifying days', dmR.value, 3);
  ok('daysMeeting reaches target', dmR.done);

  const avgDef = { id: 't', metric: 'volume', agg: 'avg', target: 100, window: { kind: 'rolling', days: 7 } };
  const avgR = CE.evaluate(avgDef, ctx);
  ok('avg is between the min and max daily volume', avgR.value > 0 && avgR.value < 600);
}

/* ── The seven named challenge types ───────────────────────── */

section('the 7 named challenge types, from CATALOGUE');
{
  // Anchored 2 days before the season ends, with a 35-day streak behind it
  // — "near the end of the season" without hardcoding a season length.
  const endAnchor = WA.addDays(SEASON.end, -2);
  const now = dateObj(endAnchor);
  const workouts = consecutiveWorkouts(endAnchor, 35);
  const s = CE.summary({ workouts, checkins: {}, now, season: SEASON });
  const byId = id => s.challenges.find(c => c.def.id === id);

  ok('30-day consistency completes on a 35-day streak', byId('wa_no_zero_30').done);
  ok('7-day streak completes', byId('wa_streak_7').done);
  ok('most-workouts-this-season has no target (a race)', byId('wa_workouts_season').target === null);
  ok('weekly strength goal evaluates', byId('wa_week_volume').value >= 0);
  ok('cardio challenge exists and evaluates', byId('wa_cardio_7').value === 0); // no cardio logged in this fixture
  ok('step challenge exists and evaluates', byId('wa_steps_week').value === 0);
  // no-zero-days is the same shape as 30-day consistency — covered above.
}

section('custom / friend-created challenge — pure data, zero new code');
{
  const custom = {
    id: 'custom_1', name: 'Bench 10000kg', desc: 'Total bench volume this month.',
    metric: 'volume', agg: 'sum', target: 10000, window: { kind: 'rolling', days: 30 }, xp: 200
  };
  eq('validates cleanly', CE.validate(custom), []);
  const anchor = day(45); // mid-season, with 19 days of season behind it — plenty of room for 20 consecutive days
  const now = dateObj(anchor);
  const workouts = consecutiveWorkouts(anchor, 20).map(w => {
    w.exercises[0].sets = [{ weight: 60, reps: 10, notes: '' }];
    return w;
  });
  const s = CE.summary({ workouts, checkins: {}, now, season: SEASON, challenges: [custom] });
  eq('only the custom challenge is evaluated when a list is passed', s.challenges.length, 1);
  ok('custom challenge tracks progress', s.challenges[0].value === 20 * 600);
}

section('validation rejects malformed challenges');
{
  ok('unknown metric rejected', CE.validate({ name: 'x', metric: 'bogus', agg: 'sum' }).length > 0);
  ok('unknown aggregator rejected', CE.validate({ name: 'x', metric: 'workouts', agg: 'bogus' }).length > 0);
  ok('missing name rejected', CE.validate({ metric: 'workouts', agg: 'sum' }).length > 0);
  ok('negative target rejected', CE.validate({ name: 'x', metric: 'workouts', agg: 'sum', target: -5 }).length > 0);
  ok('fixed window without dates rejected',
     CE.validate({ name: 'x', metric: 'workouts', agg: 'sum', target: 1, window: { kind: 'fixed' } }).length > 0);
}

/* ── Backfill, retroactive completion, lapse ───────────────── */

section('retroactive completion via backfill');
{
  const now = dateObj(day(40));
  // Only 6 consecutive days today — the 7-day streak is NOT complete yet.
  const workouts = consecutiveWorkouts(day(40), 6);
  const before = CE.summary({ workouts, checkins: {}, now, season: SEASON });
  ok('7-day streak not yet done', !before.challenges.find(c => c.def.id === 'wa_streak_7').done);

  // Backfill the missing 7th day — the run should now read 7.
  workouts.push(workout(day(34), 'Pull'));
  const after = CE.summary({ workouts, checkins: {}, now, season: SEASON });
  const c = after.challenges.find(c => c.def.id === 'wa_streak_7');
  ok('backfilling completes the streak challenge retroactively', c.done);
  eq('streak value is now 7', c.value, 7);
}

section('lapse after deleting a workout — recomputed, not clawed back');
{
  const now = dateObj(day(40));
  const full = consecutiveWorkouts(day(40), 7);
  const s1 = CE.summary({ workouts: full, checkins: {}, now, season: SEASON });
  ok('streak challenge done with all 7 days present', s1.challenges.find(c => c.def.id === 'wa_streak_7').done);

  // Delete one day from the middle — the run should re-derive to "not done".
  const withGap = full.filter(w => w.date !== day(37));
  const s2 = CE.summary({ workouts: withGap, checkins: {}, now, season: SEASON });
  ok('deleting a day un-completes the challenge on recompute',
     !s2.challenges.find(c => c.def.id === 'wa_streak_7').done);
  // The engine itself does not persist "was completed" state — that sticky
  // behaviour (keep the badge, mark it lapsed) is a caller-side concern
  // documented in the plan; this test proves the engine's half: it never
  // silently keeps reporting done=true against fresh data.
}

/* ── XP monotonicity ───────────────────────────────────────── */

section('XP is derived from the record, never incremented');
{
  const now = dateObj(day(40));
  const checkins = {};
  [day(40), day(39), day(38)].forEach(d => {
    checkins[d] = checkin({ waterMl: 3000, proteinG: 140, sleepH: 7, steps: 8000, mobilityMin: 10 });
  });
  const workouts = [day(40), day(39), day(38)].map(d => workout(d, 'Pull'));

  const s1 = CE.summary({ workouts, checkins, now, season: SEASON });
  ok('3 perfect days produce positive derived XP', s1.derivedXp > 0);

  // Delete one day entirely — XP must go DOWN, never negative, and must
  // match a from-scratch recompute exactly (no drift from incremental math,
  // because there IS no incremental math).
  const workouts2 = workouts.filter(w => w.date !== day(39));
  delete checkins[day(39)];
  const s2 = CE.summary({ workouts: workouts2, checkins, now, season: SEASON });
  ok('XP decreases after removing a day', s2.derivedXp < s1.derivedXp);
  ok('XP never negative', s2.derivedXp >= 0);

  // Recomputing on the SAME data twice must be perfectly stable.
  const s3 = CE.summary({ workouts: workouts2, checkins, now, season: SEASON });
  eq('recompute is deterministic', s3.derivedXp, s2.derivedXp);
}

/* ── Rollover boundary ─────────────────────────────────────── */

section('day-rollover boundary');
{
  // 23:59:58 on day 39 vs 00:00:02 on day 40 must resolve to different
  // "today"s and must not double- or under-count day 39's workout.
  const d39 = dateObj(day(39)), d40 = dateObj(day(40));
  const late = new Date(d39.getFullYear(), d39.getMonth(), d39.getDate(), 23, 59, 58);
  const early = new Date(d40.getFullYear(), d40.getMonth(), d40.getDate(), 0, 0, 2);
  const workouts = [workout(day(39), 'Pull')];

  const sLate = CE.summary({ workouts, checkins: {}, now: late, season: SEASON });
  eq('just before midnight, today is day 39', sLate.today, day(39));
  eq('and today is active', sLate.streak.todayDone, true);

  const sEarly = CE.summary({ workouts, checkins: {}, now: early, season: SEASON });
  eq('just after midnight, today is day 40', sEarly.today, day(40));
  eq('day 39 no longer counts as today', sEarly.streak.todayDone, false);
  eq('but still counts toward the streak (grace)', sEarly.streak.current, 1);
}

/* ── Objectives ────────────────────────────────────────────── */

section('daily objectives');
{
  const goals = WA.defaultGoals();
  const emptyFacts = CE.dayFacts(null, null, goals);
  eq('4 objectives always returned', emptyFacts._objectives.length, 4);
  eq('none done on an empty day', emptyFacts.objectivesDone, 0);

  const moveByWorkout = CE.dayFacts(workout(day(34), 'Pull'), null, goals);
  ok('move satisfied by a workout alone', moveByWorkout._objectives.find(o => o.id === 'move').done);

  const moveBySteps = CE.dayFacts(null, checkin({ steps: goals.steps }), goals);
  ok('move satisfied by steps alone (no workout needed)', moveBySteps._objectives.find(o => o.id === 'move').done);

  const moveByCardio = CE.dayFacts(cardioWorkout(day(34), 20), null, goals);
  ok('move satisfied by 20 min cardio', moveByCardio._objectives.find(o => o.id === 'move').done);

  const recoverBySleep = CE.dayFacts(null, checkin({ sleepH: goals.sleepH }), goals);
  ok('recover satisfied by sleep alone', recoverBySleep._objectives.find(o => o.id === 'recover').done);

  const recoverByMobility = CE.dayFacts(null, checkin({ mobilityMin: goals.mobilityMin }), goals);
  ok('recover satisfied by mobility alone', recoverByMobility._objectives.find(o => o.id === 'recover').done);
}

/* ── Cardio vs lifting duck-typing mirrors app.js ──────────── */

section('cardio/lifting classification');
{
  eq('a plain lifting set is not cardio', CE.isCardioSet({ weight: 50, reps: 10 }), false);
  eq('cardio:true flags a set', CE.isCardioSet({ cardio: true }), true);
  eq('mins alone flags a set as cardio', CE.isCardioSet({ mins: 20 }), true);
  eq('a cardio set contributes zero to weight', CE.setWeight({ cardio: true, mins: 20 }), 0);
  eq('level notes are parsed as weight when unset', CE.setWeight({ weight: null, notes: 'Level 6' }), 6);
  eq('warm-up sets contribute zero to weight', CE.setWeight({ weight: 100, reps: 5, setType: 'warmup' }), 0);
  eq('working/drop/failure sets still count', CE.setWeight({ weight: 100, setType: 'drop' }), 100);
}

section('arc state merge (WinterArc.mergeArcState)');
{
  const defaults = WA.defaultGoals;
  const base = {
    enrolled: false, seasonId: SEASON.id, joinedAt: 0,
    goals: { waterMl: 2000 }, checkins: {},
    xp: 0, level: 1,
    streak: { current: 0, best: 0, lastDay: '', freezesLeft: 2, freezeUsed: {} },
    badges: {}, seenBadges: {}, joinedChallenges: {}, forceJoinApplied: {}, monkMode: false
  };
  // Empty local + populated cloud -> adopt fully
  {
    const cloud = {
      active: true, joinedAt: 100, seasonId: SEASON.id,
      goals: { waterMl: 3000 },
      checkins: { [day(1)]: { waterMl: 500, ts: 10 }, [day(3)]: { waterMl: 700, ts: 30 } },
      streak: { current: 3, best: 5, lastDay: day(3), freezesLeft: 1, freezeUsed: { [day(2)]: 20 }, ts: 30 },
      badges: { day1: 10 }
    };
    const out = WA.mergeArcState(base, {}, cloud);
    ok('empty local adopts cloud enrolled', out.enrolled === true);
    eq('goals come from cloud', out.goals.waterMl, 3000);
    eq('checkins: both days taken', Object.keys(out.checkins).sort(), [day(1), day(3)].sort());
    eq('streak current from newer side', out.streak.current, 3);
    eq('best is max', out.streak.best, 5);
    eq('freeze days unioned', out.streak.freezeUsed[day(2)], 20);
    eq('badges union', out.badges.day1, 10);
  }
  // LWW per-day on checkin entry
  {
    const local = Object.assign({}, base, {
      checkins: { [day(1)]: { waterMl: 100, ts: 5 } },
      streak: { current: 1, best: 1, lastDay: day(1), freezesLeft: 2, freezeUsed: {}, ts: 5 }
    });
    const cloud = {
      active: true,
      checkins: { [day(1)]: { waterMl: 900, ts: 50 }, [day(2)]: { waterMl: 200, ts: 20 } },
      streak: { current: 2, best: 2, lastDay: day(2), freezesLeft: 2, freezeUsed: {}, ts: 20 }
    };
    const out = WA.mergeArcState(base, local, cloud);
    eq('cloud newer checkin wins the shared day', out.checkins[day(1)].waterMl, 900);
    eq('local-only fields on shared day persist via cloud object identity', out.checkins[day(1)].ts, 50);
    eq('cloud-only day arrives intact', out.checkins[day(2)].waterMl, 200);
    eq('streak.ts from newer side wins', out.streak.current, 2);
  }
  // .active false honours the "left the season" signal
  {
    const out = WA.mergeArcState(base, {}, { active: false, checkins: { [day(1)]: { ts: 1 } } });
    ok('active:false keeps user un-enrolled', out.enrolled === false);
  }
  // Null cloud -> local untouched
  {
    const local = Object.assign({}, base, { enrolled: true, xp: 42 });
    const out = WA.mergeArcState(base, local, null);
    eq('null cloud returns local untouched', out.xp, 42);
    ok('null cloud keeps enrolled', out.enrolled === true);
  }
}

/* ── Freeze earn & auto-spend (derived from scratch) ───────── */

section('freeze: earn one per perfect 7-day run, capped at 2');
{
  // A perfect day = all four objectives met (workout+steps for "move",
  // protein, water, sleep). `perfect` builds exactly that.
  const perfect = d => checkin({ steps: 8000, proteinG: 140, waterMl: 3000, sleepH: 7 });
  const perfectWeek = (endDay, n) => {
    const ws = [], cs = {};
    for (let i = 0; i < n; i++) {
      const d = WA.addDays(endDay, -i);
      ws.push(workout(d, 'Pull'));
      cs[d] = perfect(d);
    }
    return { workouts: ws, checkins: cs };
  };

  // Nothing earned on a partial record.
  {
    const now = dateObj(day(40));
    const s = CE.summary({ workouts: [workout(day(40), 'Pull')], checkins: {}, now, season: SEASON });
    eq('no perfect week, freezesLeft is 0', s.streak.freezesLeft, 0);
    eq('freeze cap is 2', s.streak.freezeCap, 2);
  }

  // Seven perfect days ending YESTERDAY — the earn settles overnight.
  {
    const now = dateObj(day(8));
    const { workouts, checkins } = perfectWeek(day(7), 7);
    const s = CE.summary({ workouts, checkins, now, season: SEASON });
    eq('seven perfect days earn one freeze', s.streak.freezesLeft, 1);
    eq('earn day is day 7', CE.freezePlan(CE.buildContext({ workouts, checkins, now, season: SEASON })).earnAt[day(7)], 1);
  }

  // ...but a run that only REACHES 7 through today's activity pays out
  // tomorrow, so the same pass can never earn-and-spend one freeze.
  {
    const now = dateObj(day(7));
    const { workouts, checkins } = perfectWeek(day(7), 7);
    const s = CE.summary({ workouts, checkins, now, season: SEASON });
    eq('run completed today has not paid out yet', s.streak.freezesLeft, 0);
  }

  // Runs do not overlap: 14 perfect days earn exactly two, at days 8 & 15.
  {
    const now = dateObj(day(16));
    const { workouts, checkins } = perfectWeek(day(15), 14);
    const s = CE.summary({ workouts, checkins, now, season: SEASON });
    eq('fourteen perfect days hit the cap', s.streak.freezesLeft, 2);
    const plan = CE.freezePlan(CE.buildContext({ workouts, checkins, now, season: SEASON }));
    eq('second earn lands at day 15', plan.earnAt[day(15)], 2);
    eq('no third earn is possible', plan.earnAt[day(8)], 1);
  }

  // A 13-day perfect run earns one, not "1.85".
  {
    const now = dateObj(day(15));
    const { workouts, checkins } = perfectWeek(day(14), 13);
    const s = CE.summary({ workouts, checkins, now, season: SEASON });
    eq('thirteen perfect days earn one', s.streak.freezesLeft, 1);
  }
}

section('freeze: auto-spend on the only day that needs saving');
{
  const perfect = d => checkin({ steps: 8000, proteinG: 140, waterMl: 3000, sleepH: 7 });

  // Perfect days 1–7 (freeze banked at day 7), blank day 8, active
  // (imperfect) day 9; "now" is day 10 with nothing logged yet — so
  // today is pending and the freeze must already be spent, streak intact.
  const now = dateObj(day(10));
  const workouts = [], checkins = {};
  for (let n = 1; n <= 7; n++) { workouts.push(workout(day(n), 'Pull')); checkins[day(n)] = perfect(day(n)); }
  workouts.push(workout(day(9), 'Push'));
  // day 8 left entirely blank — neither workout nor check-in.

  const s = CE.summary({ workouts, checkins, now, season: SEASON });
  eq('auto-spent freeze keeps the season streak alive', s.streak.current, 9);
  eq('freeze shows as spent', s.streak.freezeUsed[day(8)], true);
  // The spend is derived, not persisted: recomputing on the same record
  // must produce the identical plan, and the ledger must hold what the
  // UI quotes ("Freeze used day 8 · 0 left").
  const again = CE.summary({ workouts, checkins, now, season: SEASON });
  eq('auto-spend is deterministic on recompute', again.streak.freezeUsed, s.streak.freezeUsed);
  eq('ledger: bank was empty after the spend', s.streak.freezeSpends[day(8)], 0);
  eq('freezesLeft reports the empty bank', s.streak.freezesLeft, 0);

  // Had the bank held TWO freezes going into the gap (14 perfect days
  // earn at days 7 and 14), one spare survives the spend — and the
  // ledger for the spend day says exactly what the UI shows: "1 left".
  {
    const ws2 = [], cs2 = {};
    for (let n = 1; n <= 14; n++) { ws2.push(workout(day(n), 'Pull')); cs2[day(n)] = perfect(day(n)); }
    ws2.push(workout(day(16), 'Push'));
    // day 15 blank; now = day 17 (pending)
    const s2 = CE.summary({
      workouts: ws2, checkins: cs2, now: dateObj(day(17)), season: SEASON
    });
    eq('a spare freeze survives the auto-spend', s2.streak.freezesLeft, 1);
    eq('ledger then shows one left', s2.streak.freezeSpends[day(15)], 1);
    eq('streak bridges the gap through the freeze', s2.streak.current, 16);
  }
}

section('freeze: no earn, no spend — an empty bank cannot save a streak');
{
  const now = dateObj(day(10));
  // Active days 9–10, blank day 8, active days 5–7 — no perfect week
  // anywhere, so nothing was ever earned.
  const workouts = [9, 10, 5, 6, 7].map(n => workout(day(n), 'Pull'));
  const s = CE.summary({ workouts, checkins: {}, now, season: SEASON });
  eq('unearned freeze is never auto-spent', s.streak.freezeUsed[day(8)], undefined);
  eq('streak still breaks at the gap', s.streak.current, 2);
  eq('freezesLeft stays 0', s.streak.freezesLeft, 0);
}

section('freeze: at most two in the bank even after many perfect weeks');
{
  const now = dateObj(day(30));
  const perfect = d => checkin({ steps: 8000, proteinG: 140, waterMl: 3000, sleepH: 7 });
  const workouts = [], checkins = {};
  for (let n = 1; n <= 29; n++) { workouts.push(workout(day(n), 'Pull')); checkins[day(n)] = perfect(day(n)); }
  const s = CE.summary({ workouts, checkins, now, season: SEASON });
  eq('29 perfect days still cap at two freezes', s.streak.freezesLeft, 2);
}

/* ── Weekly digest ─────────────────────────────────────────── */

section('weekly digest — local, season-gated');
{
  const now = dateObj(day(40));           // whatever weekday that is
  const monday = WA.weekStart(day(40));
  const perfect = d => checkin({ steps: 8000, proteinG: 140, waterMl: 3000, sleepH: 8 });
  const checkins = { [monday]: perfect(monday) };
  const workouts = [workout(monday, 'Pull'), workout(WA.addDays(monday, 1), 'Push')];
  const ctx = CE.buildContext({ workouts, checkins, now, season: SEASON, goals: WA.defaultGoals() });
  const d = CE.weeklyDigest(ctx);
  eq('digest week starts Monday', d.from, monday);
  eq('digest ends today', d.to, ctx.today);
  ok('digest counts the two workouts', d.workouts === 2);
  eq('sleep avg from logged days only', d.sleepAvg, 8);
  ok('best day is the perfect Monday', d.bestDay && d.bestDay.date === monday);
  // Mobility is the one habit not logged anywhere this week.
  ok('weakest habit is the never-logged one', d.weakest && d.weakest.key === 'mobilityMin');

  // Season gate: data before the season must not inflate the digest.
  const preSeason = WA.addDays(SEASON.start, -3);
  const ctxPre = CE.buildContext({
    workouts: [workout(preSeason, 'Pull')], checkins: { [preSeason]: perfect(preSeason) },
    now: dateObj(SEASON.start), season: SEASON
  });
  const dPre = CE.weeklyDigest(ctxPre);
  eq('out-of-season workout excluded', dPre.workouts, 0);
  ok('digest window never reaches before the season',
     dPre.days >= 1 && WA.daysBetween(dPre.from, SEASON.start) <= 6 && dPre.from <= SEASON.start);
  // ...and its day list is season-gated day-for-day.
  {
    const gateDays = CE.daysIn({ from: dPre.from, to: dPre.to })
      .filter(d => d >= SEASON.start && d <= SEASON.end);
    eq('only in-season days are counted', dPre.days, gateDays.length);
  }
}

/* ── Report ────────────────────────────────────────────────── */

console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`\x1b[31m${fail} FAILED\x1b[0m, ${pass} passed\n`);
  failures.forEach(f => {
    console.log(`  \x1b[31m✗\x1b[0m ${f.label}`);
    console.log(`      got  ${JSON.stringify(f.got)}`);
    console.log(`      want ${JSON.stringify(f.want)}`);
  });
  console.log('');
  process.exit(1);
} else {
  console.log(`\x1b[32m${pass} passed\x1b[0m, 0 failed\n`);
  process.exit(0);
}
