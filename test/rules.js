/* ═══════════════════════════════════════════════════════════════
   RTDB rules consistency check — `node test/rules.js`.

   The ruleset is shared by two apps hitting the same Firebase project
   (this gym tracker and the separate Vault/budget repo), and Firebase
   has exactly one rules document — publishing REPLACES it whole. The
   ruleset is duplicated in three places by necessity (a committed JSON
   file plus a "Copy Database Rules" button literal in each app's
   src/app.js, so a user can republish from either app's Settings
   without needing this repo checked out). This test is the guard
   against those three drifting again the way database.rules.json once
   silently diverged from the button by an entire missing node.

   Not a rule-string comparison — a genuine JSON round-trip: each button
   literal is extracted from its surrounding <script> and eval()'d, then
   the resulting tree is compared to database.rules.json via JSON.stringify
   equality. That catches a structural difference (same rule text at the
   wrong path) that a flat set-of-strings comparison could miss.

   Requires the budget repo to be checked out as a sibling of this repo's
   parent, matching CLAUDE.md's documented layout
   (Project_Asca/{contents/gym-tracker, budget}). If it isn't present,
   that half of the check is skipped with a clear note — this repo alone
   can't fix a missing sibling checkout.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RULES_JSON = path.join(ROOT, 'database.rules.json');
const GYM_APPJS = path.join(ROOT, 'src', 'app.js');
const BUDGET_APPJS = path.join(ROOT, '..', '..', 'budget', 'src', 'app.js');

let failed = 0;
const bad = m => { console.log(`  \x1b[31m✗\x1b[0m ${m}`); failed++; };
const good = m => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const warn = m => console.log(`  \x1b[33m!\x1b[0m ${m}`);

function extractRulesLiteral(filePath, startMarker, endMarker) {
  const src = fs.readFileSync(filePath, 'utf8');
  const start = src.indexOf(startMarker);
  if (start === -1) return { error: `start marker not found: ${JSON.stringify(startMarker)}` };
  const end = src.indexOf(endMarker, start);
  if (end === -1) return { error: `end marker not found: ${JSON.stringify(endMarker)}` };
  const block = src.slice(start, end);

  const callSite = 'JSON.stringify(';
  const jsonStart = block.indexOf(callSite);
  if (jsonStart === -1) return { error: 'JSON.stringify( not found in the button body' };
  let depth = 0, i = jsonStart + callSite.length, objStart = -1, objEnd = -1;
  for (; i < block.length; i++) {
    const c = block[i];
    if (c === '{') { if (depth === 0) objStart = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0) { objEnd = i + 1; break; } }
  }
  if (objStart === -1 || objEnd === -1) return { error: 'could not balance braces in the rules literal' };

  const literalSrc = block.slice(objStart, objEnd);
  try {
    // eslint-disable-next-line no-eval
    const value = eval('(' + literalSrc + ')');
    return { value };
  } catch (e) {
    return { error: `literal did not eval: ${e.message}` };
  }
}

console.log('\n\x1b[1msources\x1b[0m');

let jsonDoc = null;
try {
  jsonDoc = JSON.parse(fs.readFileSync(RULES_JSON, 'utf8'));
  good(`database.rules.json parses (${Object.keys(jsonDoc.rules || {}).length} top-level nodes)`);
} catch (e) {
  bad(`database.rules.json is not valid JSON: ${e.message}`);
}

const gym = fs.existsSync(GYM_APPJS)
  ? extractRulesLiteral(GYM_APPJS, "const copyRulesBtn=document.getElementById('copyFbRules')", 'navigator.clipboard.writeText(rules)')
  : { error: 'src/app.js not found' };
if (gym.error) bad(`gym src/app.js: ${gym.error}`);
else good(`gym src/app.js "Copy Database Rules" button parses`);

let budget = null;
if (fs.existsSync(BUDGET_APPJS)) {
  budget = extractRulesLiteral(BUDGET_APPJS, "$('#fb-rules').onclick=function(){", 'navigator.clipboard.writeText(rules)');
  if (budget.error) bad(`budget/src/app.js: ${budget.error}`);
  else good(`budget/src/app.js "#fb-rules" button parses`);
} else {
  warn(`budget repo not found at ${path.relative(ROOT, BUDGET_APPJS)} — skipping the third-copy check`);
  warn('this only means the check was skipped, NOT that the copies agree — verify manually before publishing');
}

console.log('\n\x1b[1mstructural equality\x1b[0m');

if (jsonDoc && !gym.error) {
  const a = JSON.stringify(jsonDoc.rules);
  const b = JSON.stringify(gym.value.rules);
  if (a === b) good('database.rules.json === gym app.js button (full tree, not just rule text)');
  else bad('database.rules.json and the gym app.js button produce DIFFERENT rule trees');
}

if (jsonDoc && budget && !budget.error) {
  const a = JSON.stringify(jsonDoc.rules);
  const c = JSON.stringify(budget.value.rules);
  if (a === c) good('database.rules.json === budget app.js button (full tree, not just rule text)');
  else bad('database.rules.json and the budget app.js button produce DIFFERENT rule trees');
}

if (!gym.error && budget && !budget.error) {
  const b = JSON.stringify(gym.value.rules);
  const c = JSON.stringify(budget.value.rules);
  if (b === c) good('gym app.js button === budget app.js button');
  else bad('the two apps\' buttons produce DIFFERENT rule trees from each other');
}

console.log('\n\x1b[1mno path is accidentally open\x1b[0m');
if (jsonDoc) {
  // Every top-level node must declare SOME access control — a bare node
  // with no .read/.write anywhere under it inherits nothing and silently
  // becomes reachable by rule cascade rather than being denied.
  const hasAnyRule = (node) => {
    if (!node || typeof node !== 'object') return false;
    if ('.read' in node || '.write' in node) return true;
    return Object.keys(node).some(k => !k.startsWith('.') && hasAnyRule(node[k]));
  };
  Object.entries(jsonDoc.rules || {}).forEach(([node, def]) => {
    if (hasAnyRule(def)) good(`${node}/ declares access control somewhere in its subtree`);
    else bad(`${node}/ has NO .read or .write anywhere — this looks unintentional`);
  });
}

console.log('');
if (failed) { console.log(`\x1b[31mrules FAILED (${failed})\x1b[0m\n`); process.exit(1); }
console.log('\x1b[32mrules OK\x1b[0m\n');
