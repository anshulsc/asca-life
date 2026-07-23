const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

// Read files
const indexHtml = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(srcDir, 'style.css'), 'utf8');
const dataJs = fs.readFileSync(path.join(srcDir, 'data.js'), 'utf8');
const firebaseSyncJs = fs.readFileSync(path.join(srcDir, 'firebase-sync.js'), 'utf8');
const appJs = fs.readFileSync(path.join(srcDir, 'app.js'), 'utf8');

// Access control is Firebase Authentication now (see firebase-sync.js) —
// the old PIN + salt RC4 encryption of the bundle is gone. The payload is
// only base64-packed to keep the single-file structure and a fast-painting
// login screen; the login overlay stays up until sign-in succeeds.
if (!/FIREBASE_PROJECT_ID = '[^']+'/.test(firebaseSyncJs) || !/FIREBASE_API_KEY = '[^']+'/.test(firebaseSyncJs)) {
  console.warn('\x1b[33m%s\x1b[0m', 'WARNING: FIREBASE_PROJECT_ID / FIREBASE_API_KEY are empty in src/firebase-sync.js — the built app will show "Backend not configured".');
}

// Parse index.html
// Extract head content
const headMatch = indexHtml.match(/<head>([\s\S]*?)<\/head>/);
if (!headMatch) throw new Error('Could not find <head> tag in index.html');
let headContent = headMatch[1];
// Strip stylesheet link
headContent = headContent.replace(/<link[^>]*href=["']style\.css[^"']*["'][^>]*>/i, '');

// Extract layout variables, base styles, and lock screen CSS
const fontImportMatch = styleCss.match(/@import\s+url\([^)]+\);/);
const fontImport = fontImportMatch ? fontImportMatch[0] : '';

const rootStartIndex = styleCss.indexOf(':root {');
const rootEndIndex = styleCss.indexOf('}', rootStartIndex);
const rootCss = rootStartIndex !== -1 && rootEndIndex !== -1 ? styleCss.substring(rootStartIndex, rootEndIndex + 1) : '';

const resetStartIndex = styleCss.indexOf('/* ── Reset & Base');
const resetEndIndex = styleCss.indexOf('/* ── Animated Gradient Mesh');
const resetCss = resetStartIndex !== -1 && resetEndIndex !== -1 ? styleCss.substring(resetStartIndex, resetEndIndex) : '';

const lockStartIndex = styleCss.indexOf('/* ── Lock Screen Overlay');
const lockCss = lockStartIndex !== -1 ? styleCss.substring(lockStartIndex) : '';

const inlineLockCss = `${fontImport}\n\n${rootCss}\n\n${resetCss}\n\n${lockCss}`;

// Extract body content
const bodyMatch = indexHtml.match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error('Could not find <body> tag in index.html');
const fullBodyContent = bodyMatch[1];

// Extract the Lock Screen container
// We find <div class="lock-screen" id="lockScreen"> ... </div>
// Since it can contain nested div tags, we use a simple regex or parser.
const lockScreenStartTag = '<div class="lock-screen" id="lockScreen">';
const lockScreenStartIndex = fullBodyContent.indexOf(lockScreenStartTag);
if (lockScreenStartIndex === -1) throw new Error('Could not find lock screen div in index.html');

// Find the matching end div for lock screen.
// We count nesting depth.
let depth = 0;
let lockScreenEndIndex = -1;

for (let i = lockScreenStartIndex; i < fullBodyContent.length; i++) {
  if (fullBodyContent.substr(i, 4) === '<div') {
    depth++;
  } else if (fullBodyContent.substr(i, 6) === '</div>') {
    depth--;
    if (depth === 0) {
      lockScreenEndIndex = i + 6; // Include the closing tag </div>
      break;
    }
  }
}

if (lockScreenEndIndex === -1) throw new Error('Could not find matching end tag for lock screen div');

const lockScreenHtml = fullBodyContent.substring(lockScreenStartIndex, lockScreenEndIndex);

