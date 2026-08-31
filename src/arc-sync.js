/* ═══════════════════════════════════════════════════════════════
   WINTER ARC — RTDB access for season/challenge state

   Same plain-REST, no-SDK pattern as FirebaseSync (kudos/comments
   are the closest precedent — see firebase-sync.js:505-587). This
   module owns FOUR new top-level nodes, all username-keyed like
   gym/ and directory/:

     arc/{userId}/{seasonId}          PRIVATE  (owner read+write)
     arcPublic/{userId}/{seasonId}    PUBLIC   (member-readable projection)
     challenges/{cid}                 SHARED   (definitions)
     challengeMembers/{cid}/{userId}  SHARED   (each writes only their own key)

   The one rule that matters more than any other in this file:
   NOTHING here ever calls FirebaseSync.writeDoc(). That call replaces
   the entire gym/{id} node — a water quick-add must not re-upload
   every workout ever logged. Every write below is a targeted PATCH
   to a specific subpath instead, which is why check-ins can be
   high-churn (a tap per quick-add) at effectively no cost.

   Loaded after firebase-sync.js (reuses its token/config plumbing)
   and before app.js. Exposes the `ArcSync` global.
   ═══════════════════════════════════════════════════════════════ */
const ArcSync = (() => {
  'use strict';

  function hasBackend() {
    return typeof FirebaseSync !== 'undefined' && FirebaseSync.isConnected
      ? FirebaseSync.getConfig().backendReady
      : false;
  }

  function myId() {
    const cfg = (typeof FirebaseSync !== 'undefined') ? FirebaseSync.getConfig() : null;
    return cfg ? cfg.userId : '';
  }

  function connected() {
    return typeof FirebaseSync !== 'undefined' && FirebaseSync.isConnected();
  }

  // dbUrl() is module-private in firebase-sync.js, so this mirrors it exactly
  // rather than reaching into that closure. Kept as one function so a future
  // FIREBASE_RTDB_URL change only needs updating in two places, matching the
  // existing duplication between firebase-sync.js and listenToDoc() in app.js.
  function dbUrl(path) {
    const cfg = FirebaseSync.getConfig();
    const base = cfg.projectId
      ? `https://${cfg.projectId}-default-rtdb.firebaseio.com`
      : 'https://asca-gym-default-rtdb.firebaseio.com';
    return `${base.replace(/\/$/, '')}/${path}`;
  }

  async function tok() { return FirebaseSync.getIdToken(); }

  function requireConnected() {
    if (!connected()) throw new Error('Not signed in');
  }

  /* ── arc/ — private season state ──────────────────────────
     goals, checkins, xp/level, streak, badges. Owner-read-only at the
     rules level, so a client-side mistake anywhere else in the app
     structurally cannot leak sleep hours or protein grams to a friend. */

  function arcPath(userId, seasonId, sub) {
    let p = `arc/${encodeURIComponent(userId)}/${encodeURIComponent(seasonId)}`;
    if (sub) p += `/${sub}`;
    return p + '.json';
  }

  async function readArc(seasonId) {
    if (!hasBackend()) return null;
    const id = myId();
    if (!id) return null;
    try {
      const token = await tok();
      const res = await fetch(dbUrl(`${arcPath(id, seasonId)}?auth=${token}`));
      if (!res.ok) return null;
      return await res.json();
    } catch (_) { return null; }
  }

  // Targeted PATCH to a subpath — never a full-node PUT. This is the
  // function every high-churn write in this module goes through.
  async function patchArc(seasonId, sub, value) {
    requireConnected();
    const id = myId();
    const token = await tok();
    const res = await fetch(dbUrl(`${arcPath(id, seasonId, sub)}?auth=${token}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    if (!res.ok) throw new Error('Season sync not enabled yet');
    return true;
  }

  // One check-in day. `fields` is a partial object — sleepH, waterMl, etc.
  // Always stamps uid/ts (the rules require both) and never sends null:
  // RTDB drops null keys silently, and 0 is the correct "logged, zero" value.
  async function writeCheckinDay(seasonId, date, fields) {
    requireConnected();
    const me = FirebaseSync.getUser();
    const body = Object.assign({}, fields, { uid: me.uid, ts: Date.now() });
    Object.keys(body).forEach(k => { if (body[k] == null) delete body[k]; });
    return patchArc(seasonId, `checkins/${encodeURIComponent(date)}`, body);
  }

  async function writeGoals(seasonId, goals) {
    requireConnected();
    const me = FirebaseSync.getUser();
    return patchArc(seasonId, null, { uid: me.uid, ts: Date.now(), goals });
  }

  async function writeProgress(seasonId, patch) {
    // patch: any of { xp, level, streak: {...}, badges: {...} }
    requireConnected();
    const me = FirebaseSync.getUser();
    return patchArc(seasonId, null, Object.assign({ uid: me.uid, ts: Date.now() }, patch));
  }

  async function writeSeasonJoin(seasonId, goals) {
    requireConnected();
    const me = FirebaseSync.getUser();
    return patchArc(seasonId, null, {
      uid: me.uid, ts: Date.now(),
      active: true, joinedAt: Date.now(), goals: goals || {},
      xp: 0, level: 1,
      streak: { current: 0, best: 0, lastDay: '', freezesLeft: 2, freezeUsed: {} },
      badges: {}
    });
  }

  /* ── arcPublic/ — the narrow social projection ─────────────
     Only what a group leaderboard needs. NEVER sleep/protein/water/
     steps/body weight — those live only in arc/, which no one but the
     owner can read. */

  function arcPublicPath(userId, seasonId) {
    return `arcPublic/${encodeURIComponent(userId)}/${encodeURIComponent(seasonId)}.json`;
  }

  async function writeArcPublic(seasonId, projection) {
    requireConnected();
    const me = FirebaseSync.getUser();
    const id = myId();
    const token = await tok();
    const body = Object.assign({ uid: me.uid, ts: Date.now() }, projection);
    const res = await fetch(dbUrl(`${arcPublicPath(id, seasonId)}?auth=${token}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Season sync not enabled yet');
    return true;
  }

  async function readArcPublic(userId, seasonId) {
    if (!hasBackend()) return null;
    try {
      const token = await tok();
      const res = await fetch(dbUrl(`${arcPublicPath(userId, seasonId)}?auth=${token}`));
      if (!res.ok) return null;
      return await res.json();
    } catch (_) { return null; }
  }

  /* ── challenges/ + challengeMembers/ — group challenges ────
     Phase 2 surface; the read/write helpers are defined now because
     the rules and the wire shape are part of the MVP data-model design,
     but no UI calls these yet. */

  async function createChallenge(def) {
    requireConnected();
    const me = FirebaseSync.getUser();
    const token = await tok();
    const body = Object.assign({}, def, { ownerUid: me.uid, ts: Date.now() });
    const res = await fetch(dbUrl(`challenges.json?auth=${token}`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Challenges not enabled yet');
    const out = await res.json();
    return (out && out.name) || null; // push id
  }

  async function readChallenge(cid) {
    if (!hasBackend()) return null;
    try {
      const token = await tok();
      const res = await fetch(dbUrl(`challenges/${encodeURIComponent(cid)}.json?auth=${token}`));
      return res.ok ? await res.json() : null;
    } catch (_) { return null; }
  }

  async function joinChallenge(cid, name, avatar) {
    requireConnected();
    const me = FirebaseSync.getUser();
    const id = myId();
    const token = await tok();
    const body = { uid: me.uid, ts: Date.now(), name: (name || id).slice(0, 60), avatar: avatar || '', state: 'active' };
    const res = await fetch(dbUrl(`challengeMembers/${encodeURIComponent(cid)}/${encodeURIComponent(id)}.json?auth=${token}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Challenges not enabled yet');
    return true;
  }

  async function leaveChallenge(cid) {
    requireConnected();
    const id = myId();
    const token = await tok();
    await fetch(dbUrl(`challengeMembers/${encodeURIComponent(cid)}/${encodeURIComponent(id)}.json?auth=${token}`), { method: 'DELETE' });
    return true;
  }

  // Each client writes only its OWN progress — the rules enforce this at
  // the server. Nobody computes anyone else's number; you only ever read it.
  async function writeMyProgress(cid, progress) {
    requireConnected();
    const id = myId();
    const token = await tok();
    const res = await fetch(dbUrl(`challengeMembers/${encodeURIComponent(cid)}/${encodeURIComponent(id)}/progress.json?auth=${token}`), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(progress)
    });
    if (!res.ok) throw new Error('Challenges not enabled yet');
    return true;
  }

  async function readMembers(cid) {
    if (!hasBackend()) return {};
    try {
      const token = await tok();
      const res = await fetch(dbUrl(`challengeMembers/${encodeURIComponent(cid)}.json?auth=${token}`));
      if (!res.ok) return {};
      return (await res.json()) || {};
    } catch (_) { return {}; }
  }

  /* ── invites/{inviteeId}/{cid} — Phase 2, defined for shape parity ── */

  async function sendInvite(inviteeId, cid) {
    requireConnected();
    const me = FirebaseSync.getUser();
    const token = await tok();
    const body = { fromId: myId(), fromUid: me.uid, ts: Date.now() };
    const res = await fetch(dbUrl(`invites/${encodeURIComponent(inviteeId)}/${encodeURIComponent(cid)}.json?auth=${token}`), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Invites not enabled yet');
    return true;
  }

  async function readInvites() {
    if (!hasBackend() || !connected()) return {};
    const id = myId();
    try {
      const token = await tok();
      const res = await fetch(dbUrl(`invites/${encodeURIComponent(id)}.json?auth=${token}`));
      if (!res.ok) return {};
      return (await res.json()) || {};
    } catch (_) { return {}; }
  }

  async function respondInvite(cid, accept, def) {
    requireConnected();
    const id = myId();
    const token = await tok();
    if (accept) await joinChallenge(cid, id);
    await fetch(dbUrl(`invites/${encodeURIComponent(id)}/${encodeURIComponent(cid)}.json?auth=${token}`), { method: 'DELETE' });
    return true;
  }

  return Object.freeze({
    // arc/
    readArc, patchArc, writeCheckinDay, writeGoals, writeProgress, writeSeasonJoin,
    // arcPublic/
    writeArcPublic, readArcPublic,
    // challenges/ + challengeMembers/ (Phase 2)
    createChallenge, readChallenge, joinChallenge, leaveChallenge, writeMyProgress, readMembers,
    // invites/ (Phase 2)
    sendInvite, readInvites, respondInvite,
    // status
    connected, myId
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ArcSync;
