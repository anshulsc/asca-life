/* ═══════════════════════════════════════════════════════════════
   Winter Arc test harness — `node test/run.js` from the repo root.

   The app has no test runner and no dependencies, and that is not
   going to change. But the Winter Arc engine is written as pure
   functions with no DOM and no network precisely so it CAN be
   exercised here, which is where the logic that is easy to get
   quietly wrong (dates, streaks, windows, levels) actually lives.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

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

/* ── Load the modules under test ──────────────────────────── */

const WinterArc = require(path.join(SRC, 'winter.js'));

/* Pull the two day-type maps straight out of app.js and eval them, so the
   mirror test compares against the REAL code rather than a re-typing of it.
   If app.js's originals ever change, this test starts failing — which is
   exactly what we want it to do. */
function loadAppJsDayTypeFns() {
  const src = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');

  const colorStart = src.indexOf('function dayTypeColor(dt){');
  if (colorStart === -1) throw new Error('dayTypeColor() not found in app.js — did it get renamed?');
  const colorSrc = src.slice(colorStart);
  const dayTypeColor = eval('(' + colorSrc.slice(0, colorSrc.indexOf('\n}') + 2) + ')');

  const dayCLine = src.split('\n').find(l => l.trim().startsWith('function dayC(t){'));
  if (!dayCLine) throw new Error('dayC() not found in app.js — did it get renamed?');
  const dayC = eval('(' + dayCLine.trim() + ')');

  return { dayTypeColor, dayC };
}

function loadDayTypes() {
  const dataJs = fs.readFileSync(path.join(SRC, 'data.js'), 'utf8');
  const block = dataJs.slice(dataJs.indexOf('const DAY_TYPES'));
  return eval(block.slice(block.indexOf('['), block.indexOf(']') + 1));
}

/* ── Dates ─────────────────────────────────────────────────
   The reason this file exists. Every one of these was wrong, or
   would have been wrong, under the old toISOString() approach.   */

section('dates');
const W = WinterArc;

eq('dateStr at local midnight', W.dateStr(new Date(2026, 7, 31, 0, 0, 0)), '2026-08-31');
eq('dateStr at 23:59 local', W.dateStr(new Date(2026, 7, 31, 23, 59, 59)), '2026-08-31');
eq('dateStr zero-pads', W.dateStr(new Date(2026, 0, 5)), '2026-01-05');
eq('dateStr rejects junk', W.dateStr('not a date'), '');

eq('parseDay is local, not UTC', W.parseDay('2026-08-31').getDate(), 31);
eq('parseDay rejects junk', W.parseDay('nope'), null);
eq('parseDay rejects partial', W.parseDay('2026-08'), null);

eq('addDays forward', W.addDays('2026-08-31', 1), '2026-09-01');
eq('addDays backward over new year', W.addDays('2026-01-01', -1), '2025-12-31');
eq('addDays over a leap day', W.addDays('2028-02-28', 1), '2028-02-29');
eq('addDays zero is identity', W.addDays('2026-08-31', 0), '2026-08-31');

eq('daysBetween forward', W.daysBetween('2026-08-01', '2026-08-31'), 30);
eq('daysBetween backward', W.daysBetween('2026-08-31', '2026-08-01'), -30);
eq('daysBetween same day', W.daysBetween('2026-08-31', '2026-08-31'), 0);

// DST is the classic silent killer here. Europe springs forward 2026-03-29
// and falls back 2026-10-25; a naive (b-a)/86400000 gets both of these wrong.
eq('daysBetween across spring-forward', W.daysBetween('2026-03-28', '2026-03-30'), 2);
eq('daysBetween across fall-back', W.daysBetween('2026-10-24', '2026-10-26'), 2);
eq('addDays across fall-back', W.addDays('2026-10-24', 2), '2026-10-26');
eq('addDays across spring-forward', W.addDays('2026-03-28', 2), '2026-03-30');

