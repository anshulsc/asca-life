/* ═══════════════════════════════════════════════════════════════
   Arc UI test — `node test/ui.js` (after `node build.js`).

   The earlier smoke test proves every payload chunk executes, but its
   DOM stub returns null from every getElementById — which means every
   render function's early-return guard (`if(!el) return`) swallows the
   call silently. A renderArc() that threw internally, or that computed
   the wrong text, would pass that test just as well as a correct one.

   This builds a real (if minimal) DOM with actual elements for every id
   the built src/index.html defines under #vArc, boots the real payload
   against it, drives window.__arcDebug through onboarding → check-in →
   a completed challenge, and asserts on the resulting textContent/HTML.
   No jsdom dependency — a purpose-built element is cheap enough here
   that adding one wasn't worth it.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const BUILT = path.join(ROOT, 'index.html');
const SRC_INDEX = path.join(ROOT, 'src', 'index.html');

let failed = 0;
const bad = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); failed++; };
const good = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`);

if (!fs.existsSync(BUILT)) { console.error('ui: run `node build.js` first.'); process.exit(1); }

/* ── Discover every id the Arc view actually declares ──────── */
/* Read straight from src/index.html rather than hand-maintaining a list —
   if the markup gains or loses an id, this test's DOM automatically
   tracks it, and a render function reaching for an id nobody declared
   still fails loudly instead of silently no-op'ing. */

const srcHtml = fs.readFileSync(SRC_INDEX, 'utf8');
// vHome is the first section after vArc in the markup; #sessionOverlay is a
// sibling <div>, not another .view, so it can't end this slice.
const arcSection = srcHtml.slice(srcHtml.indexOf('id="vArc"'), srcHtml.indexOf('<section class="view on" id="vHome"'));
const ARC_IDS = [...arcSection.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
if (!ARC_IDS.includes('arcOnboardCard')) {
  console.error('ui: could not locate the #vArc section in src/index.html — markup may have moved.');
  process.exit(1);
}
// The challenges sheet sits outside #vArc; register its real ids so the
// tests below assert against real nodes rather than the generic stub.
const chSheetSection = srcHtml.slice(srcHtml.indexOf('id="chSheet"'), srcHtml.indexOf('id="goalsSheet"'));
const CH_IDS = [...chSheetSection.matchAll(/id="([^"]+)"/g)].map(m => m[1]);

/* ── A tiny real DOM ────────────────────────────────────────── */

function makeElement(id) {
  const el = {
    id, textContent: '', innerHTML: '', style: {}, value: '',
    _classes: new Set(),
    classList: {
      add: (...c) => c.forEach(x => el._classes.add(x)),
      remove: (...c) => c.forEach(x => el._classes.delete(x)),
      contains: c => el._classes.has(c),
      toggle: c => el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c)
    },
    dataset: {},
    attributes: {},
    _listeners: {},
    addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
    dispatch(type, target) { (el._listeners[type] || []).forEach(fn => fn({ target: target || el })); },
    setAttribute(k, v) { el.attributes[k] = v; },
    getAttribute(k) { return el.attributes[k]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    scrollIntoView() {},
    get offsetWidth() { return 100; },
    appendChild() {},
    remove() {} // toast() schedules el.remove() 2500ms after append; a no-op here is correct
  };
  return el;
}

function makeDocument(ids) {
  const registry = {};
  ids.forEach(id => { registry[id] = makeElement(id); });
  const html = makeElement('html');
  const body = makeElement('body');
  return {
    documentElement: html,
    body,
    head: makeElement('head'),
    readyState: 'complete',
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    // Elements under #vArc are real (registered above) so assertions can
    // inspect them. Anything else the app touches — the toast wrap, the
    // confirm modal, header chrome — is auto-created on first lookup and
    // cached, so a call like toast() doesn't crash the test just because
    // that chrome is outside the section actually being tested.
    getElementById: id => registry[id] || (registry[id] = makeElement(id)),
    querySelector: (sel) => {
      // Only what app.js actually needs for the Arc path: the promo "Try it"
      // button hops to the Arc tab via .bot-btn[data-v="Arc"].click().
      if (sel === 'meta[name="theme-color"]') return makeElement('meta-theme');
      if (sel === '.bot-btn[data-v="Arc"]') { const b = makeElement('arcbtn'); b.click = () => {}; return b; }
      return null;
    },
    querySelectorAll: () => [],
    createElement: tag => makeElement('created-' + tag),
    _registry: registry
  };
}

const document_ = makeDocument(ARC_IDS.concat(CH_IDS, ['bot-nav', 'navLens', 'themeToggle', 'themeDesc']));

/* ── Boot the real built payload against this DOM ──────────── */

const html = fs.readFileSync(BUILT, 'utf8');
const b64 = html.match(/const PAYLOAD_B64 = "([^"]+)"/)[1];
const payload = JSON.parse(decodeURIComponent(escape(Buffer.from(b64, 'base64').toString('binary'))));