// Evaluate data.js to get HISTORICAL_DATA
const vm = require('vm');
const dataContext = vm.createContext({});
vm.runInContext(dataJs + "\n;this.HISTORICAL_DATA = HISTORICAL_DATA;", dataContext);
const historicalData = dataContext.HISTORICAL_DATA || [];

// Generate preview dots and months HTML
function generateHeatmapPreview(historicalData) {
  const today = new Date();
  // Open on the 1st of the earliest workout's month (capped at 24 weeks)
  // — mirrors heatmapRange() in app.js; days before the 1st are hidden
  let weeks = 24, rangeStart = null;
  const dates = historicalData.map(w => w && w.date).filter(Boolean).sort();
  if (dates.length) {
    const ed = new Date(dates[0] + 'T00:00:00');
    if (!isNaN(ed)) {
      rangeStart = new Date(ed.getFullYear(), ed.getMonth(), 1);
      const ws = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; };
      const wks = Math.round((ws(new Date()) - ws(rangeStart)) / (7 * 86400000)) + 1;
      weeks = Math.max(1, Math.min(24, wks));
    }
  }
  const days = weeks * 7;

  const dateWorkouts = {};
  historicalData.forEach(w => {
    let vol = 0;
    if (w.exercises) {
      w.exercises.forEach(e => {
        if (e.sets) {
          e.sets.forEach(s => {
            const weight = parseFloat(s.weight) || 0;
            const reps = parseInt(s.reps) || 0;
            vol += weight * reps;
          });
        }
      });
    }
    dateWorkouts[w.date] = { volume: vol };
  });

  const maxVol = Math.max(...Object.values(dateWorkouts).map(info => info.volume), 1);
  const startDate = new Date();
  startDate.setDate(today.getDate() - (weeks - 1) * 7 - today.getDay());

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const seenMonths = new Set();
  const monthLabels = [];

  let dotsHtml = '';
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const dayIdx = col * 7 + row;
      const d = new Date(startDate);
      d.setDate(d.getDate() + dayIdx);
      const y = d.getFullYear();
      const mOffset = String(d.getMonth() + 1).padStart(2, '0');
      const dOffset = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${mOffset}-${dOffset}`;
      const info = dateWorkouts[dateStr];
      const vol = info ? info.volume : 0;

      let lvl = '';
      if (vol > 0) {
        const ratio = vol / maxVol;
        if (ratio > 0.6) lvl = 'lvl-3';
        else if (ratio > 0.3) lvl = 'lvl-2';
        else lvl = 'lvl-1';
      }

      const isFuture = d > today;
      const isBeforeRange = rangeStart && d < rangeStart;
      const style = (isFuture || isBeforeRange) ? 'visibility: hidden; pointer-events: none;' : '';

      const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      const formattedDate = d.toLocaleDateString('en-US', options);
      const tooltip = info ? `${formattedDate}\\nWorkout Day` : `${formattedDate}\\nRest Day`;

      dotsHtml += `<div class="lock-heatmap-dot ${lvl}" style="${style}" title="${tooltip}"></div>`;

      // Track months (skip hidden lead-in days before the range start)
      const monthKey = d.getFullYear() + '-' + d.getMonth();
      if (!seenMonths.has(monthKey) && row === 0 && !isBeforeRange) {
        seenMonths.add(monthKey);
        monthLabels.push({ name: monthNames[d.getMonth()], col: col + 1 });
      }
    }
  }

  const monthsHtml = monthLabels
    .map(m => `<span class="lock-heatmap-month-label" style="left: ${(m.col - 1) * 8}px;">${m.name}</span>`)
    .join('');

  return { dotsHtml, monthsHtml };
}

const previewData = generateHeatmapPreview(historicalData);
let lockScreenHtmlWithPreview = lockScreenHtml.replace('<!-- PRE_RENDERED_HEATMAP_DOTS -->', previewData.dotsHtml);
lockScreenHtmlWithPreview = lockScreenHtmlWithPreview.replace('<!-- PRE_RENDERED_HEATMAP_MONTHS -->', previewData.monthsHtml);

// The rest of the body content is the application layout.
let appLayoutHtml = fullBodyContent.replace(lockScreenHtml, '');
// Strip the original script tags at the bottom
appLayoutHtml = appLayoutHtml.replace(/<script[\s\S]*?<\/script>/gi, '');

// Payload object
const payload = {
  css: styleCss,
  html: appLayoutHtml,
  data: dataJs,
  fsync: firebaseSyncJs,
  app: appJs
};

const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');

// Generate distribution HTML
const distHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  ${headContent.trim()}
  <style>
    ${inlineLockCss}
  </style>
</head>
<body>

${lockScreenHtmlWithPreview.trim()}

<script>
(() => {
  'use strict';
  const PAYLOAD_B64 = "${payloadB64}";

  function injectScript(code) {
    const s = document.createElement('script');
    s.textContent = code;
    document.body.appendChild(s);
  }

  // Unpack the app behind the login overlay; app.js owns the login
  // flow (Firebase Auth) and removes the overlay after sign-in.
  function boot() {
    const payload = JSON.parse(decodeURIComponent(escape(atob(PAYLOAD_B64))));

    const style = document.createElement('style');
    style.textContent = payload.css;
    document.head.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.innerHTML = payload.html;
    while (wrapper.firstChild) {
      document.body.appendChild(wrapper.firstChild);
    }

    injectScript(payload.data);
    if (payload.fsync) injectScript(payload.fsync);
    injectScript(payload.app);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(__dirname, 'index.html'), distHtml, 'utf8');
console.log('Successfully compiled index.html (login-gated, no payload encryption)!');

// ── Admin console (admin/index.html) ──────────────────────────────
// A standalone maintainer-only dashboard served at /asca-life/admin/.
// It reuses the app's design system (style.css) and Firebase module
// (firebase-sync.js) — bundled as plaintext (no secrets beyond the
// same client identifiers already public in index.html).
const adminHtmlPath = path.join(srcDir, 'admin.html');
const adminJsPath = path.join(srcDir, 'admin.js');
if (fs.existsSync(adminHtmlPath) && fs.existsSync(adminJsPath)) {
  const adminHtml = fs.readFileSync(adminHtmlPath, 'utf8');
  const adminJs = fs.readFileSync(adminJsPath, 'utf8');

  const adminHeadMatch = adminHtml.match(/<head>([\s\S]*?)<\/head>/);
  let adminHead = adminHeadMatch ? adminHeadMatch[1] : '';
  // Drop the dev-time stylesheet link — style.css is inlined below.
  adminHead = adminHead.replace(/<link[^>]*href=["']style\.css[^"']*["'][^>]*>/i, '');
  // Pull the admin-specific <style> out so it can be placed AFTER style.css
  // (so admin overrides win the cascade), and keep <meta charset> first.
  const adminStyleMatch = adminHead.match(/<style>([\s\S]*?)<\/style>/i);
  const adminInlineCss = adminStyleMatch ? adminStyleMatch[1] : '';
  const adminMeta = adminHead.replace(/<style>[\s\S]*?<\/style>/i, '').trim();

  const adminBodyMatch = adminHtml.match(/<body>([\s\S]*?)<\/body>/);
  let adminBody = adminBodyMatch ? adminBodyMatch[1] : adminHtml;
  // Strip the dev-time <script src> tags — the code is inlined below.
  adminBody = adminBody.replace(/<script[\s\S]*?<\/script>/gi, '');

  const adminDist = `<!DOCTYPE html>
<html lang="en">
<head>
  ${adminMeta}
  <style>
${styleCss}
${adminInlineCss}
  </style>
</head>
<body>

${adminBody.trim()}

<script>
${firebaseSyncJs}
</script>
<script>
${adminJs}
</script>
</body>
</html>
`;

  const adminDir = path.join(__dirname, 'admin');
  if (!fs.existsSync(adminDir)) fs.mkdirSync(adminDir, { recursive: true });
  fs.writeFileSync(path.join(adminDir, 'index.html'), adminDist, 'utf8');
  console.log('Successfully compiled admin/index.html (maintainer console)!');
} else {
  console.warn('\x1b[33m%s\x1b[0m', 'Skipped admin build: src/admin.html or src/admin.js missing.');
}
