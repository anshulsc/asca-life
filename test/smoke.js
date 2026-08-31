/* ═══════════════════════════════════════════════════════════════
   Boot smoke test — `node test/smoke.js` after `node build.js`.

   Unpacks the base64 payload out of the BUILT index.html and executes
   every chunk in the same order the boot script does, against a minimal
   DOM stub. It cannot prove the UI renders, but it does prove the three
   things that actually break silently in a no-bundler, no-module-system
   build:

     1. every chunk parses and runs with no top-level error
     2. the chunks are in the payload at all, and in the right order
     3. a later chunk can SEE an earlier chunk's top-level `const`

   (3) is the property the whole architecture rests on — it is why
   winter.js can be injected before app.js and simply be there. If a
   future refactor wraps a module in something that breaks that
   sharing, this is the test that catches it.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const BUILT = path.join(ROOT, 'index.html');

if (!fs.existsSync(BUILT)) {
  console.error('smoke: index.html not found — run `node build.js` first.');
  process.exit(1);
}

/* ── Unpack the payload exactly as the boot script does ────── */

const html = fs.readFileSync(BUILT, 'utf8');
const m = html.match(/const PAYLOAD_B64 = "([^"]+)"/);
if (!m) {
  console.error('smoke: could not find PAYLOAD_B64 in the built index.html.');
  process.exit(1);
}
const payload = JSON.parse(decodeURIComponent(escape(Buffer.from(m[1], 'base64').toString('binary'))));

// The order here must mirror boot() in build.js. If a chunk is added to the
// payload but not injected (or injected in the wrong place), this list is
// where it gets noticed.
const INJECTION_ORDER = ['data', 'winter', 'challenges', 'fsync', 'arcSync', 'app'];
const EXPECTED_GLOBALS = ['HISTORICAL_DATA', 'EXERCISE_LIBRARY', 'DAY_TYPES', 'WinterArc', 'ChallengeEngine', 'FirebaseSync', 'ArcSync'];

let failed = 0;
const bad = msg => { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); failed++; };
const good = msg => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);

console.log(`\n\x1b[1mpayload\x1b[0m  (${Math.round(Buffer.byteLength(html) / 1024)} KB built)`);
console.log(`  keys: ${Object.keys(payload).join(', ')}`);
INJECTION_ORDER.forEach(k => {
  if (!payload[k]) bad(`payload.${k} is missing — check the payload object and injectScript order in build.js`);
});
if (!html.includes('if (payload.winter) injectScript(payload.winter)')) {
  bad('the boot script does not inject payload.winter');
}
if (!html.includes('if (payload.challenges) injectScript(payload.challenges)')) {
  bad('the boot script does not inject payload.challenges');
}
// winter and challenges must be injected BEFORE app: app.js's dayKey() alias
// needs WinterArc, and challenges.js itself needs WinterArc at its own load
// time (it resolves WA at the top of the IIFE, not lazily).
const bootIdx = s => html.indexOf(s);
if (bootIdx('injectScript(payload.winter)') > bootIdx('injectScript(payload.app)')) {
  bad('payload.winter is injected AFTER payload.app — app.js needs WinterArc to already exist');
}
if (bootIdx('injectScript(payload.winter)') > bootIdx('injectScript(payload.challenges)')) {
  bad('payload.winter is injected AFTER payload.challenges — ChallengeEngine needs WinterArc to already exist');
}
if (bootIdx('injectScript(payload.challenges)') > bootIdx('injectScript(payload.app)')) {
  bad('payload.challenges is injected AFTER payload.app');
}
if (!html.includes('if (payload.arcSync) injectScript(payload.arcSync)')) {
  bad('the boot script does not inject payload.arcSync');
}
if (bootIdx('injectScript(payload.arcSync)') > bootIdx('injectScript(payload.app)')) {
  bad('payload.arcSync is injected AFTER payload.app');
}
if (bootIdx('injectScript(payload.fsync)') > bootIdx('injectScript(payload.arcSync)')) {
  bad('payload.fsync is injected AFTER payload.arcSync — ArcSync calls FirebaseSync at runtime, and while that is call-time not load-time, the payload order should still document the real dependency');
}

/* ── Minimal browser stub ──────────────────────────────────── */

