/* ═══════════════════════════════════════════════════════════════
   ASCA GYM TRACKER — Firebase Backend Module (Auth + Realtime DB)

   The app's single backend, spoken to over plain REST — no SDK
   and no external <script>, so it works from the static GitHub
   Pages bundle.

   SINGLE SHARED BACKEND: every user of the site talks to the
   same Firebase project, baked in below at build time. Users
   are real Firebase Authentication accounts (email + password);
   the old PIN + salt scheme is gone. Sign-in state persists in
   localStorage and tokens are refreshed automatically.

   Each user owns one Realtime Database node at gym/{syncId}:
     { uid, ts, name, avatar, github, following: [ids],
       workouts: { "YYYY-MM-DD": { dayType, exercises: [...] } } }
   Workouts are stored day-wise (date-keyed), so the data is
   directly browsable in the RTDB console. Old docs that still
   hold a compressed `blob` progress code are decoded by app.js
   on read. Security rules require sign-in to read and ownership
   (uid) to write. RTDB is the source of truth; browser
   localStorage is only a cache. A parallel directory/{syncId}
   node holds { name, ts } for lightweight user listings.
   ═══════════════════════════════════════════════════════════════ */

const FirebaseSync = (() => {
  // ── The one shared backend (fill in after creating the project) ──
  const FIREBASE_PROJECT_ID = 'asca-gym';
  const FIREBASE_API_KEY = 'AIzaSyCAvGn9blvhx-sGINHwbasYcx8LH1A-4mk';
  const FIREBASE_RTDB_URL = 'https://asca-gym-default-rtdb.firebaseio.com';

  // Users sign in with a username; Firebase Auth only speaks email, so
  // usernames are mapped to a synthetic address on this fake domain.
  // Existing full-email accounts still work (input containing @ passes
  // through untouched).
  const USERNAME_DOMAIN = 'asca-gym.app';

  function usernameToEmail(name) {
    name = (name || '').trim().toLowerCase();
    if (name.includes('@')) return name;
    if (!/^[a-z0-9._-]+$/.test(name)) {
      throw new Error('Usernames can only use letters, numbers, dots, dashes and underscores');
    }
    return name + '@' + USERNAME_DOMAIN;
  }

  function emailToUsername(email) {
    return (email || '').split('@')[0];
  }

  const CONFIG_KEY = 'asca_gym_firebase_config';  // sync ids + friend name
  const AUTH_KEY = 'asca_gym_auth';               // tokens + user info

  let config = {
    userId: '',        // my node id under gym/, e.g. "anshul"
    displayName: '',   // shown to followers; defaults to userId
    avatar: '',        // small base64 data-URI profile photo
    bio: '',           // short profile tagline
    github: '',        // optional GitHub username
    following: []      // Strava-style follow list: [{ id, name }]
  };

  // { uid, email, idToken, refreshToken, exp } or null
  let auth = null;

  // ── Config (sync identity) ───────────────────────────────
  function loadConfig() {
    try {
      const saved = localStorage.getItem(CONFIG_KEY);
      if (saved) {
        const s = JSON.parse(saved);
        config.userId = s.userId || '';
        config.displayName = s.displayName || '';
        config.avatar = s.avatar || '';
        config.bio = s.bio || '';
        config.github = s.github || '';
        if (Array.isArray(s.following)) {
          config.following = s.following
            .filter(f => f && f.id)
            .map(f => ({ id: String(f.id), name: f.name || '' }));
        } else if (s.friendId) {
          // Migrate the old single-friend config into the follow list
          config.following = [{ id: s.friendId, name: (s.friendName && s.friendName !== 'Friend') ? s.friendName : '' }];
          saveConfig();
        }
      }
    } catch (e) {
      console.warn('Failed to load firebase config:', e);
    }
    return config;
  }

  function saveConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      console.warn('Failed to save firebase config:', e);
    }
  }

  function updateConfig(partial) {
    config = { ...config, ...partial };
    saveConfig();
    return getConfig();
  }

  function hasBackend() {
    return !!(FIREBASE_PROJECT_ID && FIREBASE_API_KEY);
  }

  // ── Auth state ───────────────────────────────────────────
  function loadAuth() {
    try {
      const saved = localStorage.getItem(AUTH_KEY);
      auth = saved ? JSON.parse(saved) : null;
    } catch (_) {
      auth = null;
    }
    return auth;
  }

  function saveAuth() {
    try {
      if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
      else localStorage.removeItem(AUTH_KEY);
    } catch (_) {}
  }

  function setAuthFromTokenResponse(d) {
    auth = {
      uid: d.localId || d.user_id || (auth && auth.uid) || '',
      email: d.email || (auth && auth.email) || '',
      idToken: d.idToken || d.id_token,
      refreshToken: d.refreshToken || d.refresh_token,
      exp: Date.now() + (parseInt(d.expiresIn || d.expires_in || 3600, 10) - 120) * 1000
    };
    saveAuth();
    return auth;
  }

  function authErrorMessage(code) {
    const map = {
      EMAIL_NOT_FOUND: 'No account with that username',
      INVALID_PASSWORD: 'Wrong password',
      INVALID_LOGIN_CREDENTIALS: 'Wrong username or password',
      EMAIL_EXISTS: 'That username is already taken',
      WEAK_PASSWORD: 'Password must be at least 6 characters',
      INVALID_EMAIL: 'That username is not valid',
      USER_DISABLED: 'This account has been disabled',
      TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts — try again later',
      OPERATION_NOT_ALLOWED: 'Email/password sign-in is not enabled in Firebase',
      ADMIN_ONLY_OPERATION: 'New sign-ups are disabled'
    };
    const key = String(code || '').split(' ')[0].split(':')[0];
    return map[key] || ('Sign-in failed: ' + code);
  }

  async function identityCall(endpoint, body) {
    if (!hasBackend()) throw new Error('This build has no Firebase backend configured');
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(authErrorMessage(data.error && data.error.message));
    return data;
  }

  async function signUp(username, password) {
    const email = usernameToEmail(username);
    const d = await identityCall('signUp', { email, password, returnSecureToken: true });
    return setAuthFromTokenResponse(d);
  }

  async function signIn(username, password) {
    const email = usernameToEmail(username);
    const d = await identityCall('signInWithPassword', { email, password, returnSecureToken: true });
    return setAuthFromTokenResponse(d);
  }

  function signOut() {
    auth = null;
    saveAuth();
  }

  async function refreshToken() {
    if (!auth || !auth.refreshToken) throw new Error('Not signed in');
    const res = await fetch(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(FIREBASE_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(auth.refreshToken)
      }
    );
    const data = await res.json();
    if (!res.ok) {
      // Refresh token revoked/expired — session is dead
      signOut();
      throw new Error('Session expired — please sign in again');
    }
    return setAuthFromTokenResponse(data);
  }

  async function getIdToken() {
    if (!auth) loadAuth();
    if (!auth) throw new Error('Not signed in');
    if (Date.now() >= (auth.exp || 0)) await refreshToken();
    return auth.idToken;
  }

  // Restore a persisted session on page load.
  // Returns { uid, email } when signed in, 'offline' when we have a
  // saved session but the network is unreachable, or null when the
  // user must sign in.
  async function restoreSession() {
    loadAuth();
    if (!hasBackend() || !auth || !auth.refreshToken) return null;
    if (Date.now() < (auth.exp || 0)) return getUser();
    try {
      await refreshToken();
      return getUser();
    } catch (e) {
      if (!auth) return null;          // refresh rejected → signed out
      return 'offline';                // network error → allow cached use
    }
  }

  function getUser() {
    if (!auth) loadAuth();
    return auth ? { uid: auth.uid, email: auth.email, username: emailToUsername(auth.email) } : null;
  }

  // ── Firebase Realtime Database ───────────────────────────
  function dbUrl(path) {
    const baseUrl = (typeof FIREBASE_RTDB_URL !== 'undefined' && FIREBASE_RTDB_URL)
      ? FIREBASE_RTDB_URL.replace(/\/$/, '')
      : `https://${FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`;
    return `${baseUrl}/${path}`;
  }

  // RTDB has no real arrays: they round-trip as objects with numeric
  // keys when sparse, and empty ones vanish entirely.
  function toArr(v) {
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      return Object.keys(v).sort((a, b) => (+a) - (+b)).map(k => v[k]);
    }
    return [];
  }

  // workouts array [{date, dayType, exercises}] ⇄ date-keyed map
  // { "YYYY-MM-DD": { dayType, exercises } } as stored in RTDB.
  function workoutsToMap(list) {
    const map = {};
    (list || []).forEach(w => {
      if (!w || !w.date) return;
      const { date, ...rest } = w;
      map[date] = rest;
    });
    return map;
  }

  function workoutsToArray(map) {
    if (!map || typeof map !== 'object') return null;
    return Object.entries(map)
      .map(([date, w]) => ({
        date,
        ...(w || {}),
        exercises: toArr(w && w.exercises).map(e => ({ ...e, sets: toArr(e && e.sets) }))
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  // Shape a raw gym/{id} node (from readDoc or an EventSource packet)
  // into { uid, ts, name, avatar, github, following, workouts, blob }.
  // `workouts` is an array (or null for legacy blob-only docs, whose
  // `blob` app.js still knows how to decode).
  function normalizeDocData(data) {
    if (!data) return null;
    return {
      uid: data.uid || '',
      ts: data.ts || 0,
      name: data.name || '',
      avatar: data.avatar || '',
      bio: data.bio || '',
      github: data.github || '',
      following: toArr(data.following).map(String),
      workouts: workoutsToArray(data.workouts),
      blob: data.blob || ''
    };
  }

  // Read a user's node; returns the normalized doc or null when missing.
  async function readDoc(docId) {
    if (!hasBackend() || !docId) return null;
    const token = await getIdToken();
    const res = await fetch(dbUrl(`gym/${encodeURIComponent(docId)}.json?auth=${token}`));
    if (!res.ok) throw new Error('Database responded ' + res.status);
    return normalizeDocData(await res.json());
  }

  // Create-or-overwrite gym/{userId} with the structured day-wise doc
  // ({ ts, workouts: [...] } in; profile fields come from config) and
  // refresh the directory metadata.
  async function writeDoc(payload) {
    loadConfig();
    if (!isConnected()) throw new Error('Firebase not configured');
    const token = await getIdToken();

    const data = {
      uid: auth.uid,
      ts: payload.ts || Date.now(),
      name: (config.displayName || config.userId || '').slice(0, 60),
      avatar: config.avatar || '',
      bio: (config.bio || '').slice(0, 120),
      github: config.github || '',
      following: (config.following || []).map(f => f.id),
      workouts: workoutsToMap(payload.workouts)
    };

    const res1 = await fetch(dbUrl(`gym/${encodeURIComponent(config.userId)}.json?auth=${token}`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });
    
    if (res1.status === 403 || res1.status === 401) {
      throw new Error('That Sync ID belongs to another account');
    }
    if (!res1.ok) throw new Error('Database responded ' + res1.status);

    // Save directory metadata for lightweight listings: name + avatar
    // for search results, following ids so anyone can compute follower
    // counts without downloading workout data.
    const meta = {
      name: data.name,
      ts: data.ts,
      avatar: data.avatar,
      bio: data.bio,
      following: data.following
    };
    await fetch(dbUrl(`directory/${encodeURIComponent(config.userId)}.json?auth=${token}`), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(meta)
    });

    return true;
  }

  // Lists every directory metadata entry
  async function listUsers() {
    if (!hasBackend()) return [];
    const token = await getIdToken();
    const res = await fetch(dbUrl(`directory.json?auth=${token}`));
    if (!res.ok) throw new Error('Database responded ' + res.status);
    const data = await res.json();
    if (!data) return [];
    const users = [];
    Object.entries(data).forEach(([id, u]) => {
      users.push({
        id,
        name: (u && u.name) || id,
        ts: (u && u.ts) || 0,
        avatar: (u && u.avatar) || '',
        bio: (u && u.bio) || '',
        following: toArr(u && u.following).map(String)
      });
    });
    return users;
  }

  // ── Status ───────────────────────────────────────────────
  function isConnected() {
    return hasBackend() && !!getUser() && !!config.userId;
  }

  function getConfig() {
    loadConfig();
    return {
      ...config,
      following: config.following.map(f => ({ ...f })),
      projectId: FIREBASE_PROJECT_ID,
      backendReady: hasBackend(),
      user: getUser(),
      connected: isConnected()
    };
  }

  // Initialize
  loadConfig();
  loadAuth();

  return {
    updateConfig,
    signUp,
    signIn,
    signOut,
    restoreSession,
    getUser,
    getIdToken,
    readDoc,
    writeDoc,
    normalizeDocData,
    listUsers,
    isConnected,
    getConfig
  };
})();
