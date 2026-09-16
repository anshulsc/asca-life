/* ═══════════════════════════════════════════════════════════════
   NUTRITION SYNC — RTDB access for the calorie & nutrition tracker

   Same plain-REST, no-SDK, targeted-PATCH discipline as ArcSync (which
   this file mirrors deliberately: see arc-sync.js's own header for why
   full-node writes are forbidden). This module owns ONE new top-level
   node, username-keyed and PRIVATE to its owner:

     nutrition/{userId}/
       profile                     body stats used for BMR/TDEE
       goals                       goal kind + rate/deficit + macro targets
       foods/{foodId}              saved custom foods (per-100g / serving / piece)
       recipes/{recipeId}          multi-ingredient meals with servings
       days/{YYYY-MM-DD}           meals + quick-adds for one local day
       weights/{YYYY-MM-DD}        daily body-weight log (dated series)
       measurements/{YYYY-MM-DD}   waist/neck/etc., dated

   Nothing here writes anywhere else: the app's legacy single-value body
   weight (gym/{id}/bw, the ASCA Score input) is maintained by app.js
   itself — this module patches only nutrition/.
   ═══════════════════════════════════════════════════════════════ */
const NutritionSync = (() => {
  'use strict';

  function hasBackend() {
    return typeof FirebaseSync !== 'undefined' && FirebaseSync.isConnected
      ? FirebaseSync.isConnected()
      : false;
  }

  function myId() {
    const cfg = (typeof FirebaseSync !== 'undefined') ? FirebaseSync.getConfig() : null;
    return cfg ? cfg.userId : '';
  }

  function connected() {
    return typeof FirebaseSync !== 'undefined' && FirebaseSync.isConnected();
  }

  // Mirrors arc-sync.js / app.js rather than reaching into FirebaseSync's
  // closure — one function so a future URL change has a known home.
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

  function nutPath(userId, sub) {
    let p = `nutrition/${encodeURIComponent(userId)}`;
    if (sub) p += `/${sub}`;
    return p + '.json';
  }

  /* Whole-node read — used once at boot to hydrate a fresh device.
     The node stays small (foods/recipes/profile/goals + day-wise logs),
     so a single GET is fine and keeps the merge trivial. A 401/403 with
     an older published ruleset is remembered for the session so the UI
     can say "sync needs the updated rules" instead of failing silently. */
  let denied = false;
  function wasDenied() { return denied; }

  async function readAll() {
    if (!hasBackend()) return null;
    const id = myId();
    if (!id) return null;
    try {
      const token = await tok();
      const res = await fetch(dbUrl(`${nutPath(id)}?auth=${token}`));
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) denied = true;
        return null;
      }
      return await res.json();
    } catch (_) { return null; }
  }

  // The one writer every other function goes through — PATCH to a
  // subpath, never PUT at the node root.
  async function patchNode(sub, value) {
    requireConnected();
    const id = myId();
    const token = await tok();
    const res = await fetch(dbUrl(`${nutPath(id, sub)}?auth=${token}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) denied = true;
      throw new Error('Nutrition sync not enabled yet');
    }
    return true;
  }

  async function deleteNode(sub) {
    requireConnected();
    const id = myId();
    const token = await tok();
    const res = await fetch(dbUrl(`${nutPath(id, sub)}?auth=${token}`), { method: 'DELETE' });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) denied = true;
      throw new Error('Nutrition sync not enabled yet');
    }
    return true;
  }

  /* Stamps uid/ts on the sub-documents the rules validate, and strips
     nulls before send (RTDB drops null keys silently — a stripped key
     is a deliberate omission, never an accident). */
  function clean(obj) {
    const out = {};
    Object.keys(obj || {}).forEach(k => { if (obj[k] != null) out[k] = obj[k]; });
    return out;
  }

  function stamp() {
    const me = FirebaseSync.getUser();
    return { uid: me.uid, ts: Date.now() };
  }

  const writeProfile = p => patchNode('profile', clean(Object.assign(stamp(), p)));
  const writeGoals = g => patchNode('goals', clean(Object.assign(stamp(), g)));
  const writeFood = (id, f) => patchNode(`foods/${encodeURIComponent(id)}`, clean(Object.assign(stamp(), f)));
  const deleteFood = id => deleteNode(`foods/${encodeURIComponent(id)}`);
  const writeRecipe = (id, r) => patchNode(`recipes/${encodeURIComponent(id)}`, clean(Object.assign(stamp(), r)));
  const deleteRecipe = id => deleteNode(`recipes/${encodeURIComponent(id)}`);
  const writeDay = (date, d) => patchNode(`days/${encodeURIComponent(date)}`, clean(d));
  const writeWeight = (date, kg) => patchNode(`weights/${encodeURIComponent(date)}`, kg);
  const deleteWeight = date => deleteNode(`weights/${encodeURIComponent(date)}`);
  const writeMeasurements = (date, m) => patchNode(`measurements/${encodeURIComponent(date)}`, clean(m));
  // Small meta maps (activity mode, custom meal names) — plain value PATCHes.
  const writeMeta = (key, value) => patchNode(encodeURIComponent(key), value);

  /* Boot merge: cloud wins for records the local cache has never seen
     (fresh device), local wins where both exist (localStorage is the
     offline-first live copy and always holds the newest edit). Returns
     the merged state; callers persist + re-render from it. */
  function mergeCloud(local, cloud) {
    if (!cloud) return local;
    const out = Object.assign({}, local);
    const mergeMap = (a, b) => Object.assign({}, b || {}, a || {});
    out.profile = local.profile || cloud.profile || null;
    out.goals = local.goals || cloud.goals || null;
    out.foods = mergeMap(local.foods, cloud.foods);
    out.recipes = mergeMap(local.recipes, cloud.recipes);
    out.days = mergeMap(local.days, cloud.days);
    out.weights = mergeMap(local.weights, cloud.weights);
    out.measurements = mergeMap(local.measurements, cloud.measurements);
    out.mealNames = mergeMap(local.mealNames, cloud.mealNames);
    out.activity = local.activity || cloud.activity || null;
    out.startedWeight = local.startedWeight != null ? local.startedWeight : (cloud.startedWeight != null ? cloud.startedWeight : null);
    return out;
  }

  return Object.freeze({
    connected, wasDenied, readAll, myId,
    writeProfile, writeGoals,
    writeFood, deleteFood, writeRecipe, deleteRecipe,
    writeDay, writeWeight, deleteWeight, writeMeasurements, writeMeta,
    mergeCloud
  });
})();
