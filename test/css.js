/* ═══════════════════════════════════════════════════════════════
   Stylesheet checks — `node test/css.js`.

   CSS fails silently. An undefined custom property, a self-referential
   one, or an unbalanced brace produces no error anywhere — the rule
   just stops applying and the UI quietly loses a colour. With the
   palette now expressed as `rgba(var(--channel), alpha)` across 400+
   sites, that failure mode is worth a test.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

const CSS_PATH = path.join(__dirname, '..', 'src', 'style.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');

let failed = 0;
const bad = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); failed++; };
const good = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`);

/* Strip comments once — every check below should ignore them. Doing this
   naively would also eat the `//` inside url(http://…), so only /* … *​/ . */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ── 1. Braces balance ─────────────────────────────────────── */
console.log('\n\x1b[1mstructure\x1b[0m');
{
  const open = (code.match(/\{/g) || []).length;
  const close = (code.match(/\}/g) || []).length;
  if (open !== close) bad(`unbalanced braces: ${open} '{' vs ${close} '}'`);
  else good(`braces balance (${open} blocks)`);
}

/* ── 2. Every var(--x) is defined somewhere ────────────────── */
console.log('\n\x1b[1mcustom properties\x1b[0m');

// Declarations: `--name:` at the start of a declaration.
const declared = new Set();
for (const m of code.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) declared.add(m[1]);

// Usages, keeping any fallback so we can tell "safe" from "broken".
const used = new Map(); // name -> hasFallback
for (const m of code.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)) {
  const [, name, comma] = m;
  if (!used.has(name) || comma) used.set(name, used.get(name) || !!comma);
}

const undefinedNoFallback = [...used.keys()].filter(n => !declared.has(n) && !used.get(n));
const undefinedWithFallback = [...used.keys()].filter(n => !declared.has(n) && used.get(n));

if (undefinedNoFallback.length) {
  undefinedNoFallback.forEach(n => bad(`${n} is used with no fallback and never declared — that rule silently does nothing`));
} else {
  good(`all ${used.size} referenced properties resolve (${declared.size} declared)`);
}
if (undefinedWithFallback.length) {
  console.log(`  \x1b[33m!\x1b[0m ${undefinedWithFallback.length} undeclared but with a fallback: ${undefinedWithFallback.join(', ')}`);
}

/* ── 3. No self-referential declarations ───────────────────── */
{
  const circular = [];
  for (const m of code.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)[;}]/g)) {
    const [, name, value] = m;
    if (new RegExp(`var\\(\\s*${name}\\b`).test(value)) circular.push(name);
  }
  if (circular.length) circular.forEach(n => bad(`${n} references itself — invalid at computed-value time, so it resolves to nothing`));
  else good('no self-referential declarations');
}

/* ── 4. var() must not appear inside a data: URI ───────────── */
{
  // Match the QUOTED string, not up to the first ')': these URIs embed SVG
  // that itself contains rgba(...), so a naive [^)]* stops in the wrong place
  // and the check silently passes over zero URIs.
  const uris = [
    ...[...code.matchAll(/"(data:[^"]*)"/g)].map(m => m[1]),
    ...[...code.matchAll(/'(data:[^']*)'/g)].map(m => m[1]),
  ];
  if (!uris.length) {
    bad('found no data: URIs at all — the detector is broken, not the stylesheet');
  } else {
    const broken = uris.filter(u => u.includes('var(--'));
    if (broken.length) {
      broken.forEach(u => bad(`a data: URI contains var() and will never resolve: ${u.slice(0, 70)}…`));
    } else {
      good(`no var() inside any of the ${uris.length} data: URI(s)`);
    }
  }
}

/* ── 5. Both themes declare the same token surface ─────────── */
console.log('\n\x1b[1mtheme parity\x1b[0m');
{
  const blockOf = (selector) => {
    const i = code.indexOf(selector);
    if (i === -1) return null;
    const open = code.indexOf('{', i);
    const close = code.indexOf('}', open);
    return code.slice(open, close);
  };
  const names = (block) => new Set([...block.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map(m => m[1]));

  const classicBlock = blockOf(':root {');
  const winterBlock = blockOf(':root[data-theme="winter"]');

  if (!classicBlock) bad('could not find the :root block');
  else if (!winterBlock) bad('could not find the :root[data-theme="winter"] block');
  else {
    const classic = names(classicBlock);
    const winter = names(winterBlock);
    good(`classic declares ${classic.size} tokens, winter overrides ${winter.size}`);

    // Winter may legitimately override only a subset — but it must not invent
    // a token that classic lacks, or classic renders with it undefined.
    const winterOnly = [...winter].filter(n => !classic.has(n));
    // These are winter-only by design and are always used with a fallback or
    // only inside a [data-theme="winter"] rule.
    const ALLOWED_WINTER_ONLY = new Set(['--accent-2', '--accent-3', '--arc-ember', '--arc-ember-rgb']);
    const unexpected = winterOnly.filter(n => !ALLOWED_WINTER_ONLY.has(n));
    if (unexpected.length) {
      unexpected.forEach(n => bad(`${n} is declared only in the winter block — classic would render it undefined`));
    } else {
      good(`winter-only tokens are all accounted for (${winterOnly.join(', ') || 'none'})`);
    }
  }
}

/* ── 6. The winter override budget ─────────────────────────── */
// Raised from 40 to 60 for the monochrome sweep: a batch of one-off
// overrides neutralizing hardcoded pre-Winter-Arc colours (cardio red,
// medal gold/silver/bronze, inline settings-icon gradients) that have no
// existing token to redirect through — retrofitting real tokens for all
// of them would be a much larger refactor of code that predates this
// theme. Still a budget, not a green light: if this keeps climbing,
// that's the signal to do that refactor instead of raising the number again.
{
  const n = (css.match(/\[data-theme="winter"\]/g) || []).length;
  const BUDGET = 60;
  if (n > BUDGET) {
    bad(`${n} [data-theme="winter"] selectors exceeds the ${BUDGET} budget — something here should be a token instead`);
  } else {
    good(`${n} winter override selectors (budget ${BUDGET})`);
  }
}

/* ── 7. Load-bearing build anchors still present ───────────── */
console.log('\n\x1b[1mbuild anchors\x1b[0m');
[
  ['@import', /@import\s+url\([^)]+\);/],
  [':root {', /:root \{/],
  ['/* ── THEME TOKENS END ── */', /\/\* ── THEME TOKENS END ── \*\//],
  ['/* ── Reset & Base', /\/\* ── Reset & Base/],
  ['/* ── Animated Gradient Mesh', /\/\* ── Animated Gradient Mesh/],
  ['/* ── Lock Screen Overlay', /\/\* ── Lock Screen Overlay/],
].forEach(([label, re]) => {
  if (re.test(css)) good(label);
  else bad(`${label} is MISSING — build.js slices on this literally and will fail or silently emit an empty slice`);
});

/* ── 8. Winter structural block sits before the lock marker ── */
{
  const winterAt = css.indexOf('/* ── Winter Arc Structure');
  const lockAt = css.indexOf('/* ── Lock Screen Overlay');
  if (winterAt === -1) bad('the Winter Arc Structure block is missing');
  else if (winterAt > lockAt) bad('the Winter Arc Structure block is AFTER the lock marker — it would be double-shipped into <head> and the payload');
  else good('winter structural block is before the lock marker (ships once)');
}

console.log('');
if (failed) { console.log(`\x1b[31mcss FAILED (${failed})\x1b[0m\n`); process.exit(1); }
console.log('\x1b[32mcss OK\x1b[0m\n');
