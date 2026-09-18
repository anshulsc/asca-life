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
const INJECTION_ORDER = ['data', 'winter', 'challenges', 'fsync', 'arcSync', 'nutEngine', 'nutSync', 'nutrition', 'wrapped', 'app'];
const EXPECTED_GLOBALS = ['HISTORICAL_DATA', 'EXERCISE_LIBRARY', 'DAY_TYPES', 'WinterArc', 'ChallengeEngine', 'FirebaseSync', 'ArcSync', 'NutritionEngine', 'NutritionSync', 'AscaNutrition', 'Wrapped'];

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
  out.__wrapped = (typeof Wrapped !== 'undefined')
    ? { hasCompute: typeof Wrapped.compute === 'function', hasOpen: typeof Wrapped.openWrapped === 'function' }
    : null;
  out.__nutrition = (typeof NutritionEngine !== 'undefined')
    ? (() => {
        const n = NutritionEngine.nutrientsForPortion(
          { name: 't', basis: 'per100g', per100: { kcal: 250, protein: 9, carbs: 42, fat: 3.5, fiber: 6 } }, 180, 'g');
        return { kcal: Math.round(n.kcal), bmr: Math.round(NutritionEngine.bmrMifflin({ sex: 'm', age: 28, heightCm: 178, weight: 75 })), fns: Object.keys(NutritionEngine).length };
      })()
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

if (seen.__wrapped != null) {
  if (!seen.__wrapped.hasCompute || !seen.__wrapped.hasOpen) bad('Wrapped missing compute/openWrapped on its public surface');
  else good('Wrapped live: compute() + openWrapped() exposed');
} else {
  bad('Wrapped did not load or exposed nothing');
}

if (seen.__nutrition != null) {
  const n = seen.__nutrition;
  if (n.kcal !== 450) bad(`NutritionEngine.nutrientsForPortion(180g of 250kcal/100g) = ${n.kcal}, expected 450`);
  if (!n.bmr || n.bmr < 1600 || n.bmr > 1850) bad(`NutritionEngine.bmrMifflin implausible: ${n.bmr}`);
  if (n.fns < 30) bad(`NutritionEngine exposes only ${n.fns} members`);
  if (!failed) good(`NutritionEngine live: 180g scaling → ${n.kcal} kcal, Mifflin BMR ${n.bmr}`);
} else {
  bad('NutritionEngine did not load or exposed nothing');
}

/* ── Information architecture (P0b) ────────────────────────────
   The boot probe above proves the payload EXECUTES; it says nothing about
   the markup it's wired against. Log is no longer a tab — it is the
   #sessionOverlay opened by the ＋ action button — and if the nav bar or
   view ids drift from the data-v targets, a tap silently takes the user
   nowhere. These are no-DOM assertions against src/index.html as a
   string: id-level presence plus data-v ↔ #v<Name> consistency. */

console.log('\n\x1b[1minformation architecture (P0b)\x1b[0m');
const srcIndex = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');

const sectionBlock = (id) => {
  const from = srcIndex.indexOf(`id="${id}"`);
  if (from === -1) return '';
  // `from` points at the id attribute inside the element's open tag, so back
  // up to its '<' to bound the block by element.
  const tagStart = srcIndex.lastIndexOf('<', from);
  const tagEnd = srcIndex.indexOf('>', from);
  const tag = srcIndex.slice(tagStart + 1, tagEnd).match(/^(\w+)/)[1];
  const close = srcIndex.indexOf(`</${tag}>`, tagEnd);
  if (close === -1) return srcIndex.slice(tagStart);
  // For a <section> the close tag bounds the block; for the overlay <div>
  // the FIRST </div> after the wrapper would clip it, so a div block instead
  // runs to the next top-level section/sheet — good enough for id containment.
  if (tag === 'section') return srcIndex.slice(tagStart, close + `</${tag}>`.length);
  const nextSection = srcIndex.indexOf('<section', tagEnd);
  return srcIndex.slice(tagStart, nextSection === -1 ? close : nextSection);
};

if (!srcIndex.includes('id="vLog"')) good('no #vLog tab remains in the markup');
else bad('#vLog still exists — the Log tab should be gone');

const overlay = sectionBlock('sessionOverlay');
if (overlay) {
  good('#sessionOverlay exists');
  ['wDate', 'wType', 'exS', 'se', 'disc', 'fin', 'sessionClose'].forEach(id => {
    if (overlay.includes(`id="${id}"`)) good(`#sessionOverlay contains #${id}`);
    else bad(`#sessionOverlay is missing #${id} — set-editor wiring will dead-end`);
  });
} else {
  bad('#sessionOverlay is missing from src/index.html');
}

const home = sectionBlock('vHome');
if (home) {
  good('#vHome dashboard view exists');
  ['homeStartWorkout', 'heatmapCalGrid', 'heatmapMonths', 'volWidgetVal'].forEach(id => {
    if (home.includes(`id="${id}"`)) good(`#vHome contains #${id}`);
    else bad(`#vHome is missing #${id}`);
  });
} else {
  bad('#vHome is missing from src/index.html');
}

if (!srcIndex.includes('data-v="Log"')) good('no data-v="Log" tab target remains');
else bad('a data-v="Log" button still exists — tapping it opens nothing');

const barFrom = srcIndex.indexOf('id="bot-nav"');
if (barFrom === -1) { bad('the bottom bar (#bot-nav) is missing'); }
const bar = srcIndex.slice(barFrom, srcIndex.indexOf('</nav>', barFrom === -1 ? 0 : barFrom));
if (/(?:id="fabSession[^"]*"[^>]*data-v=|data-v="[^"]*"[^>]*id="fabSession")/.test(bar))
  bad('#fabSession carries a data-v — the ＋ is an action, not a tab, and the binder would clobber its hero styling with .on');
else good('#fabSession has no data-v (action button, not a tab)');
if (!bar.includes('data-v="Soc"')) bad('bottom bar lost its data-v="Soc" (Social) tab');
if (!bar.includes('data-v="Ana"')) bad('bottom bar lost its data-v="Ana" (Insights) tab');
if (!bar.includes('data-v="Set"')) bad('bottom bar lost its data-v="Set" (Profile) tab');
if (!bar.includes('data-v="Home"')) bad('bottom bar lost its data-v="Home" tab');
if (['Soc', 'Ana', 'Set', 'Home'].every(t => bar.includes(`data-v="${t}"`)))
  good('bottom bar keeps Home / Soc / Ana / Set view slots around the ＋');

if (srcIndex.includes('data-v="Hist"') && srcIndex.includes('data-v="Nut"'))
  good('header keeps icon buttons for data-v="Hist" and data-v="Nut"');
else bad('header is missing the History/Nutrition icon buttons');

// Attribute order varies across buttons (class-first on the bottom bar,
// data-v-first on the header icons) — can't regex one order only.
const targets = [...srcIndex.matchAll(/data-v="([^"]+)"/g)]
  .map(m => m[1])
  .filter(t => t !== 'Log');
if (!targets.length) bad('no data-v tab targets found at all');
targets.forEach(t => {
  if (srcIndex.includes(`id="v${t}"`)) good(`data-v="${t}" resolves to #v${t}`);
  else bad(`data-v="${t}" has no matching #v${t} section — the tab opens nothing`);
});

console.log('');
if (failed) { console.log(`\x1b[31msmoke FAILED (${failed})\x1b[0m\n`); process.exit(1); }
console.log('\x1b[32msmoke OK\x1b[0m — payload executes and app.js can see WinterArc.\n');