function makeSandbox() {
  const store = {};
  const el = () => new Proxy({}, {
    get: (t, k) => (k in t ? t[k]
      : (['style', 'dataset', 'classList'].includes(k) ? el()
      : (typeof k === 'string' ? () => undefined : undefined))),
    set: (t, k, v) => (t[k] = v, true)
  });
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    document: {
      documentElement: el(), head: el(), body: el(),
      readyState: 'loading',
      addEventListener: () => {}, querySelector: () => null,
      querySelectorAll: () => [], getElementById: () => null,
      createElement: () => el()
    },
    navigator: { onLine: true, clipboard: { writeText: () => Promise.resolve() } },
    fetch: () => Promise.reject(new Error('smoke test: no network')),
    EventSource: function () {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    Date, Math, JSON, Promise, Object, Array, String, Number, Boolean,
    RegExp, Error, Set, Map, WeakMap, Symbol,
    isNaN, parseInt, parseFloat,
    encodeURIComponent, decodeURIComponent, escape, unescape,
    TextEncoder, TextDecoder, Uint8Array
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return vm.createContext(sandbox);
}

/* ── Execute ───────────────────────────────────────────────── */

console.log('\n\x1b[1mexecution\x1b[0m');
const ctx = makeSandbox();
for (const name of INJECTION_ORDER) {
  if (!payload[name]) continue;
  try {
    vm.runInContext(payload[name], ctx, { filename: `payload.${name}.js` });
    good(`${name} executed`);
  } catch (e) {
    bad(`${name} threw at load: ${e.message}`);
    // A chunk that fails to load makes everything after it meaningless.
    console.log(`\n\x1b[31msmoke FAILED\x1b[0m\n`);
    process.exit(1);
  }
}

/* ── Cross-script visibility ───────────────────────────────── */

console.log('\n\x1b[1mglobals visible to a later <script>\x1b[0m');
const probe = `
  const out = {};
  ${JSON.stringify(EXPECTED_GLOBALS)}.forEach(n => {
    try { out[n] = eval('typeof ' + n); } catch (e) { out[n] = 'THROWS'; }
  });
  out.__winter = (typeof WinterArc !== 'undefined')
    ? { today: WinterArc.todayStr(), day1: WinterArc.seasonDay(WinterArc.season().start), lvl: WinterArc.levelForXp(1500) }
    : null;
  out.__engine = (typeof ChallengeEngine !== 'undefined')
    ? (() => {
        const s = ChallengeEngine.summary({ workouts: [], checkins: {}, now: new Date() });
        return { catalogueSize: ChallengeEngine.CATALOGUE.length, xp: s.xp, objectives: s.objectivesTotal };
      })()
    : null;
  out.__arcSync = (typeof ArcSync !== 'undefined')
    ? Object.keys(ArcSync).filter(k => typeof ArcSync[k] === 'function').length
    : null;
  out;
`;
const seen = vm.runInContext(probe, ctx, { filename: 'probe.js' });
EXPECTED_GLOBALS.forEach(n => {
  if (seen[n] === 'undefined' || seen[n] === 'THROWS') bad(`${n} is not visible (typeof = ${seen[n]})`);
  else good(`${n} (${seen[n]})`);
});

if (seen.__winter) {
  const w = seen.__winter;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(w.today)) bad(`WinterArc.todayStr() returned ${w.today}`);
  if (w.day1 !== 1) bad(`WinterArc.seasonDay(season start) returned ${w.day1}, expected 1`);
  if (w.lvl !== 3) bad(`WinterArc.levelForXp(1500) returned ${w.lvl}, expected 3`);
  if (!failed) good(`WinterArc live: today=${w.today} seasonDay=${w.day1} level=${w.lvl}`);
}

if (seen.__engine) {
  const e = seen.__engine;
  if (e.catalogueSize < 1) bad(`ChallengeEngine.CATALOGUE is empty`);
  if (e.xp !== 0) bad(`ChallengeEngine.summary() with no data returned xp=${e.xp}, expected 0`);
  if (e.objectives !== 4) bad(`ChallengeEngine.summary() returned ${e.objectives} objectives, expected 4`);
  if (!failed) good(`ChallengeEngine live: ${e.catalogueSize} catalogue entries, summary() runs clean`);
}

if (seen.__arcSync != null) {
  if (seen.__arcSync < 10) bad(`ArcSync exposes only ${seen.__arcSync} functions — expected the full read/write surface`);
  else good(`ArcSync live: ${seen.__arcSync} functions exposed`);
} else {
  bad('ArcSync did not load or exposed nothing');
}

console.log('');
if (failed) { console.log(`\x1b[31msmoke FAILED (${failed})\x1b[0m\n`); process.exit(1); }
console.log('\x1b[32msmoke OK\x1b[0m — payload executes and app.js can see WinterArc.\n');
