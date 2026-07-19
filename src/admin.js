/* ═══════════════════════════════════════════════════════════════
   ASCA GYM — Admin Console
   A maintainer-only dashboard to inspect every athlete's profile,
   workouts and activity. Reuses the app's Firebase module
   (firebase-sync.js) for auth + reads. Access is gated to maintainer
   usernames (see ADMIN_PREFIXES) — anyone else who signs in is
   refused. Note: the RTDB rules already let any signed-in account
   read the directory + each gym/{id} node over REST, so this page
   only gates the *console UI*, not the data itself.
   ═══════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const ADMIN_PREFIXES = ['anshul'];

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let USERS = [];      // directory entries [{id,name,ts,avatar,bio,bw,following}]
  let DOCS = {};       // { id: normalizedDoc|null } full workout docs
  let sortKey = 'ts';
  let sortDir = -1;    // -1 desc, 1 asc
  let searchQ = '';

  // ── Metric helpers ───────────────────────────────────────
  function setVol(s) { return (parseFloat(s.weight) || 0) * (parseInt(s.reps, 10) || 0); }
  function woVol(w) { let v = 0; (w.exercises || []).forEach(e => (e.sets || []).forEach(s => { v += setVol(s); })); return v; }
  function totalVol(ws) { let v = 0; (ws || []).forEach(w => { v += woVol(w); }); return v; }
  function daysSince(dateStr) { const d = new Date(dateStr + 'T00:00:00'); return (Date.now() - d.getTime()) / 86400000; }
  function weekVol(ws) { let v = 0; (ws || []).forEach(w => { const dd = daysSince(w.date); if (dd >= 0 && dd < 7) v += woVol(w); }); return v; }
  function sessions(ws) { return (ws || []).filter(w => w && w.dayType !== 'Rest Day' && Array.isArray(w.exercises) && w.exercises.length); }
  function score(ws, bw) { const b = bw > 0 ? bw : 75; return Math.round(weekVol(ws) / b); }
  function setCount(w) { return (w.exercises || []).reduce((s, e) => s + (e.sets ? e.sets.length : 0), 0); }

  function followersOf(id, dir) {
    return dir.filter(u => u.id !== id && Array.isArray(u.following) && u.following.map(String).includes(String(id))).length;
  }

  function fmtNum(n) {
    n = Math.round(n || 0);
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(n);
  }
  function timeAgo(ms) {
    if (!ms) return 'never';
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    const d = Math.floor(s / 86400);
    if (d < 30) return d + 'd ago';
    if (d < 365) return Math.floor(d / 30) + 'mo ago';
    return Math.floor(d / 365) + 'y ago';
  }
  function fmtDate(dateStr) {
    try { return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
    catch (_) { return dateStr; }
  }

  function dayTypeColor(t) {
    t = (t || '').toLowerCase();
    if (t.includes('push')) return '#0A84FF';
    if (t.includes('pull')) return '#BF5AF2';
    if (t.includes('leg')) return '#30D158';
    if (t.includes('shoulder')) return '#FF9F0A';
    if (t.includes('rest')) return '#8E8E93';
    return '#FF7600';
  }

  function hashHue(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h; }
  function avatarBg(id) { const h = hashHue(id || '?'); return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 40) % 360} 70% 45%))`; }
  function avatarHtml(u) {
    const id = u.id || '?';
    const name = u.name || id;
    if (u.avatar) return `<div class="admin-avatar"><img src="${esc(u.avatar)}" alt=""></div>`;
    return `<div class="admin-avatar" style="background:${avatarBg(id)}">${esc((name[0] || '?').toUpperCase())}</div>`;
  }

  // ── Auth gate ────────────────────────────────────────────
  function isMaintainer(username) {
    const u = (username || '').toLowerCase();
    return ADMIN_PREFIXES.some(p => u.startsWith(p));
  }

  function showGate(msg) {
    $('adminGate').style.display = 'flex';
    $('adminShell').style.display = 'none';
    const err = $('adminGateErr');
    if (msg) { err.textContent = msg; err.style.display = 'block'; }
    else err.style.display = 'none';
  }

  async function enterConsole(user) {
    $('adminGate').style.display = 'none';
    $('adminShell').style.display = 'block';
    $('adminWhoami').innerHTML = 'Signed in as <b>@' + esc(user.username) + '</b>';
    await loadData();
  }

  async function attemptSignIn() {
    const err = $('adminGateErr');
    err.style.display = 'none';
    const btn = $('adminSignIn');
    const username = $('adminUser').value.trim();
    const password = $('adminPass').value;
    if (!username || !password) { err.textContent = 'Enter username and password'; err.style.display = 'block'; return; }
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      await FirebaseSync.signIn(username, password);
      const user = FirebaseSync.getUser();
      if (!user || !isMaintainer(user.username)) {
        showGate('Not authorized — maintainer accounts only.');
      } else {
        await enterConsole(user);
      }
    } catch (e) {
      err.textContent = (e && e.message) || 'Sign-in failed';
      err.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Enter Console';
    }
  }

  // ── Data load + render ───────────────────────────────────
  async function loadData() {
    $('adminOverview').innerHTML = '<div class="admin-loading" style="grid-column:1/-1">Loading athletes…</div>';
    $('adminTableBody').innerHTML = '<tr><td colspan="6" class="admin-loading">Loading…</td></tr>';
    $('adminActivity').innerHTML = '<div class="admin-loading">Loading…</div>';
    try {
      USERS = await FirebaseSync.listUsers();
      DOCS = await FirebaseSync.readAllDocs(USERS.map(u => u.id));
    } catch (e) {
      $('adminOverview').innerHTML = '<div class="admin-empty" style="grid-column:1/-1">Failed to load: ' + esc(e && e.message) + '</div>';
      return;
    }
    renderOverview();
    renderTable();
    renderActivity();
  }

  function docWorkouts(id) { const d = DOCS[id]; return (d && d.workouts) ? d.workouts : []; }

  function renderOverview() {
    let totalWorkouts = 0, grandVol = 0, activeWeek = 0;
    USERS.forEach(u => {
      const ws = sessions(docWorkouts(u.id));
      totalWorkouts += ws.length;
      grandVol += totalVol(ws);
      const recent = u.ts && (Date.now() - u.ts) < 7 * 86400000;
      if (recent) activeWeek++;
    });
    const cards = [
      { label: 'Athletes', val: USERS.length, sub: 'registered' },
      { label: 'Active this week', val: activeWeek, sub: 'synced in 7d' },
      { label: 'Total workouts', val: totalWorkouts, sub: 'across all users' },
      { label: 'Total volume', val: fmtNum(grandVol), sub: 'kg lifted' }
    ];
    $('adminOverview').innerHTML = cards.map(c =>
      `<div class="card glass-card admin-stat"><div class="admin-stat-label">${c.label}</div><div class="admin-stat-val">${c.val}</div><div class="admin-stat-sub">${c.sub}</div></div>`
    ).join('');
  }

  function userRows() {
    return USERS.map(u => {
      const ws = docWorkouts(u.id);
      const sess = sessions(ws);
      return {
        id: u.id,
        name: u.name || u.id,
        avatar: u.avatar,
        bio: u.bio,
        bw: u.bw,
        ts: u.ts || 0,
        workouts: sess.length,
        vol: totalVol(sess),
        week: weekVol(ws),
        score: score(ws, u.bw),
        followers: followersOf(u.id, USERS),
        following: Array.isArray(u.following) ? u.following.length : 0
      };
    });
  }

  function renderTable() {
    let rows = userRows();
    if (searchQ) {
      const q = searchQ.toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q) || (r.bio || '').toLowerCase().includes(q));
    }
    rows.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'name') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); return av < bv ? sortDir : av > bv ? -sortDir : 0; }
      return (av - bv) * sortDir;
    });
    $('adminUserCount').textContent = rows.length + ' athlete' + (rows.length === 1 ? '' : 's');
    const body = $('adminTableBody');
    if (!rows.length) { body.innerHTML = '<tr><td colspan="6" class="admin-empty">No athletes found.</td></tr>'; return; }
    body.innerHTML = rows.map(r => {
      const dd = r.ts ? (Date.now() - r.ts) / 86400000 : 999;
      const cls = dd < 7 ? 'hot' : dd < 30 ? 'warm' : 'cold';
      return `<tr data-id="${esc(r.id)}">
        <td><div class="admin-user-cell">${avatarHtml(r)}<div class="admin-user-meta"><span class="admin-user-name">${esc(r.name)}</span><span class="admin-user-id">@${esc(r.id)}</span></div></div></td>
        <td class="num">${r.workouts}</td>
        <td class="num">${fmtNum(r.vol)}</td>
        <td class="num">${r.score}</td>
        <td class="num">${r.followers}</td>
        <td class="num"><span class="admin-pill ${cls}">${timeAgo(r.ts)}</span></td>
      </tr>`;
    }).join('');
    body.querySelectorAll('tr[data-id]').forEach(tr => tr.addEventListener('click', () => openDrawer(tr.dataset.id)));
  }

  function renderActivity() {
    const feed = [];
    USERS.forEach(u => {
      sessions(docWorkouts(u.id)).forEach(w => feed.push({ id: u.id, name: u.name || u.id, avatar: u.avatar, w }));
    });
    feed.sort((a, b) => (b.w.date || '').localeCompare(a.w.date || ''));
    const el = $('adminActivity');
    if (!feed.length) { el.innerHTML = '<div class="admin-empty">No activity yet.</div>'; return; }
    el.innerHTML = feed.slice(0, 80).map(({ id, name, avatar, w }) => {
      const vol = woVol(w);
      const dtc = dayTypeColor(w.dayType);
      return `<div class="admin-act-item" data-id="${esc(id)}" style="cursor:pointer">
        ${avatarHtml({ id, name, avatar })}
        <div class="admin-act-body">
          <div class="admin-act-line1">${esc(name)} <span>· ${esc(w.dayType || 'Workout')}</span></div>
          <div class="admin-act-line2">${fmtDate(w.date)} · ${w.exercises.length} exercises · ${setCount(w)} sets</div>
        </div>
        <div class="admin-act-vol" style="color:${dtc}">${fmtNum(vol)} kg</div>
      </div>`;
    }).join('');
    el.querySelectorAll('.admin-act-item[data-id]').forEach(it => it.addEventListener('click', () => openDrawer(it.dataset.id)));
  }

  // ── Detail drawer ────────────────────────────────────────
  function openDrawer(id) {
    const u = USERS.find(x => x.id === id) || { id, name: id };
    const ws = docWorkouts(id);
    const sess = sessions(ws);
    const doc = DOCS[id];
    const me = FirebaseSync.getUser();
    // Deletable only if the node's uid matches the signed-in maintainer —
    // the same condition the RTDB write rule enforces.
    const mine = !!(me && doc && doc.uid && doc.uid === me.uid);
    $('adminDrawerHead').innerHTML = `
      ${avatarHtml(u)}
      <div style="min-width:0">
        <div style="font-family:var(--ff-title);font-size:1.15rem;font-weight:800">${esc(u.name || id)}</div>
        <div style="font-size:0.78rem;color:var(--t-3)">@${esc(id)}${u.bio ? ' · ' + esc(u.bio) : ''}</div>
      </div>
      <button class="btn-close admin-drawer-close" id="adminDrawerClose" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>`;
    const mini = [
      { v: sess.length, l: 'Workouts' },
      { v: fmtNum(totalVol(sess)), l: 'Volume kg' },
      { v: score(ws, u.bw), l: 'Score' },
      { v: u.bw ? u.bw + 'kg' : '—', l: 'Body wt' }
    ];
    const legacy = doc && !doc.workouts && doc.blob ? '<div class="admin-wo-meta" style="margin-bottom:12px">⚠︎ Legacy compressed data — workout details not expanded here.</div>' : '';
    const woHtml = sess.length
      ? sess.slice(0, 60).map(w => {
          const dtc = dayTypeColor(w.dayType);
          return `<div class="admin-wo">
            <div class="admin-wo-head">
              <span class="admin-wo-date">${fmtDate(w.date)}</span>
              <span class="admin-wo-type" style="background:${dtc}22;color:${dtc}">${esc(w.dayType || 'Workout')}</span>
            </div>
            <div class="admin-wo-meta">${w.exercises.length} exercises · ${setCount(w)} sets · ${fmtNum(woVol(w))} kg volume</div>
          </div>`;
        }).join('')
      : '<div class="admin-empty">No workouts logged.</div>';
    $('adminDrawerBody').innerHTML = `
      <div class="admin-mini-stats">${mini.map(m => `<div class="admin-mini-stat"><div class="admin-mini-stat-val">${m.v}</div><div class="admin-mini-stat-label">${m.l}</div></div>`).join('')}</div>
      <div style="display:flex;gap:16px;margin-bottom:18px;font-size:0.78rem;color:var(--t-2);font-weight:700">
        <span><b style="color:#fff">${Array.isArray(u.following) ? u.following.length : 0}</b> following</span>
        <span><b style="color:#fff">${followersOf(id, USERS)}</b> followers</span>
        <span>Last active <b style="color:#fff">${timeAgo(u.ts)}</b></span>
      </div>
      ${legacy}
      <div class="admin-section-title" style="margin-top:0;font-size:0.9rem">Workout history</div>
      ${woHtml}
      <div class="admin-section-title" style="font-size:0.9rem;color:#ff5a5a">Danger zone</div>
      <div class="admin-wo-meta" style="margin-bottom:10px">${mine
        ? 'Permanently delete this account’s <b>gym</b> and <b>directory</b> nodes. Use this to clear orphan accounts left behind by username changes.'
        : 'This account isn’t yours — the database rules only let you delete accounts you own (same login). Deleting it here will be rejected.'}</div>
      <button id="adminDeleteBtn" class="admin-danger-btn" data-id="${esc(id)}" style="background:${mine ? 'rgba(255,60,60,0.14)' : 'rgba(120,120,120,0.14)'};color:${mine ? '#ff5a5a' : 'var(--t-3)'};border:1px solid ${mine ? 'rgba(255,60,60,0.4)' : 'rgba(120,120,120,0.3)'};border-radius:10px;padding:10px 16px;font-weight:800;font-size:0.82rem;cursor:pointer;font-family:inherit">Delete @${esc(id)}</button>`;
    $('adminDrawerClose').addEventListener('click', closeDrawer);
    bindDeleteBtn(id);
    $('adminDrawerBg').classList.add('open');
    $('adminDrawer').classList.add('open');
  }

  // Two-step, no blocking dialog: first click arms, second click deletes.
  function bindDeleteBtn(id) {
    const btn = $('adminDeleteBtn');
    if (!btn) return;
    let armed = false, timer = null;
    btn.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btn.textContent = 'Click again to confirm delete';
        timer = setTimeout(() => { armed = false; btn.textContent = 'Delete @' + id; }, 4000);
        return;
      }
      clearTimeout(timer);
      btn.disabled = true; btn.textContent = 'Deleting…';
      try {
        await FirebaseSync.deleteDoc(id);
        closeDrawer();
        await loadData();
      } catch (e) {
        btn.disabled = false; armed = false;
        btn.textContent = 'Delete @' + id;
        let msg = document.getElementById('adminDeleteErr');
        if (!msg) {
          msg = document.createElement('div');
          msg.id = 'adminDeleteErr';
          msg.className = 'admin-wo-meta';
          msg.style.cssText = 'color:#ff5a5a;margin-top:10px';
          btn.insertAdjacentElement('afterend', msg);
        }
        msg.textContent = (e && e.message) || 'Delete failed';
      }
    });
  }
  function closeDrawer() {
    $('adminDrawerBg').classList.remove('open');
    $('adminDrawer').classList.remove('open');
  }

  // ── Wire up ──────────────────────────────────────────────
  function bind() {
    $('adminSignIn').addEventListener('click', attemptSignIn);
    $('adminPass').addEventListener('keydown', e => { if (e.key === 'Enter') attemptSignIn(); });
    $('adminUser').addEventListener('keydown', e => { if (e.key === 'Enter') $('adminPass').focus(); });
    $('adminRefresh').addEventListener('click', loadData);
    $('adminSignOut').addEventListener('click', () => { FirebaseSync.signOut(); showGate(); });
    $('adminSearch').addEventListener('input', e => { searchQ = e.target.value; renderTable(); });
    $('adminDrawerBg').addEventListener('click', closeDrawer);
    document.querySelectorAll('#adminTable thead th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) sortDir = -sortDir;
        else { sortKey = key; sortDir = (key === 'name') ? 1 : -1; }
        document.querySelectorAll('#adminTable thead th .sort-caret').forEach(c => c.remove());
        const caret = document.createElement('span');
        caret.className = 'sort-caret';
        caret.textContent = sortDir === 1 ? '▲' : '▼';
        th.appendChild(caret);
        renderTable();
      });
    });
  }

  async function init() {
    bind();
    if (!FirebaseSync.getConfig().backendReady) {
      showGate('Backend not configured.');
      return;
    }
    // Auto-enter if a maintainer session is already restored (shared origin).
    try {
      const res = await FirebaseSync.restoreSession();
      const user = FirebaseSync.getUser();
      if (res && res !== 'offline' && user && isMaintainer(user.username)) {
        await enterConsole(user);
        return;
      }
    } catch (_) {}
    showGate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
