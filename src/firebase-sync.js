/* ═══════════════════════════════════════════════════════════════
   ASCA GYM TRACKER — Firebase Backend Module (Auth + Firestore)

   The app's single backend, spoken to over plain REST — no SDK
   and no external <script>, so it works from the static GitHub
   Pages bundle.

   SINGLE SHARED BACKEND: every user of the site talks to the
   same Firebase project, baked in below at build time. Users
   are real Firebase Authentication accounts (email + password);
   the old PIN + salt scheme is gone. Sign-in state persists in
   localStorage and tokens are refreshed automatically.

   Each user owns one Firestore document at gym/{syncId} holding
   { uid, ts, blob } where blob is a compressed progress code
   (built in app.js). Security rules require sign-in to read and
   ownership (uid) to write, so the blob no longer needs client-
   side encryption. Firestore is the source of truth; browser
   localStorage is only a cache.
   ═══════════════════════════════════════════════════════════════ */

const FirebaseSync = (() => {
  // ── The one shared backend (fill in after creating the project) ──
  const FIREBASE_PROJECT_ID = 'asca-gym';
  const FIREBASE_API_KEY = 'AIzaSyCAvGn9blvhx-sGINHwbasYcx8LH1A-4mk';

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
    userId: '',        // my document id under gym/, e.g. "anshul"
    displayName: '',   // shown to followers; defaults to userId
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

  // ── Firestore ────────────────────────────────────────────
  function docUrl(docId) {
    return 'https://firestore.googleapis.com/v1/projects/' +
      encodeURIComponent(FIREBASE_PROJECT_ID) +
      '/databases/(default)/documents/gym/' +
      encodeURIComponent(docId);
  }

  // Read a user's doc; returns { uid, ts, blob } or null when missing.
  async function readDoc(docId) {
    if (!hasBackend() || !docId) return null;
    const token = await getIdToken();
    const res = await fetch(docUrl(docId), {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Firestore responded ' + res.status);
    const doc = await res.json();
    const f = doc.fields || {};
    return {
      uid: f.uid && f.uid.stringValue ? f.uid.stringValue : '',
      ts: f.ts ? parseInt(f.ts.integerValue || f.ts.doubleValue || 0, 10) : 0,
      blob: f.blob && f.blob.stringValue ? f.blob.stringValue : ''
    };
  }

  // Create-or-overwrite gym/{userId} with { uid, ts, blob, name }.
  // The top-level name field makes user search possible without
  // decoding blobs; if the project still runs the older rules that
  // reject it, we retry without the field so sync keeps working.
  async function writeDoc(payload) {
    loadConfig();
    if (!isConnected()) throw new Error('Firebase not configured');
    const token = await getIdToken();

    async function attempt(includeName) {
      const fields = {
        uid: { stringValue: auth.uid },
        ts: { integerValue: String(payload.ts || Date.now()) },
        blob: { stringValue: payload.blob || '' }
      };
      if (includeName) {
        fields.name = { stringValue: (config.displayName || config.userId || '').slice(0, 60) };
      }
      return fetch(docUrl(config.userId), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ fields })
      });
    }

    let res = await attempt(true);
    if (res.status === 403) res = await attempt(false);
    if (res.status === 403) throw new Error('That Sync ID belongs to another account');
    if (!res.ok) throw new Error('Firestore responded ' + res.status);
    return true;
  }

  // ── User directory (for Find Friends search) ─────────────
  // Lists every gym/ doc's id + display name via a field mask, so no
  // blobs are downloaded. Fine at this scale; paginates just in case.
  async function listUsers() {
    if (!hasBackend()) return [];
    const token = await getIdToken();
    const users = [];
    let pageToken = '';
    do {
      const url = 'https://firestore.googleapis.com/v1/projects/' +
        encodeURIComponent(FIREBASE_PROJECT_ID) +
        '/databases/(default)/documents/gym?pageSize=300&mask.fieldPaths=name&mask.fieldPaths=ts' +
        (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) throw new Error('Firestore responded ' + res.status);
      const data = await res.json();
      (data.documents || []).forEach(d => {
        const id = decodeURIComponent(d.name.split('/').pop());
        const f = d.fields || {};
        users.push({
          id,
          name: f.name && f.name.stringValue ? f.name.stringValue : '',
          ts: f.ts ? parseInt(f.ts.integerValue || 0, 10) : 0
        });
      });
      pageToken = data.nextPageToken || '';
    } while (pageToken);
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
    readDoc,
    writeDoc,
    listUsers,
    isConnected,
    getConfig
  };
})();
