/* ═══════════════════════════════════════════════════════════════
   WINTER ARC — season, theme and shared primitives
   Loaded before app.js; exposes the `WinterArc` global.
   ═══════════════════════════════════════════════════════════════ */
const WinterArc = (() => {
  'use strict';

  /* ── Local dates ───────────────────────────────────────────
     Everything in this app keys off a local "YYYY-MM-DD" string:
     workout.date, the RTDB workouts map, the heatmap grids. The one
     place that reached for toISOString() — the streak walk — was
     silently wrong at every positive UTC offset, because
     `new Date()` at local midnight stringifies to the PREVIOUS day
     in UTC. So there is exactly one date formatter, it is local,
     and every window boundary is a string comparison rather than
     Date arithmetic (which makes DST structurally unable to bite).  */

  function dateStr(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '';
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${dt.getFullYear()}-${m}-${day}`;
  }

  function todayStr() {
    return dateStr(new Date());
  }

  // Parse a "YYYY-MM-DD" into a LOCAL midnight Date. `new Date('2026-08-31')`
  // parses as UTC midnight; the explicit 'T00:00:00' suffix is what makes it
  // local, and the rest of the app already relies on that trick.
  function parseDay(ds) {
    if (typeof ds !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ds)) return null;
    const d = new Date(ds + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  // Calendar-day arithmetic on the string form. setDate() handles month
  // and year rollover, and DST never shifts the *date* because we only
  // ever read the local Y/M/D back out.
  function addDays(ds, n) {
    const d = parseDay(ds);
    if (!d) return '';
    d.setDate(d.getDate() + n);
    return dateStr(d);
  }

  // Whole calendar days from `a` to `b` (b - a). Computed by normalising
  // both to local noon first, so a DST transition inside the span can't
  // round the division to the wrong integer.
  function daysBetween(a, b) {
    const da = parseDay(a), db = parseDay(b);
    if (!da || !db) return 0;
    da.setHours(12, 0, 0, 0);
    db.setHours(12, 0, 0, 0);
    return Math.round((db - da) / 86400000);
  }

  // Monday-start week, matching renderWeeklyRing()'s existing convention.
  function weekStart(ds) {
    const d = parseDay(ds || todayStr());
    if (!d) return '';
    const dow = d.getDay();                 // 0 = Sunday
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return dateStr(d);
  }

  // Milliseconds until the next local midnight — the day-rollover tick.
  // "Day 34 of 90", streak-at-risk and the daily objectives are all
  // relative to today, so they go stale in a tab left open overnight.
  function msUntilMidnight(now) {
    const n = now instanceof Date ? new Date(now.getTime()) : new Date();
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 2, 0);
    return Math.max(1000, next - n);
  }

  /* ── Season ────────────────────────────────────────────────
     A season is pure data so a future Summer Arc is a new entry,
     not a new code path. Dates are inclusive local day strings.   */

  const SEASONS = {
    'winter-2026': {
      id: 'winter-2026',
      name: 'Winter Arc',
      start: '2026-09-01',
      end: '2026-12-01',
      tagline: 'Ninety-two days. Keep the fire lit.'
    }
  };

  const CURRENT_SEASON = 'winter-2026';

  function season(id) {
    return SEASONS[id || CURRENT_SEASON] || null;
  }

  function seasonLength(id) {
    const s = season(id);
    return s ? daysBetween(s.start, s.end) + 1 : 0;
  }

  // Which day of the season `ds` is: 1-based, 0 before the start,
  // clamped to the length after the end.
  function seasonDay(ds, id) {
    const s = season(id);
    if (!s) return 0;
    const day = daysBetween(s.start, ds || todayStr()) + 1;
    if (day < 1) return 0;
    return Math.min(day, seasonLength(id));
  }

  function seasonPhase(ds, id) {
    const s = season(id);
    if (!s) return 'none';
    const d = ds || todayStr();
    if (d < s.start) return 'upcoming';
    if (d > s.end) return 'ended';
    return 'active';
  }

  function daysLeft(ds, id) {
    const s = season(id);
    if (!s) return 0;
    return Math.max(0, daysBetween(ds || todayStr(), s.end));
  }

  /* ── Levels ────────────────────────────────────────────────
     Triangular curve: level n costs 500·n, so the running total to
     REACH level n is 500·n·(n+1)/2 — 500, 1500, 3000, 5000, 7500…
     At the ~125 XP/day a committed athlete earns from real behaviour,
     a 92-day season lands around level 8-9. Visible movement early,
     no runaway inflation late.                                    */

  const XP_PER_LEVEL_STEP = 500;

  function xpForLevel(n) {
    if (n <= 1) return 0;
    const k = n - 1;
    return XP_PER_LEVEL_STEP * k * (k + 1) / 2;
  }

  function levelForXp(xp) {
    const x = Math.max(0, Number(xp) || 0);
    let n = 1;
    while (xpForLevel(n + 1) <= x) n++;
    return n;
  }

  // Everything the XP bar needs, in one call.
  function levelProgress(xp) {
    const x = Math.max(0, Number(xp) || 0);
    const level = levelForXp(x);
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    const span = next - base;
    return {
      level,
      xp: x,
      into: x - base,
      need: span,
      toNext: next - x,
      pct: span > 0 ? Math.min(100, ((x - base) / span) * 100) : 100
    };
  }

  const XP = {
    workout: 50,
    habitGoal: 10,          // per habit, capped by HABITS.length
    allObjectives: 25,
    weeklyChallenge: 150,
    seasonalChallenge: 500,
    personalRecord: 30,
    streakMilestone: 100
  };

  const STREAK_MILESTONES = [7, 14, 30, 60, 90];

  /* ── Habits ────────────────────────────────────────────────
     The five numeric check-in fields. `goal` is the default target a
     new athlete is offered during onboarding; each is overridable.
     `dir: 'min'` means "at least this much" — every habit here is a
     floor, but stating it keeps the comparison out of the UI code.   */

  const HABITS = [
    { key: 'sleepH',      label: 'Sleep',    unit: 'h',    goal: 7,    dir: 'min', step: 0.5, max: 14,    icon: 'moon' },
    { key: 'waterMl',     label: 'Water',    unit: 'ml',   goal: 3000, dir: 'min', step: 250, max: 8000,  icon: 'droplet' },
    { key: 'proteinG',    label: 'Protein',  unit: 'g',    goal: 140,  dir: 'min', step: 10,  max: 500,   icon: 'protein' },
    { key: 'steps',       label: 'Steps',    unit: '',     goal: 8000, dir: 'min', step: 500, max: 100000, icon: 'steps' },
    { key: 'mobilityMin', label: 'Mobility', unit: 'min',  goal: 10,   dir: 'min', step: 5,   max: 240,   icon: 'stretch' }
  ];

  // Sleep quality is a 1-5 dot rating, not a goal — it is context for the
  // charts, never something you can fail.
  const SLEEP_QUALITY_MAX = 5;

  function defaultGoals() {
    const g = { workoutsPerWeek: 5 };
    HABITS.forEach(h => { g[h.key] = h.goal; });
    return g;
  }

  // An empty check-in. Zeros rather than nulls: RTDB drops nulls, so a
  // null field would vanish on the round-trip and read back undefined.
  // sleepStart/sleepEnd are "HH:MM" clock times (empty string = unset) —
  // separate from sleepH (the numeric hours HABITS already tracks and
  // that objectives/challenges evaluate against). When both times are
  // set, computeSleepHours() below derives sleepH automatically.
  function emptyCheckin() {
    const c = { sleepQ: 0, sleepStart: '', sleepEnd: '', note: '', ts: 0 };
    HABITS.forEach(h => { c[h.key] = 0; });
    return c;
  }

  // Hours between two "HH:MM" clock times, handling the overnight wrap a
  // bedtime→wake pair almost always needs (23:30 → 06:15 is 6.75h, not
  // negative). Returns null if either time is missing or malformed —
  // callers keep whatever sleepH was already there rather than zeroing it.
  function computeSleepHours(start, end) {
    const m = t => {
      const mm = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
      if (!mm) return null;
      const h = parseInt(mm[1], 10), min = parseInt(mm[2], 10);
      if (h > 23 || min > 59) return null;
      return h * 60 + min;
    };
    const a = m(start), b = m(end);
    if (a == null || b == null) return null;
    let diff = b - a;
    if (diff <= 0) diff += 24 * 60; // crossed midnight
    return Math.round((diff / 60) * 4) / 4; // nearest quarter-hour
  }

  // How many habit goals a given day met — the unit XP is paid in, and
  // half of what makes a day "active".
  function habitsMet(checkin, goals) {
    if (!checkin) return 0;
    const g = goals || defaultGoals();
    let n = 0;
    HABITS.forEach(h => {
      const target = Number(g[h.key]) || h.goal;
      if ((Number(checkin[h.key]) || 0) >= target) n++;
    });
    return n;
  }

  // Did anything at all get logged on this day?
  function checkinTouched(checkin) {
    if (!checkin) return false;
    if (Number(checkin.sleepQ) > 0) return true;
    return HABITS.some(h => (Number(checkin[h.key]) || 0) > 0);
  }

  /* ── Day-type colours ──────────────────────────────────────
     app.js has TWO day-type mappings — dayTypeColor() for inline hexes
     and dayC() for CSS class tokens — and they do not agree: dayTypeColor
     has no 'shoulders' branch (Shoulders falls through to cyan) while
     dayC does, and they split 'upper' differently. A third map in
     renderHist (`cL`) looks similar but is a DIFFERENT domain — it keys
     off findG(exercise.name), i.e. muscle groups, not day types.

     So these are deliberately NOT consolidated. Both helpers below are
     exact behavioural mirrors of the app.js originals, so new Arc UI
     matches the rest of the app today, and app.js can later delegate to
     them as a provable no-op refactor. Reconciling the disagreement is a
     visual decision, not a cleanup — leave it to its own change.        */

  // Mirrors dayTypeColor() at app.js:1342 exactly, branch order included.
  function dayTypeColor(dt) {
    const s = String(dt || '').toLowerCase();
    if (s.includes('cardio')) return '#FF375F';
    if (s.includes('push')) return '#FF7600';
    if (s.includes('pull')) return '#0A84FF';
    if (s.includes('leg') || s.includes('lower')) return '#BF5AF2';
    if (s.includes('upper') || s.includes('full')) return '#30D158';
    return '#64D2FF';
  }

  // Mirrors dayC() at app.js:2695 exactly. Returns the token used by the
  // .badge-* / .tl-* CSS classes, which is a different mapping again.
  function dayTypeToken(dt) {
    const s = String(dt || '').toLowerCase();
    if (s.includes('cardio')) return 'cardio';
    if (s.includes('pull')) return 'pull';
    if (s.includes('push')) return 'push';
    if (s.includes('leg')) return 'legs';
    if (s.includes('shoulder')) return 'shoulders';
    if (s.includes('upper') || s.includes('core')) return 'core';
    return 'other';
  }

  /* ── Theme ─────────────────────────────────────────────────
     The attribute lives on <html> so it also reaches the lock screen,
     the toasts and the modals, all of which sit outside .phone-frame.
     A matching pre-paint reader is inlined in index.html's <head> so
     there is no flash of the wrong theme before the payload unpacks.   */

  const THEME_KEY = 'asca_gym_theme';
  const THEMES = ['classic', 'winter'];

  // Winter Arc is the default now — a fresh browser with no stored
  // preference gets the winter skin, not classic. An explicit choice in
  // localStorage (either direction) is always honoured over the default.
  function getTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      return THEMES.includes(t) ? t : 'winter';
    } catch (_) { return 'winter'; }
  }

  function applyTheme(theme) {
    const t = THEMES.includes(theme) ? theme : 'classic';
    try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
    const root = document.documentElement;
    root.setAttribute('data-theme', t);
    // Keep the iOS status bar in step with the ground colour.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'winter' ? '#020407' : '#000000');
    return t;
  }

  function isWinter() {
    return getTheme() === 'winter';
  }

  return Object.freeze({
    // dates
    dateStr, todayStr, parseDay, addDays, daysBetween, weekStart, msUntilMidnight,
    // season
    SEASONS, CURRENT_SEASON, season, seasonLength, seasonDay, seasonPhase, daysLeft,
    // progression
    XP, XP_PER_LEVEL_STEP, STREAK_MILESTONES, xpForLevel, levelForXp, levelProgress,
    // habits
    HABITS, SLEEP_QUALITY_MAX, defaultGoals, emptyCheckin, habitsMet, checkinTouched, computeSleepHours,
    // day types
    dayTypeColor, dayTypeToken,
    // theme
    THEME_KEY, THEMES, getTheme, applyTheme, isWinter
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = WinterArc;