// 2026-08-31 is a Monday.
eq('weekStart from a Monday is itself', W.weekStart('2026-08-31'), '2026-08-31');
eq('weekStart from a Sunday looks back 6', W.weekStart('2026-09-06'), '2026-08-31');
eq('weekStart from a Wednesday', W.weekStart('2026-09-02'), '2026-08-31');

// The rollover tick must always be in the future and never more than a day out.
const mid = W.msUntilMidnight(new Date(2026, 7, 31, 23, 59, 0));
ok('msUntilMidnight is positive', mid > 0);
ok('msUntilMidnight near midnight is small', mid < 5 * 60 * 1000);
const midMorning = W.msUntilMidnight(new Date(2026, 7, 31, 0, 0, 1));
ok('msUntilMidnight at 00:00 is ~a full day', midMorning > 23 * 3600 * 1000);

/* ── Timezone regression ───────────────────────────────────
   The bug this guards against: app.js used to build day keys with
   toISOString(), which is UTC. A positive-offset zone is still on the
   PREVIOUS UTC day in the early morning; a negative-offset zone has
   already rolled to the NEXT UTC day late at night. Either way the
   streak walk started on the wrong day. Run this file under several
   TZ values (see test/all.sh) — dateStr must agree with the local
   calendar at every hour, in every zone.                            */

section(`timezone (TZ=${process.env.TZ || 'system default'})`);
{
  let mismatches = 0, utcWouldFail = 0;
  for (let h = 0; h < 24; h++) {
    const d = new Date(2026, 11, 4, h, 30, 0);
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (W.dateStr(d) !== expected) mismatches++;
    if (d.toISOString().slice(0, 10) !== expected) utcWouldFail++;
  }
  eq('dateStr matches the local calendar at all 24 hours', mismatches, 0);
  // Not an assertion — a note, so the log shows what the old code would have done.
  console.log(`   (toISOString would have been wrong for ${utcWouldFail} of 24 hours in this zone)`);

  // A day key must survive a round-trip through parseDay unchanged.
  ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31', '2028-02-29'].forEach(ds => {
    eq(`round-trip ${ds}`, W.dateStr(W.parseDay(ds)), ds);
  });
}

/* ── Season ────────────────────────────────────────────────── */

// Derived from the live season config rather than hardcoded, so this
// section never goes stale again the next time the season dates move —
// exactly what bit this file when the season shifted Nov 1 -> Sep 1.
section('season');
const SEASON = W.season();
const day34 = W.addDays(SEASON.start, 33);
const dayBeforeStart = W.addDays(SEASON.start, -1);
const dayAfterEnd = W.addDays(SEASON.end, 1);
const wellAfterEnd = W.addDays(SEASON.end, 14);

eq('season length is inclusive', W.seasonLength(), 92);
eq('first day is day 1', W.seasonDay(SEASON.start), 1);
eq('day 34', W.seasonDay(day34), 34);
eq('final day equals length', W.seasonDay(SEASON.end), 92);
eq('before the season is day 0', W.seasonDay(dayBeforeStart), 0);
eq('after the season clamps', W.seasonDay(W.addDays(SEASON.end, 90)), 92);
eq('phase before start', W.seasonPhase(dayBeforeStart), 'upcoming');
eq('phase on start day', W.seasonPhase(SEASON.start), 'active');
eq('phase on end day', W.seasonPhase(SEASON.end), 'active');
eq('phase after end', W.seasonPhase(dayAfterEnd), 'ended');
eq('daysLeft mid-season', W.daysLeft(day34), W.daysBetween(day34, SEASON.end));
eq('daysLeft never negative', W.daysLeft(wellAfterEnd), 0);

/* ── Levels ────────────────────────────────────────────────── */