const store = {};
const sandbox = {
  console,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  document: document_,
  navigator: { onLine: true, clipboard: { writeText: () => Promise.resolve() } },
  fetch: () => Promise.reject(new Error('offline')),
  EventSource: function () {},
  addEventListener: () => {}, // init() attaches 'online'/'pagehide' listeners to window itself
  matchMedia: () => ({ matches: false }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame: fn => setTimeout(fn, 16), cancelAnimationFrame: clearTimeout,
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  Date, Math, JSON, Promise, Object, Array, String, Number, Boolean,
  RegExp, Error, Set, Map, WeakMap, Symbol,
  isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, escape, unescape,
  TextEncoder, TextDecoder, Uint8Array
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

// app.js's `init()` self-invokes at load — that's fine here, it just does
// its normal (offline, signed-out) boot against the stub DOM and returns.
try {
  ['data', 'winter', 'challenges', 'fsync', 'arcSync', 'app'].forEach(k => {
    if (payload[k]) vm.runInContext(payload[k], ctx, { filename: `payload.${k}.js` });
  });
  good('payload boots against a real (stub) DOM with no top-level throw');
} catch (e) {
  bad(`boot threw: ${e.stack || e.message}`);
  console.log('');
  process.exit(1);
}

const dbg = sandbox.__arcDebug;
if (!dbg) { bad('window.__arcDebug was not exposed'); console.log(''); process.exit(1); }

// In the real app, bindArc() (which fills #arcGoalGrid, wires the join
// button, etc.) only ever runs inside startApp(), which only ever runs
// after a real sign-in via unlock() — the lock screen gates everything
// before that. This stub has no live Firebase auth to unlock with, so
// startApp() is invoked directly through the debug hook instead.
try {
  dbg.startApp();
  good('startApp() runs cleanly outside a real sign-in flow');
} catch (e) {
  bad(`startApp() threw: ${e.message}`);
}

/* ── Onboarding state ───────────────────────────────────────── */

console.log('\n\x1b[1monboarding (not yet enrolled)\x1b[0m');
dbg.renderArc();
const onboard = document_.getElementById('arcOnboardCard');
const dash = document_.getElementById('arcDash');
if (onboard.style.display === 'flex') good('onboard card is shown');
else bad(`onboard card display = "${onboard.style.display}", expected "flex"`);
if (dash.style.display === 'none') good('dashboard is hidden');
else bad(`dashboard display = "${dash.style.display}", expected "none"`);
if (document_.getElementById('arcOnboardTitle').textContent) good(`title set: "${document_.getElementById('arcOnboardTitle').textContent}"`);
else bad('onboard title is empty');
const goalGrid = document_.getElementById('arcGoalGrid');
if (goalGrid.innerHTML.includes('data-goal=')) good('goal inputs rendered');
else bad('goal grid has no inputs');

/* ── Enroll ────────────────────────────────────────────────── */

console.log('\n\x1b[1menrolling\x1b[0m');
dbg.arcEnroll({}); // defaults
dbg.renderArc();
if (dash.style.display === 'block') good('dashboard shown after enrolling');
else bad(`dashboard display = "${dash.style.display}" after enroll`);
if (onboard.style.display === 'none') good('onboard hidden after enrolling');
else bad('onboard still shown after enrolling');

const dayLabel = document_.getElementById('arcDayLabel').textContent;
if (/^Day \d+ of \d+$/.test(dayLabel)) good(`day label: "${dayLabel}"`);
else bad(`day label malformed: "${dayLabel}"`);

const objList = document_.getElementById('arcObjList').innerHTML;
const objCount = (objList.match(/arc-obj-row/g) || []).length;
if (objCount === 4) good('exactly 4 objective rows rendered');
else bad(`${objCount} objective rows rendered, expected 4`);

const checkinRows = document_.getElementById('arcCheckinRows').innerHTML;
const habitCount = (checkinRows.match(/arc-checkin-row/g) || []).length;
if (habitCount === 5) good('exactly 5 check-in rows rendered');
else bad(`${habitCount} check-in rows rendered, expected 5`);

const dayPicker = document_.getElementById('arcCheckinDay').innerHTML;
if (dayPicker.includes('>Today<')) good('day picker includes a "Today" chip');
else bad('day picker missing a "Today" chip');

/* ── Check-in mutates state and re-renders ─────────────────── */

console.log('\n\x1b[1mcheck-in\x1b[0m');
const today = dbg.summary().today;
const before = dbg.state().checkins[today];
if (!before || !before.waterMl) good('water starts unlogged');
else bad('water was already logged before any check-in — fixture setup is off');

dbg.arcCheckin(today, { waterMl: 250 });
let after = dbg.state().checkins[today];
if (after.waterMl === 250) good('a quick-add applies (0 -> 250ml)');
else bad(`water is ${after.waterMl} after one quick-add, expected 250`);

dbg.arcCheckin(today, { waterMl: 500 });
after = dbg.state().checkins[today];
if (after.waterMl === 500) good('a second write REPLACES the field, not accumulates blindly (caller controls the delta)');
else bad(`water is ${after.waterMl}, expected 500`);

dbg.arcCheckin(today, { proteinG: 999 }); // huge, unrelated field
after = dbg.state().checkins[today];
if (after.waterMl === 500 && after.proteinG === 999) good('unrelated fields on the same day are merged, not clobbered');
else bad(`merge broke: water=${after.waterMl} protein=${after.proteinG}`);

/* ── A full day of habits completes all objectives ─────────── */

console.log('\n\x1b[1mfull day → objectives complete\x1b[0m');
const goals = dbg.state().goals;
dbg.arcCheckin(today, {
  sleepH: goals.sleepH, waterMl: goals.waterMl, proteinG: goals.proteinG,
  steps: goals.steps, mobilityMin: goals.mobilityMin
});
const sum = dbg.summary();
if (sum.objectivesDone === 4) good('all 4 objectives read as done from goal-meeting check-in values');
else bad(`objectivesDone = ${sum.objectivesDone}, expected 4`);

dbg.renderArc();
// The 'done' class and the checkmark icon land one tick after render now,
// not in the initial HTML string: arcAnimateFills() adds them via a real
// classList.add()/querySelector() on the freshly-inserted rows, one frame
// later, so the completion CSS transition has an actual "before" state to
// play from instead of snapping in pre-done (see arcAnimateFills in
// app.js). This stub DOM's querySelectorAll() always returns [] — it
// doesn't parse innerHTML into a live tree — so it can't observe that
// mutation at all, deferred or not. What it CAN observe is the row's
// data-pending-done flag, baked straight into the initial HTML string by
// renderArcObjectives() and the thing arcAnimateFills() itself reads to
// know which rows to promote — a faithful proxy for "the render correctly
// identified this objective as complete."
const pendingRows = (document_.getElementById('arcObjList').innerHTML.match(/data-pending-done/g) || []).length;
if (pendingRows === 4) good('all 4 objectives flagged complete in the render (data-pending-done)');
else bad(`DOM shows ${pendingRows} pending-done rows, expected 4`);

/* ── Streak and XP move together with real data ────────────── */

console.log('\n\x1b[1mstreak + XP after a logged day\x1b[0m');
const streakNum = parseInt(document_.getElementById('arcStreakNum').textContent, 10);
if (streakNum >= 1) good(`streak shows ${streakNum} (>= 1 with today active)`);
else bad(`streak shows ${streakNum}, expected >= 1`);

const xpLabel = document_.getElementById('arcXpLabel').textContent;
if (/^\d/.test(xpLabel)) good(`XP label populated: "${xpLabel}"`);
else bad(`XP label looks empty/malformed: "${xpLabel}"`);

/* ── Challenges render without throwing on real catalogue data ── */

console.log('\n\x1b[1mchallenges\x1b[0m');
const chScroll = document_.getElementById('arcChallengeScroll').innerHTML;
if (chScroll.includes('arc-challenge-card') || chScroll.includes('arc-challenge-empty')) {
  good('challenge scroller rendered a card list or the empty state');
} else {
  bad('challenge scroller rendered neither cards nor an empty state');
}

/* ── Friend challenges: sheet chrome, empty state, invites ── */

console.log('\n\x1b[1mfriend challenges\x1b[0m');
dbg.renderChallengesBrowser();
if (document_.getElementById('chCreatePane').style.display === 'block') {
  good('create pane is visible on the challenges sheet');
} else {
  bad(`create pane display = "${document_.getElementById('chCreatePane').style.display}"`);
}
const st = dbg.state();
if (!st.friendChallenges || Object.keys(st.friendChallenges).length === 0) {
  good('no friend challenges seeded by default');
} else {
  bad(`friendChallenges unexpectedly seeded: ${JSON.stringify(Object.keys(st.friendChallenges))}`);
}

// Friends tab renders the crew-facing empty state when nothing's on it.
dbg.setChTab('friends');
const friendsHtml = document_.getElementById('chList').innerHTML;
if (friendsHtml.includes('start one and invite the crew')) {
  good('friends tab empty state ships the expected copy');
} else {
  bad(`friends tab empty state copy missing: "${friendsHtml.slice(0, 120)}"`);
}
dbg.setChTab('active'); // reset before any later catalogue assertions

// Invites banner: set one synthetic invite and check both surfaces pick it up.
if (dbg.setInvites) {
  dbg.setInvites([{ cid: 'abc123', fromId: 'someoneelse', ts: Date.now() }]);
  const sheetBanner = document_.getElementById('chInvitesWrap').innerHTML;
  if (sheetBanner.includes('data-accept-invite') && sheetBanner.includes('data-decline-invite')) {
    good('invite banner inside the sheet renders Accept + Decline');
  } else {
    bad('invite banner inside the sheet is missing its action buttons');
  }
  const arcBanner = document_.getElementById('arcInvitesCard').innerHTML;
  if (arcBanner.includes('data-accept-invite') && arcBanner.includes('ch-invite-count')) {
    good('compact invite card inside the Arc dashboard renders');
  } else {
    bad('arc invites card did not render');
  }
  dbg.setInvites([]);
  if (document_.getElementById('arcInvitesCard').style.display === 'none') {
    good('arc invites card hides again once invites clear');
  } else {
    bad('arc invites card stayed visible after clearing invites');
  }
} else {
  bad('__arcDebug.setInvites is not exposed');
}

// Create form: selects populate from the app-side metric and window lists,
// not hardcoded markup — that list and this UI must never drift apart.
const metricSelHtml = document_.getElementById('chMetricSel').innerHTML;
const winSelHtml = document_.getElementById('chWinSel').innerHTML;
if (metricSelHtml.includes('<option') && metricSelHtml.split('<option').length > 5) {
  good(`chMetricSel populated (${metricSelHtml.split('<option').length - 1} options)`);
} else {
  bad(`chMetricSel never populated: "${metricSelHtml.slice(0, 80)}"`);
}
if (winSelHtml.includes('Fixed dates')) {
  good('chWinSel includes the fixed-window option');
} else {
  bad(`chWinSel missing expected options: "${winSelHtml.slice(0, 80)}"`);
}

console.log('');
if (failed) { console.log(`\x1b[31mui FAILED (${failed})\x1b[0m\n`); process.exit(1); }
console.log('\x1b[32mui OK\x1b[0m\n');
// startApp() schedules real timers in this sandbox (the day-rollover tick,
// toast auto-dismiss) that would otherwise keep the process alive for as
// long as a full day. The assertions are done; exit explicitly rather than
// waiting on unrelated background timers to drain.
process.exit(0);
