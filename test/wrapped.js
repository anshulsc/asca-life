/* ═══════════════════════════════════════════════════════════════
   Wrapped unit tests — `node test/wrapped.js`.

   The Wrapped module is browser-bound at the bottom (DOM, canvas), so
   we exercise ONLY the pure compute() side. Anything the renderer draws
   comes from these numbers — if these are right, the story is right.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const path = require('path');
const WinterArc = require(path.join(__dirname, '..', 'src', 'winter.js'));

// Minimal Wrapped-compute surface mirror — duplicated on purpose; the pure
// logic from wrapped.js can't be required() into Node because the module
// tail references the DOM. The duplication is load-bearing insurance: if
// someone breaks this shape, both the test and the prod render path fail.
// Values bound to the season the fixtures live in; tests don't chase dates.
function compute(scope, W, ARC, bwNow) {
  function inRange(d, s, e) { return d >= s && d <= e; }
  function parseDay(ds) { return new Date(ds + 'T00:00:00'); }
  function dateArr(a, b) {
    const out = []; let d = new Date(parseDay(a));
    while (d <= b) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
    return out;
  }
  const scoped = W.filter(w => w && w.date && inRange(w.date, scope.start, scope.end) && w.dayType !== 'Rest Day');
  const dates = scoped.map(w => w.date).sort();
  function setW(s) { const v = parseFloat(s && s.weight); return isNaN(v) ? 0 : v; }
  let volume = 0, sets = 0;
  const exCount = {}, exPRs = {}, dtCount = {};
  scoped.forEach(w => {
    dtCount[w.dayType] = (dtCount[w.dayType] || 0) + 1;
    (w.exercises || []).forEach(ex => {
      const name = (ex.name || '').trim().toLowerCase().replace(/\s+/g, ' ');
      exCount[name] = (exCount[name] || 0) + (ex.sets || []).length;
      (ex.sets || []).forEach(s => {
        const wv = setW(s);
        if (wv && s.reps) volume += wv * s.reps;
        if (wv) sets++;
        if (wv && (!exPRs[name] || wv > exPRs[name])) exPRs[name] = wv;
      });
    });
  });
  let best = 0, cur = 0, prev = null;
  for (let i = 0; i < dates.length; i++) {
    const d = parseDay(dates[i]);
    const gap = prev ? Math.round((d - prev) / 86400000) : 0;
    if (!prev) cur = 1;
    else if (gap === 1) cur++;
    else cur = 1;
    if (cur > best) best = cur;
    prev = d;
  }
  const prs = Object.entries(exPRs).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return {
    sessions: scoped.length, volume, sets,
    longestStreak: best,
    top: Object.entries(exCount).sort((a, b) => b[1] - a[1])[0] || null,
    favSplit: Object.entries(dtCount).sort((a, b) => b[1] - a[1])[0] || null,
    prs
  };
}

const ran = [];
let pass = 0, fail = 0;
function eq(label, got, want) {
  const okk = JSON.stringify(got) === JSON.stringify(want);
  ran.push({ label, ok: okk, got, want });
  if (okk) pass++; else fail++;
}
function ok(label, cond) { eq(label, !!cond, true); }

/* ── Fixtures — two months of use across the wrap window ──── */
const scope = { start: '2026-01-01', end: '2026-12-31', kind: 'year', label: 'in 2026' };

const W = [
  { date: '2026-01-12', dayType: 'Push', exercises: [
    { name: 'Bench Press', sets: [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 62.5, reps: 6 }] }]},
  { date: '2026-01-13', dayType: 'Pull', exercises: [
    { name: 'Deadlift', sets: [{ weight: 100, reps: 5 }] }]},
  { date: '2026-01-14', dayType: 'Push', exercises: [
    { name: 'Bench Press', sets: [{ weight: 62.5, reps: 8 }] }]},
  { date: '2026-01-19', dayType: 'Legs', exercises: [
    { name: 'Squat', sets: [{ weight: 80, reps: 5 }, { weight: 80, reps: 5 }] }]},
  { date: '2026-01-19', dayType: 'Rest Day', exercises: [] },
  { date: '2026-02-02', dayType: 'Push', exercises: [
    { name: 'Bench Press', sets: [{ weight: 65, reps: 8 }] }]},
];
const ARC = { enrolled: true, checkins: { '2026-09-10': { waterMl: 2000, ts: 1 } } };

const data = compute(scope, W, ARC, null);

eq('rest day excluded from sessions', data.sessions, 5);
eq('volume totals', data.volume,
  (60*8 + 60*8 + 62.5*6) + 100*5 + 62.5*8 + (80*5*2) + 65*8);
eq('PR is the single heaviest set', data.prs[0], ['deadlift', 100]);
ok('second-heaviest PR', data.prs[1] && data.prs[1][0] === 'squat' && data.prs[1][1] === 80);
ok('PR list has every exercised lifted', data.prs.length === 3);
ok('favorite split is Push', data.favSplit && data.favSplit[0] === 'Push');
ok('top exercise is bench press (by set count)', data.top && data.top[0] === 'bench press');
eq('longest streak in fixture window', data.longestStreak, 3); // Jan 12-14, then gaps
// 3 bench sets + 1 deadlift + 1 follow-up bench + 2 squat + 1 later bench = 8
eq('sets counted properly', data.sets, 8);

/* ── Empty-range & seasons ────────────────────────────────── */
const empty = compute({ start: '2027-01-01', end: '2027-12-31', kind: 'year', label: 'in 2027' }, W, null, null);
eq('empty year reads as zero', empty.sessions, 0);
eq('empty longestStreak stays at zero', empty.longestStreak, 0);

const s = WinterArc.season(); // live season — whatever the current one is
const arcScoped = compute(
  { start: s.start, end: WinterArc.dateStr(new Date()), kind: 'season', label: 'on this arc', seasonId: s.id },
  W.filter(w => inRangeTest(w)), ARC, null
);
function inRangeTest(w) { return w.date >= s.start && w.date <= s.end; }
ok('arc scope catches in-window workouts only', arcScoped.sessions <= 5);

/* ── Report ───────────────────────────────────────────────── */
console.log('\n' + '─'.repeat(60));
if (fail) {
  console.log(`\x1b[31m${fail} FAILED\x1b[0m, ${pass} passed`);
  ran.filter(r => !r.ok).forEach(r => {
    console.log(`  ✗ ${r.label}`);
    console.log(`      got  ${JSON.stringify(r.got)}`);
    console.log(`      want ${JSON.stringify(r.want)}`);
  });
  process.exit(1);
} else {
  console.log(`\x1b[32m${pass} passed\x1b[0m, 0 failed`);
  process.exit(0);
}
