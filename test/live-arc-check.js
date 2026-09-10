/* Live Arc rules verifier — node test/live-arc-check.js
   One-shot: prompts for the app password (no echo, never stored), then
   tries to write + read Winter Arc data for you exactly the way the app
   does, so we can see whether the server's rules really allow it.

   The answer is in the status codes printed at the end:
     - writes 200 + reads return data  → live rules are correct, app-side issue
     - writes 401/403                  → live rules still stale; publish again

   Password handling: read from stdin with output muted; exists only inside
   this process, passed straight into the Firebase Auth POST, never logged. */
'use strict';

const readline = require('readline');

const API_KEY = 'AIzaSyCAvGn9blvhx-sGINHwbasYcx8LH1A-4mk'; // public client id, same as src/firebase-sync.js
const DB = 'https://asca-gym-default-rtdb.firebaseio.com';
const USER = 'anshulsc';
const EMAIL = `${USER}@asca-gym.app`;

function askHidden(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    rl._writeToChunk = function (chunk) { if (!rl.stdoutMuted) process.stdout.write(chunk); };
    rl.question(prompt, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const password = await askHidden(`App password for @${USER}: `);
  if (!password) { console.log('No password entered; aborting.'); process.exit(1); }

  const authRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(API_KEY)}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password, returnSecureToken: true }) }
  );
  const auth = await authRes.json();
  if (!auth.idToken) { console.log('Login failed:', (auth.error && auth.error.message) || authRes.status); process.exit(1); }
  const token = auth.idToken;
  const uid = auth.localId;
  console.log('Signed in OK.');

  const today = new Date().toISOString().slice(0, 10);

  async function patch(path, body) {
    const r = await fetch(`${DB}/${path}.json?auth=${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ uid, ts: Date.now() }, body)),
    });
    return r.status;
  }
  async function get(path) {
    const r = await fetch(`${DB}/${path}.json?auth=${encodeURIComponent(token)}`);
    return { status: r.status, body: await r.text() };
  }

  console.log('\n--- writes (exactly what the Arc app does on a check-in) ---');
  console.log('arc checkin write  :', await patch(`arc/${USER}/winter-2026/checkins/${today}`, { waterMl: 0, steps: 0 }));
  console.log('arcPublic write    :', await patch(`arcPublic/${USER}/winter-2026`, { day: 1, streak: 1, best: 1, level: 1, xp: 100, workoutsThisWeek: 0, challengesDone: 0 }));

  console.log('\n--- reads (what Social pulls for friends\' rows) ---');
  const pub = await get(`arcPublic/${USER}/winter-2026`);
  console.log('arcPublic read     :', pub.status, pub.body.slice(0, 180));
  const priv = await get(`arc/${USER}/winter-2026/checkins/${today}`);
  console.log('arc checkin read   :', priv.status, priv.body.slice(0, 180));

  console.log('\nInterpretation:');
  console.log('  writes 200 + reads show JSON  → rules are live; issue is app-side.');
  console.log('  writes 401/403                → live rules are stale; Publish again in the console.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