section('levels');
eq('level 1 costs nothing', W.xpForLevel(1), 0);
eq('level 2 at 500', W.xpForLevel(2), 500);
eq('level 3 at 1500', W.xpForLevel(3), 1500);
eq('level 4 at 3000', W.xpForLevel(4), 3000);
eq('level 5 at 5000', W.xpForLevel(5), 5000);
eq('0 xp is level 1', W.levelForXp(0), 1);
eq('499 xp is still level 1', W.levelForXp(499), 1);
eq('500 xp is level 2', W.levelForXp(500), 2);
eq('1499 xp is still level 2', W.levelForXp(1499), 2);
eq('1500 xp is level 3', W.levelForXp(1500), 3);
eq('negative xp floors at level 1', W.levelForXp(-100), 1);

const lp = W.levelProgress(1000);
eq('levelProgress level', lp.level, 2);
eq('levelProgress into', lp.into, 500);
eq('levelProgress need', lp.need, 1000);
eq('levelProgress toNext', lp.toNext, 500);
eq('levelProgress pct', Math.round(lp.pct), 50);

// Sanity-check the curve against the intended pace: ~125 XP/day of real
// behaviour across a 92-day season should land in the 7-9 range. If a
// future XP change blows past that, this test is the tripwire.
const seasonLevel = W.levelForXp(92 * 125);
ok(`92 days at 125xp/day lands level 7-9 (got ${seasonLevel})`, seasonLevel >= 7 && seasonLevel <= 9);

/* ── Habits ────────────────────────────────────────────────── */

section('habits');
const goals = W.defaultGoals();
eq('defaultGoals covers every habit + workouts', Object.keys(goals).length, W.HABITS.length + 1);
ok('every habit has a default goal', W.HABITS.every(h => typeof goals[h.key] === 'number'));

const empty = W.emptyCheckin();
eq('empty check-in is untouched', W.checkinTouched(empty), false);
eq('empty check-in meets nothing', W.habitsMet(empty, goals), 0);
ok('empty check-in uses 0 not null (RTDB drops nulls)',
   W.HABITS.every(h => empty[h.key] === 0));

const partial = Object.assign(W.emptyCheckin(), { sleepH: 8, waterMl: 3000, proteinG: 100 });
eq('partial meets 2 of 5', W.habitsMet(partial, goals), 2);
eq('partial counts as touched', W.checkinTouched(partial), true);
eq('sleep quality alone counts as touched',
   W.checkinTouched(Object.assign(W.emptyCheckin(), { sleepQ: 4 })), true);
eq('exactly-on-target counts as met',
   W.habitsMet(Object.assign(W.emptyCheckin(), { sleepH: goals.sleepH }), goals), 1);
eq('just under target does not count',
   W.habitsMet(Object.assign(W.emptyCheckin(), { sleepH: goals.sleepH - 0.1 }), goals), 0);
eq('custom goals are respected',
   W.habitsMet(Object.assign(W.emptyCheckin(), { steps: 5000 }), Object.assign({}, goals, { steps: 4000 })), 1);
eq('habitsMet tolerates a missing check-in', W.habitsMet(null, goals), 0);

/* ── Day-type maps mirror app.js exactly ───────────────────── */

section('day-type maps mirror app.js');
const orig = loadAppJsDayTypeFns();
const dayTypeCases = [...loadDayTypes(), 'Core', 'Abs', 'Lower Body', 'HIIT Cardio',
                      'push + shoulders', 'PULL', '', 'Unknown Split'];

dayTypeCases.forEach(dt => {
  eq(`dayTypeColor("${dt}")`, W.dayTypeColor(dt), orig.dayTypeColor(dt));
  eq(`dayTypeToken("${dt}")`, W.dayTypeToken(dt), orig.dayC(dt));
});
// The originals throw on null; the mirrors are deliberately tolerant.
eq('dayTypeColor(null) falls back', W.dayTypeColor(null), '#64D2FF');
eq('dayTypeToken(null) falls back', W.dayTypeToken(null), 'other');

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
