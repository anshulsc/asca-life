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
  const weeks = 24;
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
      const style = isFuture ? 'visibility: hidden; pointer-events: none;' : '';

      const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      const formattedDate = d.toLocaleDateString('en-US', options);
      const tooltip = info ? `${formattedDate}\\nWorkout Day` : `${formattedDate}\\nRest Day`;

      dotsHtml += `<div class="lock-heatmap-dot ${lvl}" style="${style}" title="${tooltip}"></div>`;

      // Track months
      const monthKey = d.getFullYear() + '-' + d.getMonth();
      if (!seenMonths.has(monthKey) && row === 0) {
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
