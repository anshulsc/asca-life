/* ═══════════════════════════════════════════════════════════════
   ASCA GYM — Liquid Glass Logic v2.0
   Dropset features • Routine Cards • Heatmap Calendar • Analytics
   ═══════════════════════════════════════════════════════════════ */
(() => {
'use strict';
const WK='asca_gym_workouts',CK='asca_gym_custom_ex',BWK='asca_gym_bodyweight',RK='asca_gym_routines',SEK='asca_gym_session_exercises';
let W=[],CX={},SE=[],eEx=null,eSets=[],filt='all',mCb=null,eMode='weight',timerSecs=0,timerTotal=0,timerInterval=null,timerRunning=false,timerEndTime=0;

function persistSE(){try{localStorage.setItem(SEK,JSON.stringify(SE));}catch(e){}}
function restoreSE(){try{const d=localStorage.getItem(SEK);if(d){SE=JSON.parse(d);if(SE.length){renderLogged();document.getElementById('acts').style.display='flex';}}}catch(e){SE=[];}}

const WEEKLY_TARGET = 5;

function init(){
  bindLockScreen();
}

function startApp() {
  load();loadCX();fillTypes();bindTabs();bindSearch();bindSets();bindActs();
  bindHist();bindAna();bindSettings();bindModal();bindLibraryModal();bindVolInsights();bindTimer();bindBodyWeight();bindFriend();
  setToday();renderRecent();renderBodyWeight();renderHeatmapCalendar();renderVolWidget();renderProfile();
  restoreSE();
  
  // Real-time synchronization stream: sub-second updates using EventSource
  if(fbCfg().connected){
    startRealtimeSync();
  }
  
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden){
      stopRealtimeSync();
      startRealtimeSync();
    }else{
      stopRealtimeSync();
    }
  });

  if (typeof updateSetupHeatmap === 'function') {
    updateSetupHeatmap(document.getElementById('wType').value);
  }
}

function renderLockHeatmapPreview() {
  const grid = document.getElementById('lockHeatmapGrid');
  const monthsEl = document.getElementById('lockHeatmapMonths');
  if (!grid) return;
  const today = new Date();
  const weeks = 24;
  const days = weeks * 7;

  const dateWorkouts = {};
  const sourceData = (typeof W !== 'undefined' && W.length) ? W : (typeof HISTORICAL_DATA !== 'undefined' ? HISTORICAL_DATA : []);
  sourceData.forEach(w => {
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

  grid.innerHTML = '';
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
      const dot = document.createElement('div');
      dot.className = `lock-heatmap-dot ${lvl}`;
      if (isFuture) {
        dot.style.visibility = 'hidden';
        dot.style.pointerEvents = 'none';
      }

      const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      const formattedDate = d.toLocaleDateString('en-US', options);
      dot.title = info ? `${formattedDate}\nWorkout Day` : `${formattedDate}\nRest Day`;
      grid.appendChild(dot);

      // Track months
      const monthKey = d.getFullYear() + '-' + d.getMonth();
      if (!seenMonths.has(monthKey) && row === 0) {
        seenMonths.add(monthKey);
        monthLabels.push({ name: monthNames[d.getMonth()], col: col + 1 });
      }
    }
  }

  if (monthsEl) {
    monthsEl.innerHTML = monthLabels
      .map(m => `<span class="lock-heatmap-month-label" style="left: ${(m.col - 1) * 8}px;">${m.name}</span>`)
      .join('');
  }
}

/* ── Login Screen (Firebase Auth) ──────────────────────────── */
function bindLockScreen() {
  const lockScreen = document.getElementById('lockScreen');
  const form = document.getElementById('loginForm');
  if (!lockScreen || !form) return;

  const subtitle = document.getElementById('lockSubtitle');
  const userInput = document.getElementById('loginUser');
  const passInput = document.getElementById('loginPassword');
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('btnLogin');
  const modeToggle = document.getElementById('loginModeToggle');
  let signUpMode = false;

  renderLockHeatmapPreview();

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg || '';
    errorEl.style.display = msg ? 'block' : 'none';
  }

  function unlock() {
    // Seed my Sync ID from the username the first time around
    const cfg = FirebaseSync.getConfig();
    if (!cfg.userId) {
      const user = FirebaseSync.getUser();
      const name = user && user.username ? user.username.replace(/[^a-z0-9_-]/gi, '').toLowerCase() : '';
      if (name) FirebaseSync.updateConfig({ userId: name });
    }
    lockScreen.classList.add('unlocked');
    startApp();
  }

  async function submit() {
    const username = (userInput.value || '').trim();
    const pass = passInput.value || '';
    if (!username || !pass) { showError('Enter your username and password'); return; }
    showError('');
    btn.disabled = true;
    btn.textContent = signUpMode ? 'Creating account…' : 'Signing in…';
    try {
      if (signUpMode) await FirebaseSync.signUp(username, pass);
      else await FirebaseSync.signIn(username, pass);
      unlock();
    } catch (e) {
      showError(e.message || 'Sign-in failed');
    } finally {
      btn.disabled = false;
      btn.textContent = signUpMode ? 'Create Account' : 'Sign In';
    }
  }

  btn.addEventListener('click', submit);
  [userInput, passInput].forEach(el => el.addEventListener('keydown', e => {
    if (e.key === 'Enter') submit();
  }));

  if (modeToggle) {
    modeToggle.addEventListener('click', () => {
      signUpMode = !signUpMode;
      if (subtitle) subtitle.textContent = signUpMode ? 'Create your account' : 'Sign in to your account';
      btn.textContent = signUpMode ? 'Create Account' : 'Sign In';
      modeToggle.textContent = signUpMode ? 'Already have an account? Sign in' : 'New here? Create an account';
      if (passInput) passInput.autocomplete = signUpMode ? 'new-password' : 'current-password';
      showError('');
    });
  }

  // Auto sign-in from a persisted session; 'offline' means we have a
  // session but no network — enter with the cached data.
  if (typeof FirebaseSync === 'undefined' || !FirebaseSync.getConfig().backendReady) {
    if (subtitle) subtitle.textContent = 'Backend not configured in this build';
    showError('Add the Firebase project credentials to src/firebase-sync.js and rebuild.');
    return;
  }
  FirebaseSync.restoreSession().then(session => {
    if (session) unlock();
  }).catch(() => {});
}

function rc4Unhex(key, hex) {
  let s = [], j = 0, x, utf8 = '';
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key.charCodeAt(i % key.length)) % 256;
    x = s[i]; s[i] = s[j]; s[j] = x;
  }
  let i = 0; j = 0;
  for (let y = 0; y < hex.length; y += 2) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    x = s[i]; s[i] = s[j]; s[j] = x;
    const code = parseInt(hex.substr(y, 2), 16) ^ s[(s[i] + s[j]) % 256];
    utf8 += String.fromCharCode(code);
  }
  try {
    return decodeURIComponent(escape(utf8));
  } catch (e) {
    return null;
  }
}

// localStorage is a plain cache now (Firestore is the source of truth,
// gated by Firebase Auth). encryptStr keeps its name so call sites stay
// untouched; decryptStr still decodes values written by old builds,
// which RC4-encrypted them with the hardcoded PIN.
const LEGACY_PIN = '0067';

function encryptStr(plaintext) {
  return plaintext;
}

function decryptStr(raw) {
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return raw;
  }
  return rc4Unhex(LEGACY_PIN, raw);
}


/* ── Data ──────────────────────────────────────────────────── */
function load(){
  try{
    const raw=localStorage.getItem(WK);
    if(raw) {
      const s = decryptStr(raw);
      W=JSON.parse(s);
      // Legacy builds stored RC4 hex; re-save decodes it to plaintext
      let migrated = !(raw.trim().startsWith('[') || raw.trim().startsWith('{'));
      W.forEach(w => {
        if (w.date && w.date.startsWith("2025-")) {
          w.date = w.date.replace("2025-", "2026-");
          migrated = true;
        }
        if (w.exercises) {
          w.exercises.forEach(e => {
            const canonical = canonicalName(e.name);
            if (e.name !== canonical) {
              e.name = canonical;
              migrated = true;
            }
          });
        }
      });
      if (migrated) save();
    }
  }catch(_){}
  if(!W.length&&canSeedHistorical()&&typeof HISTORICAL_DATA!=='undefined'&&HISTORICAL_DATA.length > 0){
    W=JSON.parse(JSON.stringify(HISTORICAL_DATA));
    W.forEach(w => {
      if (w.exercises) {
        w.exercises.forEach(e => {
          e.name = canonicalName(e.name);
        });
      }
    });
    save();
  }
}
let lastLocalWrite = parseInt(localStorage.getItem('asca_gym_last_write_ts') || '0', 10);
function save(){
  try{
    localStorage.setItem(WK,encryptStr(JSON.stringify(W)));
    lastLocalWrite = Date.now();
    localStorage.setItem('asca_gym_last_write_ts', String(lastLocalWrite));
  }catch(_){}
  if(typeof fbPush==='function'&&fbCfg().connected){
    fbPush(false);
  }
}
// The baked-in HISTORICAL_DATA is Anshul's log. With per-user cloud
// accounts, seeding it into another user's fresh browser would push it
// to THEIR Firestore doc — so only seed for the owner (or standalone
// builds with no backend); everyone else starts from their cloud doc.
function canSeedHistorical(){
  const fb=fbCfg();
  if(!fb.backendReady)return true;
  const id=(fb.userId||'').toLowerCase();
  return !id||id.startsWith('anshul');
}
function loadCX(){
  try{
    const raw=localStorage.getItem(CK);
    if(raw) {
      const s = decryptStr(raw);
      CX=JSON.parse(s);
      let migrated = !raw.trim().startsWith('{');
      for (const [group, list] of Object.entries(CX)) {
        const canonicalList = list.map(name => canonicalName(name));
        if (JSON.stringify(list) !== JSON.stringify(canonicalList)) {
          CX[group] = canonicalList;
          migrated = true;
        }
      }
      if (migrated) saveCX();
    }
  }catch(_){}
  invalidateLib();
}
function saveCX(){invalidateLib();try{localStorage.setItem(CK,encryptStr(JSON.stringify(CX)));}catch(_){}}

/* Library is rebuilt only when custom exercises change — findG() calls
   this in per-exercise loops, so caching avoids O(n·m) rebuilds. */
let LIBC=null;
function invalidateLib(){LIBC=null;}
function lib(){
  if(LIBC)return LIBC;
  const L={};
  for(const[g,e]of Object.entries(EXERCISE_LIBRARY))L[g]=[...e];
  for(const[g,e]of Object.entries(CX)){if(!L[g])L[g]=[];e.forEach(x=>{if(!L[g].includes(x))L[g].push(x);});}
  LIBC=L;
  return L;
}

/* ── Navigation ────────────────────────────────────────────── */
function positionNavLens(activeBtn, animate = true) {
  const lens = document.getElementById('navLens');
  if (!lens) return;
  if (!activeBtn) {
    lens.style.display = 'none';
    return;
  }
  lens.style.display = 'block';
  
  const activeLeft = activeBtn.offsetLeft;
  const activeWidth = activeBtn.offsetWidth;
  const lensWidth = 54; // consistent size covering both icon and text
  const leftPos = activeLeft + (activeWidth - lensWidth) / 2;
  
  if (animate) {
    lens.classList.add('stretching');
    setTimeout(() => {
      lens.classList.remove('stretching');
    }, 320);
  }
  lens.style.transition = animate ? 'left 0.32s cubic-bezier(0.25, 1, 0.4, 1.1), transform 0.32s cubic-bezier(0.25, 1, 0.4, 1.1)' : 'none';
  lens.style.left = `${leftPos}px`;
  lens.style.top = `8px`; // centered vertically in bottom bar
}

function bindTabs(){
  const navs = document.querySelectorAll('.nav-btn, .bot-btn');
  navs.forEach(b=>{
    b.addEventListener('click',()=>{
      navs.forEach(x=>x.classList.remove('on'));
      const tgt = b.dataset.v;
      document.querySelectorAll(`[data-v="${tgt}"]`).forEach(x=>x.classList.add('on'));
      document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));
      const v=document.getElementById('v'+tgt);
      if(v)v.classList.add('on');
      if(tgt==='Hist')renderHist();
      if(tgt==='Ana')refreshAna();
      if(tgt==='Soc')renderFriendsCard();
      if(tgt==='Log'){renderBodyWeight();renderHeatmapCalendar();renderVolWidget();}
      
      const container = document.querySelector('.views-container');
      if(container) container.scrollTo({top:0,behavior:'smooth'});
      
      const activeBotBtn = document.querySelector('.bot-btn.on');
      if (activeBotBtn) {
        positionNavLens(activeBotBtn, true);
      }
    });
  });

  // Position lens initially
  setTimeout(() => {
    const activeBotBtn = document.querySelector('.bot-btn.on');
    if (activeBotBtn) {
      positionNavLens(activeBotBtn, false);
    }
  }, 100);

  // Handle window resize to keep lens centered
  window.addEventListener('resize', () => {
    const activeBotBtn = document.querySelector('.bot-btn.on');
    if (activeBotBtn) {
      positionNavLens(activeBotBtn, false);
    }
  });
}
function fillTypes(){
  const s=document.getElementById('wType');
  DAY_TYPES.forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;s.appendChild(o);});
  s.addEventListener('change',()=>{
    if(s.value==='Rest Day'||SE.length>0){
      document.getElementById('acts').style.display='flex';
    }else{
      document.getElementById('acts').style.display='none';
    }
    if (typeof updateSetupHeatmap === 'function') {
      updateSetupHeatmap(s.value);
    }
  });
}
function setToday(){document.getElementById('wDate').value=new Date().toISOString().split('T')[0];}

/* ── Body Weight Tracker ──────────────────────────────────── */
function bindBodyWeight(){
  const modal = document.getElementById('bwBg');
  const input = document.getElementById('bwInput');
  const saveBtn = document.getElementById('bwSave');
  const cancelBtn = document.getElementById('bwCancel');
  const widget = document.getElementById('bwWidget');
  
  if(!modal||!input||!saveBtn||!cancelBtn)return;
  
  if(widget) {
    widget.addEventListener('click',()=>{
      modal.classList.add('show');
      const bw = getBodyWeight();
      if(bw) input.value = bw.weight;
      setTimeout(()=>input.focus(),100);
    });
  }
  


  saveBtn.addEventListener('click',()=>{
    const val = parseFloat(input.value);
    if(!val||val<=0){toast('Enter a valid weight','error');return;}
    const data = {weight:val, timestamp:Date.now()};
    localStorage.setItem(BWK,encryptStr(JSON.stringify(data)));
    modal.classList.remove('show');
    input.value='';
    renderBodyWeight();
    toast('Body weight saved','success');
  });
  
  cancelBtn.addEventListener('click',()=>{
    modal.classList.remove('show');
    input.value='';
  });
  
  modal.addEventListener('click',e=>{
    if(e.target===e.currentTarget){modal.classList.remove('show');input.value='';}
  });
}

function getBodyWeight(){
  try{
    const raw=localStorage.getItem(BWK);
    if(raw) {
      const s = decryptStr(raw);
      const data = JSON.parse(s);
      if (raw.trim().startsWith('{')) {
        localStorage.setItem(BWK, encryptStr(s));
      }
      return data;
    }
  }catch(_){}
  return null;
}

function renderBodyWeight(){
  const display = document.getElementById('bwDisplay');
  const ts = document.getElementById('bwTimestamp');
  if(!display||!ts)return;
  
  const bw=getBodyWeight();
  if(bw){
    display.textContent = bw.weight;
    ts.textContent = timeAgo(bw.timestamp);
  }else{
    display.textContent = '—';
    ts.textContent = 'Tap to log';
  }
}

function timeAgo(ts){
  const diff=Date.now()-ts;
  const mins=Math.floor(diff/60000);
  if(mins<1)return 'Just now';
  if(mins<60)return `${mins}m ago`;
  const hrs=Math.floor(mins/60);
  if(hrs<24)return `${hrs}h ago`;
  const days=Math.floor(hrs/24);
  return `${days}d ago`;
}

/* ── Workout Heatmap Calendar ─────────────────────────────── */
function renderHeatmapCalendar(){
  const grid=document.getElementById('heatmapCalGrid');
  const monthsEl=document.getElementById('heatmapMonths');
  if(!grid||!monthsEl)return;
  
  const today=new Date();
  const weeks=24;
  const days=weeks*7;
  
  // Build date->workout stats map
  const dateWorkouts={};
  W.forEach(w=>{
    const vol=w.exercises.reduce((s,e)=>s+e.sets.reduce((ss,x)=>ss+((getSetWeightVal(x))*(x.reps||0)),0),0);
    const setsCount=w.exercises.reduce((s,e)=>s+e.sets.length,0);
    const exCount=w.exercises.length;
    
    dateWorkouts[w.date] = {
      dayType: w.dayType,
      volume: vol,
      sets: setsCount,
      exercises: exCount
    };
  });
  
  // Find max volume for scaling
  const maxVol = Math.max(...Object.values(dateWorkouts).map(info => info.volume), 1);
  
  // Generate grid (7 rows x 24 cols, starting on Sunday) as one HTML
  // string with a single delegated click listener — much cheaper than
  // 168 elements each carrying their own listener.
  const startDate=new Date(today);
  startDate.setDate(today.getDate() - (weeks - 1) * 7 - today.getDay());

  // Track months for labels
  const monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const seenMonths=new Set();
  const monthLabels=[];
  const dayMeta={};
  let dotsHtml='';

  for(let col=0;col<weeks;col++){
    for(let row=0;row<7;row++){
      const dayIdx=col*7+row;
      const d=new Date(startDate);
      d.setDate(d.getDate()+dayIdx);
      const y=d.getFullYear();
      const mOffset=String(d.getMonth()+1).padStart(2,'0');
      const dOffset=String(d.getDate()).padStart(2,'0');
      const dateStr=`${y}-${mOffset}-${dOffset}`;
      const info=dateWorkouts[dateStr];
      const vol=info?info.volume:0;

      let lvl='';
      if(vol>0){
        const ratio=vol/maxVol;
        if(ratio>0.6)lvl='lvl-3';
        else if(ratio>0.3)lvl='lvl-2';
        else lvl='lvl-1';
      }

      const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      const formattedDate = d.toLocaleDateString('en-US', options);
      dayMeta[dateStr]={info,formattedDate};

      let tooltip;
      if(info && info.dayType !== 'Rest Day') {
        tooltip = `${formattedDate}\n${info.dayType} Day\n• Volume: ${Math.round(info.volume)} kg\n• Exercises: ${info.exercises}\n• Sets: ${info.sets}`;
      } else {
        tooltip = `${formattedDate}\nRest Day`;
      }

      const hiddenStyle = d > today ? ' style="visibility:hidden;pointer-events:none"' : '';
      dotsHtml += `<div class="heatmap-dot ${lvl}" data-date="${dateStr}" title="${tooltip}"${hiddenStyle}></div>`;

      // Track months
      const monthKey=d.getFullYear()+'-'+d.getMonth();
      if(!seenMonths.has(monthKey)&&row===0){
        seenMonths.add(monthKey);
        monthLabels.push({name:monthNames[d.getMonth()],col: col + 1});
      }
    }
  }

  grid.innerHTML=dotsHtml;

  function selectDay(dateStr){
    const meta=dayMeta[dateStr];
    if(!meta)return;
    grid.querySelectorAll('.heatmap-dot.selected').forEach(el => el.classList.remove('selected'));
    const dot=grid.querySelector(`[data-date="${dateStr}"]`);
    if(dot)dot.classList.add('selected');

    const detailsEl = document.getElementById('heatmapDayDetails');
    if (!detailsEl) return;

    const {info,formattedDate}=meta;
    if (info && info.dayType !== 'Rest Day') {
      detailsEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; width:100%; align-items:center">
          <span><strong>${formattedDate}</strong>: <span style="color:var(--accent); font-weight:700">${info.dayType} Day</span></span>
          <span style="color:var(--t-4)">${Math.round(info.volume)} kg volume • ${info.exercises} ex • ${info.sets} sets</span>
        </div>
      `;
    } else {
      detailsEl.innerHTML = `<strong>${formattedDate}</strong>: Rest Day`;
    }
  }

  grid.onclick = e => {
    const dot=e.target.closest('.heatmap-dot');
    if(dot && dot.dataset.date) selectDay(dot.dataset.date);
  };

  // Render month labels aligned with columns
  monthsEl.innerHTML = monthLabels
    .map(m => `<span class="heatmap-cal-month-label" style="left: ${(m.col - 1) * 13}px; text-align: left;">${m.name}</span>`)
    .join('');

  // Pre-select most recent workout
  if (W.length > 0) {
    selectDay(W[0].date);
  } else {
    const detailsEl = document.getElementById('heatmapDayDetails');
    if (detailsEl) detailsEl.textContent = 'Tap a cell to view workout details & stats';
  }
}

/* ── Volume Widget ────────────────────────────────────────── */
function renderVolWidget(){
  const el=document.getElementById('volWidgetVal');
  if(!el)return;
  
  const today=new Date();
  today.setHours(23,59,59,999);
  const weekAgo=new Date(today.getTime()-7*24*60*60*1000);
  
  let vol=0;
  W.forEach(w=>{
    const d=new Date(w.date+'T00:00:00');
    if(d>=weekAgo&&d<=today){
      w.exercises.forEach(e=>{
        e.sets.forEach(s=>{
          const wVal=getSetWeightVal(s);
          if(wVal&&s.reps)vol+=wVal*s.reps;
        });
      });
    }
  });
  
  el.textContent=vol>=1000?(vol/1000).toFixed(1)+'k':Math.round(vol).toLocaleString();
}

/* ── Weekly Progress Ring ─────────────────────────────────── */
function renderWeeklyRing(){
  const ringFill=document.getElementById('ringFill');
  const ringVal=document.getElementById('ringVal');
  if(!ringFill||!ringVal)return;
  
  // Count workouts this week (Mon-Sun)
  const today=new Date();
  const dayOfWeek=today.getDay();
  const mondayOffset=dayOfWeek===0?6:dayOfWeek-1;
  const monday=new Date(today);
  monday.setDate(today.getDate()-mondayOffset);
  monday.setHours(0,0,0,0);
  
  let count=0;
  W.forEach(w=>{
    if(w.dayType==='Rest Day')return;
    const d=new Date(w.date+'T00:00:00');
    if(d>=monday&&d<=today)count++;
  });
  
  ringVal.textContent=count;

  const circumference=2*Math.PI*50; // r=50
  const progress=Math.min(count/WEEKLY_TARGET,1);
  const offset=circumference*(1-progress);
  ringFill.setAttribute('stroke-dasharray',`${circumference} ${circumference}`);
  ringFill.setAttribute('stroke-dashoffset',offset);
}

/* ── Friends (Strava-style following) ─────────────────────── */
/* Cache of everyone I follow: { ts, friends: { id: {ts,name,workouts} } }.
   Special ids: '_code' = progress-code import, '_sheet' = legacy tab. */
const FCK='asca_gym_friends_cache';

function getFriendsCache(){
  try{
    const raw=localStorage.getItem(FCK);
    if(raw){const c=JSON.parse(decryptStr(raw));if(c&&c.friends)return c;}
  }catch(_){}
  // Migrate the old single-friend cache into the new shape
  try{
    const old=localStorage.getItem('asca_gym_friend_cache');
    if(old){
      const s=JSON.parse(decryptStr(old));
      localStorage.removeItem('asca_gym_friend_cache');
      if(s&&Array.isArray(s.workouts)){
        const c={ts:s.ts||Date.now(),friends:{_code:{ts:s.ts||Date.now(),name:'Friend',workouts:s.workouts}}};
        localStorage.setItem(FCK,JSON.stringify(c));
        return c;
      }
    }
  }catch(_){}
  return {ts:0,friends:{}};
}
function saveFriendEntry(id,entry){
  const c=getFriendsCache();
  c.friends[id]=entry;c.ts=Date.now();
  try{localStorage.setItem(FCK,JSON.stringify(c));}catch(_){}
}
function removeFriendEntry(id){
  const c=getFriendsCache();
  delete c.friends[id];
  try{localStorage.setItem(FCK,JSON.stringify(c));}catch(_){}
}

/* ── Progress Codes — offline friend sync ─────────────────── */
/* A progress code is the last 8 weeks of workouts as gzip+base64
   (prefix ASCAGYM2) or plain base64 where CompressionStream is
   unavailable (prefix ASCAGYM1). Sent over any chat app; importing
   stores it as the friend cache — no server involved. */
async function gzipB64(str){
  const cs=new CompressionStream('gzip');
  const stream=new Blob([new TextEncoder().encode(str)]).stream().pipeThrough(cs);
  const ab=await new Response(stream).arrayBuffer();
  const bytes=new Uint8Array(ab);
  let bin='';
  for(let i=0;i<bytes.length;i+=0x8000)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
  return btoa(bin);
}
async function gunzipB64(b64){
  const bin=atob(b64);
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  const ds=new DecompressionStream('gzip');
  const ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new TextDecoder().decode(ab);
}

async function decodeProgressCode(code){
  code=(code||'').replace(/\s+/g,'');
  let json;
  if(code.startsWith('ASCAGYM2.'))json=await gunzipB64(code.slice(9));
  else if(code.startsWith('ASCAGYM1.'))json=decodeURIComponent(escape(atob(code.slice(9))));
  else throw new Error('That is not a valid progress code');
  const payload=JSON.parse(json);
  if(!payload||!Array.isArray(payload.workouts))throw new Error('Progress code is corrupted');
  return payload;
}

/* ── Firebase Cloud Sync — backup + friend sync over Firestore ── */
/* FirebaseSync (firebase-sync.js) is the transport and handles auth;
   access is gated by Firebase sign-in and ownership rules, so blobs
   are stored as plain compressed progress codes. My doc carries the
   FULL history (it doubles as the cloud backup); the friend's doc is
   pulled into the friend cache like every other friend-sync source. */
function fbCfg(){return (typeof FirebaseSync!=='undefined')?FirebaseSync.getConfig():{};}

async function buildFullProgressCode(){
  const cfg=fbCfg();
  const json=JSON.stringify({
    v:2,
    ts:Date.now(),
    name:cfg.displayName||cfg.userId||'',
    avatar:cfg.avatar||'',
    github:cfg.github||'',
    following:(cfg.following||[]).map(f=>f.id),
    workouts:W
  });
  try{
    if(typeof CompressionStream!=='undefined')return 'ASCAGYM2.'+await gzipB64(json);
  }catch(_){}
  return 'ASCAGYM1.'+btoa(unescape(encodeURIComponent(json)));
}

async function fbPush(interactive=true){
  const cfg=fbCfg();
  if(!cfg.connected){
    if(interactive)toast('Connect Firebase in Settings first','error');
    return false;
  }
  try{
    const code=await buildFullProgressCode();
    const ts=lastLocalWrite||Date.now();
    await FirebaseSync.writeDoc({ts,blob:code});
    lastLocalWrite=ts;
    localStorage.setItem('asca_gym_last_write_ts',String(ts));
    if(interactive)toast('Backed up to Firebase','success');
    return true;
  }catch(e){
    if(interactive)toast('Backup failed — '+e.message,'error');
    return false;
  }
}

function refreshAllUI() {
  renderBodyWeight();
  renderHeatmapCalendar();
  renderVolWidget();
  renderWeeklyRing();
  renderProfile();
  renderFriendsCard();
  renderHist();
  renderVolInsights();
  renderSG();
  renderPRs();
  renderChart();
}

let activeStreams={};

function startRealtimeSync(){
  const cfg=fbCfg();
  if(!cfg.connected)return;

  listenToDoc(cfg.userId,data=>{
    if(data&&data.ts>lastLocalWrite){
      decodeProgressCode(data.blob).then(payload=>{
        if(payload&&Array.isArray(payload.workouts)){
          W=payload.workouts;
          try{
            localStorage.setItem(WK,encryptStr(JSON.stringify(W)));
            lastLocalWrite=data.ts;
            localStorage.setItem('asca_gym_last_write_ts',String(data.ts));
          }catch(_){}
          const up={};
          if(payload.name)up.displayName=payload.name;
          if(payload.avatar)up.avatar=payload.avatar;
          if(payload.github)up.github=payload.github;
          if(Object.keys(up).length>0)FirebaseSync.updateConfig(up);
          refreshAllUI();
        }
      }).catch(console.warn);
    }
  });

  cfg.following.forEach(f=>{
    listenToDoc(f.id,data=>{
      if(data&&data.blob){
        decodeProgressCode(data.blob).then(p=>{
          saveFriendEntry(f.id,{
            ts:data.ts||p.ts||Date.now(),
            name:f.name||p.name||f.id,
            avatar:p.avatar||'',
            github:p.github||'',
            following:Array.isArray(p.following)?p.following:[],
            workouts:p.workouts
          });
          renderFriendsCard();
        }).catch(console.warn);
      }
    });
  });
}

function listenToDoc(userId,callback){
  if(activeStreams[userId])return;
  const cfg=fbCfg();
  if(!cfg.projectId)return;
  const baseUrl=`https://${cfg.projectId}-default-rtdb.firebaseio.com`;

  FirebaseSync.getIdToken().then(token=>{
    const url=`${baseUrl}/gym/${encodeURIComponent(userId)}.json?auth=${token}`;
    const source=new EventSource(url);
    activeStreams[userId]=source;

    source.addEventListener('put',e=>{
      try{
        const packet=JSON.parse(e.data);
        if(packet&&packet.path==='/'&&packet.data){
          callback(packet.data);
        }
      }catch(err){
        console.warn(`[Sync packet err] @${userId}:`,err);
      }
    });

    source.onerror=err=>{
      console.warn(`[Sync stream err] @${userId}:`,err);
      source.close();
      delete activeStreams[userId];
    };
  }).catch(console.warn);
}

function stopRealtimeSync(){
  Object.values(activeStreams).forEach(source=>{
    try{source.close();}catch(_){}
  });
  activeStreams={};
}

// Pull every followed user's doc in parallel and refresh the cache
async function fbPullFollowing(interactive=true){
  const cfg=fbCfg();
  if(!cfg.connected||!cfg.following.length){
    if(interactive)toast('Follow someone in Settings first','error');
    return 0;
  }
  const results=await Promise.allSettled(cfg.following.map(async f=>{
    const doc=await FirebaseSync.readDoc(f.id);
    if(!doc||!doc.blob)throw new Error('no data for @'+f.id);
    const p=await decodeProgressCode(doc.blob);
    saveFriendEntry(f.id,{
      ts:doc.ts||p.ts||Date.now(),
      name:f.name||p.name||f.id,
      avatar:p.avatar||'',
      github:p.github||'',
      following:Array.isArray(p.following)?p.following:[],
      workouts:p.workouts
    });
  }));
  const ok=results.filter(r=>r.status==='fulfilled').length;
  results.forEach((r,i)=>{if(r.status==='rejected')console.warn('[Sync]',cfg.following[i]?.id,r.reason?.message||r.reason);});
  renderFriendsCard();
  if(interactive){
    if(ok===cfg.following.length)toast(ok===1?'Friend progress updated':`Synced all ${ok} friends`,'success');
    else if(ok)toast(`Synced ${ok}/${cfg.following.length} — some have no data yet`,'success');
    else{
      const reasons=results.filter(r=>r.status==='rejected').map(r=>r.reason?.message||'unknown');
      const hint=reasons.some(r=>r.includes('no data'))?'Your friend needs to sign in and save a workout first':'Check your connection';
      toast(`Sync failed — ${hint}`,'error');
    }
  }
  return ok;
}

// Union merge from my own doc: cloud fills in sessions this device is
// missing; on a date conflict the local copy wins (you log locally).
async function fbRestore(interactive=true){
  const cfg=fbCfg();
  if(!cfg.connected){
    if(interactive)toast('Connect Firebase in Settings first','error');
    return 0;
  }
  try{
    const doc=await FirebaseSync.readDoc(cfg.userId);
    if(!doc||!doc.blob){
      if(interactive)toast('No cloud backup found yet — tap Backup Now first','error');
      return 0;
    }
    const payload=await decodeProgressCode(doc.blob);
    let added=0;
    payload.workouts.forEach(wo=>{
      if(wo&&wo.date&&!W.find(w=>w.date===wo.date)){W.push(wo);added++;}
    });
    if(added){
      W.sort((a,b)=>b.date.localeCompare(a.date));save();
      renderRecent();renderHeatmapCalendar();renderVolWidget();
    }
    const up={};
    if(payload.name)up.displayName=payload.name;
    if(payload.avatar)up.avatar=payload.avatar;
    if(payload.github)up.github=payload.github;
    if(Object.keys(up).length>0)FirebaseSync.updateConfig(up);
    refreshAllUI();
    if(interactive)toast(added?`Restored ${added} sessions from cloud`:'Already up to date','success');
    return added;
  }catch(e){
    if(interactive)toast('Restore failed — '+e.message,'error');
    return 0;
  }
}

function periodStats(list){
  const today=new Date();today.setHours(23,59,59,999);
  const weekAgo=new Date(today.getTime()-7*24*60*60*1000);
  const dayOfWeek=new Date().getDay();
  const mondayOffset=dayOfWeek===0?6:dayOfWeek-1;
  const monday=new Date();monday.setDate(monday.getDate()-mondayOffset);monday.setHours(0,0,0,0);

  let week=0,vol7=0,sets7=0;
  (list||[]).forEach(w=>{
    if(!w||!w.date)return;
    const d=new Date(w.date+'T00:00:00');
    if(isNaN(d))return;
    if(w.dayType!=='Rest Day'&&d>=monday&&d<=today)week++;
    if(d>=weekAgo&&d<=today&&Array.isArray(w.exercises)){
      w.exercises.forEach(e=>{
        sets7+=e.sets.length;
        e.sets.forEach(s=>{const wv=getSetWeightVal(s);if(wv&&s.reps)vol7+=wv*s.reps;});
      });
    }
  });
  return {week,vol7,sets7};
}

function fmtStatNum(v){return v>=1000?(v/1000).toFixed(1)+'k':Math.round(v).toLocaleString();}

/* ── Social identity helpers ──────────────────────────────── */
// Deterministic avatar gradient per username, like every social app
const AV_GRADS=[['#FF6B00','#FF9F45'],['#3A7BD5','#6FA8FF'],['#8E2DE2','#B06AF9'],['#11998E','#38EF7D'],['#E94057','#F27121'],['#F2994A','#F2C94C']];
function avatarGrad(id){
  if(id===fbCfg().userId)return `linear-gradient(135deg,${AV_GRADS[0][0]},${AV_GRADS[0][1]})`;
  let h=0;for(const c of String(id||''))h=(h*31+c.charCodeAt(0))>>>0;
  const g=AV_GRADS[1+h%(AV_GRADS.length-1)];
  return `linear-gradient(135deg,${g[0]},${g[1]})`;
}
function initialOf(s){return esc((String(s||'?').trim()[0]||'?'));}

// Relative day label for feed items ('2026-07-18' → Today / Yesterday / 3d ago)
function dayAgo(dateStr){
  const d=new Date(dateStr+'T00:00:00');
  if(isNaN(d))return dateStr;
  const today=new Date();today.setHours(0,0,0,0);
  const diff=Math.round((today-d)/86400000);
  if(diff<=0)return 'Today';
  if(diff===1)return 'Yesterday';
  if(diff<7)return `${diff}d ago`;
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

/* ── My Account: profile card ─────────────────────────────── */
function getFollowers(){
  const cfg=fbCfg();
  if(!cfg.userId)return [];
  const cache=getFriendsCache();
  return Object.entries(cache.friends)
    .filter(([id,f])=>Array.isArray(f.following)&&f.following.includes(cfg.userId))
    .map(([id,f])=>({id,name:f.name||id}));
}

function renderProfile(){
  const avatar=document.getElementById('profAvatar');
  if(!avatar)return;
  const cfg=fbCfg();
  const username=cfg.userId||(cfg.user&&cfg.user.username)||'';
  const name=cfg.displayName||username||'Athlete';
  
  if(cfg.avatar){
    avatar.innerHTML=`<img src="${cfg.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    avatar.style.background='none';
  }else{
    avatar.textContent=(name.trim()[0]||'?');
    avatar.style.background='#17130f';
  }

  document.getElementById('profName').textContent=name;
  document.getElementById('profUser').textContent=username?'@'+username:'@—';
  
  const githubLink=document.getElementById('profGithubLink');
  if(githubLink){
    if(cfg.github){
      githubLink.href=`https://github.com/${cfg.github}`;
      githubLink.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:middle;margin-right:4px;"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>${cfg.github}`;
      githubLink.style.display='inline-flex';
    }else{
      githubLink.style.display='none';
    }
  }

  // Repopulate form inputs if not editing
  const hero=document.querySelector('.profile-hero');
  const isEditing=hero&&hero.classList.contains('editing');
  if(!isEditing){
    const fbMyId=document.getElementById('fbMyId');
    const fbDisplayName=document.getElementById('fbDisplayName');
    const fbGithub=document.getElementById('fbGithub');
    if(fbMyId)fbMyId.value=cfg.userId||'';
    if(fbDisplayName)fbDisplayName.value=cfg.displayName||'';
    if(fbGithub)fbGithub.value=cfg.github||'';
  }

  const sessions=W.filter(w=>w&&w.dayType!=='Rest Day');
  let vol=0;
  sessions.forEach(w=>(w.exercises||[]).forEach(e=>e.sets.forEach(s=>{const wv=getSetWeightVal(s);if(wv&&s.reps)vol+=wv*s.reps;})));
  document.getElementById('profWorkouts').textContent=sessions.length;
  document.getElementById('profVolume').textContent=fmtStatNum(vol)+' kg';
  document.getElementById('profWeek').textContent=periodStats(W).week;
  const el=document.getElementById('profFollowers');
  if(el)el.textContent=getFollowers().length;
  document.getElementById('profFollowing').textContent=cfg.following.length;
}

/* ── Extended Stats for Leaderboard / H2H ─────────────────── */
let _lbMetric='vol7';
let _lbTimeframe='week';
function periodStatsExtended(list, timeframe='week'){
  const today=new Date();today.setHours(23,59,59,999);
  let startDate=new Date(0);
  if(timeframe==='week'){
    startDate=new Date(today.getTime()-7*24*60*60*1000);
  }else if(timeframe==='month'){
    startDate=new Date(today.getTime()-30*24*60*60*1000);
  }
  let workouts=0,vol=0,sets=0,exNames=new Set(),heaviest=0,dailyVol={};
  let streak=0,checkDate=new Date();checkDate.setHours(0,0,0,0);
  const dateSet=new Set((list||[]).filter(w=>w&&w.dayType!=='Rest Day').map(w=>w.date));
  while(true){
    const ds=checkDate.toISOString().slice(0,10);
    if(dateSet.has(ds)){streak++;checkDate.setDate(checkDate.getDate()-1);}
    else break;
  }
  (list||[]).forEach(w=>{
    if(!w||!w.date)return;
    const d=new Date(w.date+'T00:00:00');
    if(isNaN(d))return;
    if(d>=startDate&&d<=today){
      if(w.dayType!=='Rest Day')workouts++;
      if(Array.isArray(w.exercises)){
        let dv=0;
        w.exercises.forEach(e=>{
          exNames.add(e.name);sets+=e.sets.length;
          e.sets.forEach(s=>{const wv=getSetWeightVal(s);if(wv&&s.reps){vol+=wv*s.reps;dv+=wv*s.reps;}if(wv>heaviest)heaviest=wv;});
        });
        dailyVol[w.date]=(dailyVol[w.date]||0)+dv;
      }
    }
  });
  const spark=[];
  const pts=timeframe==='week'?7:timeframe==='month'?15:30;
  for(let i=pts-1;i>=0;i--){
    const d=new Date(today);d.setDate(d.getDate()-i);
    spark.push(dailyVol[d.toISOString().slice(0,10)]||0);
  }
  return {workouts,volume:vol,sets,heaviest,variety:exNames.size,streak,spark};
}

function sparklineSvg(data,color){
  const w=54,h=18,max=Math.max(...data,1);
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v/max)*h*0.85+1)}`).join(' ');
  return `<svg class="lb-spark" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" stroke="${color||'rgba(255,107,0,0.7)'}"/></svg>`;
}

function buildLBRows(){
  const fb=fbCfg();const cache=getFriendsCache();const ids=Object.keys(cache.friends);
  const myName=fb.displayName||fb.userId||'You';
  return [{id:fb.userId,name:myName,me:true,stats:periodStatsExtended(W,_lbTimeframe),workouts:W},
    ...ids.map(id=>({id,name:cache.friends[id].name||id,me:false,stats:periodStatsExtended(cache.friends[id].workouts||[],_lbTimeframe),workouts:cache.friends[id].workouts||[]}))];
}
function metricVal(stats,m){return {vol7:stats.volume,week:stats.workouts,sets7:stats.sets,consistency:stats.streak}[m]||stats.volume;}
function metricLabel(m){return {vol7:'kg',week:'workouts',sets7:'sets',consistency:'day streak'}[m]||'';}


function renderPodium(rows,metric){
  const podium=document.getElementById('lbPodium');
  if(!podium)return;
  const sorted=[...rows].sort((a,b)=>metricVal(b.stats,metric)-metricVal(a.stats,metric));
  const top3=sorted.slice(0,3);
  const order=top3.length>=3?[top3[1],top3[0],top3[2]]:top3.length===2?[top3[1],top3[0]]:[top3[0]];
  const medals=['🥇','🥈','🥉'];
  podium.innerHTML=order.map(r=>{
    const origIdx=top3.indexOf(r);const rank=origIdx+1;const v=metricVal(r.stats,metric);
    return `<div class="podium-item rank-${rank}" data-uid="${esc(r.id)}">
      <div class="podium-avatar" style="background:${avatarGrad(r.id)}">${initialOf(r.name)}<div class="podium-medal">${medals[origIdx]||''}</div></div>
      <div class="podium-name">${esc(r.name)}${r.me?' <span class="lb-you">You</span>':''}</div>
      <div class="podium-val">${fmtStatNum(v)} <span>${metricLabel(metric)}</span></div>
      <div class="podium-pedestal"></div></div>`;
  }).join('');
  podium.querySelectorAll('.podium-item').forEach(el=>el.addEventListener('click',()=>showMiniProfile(el.dataset.uid)));
}

function renderLeaderboardRows(rows,metric){
  const cmp=document.getElementById('friendCompare');
  if(!cmp)return;
  const sorted=[...rows].sort((a,b)=>metricVal(b.stats,metric)-metricVal(a.stats,metric));
  const below=sorted.length>3?sorted.slice(3):sorted;
  const startRank=sorted.length>3?4:1;
  const maxV=Math.max(...sorted.map(r=>metricVal(r.stats,metric)),1);
  if(!below.length){cmp.innerHTML='';return;}
  cmp.innerHTML=below.map((r,i)=>{
    const rank=startRank+i;const v=metricVal(r.stats,metric);
    return `<div class="lb-row${r.me?' lb-me':''}" data-uid="${esc(r.id)}">
      <div class="lb-rank">${rank}</div>
      <div class="lb-avatar" style="background:${avatarGrad(r.id)}">${initialOf(r.name)}</div>
      <div class="lb-main">
        <div class="lb-name">${esc(r.name)}${r.me?'<span class="lb-you">You</span>':''}${sparklineSvg(r.stats.spark,r.me?'#FF6B00':'#3A7BD5')}</div>
        <div class="lb-bar"><div class="lb-fill" style="width:${Math.max((v/maxV)*100,2)}%"></div></div>
      </div>
      <div class="lb-val">${fmtStatNum(v)} <span>${metricLabel(metric)}</span></div></div>`;
  }).join('');
  cmp.querySelectorAll('.lb-row').forEach(el=>el.addEventListener('click',()=>showMiniProfile(el.dataset.uid)));
}

function gymHeatmapHtml(id,name,workouts){
  const today=new Date();today.setHours(0,0,0,0);const weeks=16,days=weeks*7;
  const volMap={};
  (workouts||[]).forEach(w=>{if(!w||!w.date||w.dayType==='Rest Day')return;let v=0;
    (w.exercises||[]).forEach(e=>e.sets.forEach(s=>{const wv=getSetWeightVal(s);if(wv&&s.reps)v+=wv*s.reps;}));volMap[w.date]=(volMap[w.date]||0)+v;});
  const maxV=Math.max(...Object.values(volMap),1);
  let streak=0,d=new Date(today);
  const dateSet=new Set((workouts||[]).filter(w=>w&&w.dayType!=='Rest Day').map(w=>w.date));
  while(dateSet.has(d.toISOString().slice(0,10))){streak++;d.setDate(d.getDate()-1);}
  let dots='';const startDate=new Date(today);startDate.setDate(today.getDate()-(days-1));startDate.setDate(startDate.getDate()-startDate.getDay());
  for(let i=0;i<days;i++){const dd=new Date(startDate);dd.setDate(startDate.getDate()+i);
    if(dd>today){dots+='<div class="gym-heatmap-dot" style="visibility:hidden"></div>';continue;}
    const ds=dd.toISOString().slice(0,10);const v=volMap[ds]||0;let lvl='';
    if(v>0){const r=v/maxV;lvl=r>0.7?'g-4':r>0.4?'g-3':r>0.15?'g-2':'g-1';}
    dots+=`<div class="gym-heatmap-dot ${lvl}" title="${ds}"></div>`;}
  return `<div class="gym-activity-section"><div class="gym-activity-header">
    <div class="gym-activity-avatar" style="background:${avatarGrad(id)}">${initialOf(name)}</div>
    <div class="gym-activity-name">${esc(name)}</div>
    <div class="gym-activity-streak">${streak?'🔥 '+streak+' day streak':''}</div></div>
    <div class="gym-heatmap-wrap"><div class="gym-heatmap-grid">${dots}</div></div>
    <div class="gym-heatmap-legend">Less <div class="gym-heatmap-legend-dot" style="background:rgba(255,255,255,0.04)"></div>
    <div class="gym-heatmap-legend-dot" style="background:rgba(255,107,0,0.2)"></div>
    <div class="gym-heatmap-legend-dot" style="background:rgba(255,107,0,0.45)"></div>
    <div class="gym-heatmap-legend-dot" style="background:rgba(255,107,0,0.7)"></div>
    <div class="gym-heatmap-legend-dot" style="background:#FF6B00"></div> More</div></div>`;
}

function renderGymActivity(allRows){
  const label=document.getElementById('activityLabel');const card=document.getElementById('activityCard');const grids=document.getElementById('gymActivityGrids');
  if(!label||!card||!grids)return;
  if(!allRows.length){label.style.display='none';card.style.display='none';return;}
  label.style.display='block';card.style.display='block';
  grids.innerHTML=allRows.map(r=>gymHeatmapHtml(r.id,r.name,r.workouts)).join('');
}

function renderH2HPicker(allRows){
  const label=document.getElementById('h2hLabel');const card=document.getElementById('h2hCard');const picker=document.getElementById('h2hPicker');
  if(!label||!card||!picker||allRows.length<2){if(label)label.style.display='none';if(card)card.style.display='none';return;}
  label.style.display='block';card.style.display='block';
  const meRow=allRows.find(r=>r.me)||allRows[0];const others=allRows.filter(r=>!r.me);
  picker.innerHTML=`<div class="h2h-select" style="text-align:center;font-weight:700;color:#FF6B00">${esc(meRow.name)}</div>
    <div class="h2h-vs">VS</div>
    <select class="h2h-select" id="h2hOpponent">${others.map((r,i)=>`<option value="${esc(r.id)}"${i===0?' selected':''}>${esc(r.name)}</option>`).join('')}</select>`;
  const sel=document.getElementById('h2hOpponent');
  const render=()=>{const opp=allRows.find(r=>r.id===sel.value);if(opp)renderH2HBody(meRow,opp);};
  sel.addEventListener('change',render);render();
}

function renderH2HBody(a,b){
  const body=document.getElementById('h2hBody');if(!body)return;
  const dims=[{label:'Volume',aVal:a.stats.volume,bVal:b.stats.volume,unit:'kg'},{label:'Workouts',aVal:a.stats.workouts,bVal:b.stats.workouts,unit:''},{label:'Sets',aVal:a.stats.sets,bVal:b.stats.sets,unit:''},{label:'Heaviest',aVal:a.stats.heaviest,bVal:b.stats.heaviest,unit:'kg'},{label:'Streak',aVal:a.stats.streak,bVal:b.stats.streak,unit:'days'}];
  const cx=110,cy=110,r=80,n=dims.length;
  const angles=dims.map((_,i)=>(Math.PI*2*i/n)-Math.PI/2);
  const grid=[0.25,0.5,0.75,1].map(s=>`<polygon points="${angles.map(a=>`${cx+Math.cos(a)*r*s},${cy+Math.sin(a)*r*s}`).join(' ')}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`).join('');
  const labels=dims.map((d,i)=>{const x=cx+Math.cos(angles[i])*(r+18),y=cy+Math.sin(angles[i])*(r+14);return `<text x="${x}" y="${y}" fill="rgba(255,255,255,0.5)" font-size="8" font-weight="700" text-anchor="middle" dominant-baseline="central">${d.label}</text>`;}).join('');
  const norm=vals=>vals.map((v,i)=>{const mx=Math.max(dims[i].aVal,dims[i].bVal,1);return v/mx;});
  const aN=norm(dims.map(d=>d.aVal)),bN=norm(dims.map(d=>d.bVal));
  const pA=angles.map((ang,i)=>`${cx+Math.cos(ang)*r*aN[i]},${cy+Math.sin(ang)*r*aN[i]}`).join(' ');
  const pB=angles.map((ang,i)=>`${cx+Math.cos(ang)*r*bN[i]},${cy+Math.sin(ang)*r*bN[i]}`).join(' ');
  const radar=`<svg viewBox="0 0 220 220" style="width:100%;max-width:220px">${grid}${angles.map(a=>`<line x1="${cx}" y1="${cy}" x2="${cx+Math.cos(a)*r}" y2="${cy+Math.sin(a)*r}" stroke="rgba(255,255,255,0.04)"/>`).join('')}<polygon points="${pA}" fill="rgba(255,107,0,0.12)" stroke="#FF6B00" stroke-width="1.5"/><polygon points="${pB}" fill="rgba(58,123,213,0.12)" stroke="#3A7BD5" stroke-width="1.5"/>${labels}</svg>`;
  const statRows=dims.map(d=>{const total=d.aVal+d.bVal||1;const aW=Math.max((d.aVal/total)*50,1),bW=Math.max((d.bVal/total)*50,1);
    return `<div class="h2h-stat-left${d.aVal>=d.bVal?' h2h-stat-win':''}">${fmtStatNum(d.aVal)}${d.unit?' '+d.unit:''}</div><div class="h2h-stat-label">${d.label}</div><div class="h2h-stat-right${d.bVal>d.aVal?' h2h-stat-win':''}">${fmtStatNum(d.bVal)}${d.unit?' '+d.unit:''}</div><div class="h2h-stat-bar"><div class="h2h-stat-fill-l" style="width:${aW}%"></div><div class="h2h-stat-fill-r" style="width:${bW}%"></div></div>`;}).join('');
  body.innerHTML=`<div class="h2h-radar-wrap">${radar}</div><div style="display:flex;justify-content:space-between;padding:0 8px 8px;font-size:0.66rem;font-weight:700"><span style="color:#FF6B00">${esc(a.name)}</span><span style="color:#3A7BD5">${esc(b.name)}</span></div><div class="h2h-stats-grid">${statRows}</div>`;
}

function renderActivityFeed(allRows){
  const feedLabel=document.getElementById('feedLabel');const feedCard=document.getElementById('feedCard');const recent=document.getElementById('friendRecent');
  if(!feedLabel||!feedCard||!recent)return;
  const feed=[];
  allRows.forEach(r=>{(r.workouts||[]).filter(w=>w&&w.dayType!=='Rest Day'&&Array.isArray(w.exercises)&&w.exercises.length).slice(0,6).forEach(w=>feed.push({id:r.id,name:r.name,w}));});
  feed.sort((a,b)=>b.w.date.localeCompare(a.w.date));
  if(!feed.length){feedLabel.style.display='none';feedCard.style.display='none';return;}
  feedLabel.style.display='block';feedCard.style.display='block';
  recent.innerHTML=feed.slice(0,12).map(({id,name,w})=>{
    const sets=w.exercises.reduce((s,e)=>s+e.sets.length,0);
    const vol=w.exercises.reduce((s,e)=>s+e.sets.reduce((ss,x)=>ss+((getSetWeightVal(x))*(x.reps||0)),0),0);
    let top=null;w.exercises.forEach(e=>e.sets.forEach(s=>{const wv=getSetWeightVal(s);if(wv&&(!top||wv>top.w))top={name:e.name,w:wv};}));
    return `<div class="feed-item" data-uid="${esc(id)}"><div class="feed-head"><div class="feed-avatar" style="background:${avatarGrad(id)}">${initialOf(name)}</div><div class="feed-who"><span class="feed-name">${esc(name)}</span><span class="feed-when">${dayAgo(w.date)} · ${esc(w.dayType||'Workout')}</span></div><div class="feed-vol">${fmtStatNum(vol)}<span>kg</span></div></div><div class="feed-chips"><span class="feed-chip">${w.exercises.length} exercise${w.exercises.length===1?'':'s'}</span><span class="feed-chip">${sets} sets</span>${top?`<span class="feed-chip feed-chip-top">${esc(top.name)} ${top.w} kg</span>`:''}</div></div>`;
  }).join('');
  recent.querySelectorAll('.feed-item').forEach(el=>el.addEventListener('click',()=>showMiniProfile(el.dataset.uid)));
}

function showMiniProfile(userId){
  const bg=document.getElementById('miniProfileBg');const content=document.getElementById('miniProfileContent');
  if(!bg||!content)return;
  const cfg=fbCfg();const cache=getFriendsCache();const isMe=userId===cfg.userId;
  const friendData=cache.friends[userId];
  const name=isMe?(cfg.displayName||cfg.userId||'You'):(friendData?friendData.name||userId:userId);
  const workouts=isMe?W:(friendData?friendData.workouts||[]:[]);
  const stats=periodStatsExtended(workouts);
  const followsMe=!isMe&&friendData&&Array.isArray(friendData.following)&&friendData.following.includes(cfg.userId);
  const iAmFollowing=cfg.following.some(f=>f.id===userId);
  const sessions=workouts.filter(w=>w&&w.dayType!=='Rest Day');
  let vol=0;sessions.forEach(w=>(w.exercises||[]).forEach(e=>e.sets.forEach(s=>{const wv=getSetWeightVal(s);if(wv&&s.reps)vol+=wv*s.reps;})));
  content.innerHTML=`<div class="mini-profile-hero"><div class="mini-profile-avatar" style="background:${avatarGrad(userId)}">${initialOf(name)}</div><div class="mini-profile-name">${esc(name)}${isMe?' <span class="lb-you">You</span>':''}</div><div class="mini-profile-user">@${esc(userId)}</div>${followsMe?'<div class="mini-profile-mutual"><span class="mutual-chip">Follows you</span></div>':''}</div>
    <div class="mini-profile-stats"><div class="mini-profile-stat"><div class="mini-profile-stat-val">${sessions.length}</div><div class="mini-profile-stat-label">Workouts</div></div><div class="mini-profile-stat"><div class="mini-profile-stat-val">${fmtStatNum(vol)}</div><div class="mini-profile-stat-label">Volume (kg)</div></div><div class="mini-profile-stat"><div class="mini-profile-stat-val">${stats.week}</div><div class="mini-profile-stat-label">This Week</div></div><div class="mini-profile-stat"><div class="mini-profile-stat-val">${stats.streak}</div><div class="mini-profile-stat-label">Streak 🔥</div></div></div>
    ${!isMe?`<div class="mini-profile-actions">${iAmFollowing?`<button class="btn btn-secondary btn-full" id="mpUnfollow">Following</button>`:`<button class="btn btn-primary btn-full" id="mpFollow">Follow</button>`}</div>`:''}
    <div class="mini-profile-heatmap"><div class="mini-profile-heatmap-title">Activity — Last 16 Weeks</div>${gymHeatmapHtml(userId,name,workouts)}</div>`;
  const followBtn=document.getElementById('mpFollow');const unfollowBtn=document.getElementById('mpUnfollow');
  if(followBtn)followBtn.addEventListener('click',()=>{const c=FirebaseSync.getConfig();if(!c.following.some(f=>f.id===userId)){FirebaseSync.updateConfig({following:[...c.following,{id:userId,name:name}]});toast('Following @'+userId,'success');closeMiniProfile();renderFriendsCard();}});
  if(unfollowBtn)unfollowBtn.addEventListener('click',()=>{const c=FirebaseSync.getConfig();FirebaseSync.updateConfig({following:c.following.filter(f=>f.id!==userId)});removeFriendEntry(userId);toast('Unfollowed @'+userId);closeMiniProfile();renderFriendsCard();});
  bg.classList.add('open');bg.addEventListener('click',e=>{if(e.target===bg)closeMiniProfile();},{once:true});
}
function closeMiniProfile(){const bg=document.getElementById('miniProfileBg');if(bg)bg.classList.remove('open');}

function renderFriendsCard(){
  renderProfile();
  const label=document.getElementById('friendLabel');const card=document.getElementById('friendCard');
  if(!label||!card)return;
  const fb=fbCfg();const cache=getFriendsCache();const ids=Object.keys(cache.friends);
  const hasRemote=fb.connected&&fb.following.length>0;
  if(!hasRemote&&!ids.length){
    label.style.display='none';card.style.display='none';
    ['activityLabel','activityCard','h2hLabel','h2hCard','feedLabel','feedCard'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    return;
  }
  label.style.display='block';card.style.display='block';
  const syncBtn=document.getElementById('btnFriendSync');if(syncBtn)syncBtn.style.display=hasRemote?'':'none';
  const titleEl=document.getElementById('friendNameEl');if(titleEl)titleEl.textContent='Leaderboard';
  const syncEl=document.getElementById('friendLastSync');
  if(!ids.length){
    if(syncEl)syncEl.textContent='Not synced yet';
    document.getElementById('friendCompare').innerHTML='<p class="friend-empty">Tap Sync to load the people you follow.</p>';
    document.getElementById('lbPodium').innerHTML='';return;
  }
  if(syncEl)syncEl.textContent=`Updated ${timeAgo(cache.ts)}`;
  const allRows=buildLBRows();
  renderPodium(allRows,_lbMetric);renderLeaderboardRows(allRows,_lbMetric);
  renderGymActivity(allRows);renderH2HPicker(allRows);renderActivityFeed(allRows);
}

async function syncFriends(interactive=true){
  const btn=document.getElementById('btnFriendSync');if(btn)btn.classList.add('syncing');
  try{const fb=fbCfg();if(!fb.connected||!fb.following.length){if(interactive)toast('Follow someone from your Account tab first','error');return;}
    await fbPullFollowing(interactive);
  }finally{if(btn)btn.classList.remove('syncing');}
}

function bindFriend(){
  const btn=document.getElementById('btnFriendSync');if(btn)btn.addEventListener('click',()=>syncFriends(true));
  const tabs=document.getElementById('lbMetricTabs');
  if(tabs)tabs.addEventListener('click',e=>{const t=e.target.closest('.lb-metric-tab');if(!t)return;
    tabs.querySelectorAll('.lb-metric-tab').forEach(b=>b.classList.remove('on'));t.classList.add('on');
    _lbMetric=t.dataset.metric||'vol7';const allRows=buildLBRows();renderPodium(allRows,_lbMetric);renderLeaderboardRows(allRows,_lbMetric);});
  
  const tfTabs=document.getElementById('lbTimeframeTabs');
  if(tfTabs)tfTabs.addEventListener('click',e=>{const t=e.target.closest('.lb-timeframe-tab');if(!t)return;
    tfTabs.querySelectorAll('.lb-timeframe-tab').forEach(b=>b.classList.remove('on'));t.classList.add('on');
    _lbTimeframe=t.dataset.timeframe||'week';const allRows=buildLBRows();renderPodium(allRows,_lbMetric);renderLeaderboardRows(allRows,_lbMetric);});
}


/* ── Elite Search ──────────────────────────────────────────── */
function bindSearch(){
  const inp=document.getElementById('exS'),dd=document.getElementById('dd');
  let hi=-1;
  inp.addEventListener('input',()=>{
    const q=inp.value.toLowerCase().trim();dd.innerHTML='';hi=-1;
    const L=lib();
    if(!q){fullLib(dd,L);dd.classList.add('open');return;}
    for(const[g,exs]of Object.entries(L)){
      const m=exs.filter(e=>e.toLowerCase().includes(q));
      if(m.length){grp(dd,g);m.forEach(e=>dd.appendChild(mkI(e,g)));}
    }
    if(q.length>1){
      const c=document.createElement('div');c.className='dd-item';
      c.innerHTML=`<span class="dd-badge badge-new">New</span><span>"${esc(inp.value)}"</span>`;
      c.addEventListener('click',()=>selEx(inp.value.trim()));dd.appendChild(c);
    }
    dd.classList.add('open');
  });
  inp.addEventListener('focus',()=>{if(!inp.value.trim()){dd.innerHTML='';fullLib(dd,lib());dd.classList.add('open');}else if(dd.innerHTML)dd.classList.add('open');});
  inp.addEventListener('keydown',e=>{
    const its=dd.querySelectorAll('.dd-item');
    if(e.key==='ArrowDown'){e.preventDefault();hi=Math.min(hi+1,its.length-1);hlI(its,hi);}
    else if(e.key==='ArrowUp'){e.preventDefault();hi=Math.max(hi-1,0);hlI(its,hi);}
    else if(e.key==='Enter'){e.preventDefault();hi>=0&&its[hi]?its[hi].click():inp.value.trim()&&selEx(inp.value.trim());}
    else if(e.key==='Escape'){dd.classList.remove('open');inp.blur();}
  });
  document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))dd.classList.remove('open');});
}
function fullLib(dd,L){for(const[g,exs]of Object.entries(L)){grp(dd,g);exs.forEach(e=>dd.appendChild(mkI(e,g)));}}
function grp(dd,g){const l=document.createElement('div');l.className='dd-group';l.textContent=g;dd.appendChild(l);}
function mkI(n,g){
  const el=document.createElement('div');el.className='dd-item';
  el.innerHTML=`<span class="dd-badge badge-${g.toLowerCase()}">${g}</span><span>${n}</span>`;
  el.addEventListener('click',()=>selEx(n));return el;
}
function hlI(its,i){its.forEach((x,j)=>x.classList.toggle('active',j===i));if(its[i])its[i].scrollIntoView({block:'nearest'});}

function selEx(name){
  eEx=canonicalName(name);
  document.getElementById('exS').value='';
  document.getElementById('dd').classList.remove('open');
  document.getElementById('seN').textContent=eEx;
  
  const levelKeywords = ["assisted", "cable", "extension", "curl", "flexion", "raises", "deck", "butterfly", "dips", "lat cable", "pushdown", "pec deck", "machine"];
  const nameLower = eEx.toLowerCase();
  const isLevelDefault = levelKeywords.some(keyword => nameLower.includes(keyword)) && !nameLower.includes("db") && !nameLower.includes("dumbbell");
  eMode = isLevelDefault ? 'level' : 'weight';
  
  for (const w of W) {
    let found = false;
    for (const e of w.exercises) {
      if (canonicalName(e.name) === eEx) {
        const s = e.sets.find(s => s.weight !== null);
        if (s) {
          if (s.isLevel !== undefined) {
            eMode = s.isLevel ? 'level' : 'weight';
          } else if (s.notes && /level\s*\d+/i.test(s.notes)) {
            eMode = 'level';
          }
        }
        found = true;
        break;
      }
    }
    if (found) break;
  }

  const lw=lastW(eEx);
  eSets=[{weight:lw,reps:'',notes:'',completed:false},{weight:lw,reps:'',notes:'',completed:false},{weight:lw,reps:'',notes:'',completed:false}];
  
  renderSets();
  renderSegmentToggle();
  if (typeof updateEditorHeatmap === 'function') {
    updateEditorHeatmap(eEx);
  }
  
  const se=document.getElementById('se');se.style.display='block';
  setTimeout(()=>se.scrollIntoView({behavior:'smooth',block:'center'}),80);
}

function renderSegmentToggle() {
  const parent = document.getElementById('seN').parentElement;
  const existing = document.getElementById('seTog');
  if (existing) existing.remove();
  
  const tog = document.createElement('div');
  tog.className = 'toggle-segmented';
  tog.id = 'seTog';
  tog.innerHTML = `
    <button type="button" class="segment-btn ${eMode==='weight'?'active':''}" data-mode="weight">Weight (kg)</button>
    <button type="button" class="segment-btn ${eMode==='level'?'active':''}" data-mode="level">Machine Level</button>
  `;
  parent.appendChild(tog);
  
  tog.querySelectorAll('.segment-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      eMode = e.currentTarget.dataset.mode;
      tog.querySelectorAll('.segment-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === eMode));
      renderSets();
    });
  });
}

function lastW(n){
  for(const w of W) {
    for(const e of w.exercises) {
      if(canonicalName(e.name)===n){
        const s=e.sets.find(s=>s.weight !== null && s.weight !== undefined);
        if(s) return s.weight;
        const sLevel = e.sets.find(s => s.notes && /level\s*\d+/i.test(s.notes));
        if (sLevel) {
          const m = sLevel.notes.match(/level\s*(\d+)/i);
          if (m) return parseFloat(m[1]);
        }
      }
    }
  }
  return '';
}

function renderRecent(){}

/* ── Elite Editor ──────────────────────────────────────────── */
function bindSets(){
  document.getElementById('addS').addEventListener('click',()=>{
    const lw=eSets.length?eSets[eSets.length-1].weight:'';
    eSets.push({weight:lw,reps:'',notes:'',completed:false});renderSets();
  });
  document.getElementById('seCl').addEventListener('click',()=>{eEx=null;eSets=[];document.getElementById('se').style.display='none';});
  document.getElementById('svEx').addEventListener('click',saveEx);
}

function renderSets(){
  const g=document.getElementById('seG');
  const isL = eMode === 'level';
  g.innerHTML=`
    <div style="display:grid;grid-template-columns:30px 1.3fr 1fr 28px;gap:8px;margin-bottom:6px;align-items:center">
      <div class="set-label" style="text-align:center;color:var(--accent);font-size:0.75rem">Done</div>
      <div class="set-label" style="text-align:left;padding-left:10px">${isL ? 'Level' : 'Weight'}</div>
      <div class="set-label">Reps</div>
      <div></div>
    </div>`;
    
  eSets.forEach((s,i)=>{
    const r=document.createElement('div');r.className=`set-row-container ${s.completed?'completed':''}`;
    const stepVal = isL ? 1 : 2.5;
    const placeholder = isL ? 'Level' : 'kg';
    const tags = isL 
      ? ["Warm-up", "Easy", "Normal", "To failure"]
      : ["Warm-up", "Drop set", "To failure", "Felt heavy"];
    const tagsHtml = tags.map(t => `<button type="button" class="note-tag" data-i="${i}" data-val="${t}">${t}</button>`).join('');
    
    r.innerHTML=`
      <div class="set-grid-main">
        <button class="btn-set-check ${s.completed?'completed':''}" data-i="${i}" aria-label="Toggle set completion">
          ${s.completed ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg>` : i+1}
        </button>
        <div class="stepper-wrap">
          <button class="stepper-btn" data-i="${i}" data-d="-${stepVal}">−</button>
          <input type="number" class="set-input" data-i="${i}" data-f="weight" value="${s.weight||''}" placeholder="${placeholder}" step="${isL ? 1 : 0.5}" inputmode="decimal" ${s.completed?'disabled':''}>
          <button class="stepper-btn" data-i="${i}" data-d="${stepVal}">+</button>
        </div>
        <input type="number" class="set-input" data-i="${i}" data-f="reps" value="${s.reps||''}" placeholder="reps" inputmode="numeric" ${s.completed?'disabled':''}>
        <button class="set-del" data-i="${i}" aria-label="Delete set">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="set-notes-wrap">
        <input type="text" class="set-input set-notes-input" data-i="${i}" data-f="notes" value="${s.notes||''}" placeholder="Add note for set ${i+1}..." ${s.completed?'disabled':''}>
        <div class="note-tags-row">
          ${tagsHtml}
        </div>
      </div>`;
    g.appendChild(r);
  });

  g.querySelectorAll('.stepper-btn').forEach(b=>b.addEventListener('click',e=>{
    const idx=+e.currentTarget.dataset.i,d=parseFloat(e.currentTarget.dataset.d);
    eSets[idx].weight=Math.max(0,(eSets[idx].weight||0)+d);
    renderSets();
  }));

  g.querySelectorAll('.set-input').forEach(inp=>{
    inp.addEventListener('input',e=>{
      const idx=+e.target.dataset.i,f=e.target.dataset.f;
      let v=e.target.value;
      if(f==='weight')v=v?parseFloat(v):'';
      else if(f==='reps')v=v?parseInt(v):'';
      eSets[idx][f]=v;
    });
  });

  g.querySelectorAll('.note-tag').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = +e.currentTarget.dataset.i;
      const val = e.currentTarget.dataset.val;
      const currentNote = eSets[idx].notes || '';
      if (currentNote.includes(val)) return;
      eSets[idx].notes = currentNote ? `${currentNote}, ${val}` : val;
      renderSets();
    });
  });

  g.querySelectorAll('.set-del').forEach(b=>b.addEventListener('click',e=>{eSets.splice(+e.currentTarget.dataset.i,1);renderSets();}));

  g.querySelectorAll('.btn-set-check').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = +e.currentTarget.dataset.i;
      eSets[idx].completed = !eSets[idx].completed;
      if (eSets[idx].completed) {
        const restDuration = (timerTotal > 0) ? timerTotal : 90;
        if (typeof window.triggerRestTimer === 'function') {
          window.triggerRestTimer(restDuration);
        }
      }
      renderSets();
    });
  });
}

function saveEx(){
  if(!eEx)return;
  const v=eSets.filter(s=>s.weight||s.reps||s.notes);
  if(!v.length){toast('Enter at least one set','error');return;}
  SE.push({
    name:eEx,
    sets:v.map(s=>({
      weight:s.weight||null,
      reps:s.reps||null,
      notes:s.notes||'',
      isLevel: eMode === 'level'
    }))
  });
  persistSE();
  
  let isDefault=false;
  for(const exs of Object.values(EXERCISE_LIBRARY)){
    if(exs.includes(eEx)){isDefault=true;break;}
  }
  if(!isDefault){
    if(!CX['Other']) CX['Other']=[];
    if(!CX['Other'].includes(eEx)){
      CX['Other'].push(eEx);
      saveCX();
    }
  }

  eEx=null;eSets=[];document.getElementById('se').style.display='none';
  renderLogged();toast('Exercise added','success');
  document.getElementById('acts').style.display='flex';
}

function renderLogged(){
  const el=document.getElementById('logd');el.innerHTML='';
  if(!SE.length){el.innerHTML='<p style="color:var(--t-3);font-size:0.85rem">No exercises logged yet.</p>';return;}
  SE.forEach((ex,idx)=>{
    const c=document.createElement('div');c.className='logged-card';
    const isL=ex.sets.length>0&&ex.sets[0].isLevel;
    const modeLabel=isL?'Level':'kg';
    const sh=ex.sets.map(s=>`<div class="chip"><span class="chip-w">${formatWeightVal(s)}</span><span class="chip-x">×</span><span class="chip-r">${s.reps!=null?s.reps:'—'}</span></div>`).join('');
    c.innerHTML=`<div class="logged-header"><div class="logged-name">${esc(ex.name)}</div><div class="logged-actions"><button class="btn-toggle-mode" data-tog="${idx}" title="Switch between kg and Level"><svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>${modeLabel}</button><button class="btn btn-ghost btn-sm" data-rm="${idx}">Remove</button></div></div><div class="set-chips">${sh}</div>`;
    el.appendChild(c);
  });
  el.querySelectorAll('[data-rm]').forEach(b=>b.addEventListener('click',e=>{
    SE.splice(+e.currentTarget.dataset.rm,1);persistSE();renderLogged();
    if(!SE.length)document.getElementById('acts').style.display='none';
  }));
  el.querySelectorAll('[data-tog]').forEach(b=>b.addEventListener('click',e=>{
    const idx=+e.currentTarget.dataset.tog;
    SE[idx].sets.forEach(s=>{s.isLevel=!s.isLevel;});
    persistSE();renderLogged();
  }));
}

/* ── Actions ───────────────────────────────────────────────── */
function bindActs(){
  document.getElementById('fin').addEventListener('click',finish);
  document.getElementById('disc').addEventListener('click',()=>{
    showM('Discard Session?','All entered data for today will be permanently lost.',()=>{
      SE=[];eEx=null;eSets=[];persistSE();document.getElementById('se').style.display='none';
      document.getElementById('acts').style.display='none';renderLogged();toast('Session discarded');
    });
  });
}

async function finish(){
  const d=document.getElementById('wDate').value,t=document.getElementById('wType').value;
  if(!d){toast('Pick a date','error');return;}
  if(!t){toast('Pick a split focus','error');return;}
  if(t!=='Rest Day'&&!SE.length){toast('Add at least one exercise','error');return;}
  const wo={date:d,dayType:t,exercises:t==='Rest Day'?[]:[...SE]};
  const idx=W.findIndex(w=>w.date===d);
  if(idx>=0){wo.exercises=[...W[idx].exercises,...wo.exercises];W[idx]=wo;}else W.unshift(wo);
  W.sort((a,b)=>b.date.localeCompare(a.date));save();
  const synced=fbCfg().connected?await fbPush(false):false;
  toast(synced?'Saved & Synced':'Saved locally','success');
  SE=[];eEx=null;eSets=[];persistSE();document.getElementById('se').style.display='none';
  document.getElementById('acts').style.display='none';renderLogged();
  renderHeatmapCalendar();renderVolWidget();renderProfile();
}

/* ── Elite Timeline History ────────────────────────────────── */
function bindHist(){
  document.querySelectorAll('#vHist [data-f]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('#vHist [data-f]').forEach(x=>{x.classList.remove('on');});
    b.classList.add('on');
    filt=b.dataset.f;renderHist();
  }));
}

/* Expanded card content (per-set rows + anatomy SVGs) is expensive to
   build, so it's generated lazily on first expand instead of for every
   card upfront. */
function buildExpandedHtml(wo){
  const exExpandedHtml = wo.exercises.map(ex => {
    const setsHtml = ex.sets.map((s, idx) => {
      const noteStr = s.notes ? `<span class="tl-set-note">${esc(s.notes)}</span>` : '';
      return `<div class="tl-set-row"><span class="tl-set-idx">Set ${idx+1}</span><span class="tl-set-weight-reps">${formatWeightVal(s)} × ${s.reps ?? '—'}</span>${noteStr}</div>`;
    }).join('');

    return `<div class="tl-ex-detail">
        <div class="tl-ex-detail-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div class="tl-ex-detail-name" style="margin-bottom:0">${esc(ex.name)}</div>
          <button class="btn btn-ghost btn-sm tl-del-ex-btn" data-date="${wo.date}" data-ex-name="${esc(ex.name)}" style="padding:4px 8px;color:var(--c-red);font-size:0.75rem">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;margin-right:4px">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Remove
          </button>
        </div>
        <div class="tl-ex-detail-sets">${setsHtml}</div>
      </div>`;
  }).join('');

  const sessionMuscles = {};
  wo.exercises.forEach(ex => {
    const ms = getMusclesForExercise(ex.name, wo.dayType);
    ms.forEach(m => { sessionMuscles[m] = 3; });
  });
  const hmHtml = `
    <div class="history-heatmap-wrap">
      <div class="anatomy-svg-container">
        <div class="anatomy-view-label">Front</div>
        ${getAnatomySvg('front', sessionMuscles)}
      </div>
      <div class="anatomy-svg-container">
        <div class="anatomy-view-label">Back</div>
        ${getAnatomySvg('back', sessionMuscles)}
      </div>
    </div>
  `;

  return exExpandedHtml + hmHtml;
}

function renderHist(){
  const el=document.getElementById('hList');el.innerHTML='';
  let data=W;
  if(filt!=='all')data=W.filter(w=>w.dayType.toLowerCase().includes(filt.toLowerCase()));
  if(!data.length){el.innerHTML='<p style="color:var(--t-3);padding:24px 0;font-size:0.9rem">No sessions found.</p>';return;}
  const frag=document.createDocumentFragment();

  data.forEach((wo,wi)=>{
    const dt=new Date(wo.date+'T00:00:00');
    const ds=dt.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});
    
    if (wo.dayType === 'Rest Day') {
      const recoveryTips = [
        "Active recovery day. Focus on stretching, light mobility work, and hydration.",
        "Prioritize sleep and muscle recovery. Your body synthesizes protein and rebuilds tissue during rest.",
        "Rest days are when muscles grow. Keep protein intake high and let your central nervous system recharge.",
        "Focus on mobility work and light stretching today to relieve any muscle tightness.",
        "Hydrate well and focus on clean nutrition to replenish glycogen stores for your next session."
      ];
      const dayCode = dt.getDate() + dt.getMonth();
      const tip = recoveryTips[dayCode % recoveryTips.length];

      const c=document.createElement('div');c.className='tl-item';
      c.style.animationDelay = `${wi * 0.04}s`;
      c.innerHTML=`
        <div class="tl-dot" style="background:var(--c-orange);box-shadow:0 0 8px var(--c-orange)"></div>
        <div class="tl-card tl-rest-card">
          <div class="tl-rest-header">
            <div class="tl-rest-icon-wrap">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
              </svg>
            </div>
            <div class="tl-date-group">
              <div class="tl-date">${ds}</div>
              <div class="tl-split-tag badge-shoulders" style="background:var(--c-orange-bg);color:var(--c-orange)">Rest Day</div>
            </div>
          </div>
          <div class="tl-rest-body">
            <div class="tl-recovery-tip-title">Recovery Mode Active</div>
            <p class="tl-recovery-tip">${tip}</p>
          </div>
          <div class="tl-card-actions">
            <button class="btn btn-ghost btn-sm tl-action-btn copy-btn" data-date="${wo.date}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon-svg">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy
            </button>
            <button class="btn btn-ghost btn-sm tl-action-btn delete-day-btn text-danger" data-date="${wo.date}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon-svg">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
              Delete
            </button>
          </div>
        </div>`;
      c.querySelector('.copy-btn').addEventListener('click', e => {
        e.stopPropagation();
        const item = W.find(w => w.date === e.currentTarget.dataset.date);
        if(item) copyWorkoutToClipboard(item);
      });
      c.querySelector('.delete-day-btn').addEventListener('click', e => {
        e.stopPropagation();
        deleteDay(e.currentTarget.dataset.date);
      });
      frag.appendChild(c);
      return;
    }

    const ns=wo.exercises.reduce((s,e)=>s+e.sets.length,0);
    const vol=wo.exercises.reduce((s,e)=>s+e.sets.reduce((ss,x)=>ss+((getSetWeightVal(x))*(x.reps||0)),0),0);
    
    const mD={Pull:0,Push:0,Legs:0,Shoulders:0,Core:0,Other:0};
    wo.exercises.forEach(e=>{mD[findG(e.name)]+=e.sets.length;});
    const cL={Pull:'var(--c-blue)',Push:'var(--c-red)',Legs:'var(--c-green)',Shoulders:'var(--c-orange)',Core:'var(--c-purple)',Other:'var(--c-cyan)'};
    let mbHtml='';
    Object.entries(mD).forEach(([g,c])=>{if(c>0)mbHtml+=`<div class="tl-m-seg" style="width:${(c/ns)*100}%;background:${cL[g]}"></div>`;});

    const exH=wo.exercises.map(ex=>{
      let bestS=null,maxV=0;
      ex.sets.forEach(s=>{const v=(getSetWeightVal(s))*(s.reps||0);if(v>maxV){maxV=v;bestS=s;}});
      return `<div class="tl-ex"><div><div class="tl-ex-name">${esc(ex.name)}</div><div class="tl-ex-sets">${ex.sets.length} sets</div></div>${bestS ? `<div class="tl-ex-best"><div class="tl-best-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34"/><path d="M12 2a5 5 0 0 0-5 5v3c0 2.76 2.24 5 5 5s5-2.24 5-5V7a5 5 0 0 0-5-5z"/></svg></div><span class="tl-best-val">${formatWeightVal(bestS)} × ${bestS.reps||'—'}</span></div>` : ''}</div>`;
    }).join('');

    const c=document.createElement('div');c.className='tl-item';
    c.style.animationDelay = `${wi * 0.04}s`;
    c.innerHTML=`
      <div class="tl-dot"></div>
      <div class="tl-card">
        <div class="tl-header">
          <div style="display:flex;align-items:center;flex:1">
            <div class="tl-expand-chevron">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </div>
            <div class="tl-date-group">
              <div class="tl-date">${ds}</div>
              <div class="tl-split-tag badge-${dayC(wo.dayType)}">${wo.dayType}</div>
            </div>
          </div>
          <div class="tl-stats">
            <div class="tl-stat"><span class="tl-stat-v">${vol>=1000?(vol/1000).toFixed(1)+'k':vol}</span><span class="tl-stat-l">Volume</span></div>
            <div class="tl-stat"><span class="tl-stat-v">${wo.exercises.length}</span><span class="tl-stat-l">Exercises</span></div>
          </div>
        </div>
        <div class="tl-muscles" title="Muscle Distribution">${mbHtml}</div>
        <div class="tl-body-collapsed">${exH}</div>
        <div class="tl-body-expanded"></div>
        <div class="tl-card-actions">
          <button class="btn btn-ghost btn-sm tl-action-btn copy-btn" data-date="${wo.date}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon-svg">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Copy
          </button>
          <button class="btn btn-ghost btn-sm tl-action-btn delete-day-btn text-danger" data-date="${wo.date}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="action-icon-svg">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Delete
          </button>
        </div>
      </div>`;
    
    c.querySelector('.tl-header').addEventListener('click',()=>{
      const card=c.querySelector('.tl-card');
      if(!card.dataset.built){
        card.dataset.built='1';
        const expanded=card.querySelector('.tl-body-expanded');
        expanded.innerHTML=buildExpandedHtml(wo);
        expanded.querySelectorAll('.tl-del-ex-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            removeExerciseFromWorkout(e.currentTarget.dataset.date, e.currentTarget.dataset.exName);
          });
        });
      }
      card.classList.toggle('expanded');
    });
    c.querySelector('.copy-btn').addEventListener('click', e => {
      e.stopPropagation();
      const item = W.find(w => w.date === e.currentTarget.dataset.date);
      if(item) copyWorkoutToClipboard(item);
    });
    c.querySelector('.delete-day-btn').addEventListener('click', e => {
      e.stopPropagation();
      deleteDay(e.currentTarget.dataset.date);
    });
    frag.appendChild(c);
  });
  el.appendChild(frag);
}

function deleteDay(date){
  showM('Delete Workout Day?','Are you sure you want to permanently delete this workout day from your local history?',()=>{
    const idx = W.findIndex(w => w.date === date);
    if(idx >= 0){W.splice(idx, 1);save();renderHist();renderHeatmapCalendar();renderVolWidget();toast('Workout day deleted','error');}
  });
}

function removeExerciseFromWorkout(date, exName){
  showM('Remove Exercise?','Are you sure you want to remove this exercise from this session?',()=>{
    const wIdx = W.findIndex(w => w.date === date);
    if(wIdx >= 0){
      const eIdx = W[wIdx].exercises.findIndex(e => e.name === exName);
      if(eIdx >= 0){W[wIdx].exercises.splice(eIdx, 1);save();renderHist();toast('Exercise removed','error');}
    }
  });
}

function copyWorkoutToClipboard(wo){
  const dt=new Date(wo.date+'T00:00:00');
  const ds=dt.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
  let txt = `${ds} (${wo.dayType})\n─────────────────────────\n`;
  if (wo.dayType === 'Rest Day') {
    txt += `Recovery day.\n`;
  } else if (!wo.exercises.length) {
    txt += `No exercises logged.\n`;
  } else {
    wo.exercises.forEach(ex => {
      const setsStr = ex.sets.map(s => {
        const wVal = formatWeightVal(s);
        const repVal = s.reps ?? '—';
        const noteStr = s.notes ? ` (${s.notes})` : '';
        return `${wVal} × ${repVal}${noteStr}`;
      }).join(' | ');
      txt += `• ${ex.name} : ${setsStr}\n`;
    });
  }
  txt += `─────────────────────────`;
  navigator.clipboard.writeText(txt).then(()=>{toast('Copied!','success');}).catch(()=>{toast('Failed to copy','error');});
}

function dayC(t){t=t.toLowerCase();if(t.includes('pull'))return'pull';if(t.includes('push'))return'push';if(t.includes('leg'))return'legs';if(t.includes('shoulder'))return'shoulders';if(t.includes('upper')||t.includes('core'))return'core';return'other';}

function findG(name){
  const cn=canonicalName(name);const L=lib();
  for(const[g,exs]of Object.entries(L)){if(exs.some(e=>e===cn))return g;}
  const n=cn.toLowerCase();
  if(n.includes('lat')||n.includes('row')||n.includes('pull')||n.includes('curl')||n.includes('bicep')||n.includes('hammer')||n.includes('shrug'))return'Pull';
  if(n.includes('press')||n.includes('fly')||n.includes('dip')||n.includes('tricep')||n.includes('incline')||n.includes('pec'))return'Push';
  if(n.includes('leg')||n.includes('calv')||n.includes('squat'))return'Legs';
  if(n.includes('shoulder')||n.includes('lateral')||n.includes('front raise')||n.includes('face pull')||n.includes('reverse'))return'Shoulders';
  if(n.includes('ab')||n.includes('crunch')||n.includes('wrist')||n.includes('knee raise'))return'Core';
  return'Other';
}

function getSetWeightVal(s) {
  if (s.weight !== null && s.weight !== undefined && s.weight !== '') return parseFloat(s.weight);
  if (s.notes) { const m = s.notes.match(/level\s*(\d+)/i); if (m) return parseFloat(m[1]); }
  return 0;
}

function formatWeightVal(s) {
  const w = s.weight;
  if (w === null || w === undefined || w === '') {
    if (s.notes) { const m = s.notes.match(/level\s*(\d+)/i); if (m) return `L${m[1]}`; }
    return '—';
  }
  const isLevel = (s.isLevel === true);
  return isLevel ? `L${w}` : `${w}kg`;
}

/* ── Elite Analytics Dashboard ────────────────────────────── */
function bindAna(){document.getElementById('cEx').addEventListener('change',renderChart);document.getElementById('cM').addEventListener('change',renderChart);}

function refreshAna(){popExSel();renderSG();renderPRs();renderChart();renderVolInsights();renderWeeklyRing();}

let currentVolPeriod = 7;

function bindVolInsights(){
  const tog=document.getElementById('volPeriodTog');
  if(tog){
    tog.querySelectorAll('.segment-btn').forEach(btn=>{
      btn.addEventListener('click',e=>{
        currentVolPeriod=parseInt(e.currentTarget.dataset.period);
        tog.querySelectorAll('.segment-btn').forEach(b=>b.classList.toggle('active',+b.dataset.period===currentVolPeriod));
        renderVolInsights();
      });
    });
  }
}

function renderVolInsights(){
  const period=currentVolPeriod;
  const today=new Date();
  today.setHours(23,59,59,999);
  const currentStart=new Date(today.getTime()-period*24*60*60*1000);
  const previousStart=new Date(today.getTime()-2*period*24*60*60*1000);
  
  const groups=['Pull','Push','Legs','Shoulders','Core'];
  const currentCounts={Pull:0,Push:0,Legs:0,Shoulders:0,Core:0};
  const previousCounts={Pull:0,Push:0,Legs:0,Shoulders:0,Core:0};
  
  W.forEach(w=>{
    const wDate=new Date(w.date+'T00:00:00');
    if(wDate>=currentStart&&wDate<=today){
      w.exercises.forEach(e=>{
        const g=findG(e.name);
        if(groups.includes(g)) currentCounts[g]+=e.sets.length;
      });
    }else if(wDate>=previousStart&&wDate<currentStart){
      w.exercises.forEach(e=>{
        const g=findG(e.name);
        if(groups.includes(g)) previousCounts[g]+=e.sets.length;
      });
    }
  });
  
  const listEl=document.getElementById('volInsightList');
  if(!listEl)return;
  listEl.innerHTML='';
  
  const maxSets=period===7?25:100;
  const thresholds=period===7?{under:10,optimal:20}:{under:40,optimal:80};
  
  groups.forEach(group=>{
    const cc=currentCounts[group];
    const pc=previousCounts[group];
    const diff=cc-pc;
    const compareSign=diff>0?'+':'';
    const compareClass=diff>0?'pos':(diff<0?'neg':'neutral');
    
    const currentPercent=Math.min((cc/maxSets)*100,100);
    const previousPercent=Math.min((pc/maxSets)*100,100);
    
    let statusText='';let statusClass='';let suggestionText='';
    if(cc<thresholds.under){statusText='Under-targeted';statusClass='status-under';suggestionText=`Add 1-2 exercises to hit hypertrophy threshold.`;}
    else if(cc<=thresholds.optimal){statusText='Optimal';statusClass='status-optimal';suggestionText=`Focus on progressive overload (weight/reps).`;}
    else{statusText='High Volume';statusClass='status-high';suggestionText=`Monitor fatigue and recovery.`;}
    
    const row=document.createElement('div');
    row.className='vol-item';
    row.innerHTML=`
      <div class="vol-item-meta">
        <span class="vol-name">${group}</span>
        <span class="vol-stats">
          <span class="vol-current">${cc} <span class="vol-unit">sets</span></span>
          <span class="vol-compare ${compareClass}">${compareSign}${diff} sets</span>
        </span>
      </div>
      <div class="vol-bars-wrap">
        <div class="vol-bar-row">
          <span class="vol-bar-label">Current</span>
          <div class="vol-bar-track"><div class="vol-bar-fill current badge-${group.toLowerCase()}" style="width: ${currentPercent}%"></div></div>
        </div>
        <div class="vol-bar-row">
          <span class="vol-bar-label">Previous</span>
          <div class="vol-bar-track"><div class="vol-bar-fill previous" style="width: ${previousPercent}%"></div></div>
        </div>
      </div>
      <div class="vol-suggestion">
        <span class="vol-status-badge ${statusClass}">${statusText}</span>
        <span class="vol-suggestion-text">${suggestionText}</span>
      </div>
    `;
    listEl.appendChild(row);
  });
  
  if (typeof renderHeatmapInsights === 'function') {
    renderHeatmapInsights(period);
  }
}

function popExSel(){
  const sel=document.getElementById('cEx'),pv=sel.value;sel.innerHTML='<option value="">Select Exercise</option>';
  const names=new Set();W.forEach(w=>w.exercises.forEach(e=>names.add(canonicalName(e.name))));
  [...names].sort().forEach(n=>{const o=document.createElement('option');o.value=n;o.textContent=n;sel.appendChild(o);});
  if(pv&&[...names].includes(pv))sel.value=pv;
}

function renderSG(){
  const el=document.getElementById('sgC');
  let ts=0,te=0,vol=0;
  W.forEach(w=>{
    te+=w.exercises.length;
    w.exercises.forEach(e=>{
      ts+=e.sets.length;
      e.sets.forEach(s=>{
        const wVal = getSetWeightVal(s);
        if(wVal && s.reps) vol += wVal * s.reps;
      });
    });
  });
  el.innerHTML=`
    <div class="widget w-1"><div class="w-val">${W.length}</div><div class="w-lbl">Workouts</div></div>
    <div class="widget w-2"><div class="w-val">${ts}</div><div class="w-lbl">Total Sets</div></div>
    <div class="widget w-3"><div class="w-val">${vol>=1000?(vol/1000).toFixed(1)+'k':vol}</div><div class="w-lbl">Volume (kg)</div></div>
    <div class="widget w-4"><div class="w-val">${te}</div><div class="w-lbl">Exercises</div></div>`;
}

function renderPRs(){
  const el=document.getElementById('prS');
  const prs={};
  W.forEach(w=>w.exercises.forEach(ex=>{
    const key=canonicalName(ex.name);
    if(!prs[key])prs[key]={mw:0,mr:0,isLevel:false};
    ex.sets.forEach(s=>{
      const isL = s.isLevel || (s.notes && /level\s*\d+/i.test(s.notes));
      if(isL) prs[key].isLevel = true;
      const wVal = getSetWeightVal(s);
      if(wVal && wVal>prs[key].mw)prs[key].mw=wVal;
      if(s.reps&&s.reps>prs[key].mr)prs[key].mr=s.reps;
    });
  }));
  const sorted=Object.entries(prs).filter(([,pr])=>pr.mw>0).sort((a,b)=>b[1].mw-a[1].mw).slice(0,4);
  if(!sorted.length){el.innerHTML='<p style="color:var(--t-3);font-size:0.9rem">No records set yet.</p>';return;}
  el.innerHTML=sorted.map(([n,pr])=>`
    <div class="pr-card">
      <div class="pr-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
          <path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34"/>
          <path d="M12 2a5 5 0 0 0-5 5v3c0 2.76 2.24 5 5 5s5-2.24 5-5V7a5 5 0 0 0-5-5z"/>
        </svg>
      </div>
      <div class="pr-details"><div class="pr-name">${esc(n)}</div><div class="pr-sub">Max Reps: ${pr.mr}</div></div>
      <div class="pr-score">${pr.isLevel ? 'L' : ''}${pr.mw}${pr.isLevel ? '' : 'kg'}</div>
    </div>`).join('');
}

function renderChart(){
  const name=document.getElementById('cEx').value,metric=document.getElementById('cM').value;
  const cv=document.getElementById('cV');
  const canvas=document.getElementById('cc');
  const ctx=canvas.getContext('2d');
  
  if(!name){cv.textContent='—';ctx.clearRect(0,0,canvas.width,canvas.height);return;}

  const pts=[];
  [...W].sort((a,b)=>a.date.localeCompare(b.date)).forEach(wo=>{
    wo.exercises.forEach(ex=>{
      if(canonicalName(ex.name)!==name)return;
      let isLevelEx = false;
      ex.sets.forEach(s => { if (s.isLevel || (s.notes && /level\s*\d+/i.test(s.notes))) isLevelEx = true; });
      
      if(metric==='weightReps') {
        let bestS = null, maxW = 0;
        ex.sets.forEach(s => { const wVal = getSetWeightVal(s); if (wVal > maxW) { maxW = wVal; bestS = s; } });
        if (maxW > 0) {
          const d=new Date(wo.date+'T00:00:00');
          pts.push({label:d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),weight:maxW,reps:bestS?bestS.reps:0,isLevel:isLevelEx});
        }
      } else if(metric==='volume') {
        const v=ex.sets.reduce((s,x)=>s+((getSetWeightVal(x))*(x.reps||0)),0);
        if(v>0){const d=new Date(wo.date+'T00:00:00');pts.push({label:d.toLocaleDateString('en-US',{month:'short',day:'numeric'}),value:v,isLevel:isLevelEx});}
      }
    });
  });

  if(!pts.length){cv.textContent='No data';ctx.clearRect(0,0,canvas.width,canvas.height);return;}
  
  const isLevel = pts.some(p => p.isLevel);
  if (metric === 'weightReps') {
    const lastP = pts[pts.length - 1];
    cv.textContent = (isLevel ? `L${lastP.weight}` : `${lastP.weight}kg`) + ` × ${lastP.reps || 0}r`;
  } else {
    cv.textContent = pts[pts.length-1].value + ' kg';
  }
  
  requestAnimationFrame(()=>drawChart(pts,canvas,ctx,metric));
}

function drawChart(pts,canvas,ctx,metric){
  const dpr=window.devicePixelRatio||1;
  const rect=canvas.parentElement.getBoundingClientRect();
  canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
  ctx.scale(dpr,dpr);
  const w=rect.width,h=rect.height;
  const pad={top:30,right:35,bottom:25,left:35};
  const cw=w-pad.left-pad.right,ch=h-pad.top-pad.bottom;
  const isLevel = pts.some(p => p.isLevel);
  ctx.clearRect(0,0,w,h);
  
  if (metric === 'weightReps') {
    const weights = pts.map(p => p.weight);
    const repsList = pts.map(p => p.reps || 0);
    const maxW = Math.max(...weights, 1) * 1.1;
    const minW = Math.min(...weights, 0) * 0.9;
    const rangeW = maxW - minW || 1;
    const maxR = Math.max(...repsList, 1) * 1.25;
    const minR = 0;
    const rangeR = maxR - minR || 1;

    ctx.strokeStyle='rgba(255,255,255,0.04)';ctx.lineWidth=1;
    for(let i=0;i<=3;i++){
      const y=pad.top+(ch/3)*i;
      ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(w-pad.right,y);ctx.stroke();
      const valW = maxW - (rangeW/3)*i;
      ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='600 8px "JetBrains Mono"';ctx.textAlign='right';
      ctx.fillText(isLevel ? `L${Math.round(valW)}` : `${Math.round(valW)}k`, pad.left-6, y+3);
      const valR = maxR - (rangeR/3)*i;
      ctx.fillStyle='rgba(255, 159, 10, 0.4)';ctx.font='600 8px "JetBrains Mono"';ctx.textAlign='left';
      ctx.fillText(`${Math.round(valR)}r`, w - pad.right + 6, y+3);
    }

    const points = pts.map((p, i) => ({x:pad.left+(cw/Math.max(pts.length-1,1))*i,yW:pad.top+ch-((p.weight-minW)/rangeW)*ch,yR:pad.top+ch-((p.reps-minR)/rangeR)*ch,...p}));

    if (points.length > 1) {
      const grad = ctx.createLinearGradient(0, pad.top, 0, h - pad.bottom);
      grad.addColorStop(0, 'rgba(255, 107, 0, 0.18)');grad.addColorStop(1, 'rgba(255, 107, 0, 0)');
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].yW);
      for (let i = 1; i < points.length; i++) {const cx = (points[i-1].x+points[i].x)/2;ctx.bezierCurveTo(cx,points[i-1].yW,cx,points[i].yW,points[i].x,points[i].yW);}
      ctx.lineTo(points[points.length-1].x,h-pad.bottom);ctx.lineTo(points[0].x,h-pad.bottom);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].yW);
      for (let i = 1; i < points.length; i++) {const cx = (points[i-1].x+points[i].x)/2;ctx.bezierCurveTo(cx,points[i-1].yW,cx,points[i].yW,points[i].x,points[i].yW);}
      ctx.strokeStyle = '#FF6B00'; ctx.lineWidth = 2.5; ctx.stroke();
    }

    if (points.length > 1) {
      ctx.beginPath(); ctx.moveTo(points[0].x, points[0].yR);
      for (let i = 1; i < points.length; i++) {const cx = (points[i-1].x+points[i].x)/2;ctx.bezierCurveTo(cx,points[i-1].yR,cx,points[i].yR,points[i].x,points[i].yR);}
      ctx.strokeStyle = '#FFB300'; ctx.lineWidth = 1.8;ctx.setLineDash([3, 3]);ctx.stroke();ctx.setLineDash([]);
    }

    points.forEach((p, i) => {
      ctx.beginPath();ctx.arc(p.x,p.yW,4,0,Math.PI*2);ctx.fillStyle='#000';ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='#FF6B00';ctx.stroke();
      ctx.beginPath();ctx.arc(p.x,p.yR,3,0,Math.PI*2);ctx.fillStyle='#000';ctx.fill();ctx.lineWidth=1.5;ctx.strokeStyle='#FFB300';ctx.stroke();
      if (pts.length <= 7 || i === 0 || i === pts.length - 1) {
        ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='600 8px "Plus Jakarta Sans"';ctx.textAlign='center';ctx.fillText(p.label,p.x,h-pad.bottom+16);
      }
    });

    ctx.font='700 8px "Plus Jakarta Sans"';ctx.textAlign='left';
    ctx.fillStyle='#FF6B00';ctx.beginPath();ctx.arc(pad.left+2,pad.top-14,3,0,Math.PI*2);ctx.fill();
    ctx.fillText(isLevel?'Level (left)':'Weight (left)',pad.left+10,pad.top-11);
    ctx.fillStyle='#FFB300';ctx.beginPath();ctx.arc(pad.left+102,pad.top-14,3,0,Math.PI*2);ctx.fill();
    ctx.fillText('Reps (right)',pad.left+110,pad.top-11);
  } else {
    const vals = pts.map(p => p.value);
    const max = Math.max(...vals, 1) * 1.08;const min = Math.min(...vals, 0) * 0.85;const range = max - min || 1;
    ctx.strokeStyle='rgba(255,255,255,0.04)';ctx.lineWidth=1;
    for(let i=0;i<=3;i++){const y=pad.top+(ch/3)*i;ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(w-pad.right,y);ctx.stroke();const val=max-(range/3)*i;ctx.fillStyle='rgba(255,255,255,0.3)';ctx.font='600 9px "JetBrains Mono"';ctx.textAlign='right';ctx.fillText(Math.round(val),pad.left-6,y+3);}
    const points=pts.map((p,i)=>({x:pad.left+(cw/Math.max(pts.length-1,1))*i,y:pad.top+ch-((p.value-min)/range)*ch,...p}));
    if(points.length>1){
      const grad=ctx.createLinearGradient(0,pad.top,0,h-pad.bottom);grad.addColorStop(0,'rgba(255,107,0,0.22)');grad.addColorStop(1,'rgba(255,107,0,0)');
      ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++){const cx1=(points[i-1].x+points[i].x)/2;ctx.bezierCurveTo(cx1,points[i-1].y,cx1,points[i].y,points[i].x,points[i].y);}
      ctx.lineTo(points[points.length-1].x,h-pad.bottom);ctx.lineTo(points[0].x,h-pad.bottom);ctx.closePath();ctx.fillStyle=grad;ctx.fill();
      ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);for(let i=1;i<points.length;i++){const cx1=(points[i-1].x+points[i].x)/2;ctx.bezierCurveTo(cx1,points[i-1].y,cx1,points[i].y,points[i].x,points[i].y);}
      ctx.strokeStyle='#FF6B00';ctx.lineWidth=2.5;ctx.stroke();
    }
    points.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x,p.y,4.5,0,Math.PI*2);ctx.fillStyle='#000';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#FF6B00';ctx.stroke();if(pts.length<=7||i===0||i===pts.length-1){ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='600 8px "Plus Jakarta Sans"';ctx.textAlign='center';ctx.fillText(p.label,p.x,h-pad.bottom+16);}});
    ctx.font='700 8px "Plus Jakarta Sans"';ctx.textAlign='left';ctx.fillStyle='#FF6B00';ctx.beginPath();ctx.arc(pad.left+2,pad.top-14,3,0,Math.PI*2);ctx.fill();ctx.fillText('Volume (kg)',pad.left+10,pad.top-11);
  }
}

/* ── Settings ──────────────────────────────────────────────── */
function bindSettings(){
  // Firebase Cloud Sync settings — the backend itself is baked into
  // firebase-sync.js at build time; users pick a Sync ID and follow others.
  const fbMyId=document.getElementById('fbMyId');
  const fbDisplayName=document.getElementById('fbDisplayName');
  const bFbSave=document.getElementById('bFbSave');
  if(fbMyId&&bFbSave&&typeof FirebaseSync!=='undefined'){
    const cfg=FirebaseSync.getConfig();
    fbMyId.value=cfg.userId||'';
    if(fbDisplayName)fbDisplayName.value=cfg.displayName||'';
    setFbStatus(cfg.connected);

    const bEditProfile=document.getElementById('bEditProfile');
    const profileEdit=document.getElementById('profileEdit');
    const fbGithub=document.getElementById('fbGithub');
    const fAvatarUpload=document.getElementById('fAvatarUpload');
    const profAvatar=document.getElementById('profAvatar');
    if(bEditProfile&&profileEdit){
      bEditProfile.addEventListener('click',()=>{
        const open=profileEdit.classList.toggle('open');
        const hero=document.querySelector('.profile-hero');
        if(hero)hero.classList.toggle('editing',open);
        bEditProfile.textContent=open?'Close':'Edit profile';
        if(!open) renderProfile();
      });
    }

    if(profAvatar&&fAvatarUpload){
      profAvatar.addEventListener('click',()=>{
        const hero=document.querySelector('.profile-hero');
        if(hero&&hero.classList.contains('editing')){
          fAvatarUpload.click();
        }
      });
    }

    if(fAvatarUpload){
      fAvatarUpload.addEventListener('change',e=>{
        const file=e.target.files[0];
        if(!file)return;
        const reader=new FileReader();
        reader.onload=event=>{
          const img=new Image();
          img.onload=async()=>{
            const canvas=document.createElement('canvas');
            canvas.width=120;
            canvas.height=120;
            const ctx=canvas.getContext('2d');
            const minDim=Math.min(img.width,img.height);
            const sx=(img.width-minDim)/2;
            const sy=(img.height-minDim)/2;
            ctx.drawImage(img,sx,sy,minDim,minDim,0,0,120,120);
            const avatarDataUrl=canvas.toDataURL('image/jpeg',0.7);
            const cfg=FirebaseSync.updateConfig({ avatar: avatarDataUrl });
            if(profAvatar){
              profAvatar.innerHTML=`<img src="${avatarDataUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
              profAvatar.style.background='none';
            }
            if(cfg.connected){
              toast('Uploading profile picture...','info');
              const ok=await fbPush(false);
              if(ok)toast('Profile picture updated and synced','success');
              else toast('Profile picture saved locally (cloud offline)','error');
            }else{
              toast('Profile picture saved locally','success');
            }
          };
          img.src=event.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    if(fbGithub)fbGithub.value=cfg.github||'';

    const acctEl=document.getElementById('fbAccount');
    if(acctEl)acctEl.textContent=cfg.user?`Signed in as ${cfg.user.username}`:'Not signed in';
    const bSignOut=document.getElementById('bSignOut');
    if(bSignOut)bSignOut.addEventListener('click',()=>{
      showM('Sign Out?','Your data stays backed up in Firebase and cached on this device. You will need your username and password to sign back in.',()=>{
        FirebaseSync.signOut();
        location.reload();
      });
    });

    bFbSave.addEventListener('click',async()=>{
      const updateObj={
        userId:fbMyId.value.trim().toLowerCase(),
        displayName:fbDisplayName?fbDisplayName.value.trim():'',
        github:fbGithub?fbGithub.value.trim():''
      };
      const cfg=FirebaseSync.updateConfig(updateObj);
      setFbStatus(cfg.connected);
      renderProfile();
      if(profileEdit)profileEdit.classList.remove('open');
      const hero=document.querySelector('.profile-hero');
      if(hero)hero.classList.remove('editing');
      if(bEditProfile)bEditProfile.textContent='Edit profile';
      if(!cfg.backendReady){toast('This build has no Firebase backend baked in yet — see the setup guide','error');return;}
      if(!cfg.user){toast('Sign in first (reload the page)','error');return;}
      if(!cfg.connected){toast('Pick a username to start syncing','error');return;}
      const ok=await fbPush(false);
      if(ok)toast('Profile saved','success');
      else toast('Saved, but the cloud is unreachable — check your connection','error');
    });

    // ── Find Friends: search the user directory, follow/unfollow ──
    const followList=document.getElementById('followList');
    const followCount=document.getElementById('followCount');
    const searchInput=document.getElementById('fbSearch');
    const searchResults=document.getElementById('searchResults');
    let userDirectory=null; // fetched once per session, on first search

    function isFollowing(id){return fbCfg().following.some(f=>f.id===id);}

    function follow(id,name){
      const cfg=FirebaseSync.getConfig();
      if(id===cfg.userId){toast("That's you — follow a friend instead",'error');return;}
      if(isFollowing(id)){toast(`Already following @${id}`,'error');return;}
      FirebaseSync.updateConfig({following:[...cfg.following,{id,name:name||''}]});
      renderFollowList();renderSearchResults();renderFriendsCard();
      toast(`Following @${id}`,'success');
      fbPullFollowing(false).then(()=>{renderFollowList();});
    }

    function unfollow(id){
      const cfg=FirebaseSync.getConfig();
      FirebaseSync.updateConfig({following:cfg.following.filter(f=>f.id!==id)});
      removeFriendEntry(id);
      renderFollowList();renderSearchResults();renderFriendsCard();
      toast(`Unfollowed @${id}`);
    }

    function userRow(u,extra){
      const cfg=fbCfg();
      const me=u.id===cfg.userId;
      const cached=getFriendsCache().friends[u.id];
      const followsMe=!me&&cached&&Array.isArray(cached.following)&&cfg.userId&&cached.following.includes(cfg.userId);
      const label=u.name&&u.name.toLowerCase()!==u.id?esc(u.name):'@'+esc(u.id);
      const mutual=followsMe?'<span class="mutual-chip">Follows you</span>':'';
      const sub=u.name&&u.name.toLowerCase()!==u.id?'@'+esc(u.id)+(extra?' · '+extra:''):(extra||'');
      const btn=me?'<span class="user-row-sub">You</span>'
        :isFollowing(u.id)
          ?`<button class="btn btn-secondary btn-sm" data-unfollow="${esc(u.id)}">Following</button>`
          :`<button class="btn btn-primary btn-sm" data-follow="${esc(u.id)}" data-fname="${esc(u.name||'')}">Follow</button>`;
      
      const av=me?cfg.avatar:(cached?cached.avatar:'');
      const avatarHtml=av?`<img src="${av}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`:initialOf(u.name||u.id);
      const avatarBg=av?'none':avatarGrad(u.id);

      return `<div class="user-row">
        <div class="user-row-avatar" style="background:${avatarBg}">${avatarHtml}</div>
        <div class="user-row-info">
          <div class="user-row-name">${label}${mutual}</div>
          <div class="user-row-sub">${sub}</div>
        </div>
        ${btn}
      </div>`;
    }

    function bindUserRowButtons(container){
      container.querySelectorAll('[data-follow]').forEach(b=>b.addEventListener('click',()=>follow(b.dataset.follow,b.dataset.fname)));
      container.querySelectorAll('[data-unfollow]').forEach(b=>b.addEventListener('click',()=>unfollow(b.dataset.unfollow)));
    }

    function renderFollowList(){
      if(!followList)return;
      const cfg=FirebaseSync.getConfig();
      if(followCount)followCount.textContent=cfg.following.length||'';
      const fCount=document.getElementById('followerCount');
      if(fCount)fCount.textContent=getFollowers().length||'';
      renderProfile();
      if(!cfg.following.length){
        followList.innerHTML='<p class="search-empty">Not following anyone yet — search above to find friends.</p>';
        return;
      }
      const cache=getFriendsCache();
      followList.innerHTML=cfg.following.map(f=>{
        const cached=cache.friends[f.id];
        return userRow({id:f.id,name:(cached&&cached.name)||f.name||''},cached?`synced ${timeAgo(cached.ts)}`:'not synced yet');
      }).join('');
      bindUserRowButtons(followList);
    }

    function renderFollowerList(){
      const followersList=document.getElementById('followersList');
      if(!followersList)return;
      const followers=getFollowers();
      const fCount=document.getElementById('followerCount');
      if(fCount)fCount.textContent=followers.length||'';
      if(!followers.length){
        followersList.innerHTML='<p class="search-empty">No followers yet — when someone follows you, they\'ll appear here.</p>';
        return;
      }
      const cache=getFriendsCache();
      followersList.innerHTML=followers.map(f=>{
        const cached=cache.friends[f.id];
        const mutual=isFollowing(f.id);
        return userRow({id:f.id,name:f.name},mutual?'<span class="mutual-chip">Mutual</span>':'follows you');
      }).join('');
      bindUserRowButtons(followersList);
    }

    // Followers / Following segmented tab switching
    const followTabs=document.getElementById('followTabs');
    if(followTabs)followTabs.addEventListener('click',e=>{
      const t=e.target.closest('.seg-tab');
      if(!t)return;
      followTabs.querySelectorAll('.seg-tab').forEach(b=>b.classList.remove('on'));
      t.classList.add('on');
      const tab=t.dataset.tab;
      const fl=document.getElementById('followList');
      const frl=document.getElementById('followersList');
      if(tab==='following'){if(fl)fl.style.display='';if(frl)frl.style.display='none';renderFollowList();}
      else{if(fl)fl.style.display='none';if(frl)frl.style.display='';renderFollowerList();}
    });

    let lastQuery='';
    function renderSearchResults(){
      if(!searchResults)return;
      if(!lastQuery){searchResults.innerHTML='';return;}
      if(!userDirectory){searchResults.innerHTML='<p class="search-empty">Searching…</p>';return;}
      const q=lastQuery.toLowerCase();
      const hits=userDirectory.filter(u=>u.id.toLowerCase().includes(q)||(u.name||'').toLowerCase().includes(q)).slice(0,8);
      searchResults.innerHTML=hits.length
        ?hits.map(u=>userRow(u,u.ts?`active ${timeAgo(u.ts)}`:'')).join('')
        :'<p class="search-empty">No athletes match "'+esc(lastQuery)+'"</p>';
      bindUserRowButtons(searchResults);
    }

    if(searchInput){
      let debounce=null;
      searchInput.addEventListener('input',()=>{
        lastQuery=searchInput.value.trim();
        clearTimeout(debounce);
        if(!lastQuery){renderSearchResults();return;}
        debounce=setTimeout(async()=>{
          renderSearchResults();
          if(!userDirectory){
            try{userDirectory=await FirebaseSync.listUsers();}
            catch(_){searchResults.innerHTML='<p class="search-empty">Could not reach the athlete directory — check your connection.</p>';return;}
          }
          renderSearchResults();
        },250);
      });
    }

    renderFollowList();

    const bFbBackup=document.getElementById('bFbBackup');
    if(bFbBackup)bFbBackup.addEventListener('click',()=>fbPush(true));
    const bFbRestore=document.getElementById('bFbRestore');
    if(bFbRestore)bFbRestore.addEventListener('click',()=>fbRestore(true));
  }

  const copyRulesBtn=document.getElementById('copyFbRules');
  if(copyRulesBtn){
    copyRulesBtn.addEventListener('click',()=>{
      const rules=`{\n  "rules": {\n    "gym": {\n      "$userId": {\n        ".read": "auth != null",\n        ".write": "auth != null && (!data.exists() || data.child('uid').val() === auth.uid || newData.child('uid').val() === auth.uid)"\n      }\n    },\n    "directory": {\n      "$userId": {\n        ".read": "auth != null",\n        ".write": "auth != null && (!data.exists() || root.child('gym').child($userId).child('uid').val() === auth.uid)"\n      }\n    }\n  }\n}`;
      navigator.clipboard.writeText(rules).then(()=>{toast('Database Rules copied!','success');}).catch(()=>{toast('Failed to copy','error');});
    });
  }

  document.querySelectorAll('.guide-toggle').forEach(t=>{
    t.addEventListener('click',()=>{t.closest('.connection-guide').classList.toggle('open');});
  });

  document.getElementById('bExp').addEventListener('click',()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(W,null,2)],{type:'application/json'}));a.download=`asca_gym_${new Date().toISOString().split('T')[0]}.json`;a.click();toast('Exported','success');});
  document.getElementById('bImp').addEventListener('click',()=>document.getElementById('fIn').click());
  document.getElementById('fIn').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const d=JSON.parse(ev.target.result);if(!Array.isArray(d))throw 0;d.forEach(wo=>{if(!W.find(w=>w.date===wo.date&&w.dayType===wo.dayType))W.push(wo);});W.sort((a,b)=>b.date.localeCompare(a.date));save();toast(`Imported ${d.length} workouts`,'success');}catch(_){toast('Invalid file format','error');}};r.readAsText(f);e.target.value='';});
  document.getElementById('bRst').addEventListener('click',()=>showM('Reset Database?','This will permanently delete all workouts and custom exercise files from local memory.',()=>{W=[];save();toast('App data reset','error');}));
}
// One status, two badges: the profile pill and the header cloud icon
function setFbStatus(on){
  const b=document.getElementById('fbStatus');
  if(b){
    b.classList.toggle('on',on);
    b.classList.toggle('off',!on);
    const t=document.getElementById('fbStatusT');
    if(t)t.textContent=on?'Synced':'Offline';
  }
  const h=document.getElementById('dConn');
  if(h){
    h.classList.toggle('on',on);
    h.classList.toggle('off',!on);
    const ht=document.getElementById('dConnT');
    if(ht)ht.textContent=on?'Synced':'Offline';
  }
}

/* ── UI Core ───────────────────────────────────────────────── */
function bindModal(){
  document.getElementById('mC').addEventListener('click',clsM);
  document.getElementById('mO').addEventListener('click',()=>{const cb=mCb;clsM();if(cb)cb();});
  document.getElementById('mBg').addEventListener('click',e=>{if(e.target===e.currentTarget)clsM();});
}
function showM(t,m,cb){document.getElementById('mT').textContent=t;document.getElementById('mM').textContent=m;document.getElementById('mBg').classList.add('show');mCb=cb;}
function clsM(){document.getElementById('mBg').classList.remove('show');mCb=null;}

function bindLibraryModal() {
  const btn = document.getElementById('btnExLib');
  const modal = document.getElementById('libBg');
  const closeBtn = document.getElementById('libCl');
  const tabsContainer = document.getElementById('libTabs');
  const body = document.getElementById('libB');
  if (!btn || !modal || !closeBtn || !tabsContainer || !body) return;
  let library = {};let splits = [];let activeSplit = 'Pull';

  function renderTabs() {
    tabsContainer.innerHTML = splits.map(split => `<button class="lib-tab ${split === activeSplit ? 'active' : ''}" data-split="${split}">${split}</button>`).join('');
  }
  function renderExercises() {
    const exercises = library[activeSplit] || [];
    body.innerHTML = exercises.map((ex, idx) => {
      const targetMuscles = getMusclesForExercise(ex);
      const muscleList = targetMuscles.map(m => m.charAt(0).toUpperCase() + m.slice(1)).join(', ');
      return `<div class="lib-exercise-item" style="animation-delay: ${idx * 0.04}s"><span class="lib-ex-name">${esc(ex)}</span><span class="lib-ex-muscles">Target: ${esc(muscleList)}</span></div>`;
    }).join('');
  }

  btn.addEventListener('click', () => {library=lib();splits=Object.keys(library);if(splits.length&&!splits.includes(activeSplit))activeSplit=splits[0];renderTabs();renderExercises();modal.classList.add('show');});
  closeBtn.addEventListener('click', () => {modal.classList.remove('show');});
  modal.addEventListener('click', (e) => {if (e.target === e.currentTarget) modal.classList.remove('show');});
  tabsContainer.addEventListener('click', (e) => {const tab = e.target.closest('.lib-tab');if (!tab) return;activeSplit = tab.dataset.split;renderTabs();renderExercises();});
}

function toast(msg,type=''){
  const el=document.getElementById('tw'),t=document.createElement('div');
  t.className=`toast ${type}`;
  const svg = type === 'success' 
    ? `<svg class="toast-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
    : `<svg class="toast-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  t.innerHTML=`<span class="toast-icon-svg">${svg}</span><div>${msg}</div>`;
  el.appendChild(t);setTimeout(()=>{t.style.animation='toastOut 0.35s ease forwards';setTimeout(()=>t.remove(),350);},2500);
}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML.replace(/"/g,'&quot;');}

/* ── Rest Timer Logic ──────────────────────────────────────── */
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();const gain = ctx.createGain();
    osc.connect(gain);gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();osc.stop(ctx.currentTime + 0.5);
  } catch (_) {}
}

function bindTimer() {
  const bar=document.getElementById('gtBar');const display=document.getElementById('gtTime');
  const desc=document.getElementById('gtDesc');const fill=document.getElementById('gtFill');
  const toggle=document.getElementById('gtToggle');const reset=document.getElementById('gtReset');
  const close=document.getElementById('gtClose');
  const playIcon=toggle.querySelector('.play-icon');const pauseIcon=toggle.querySelector('.pause-icon');

  function updateDisplay() {
    const min=Math.floor(timerSecs/60);const sec=timerSecs%60;
    display.textContent=`${min.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
    if (timerTotal > 0) {const percentage=(timerSecs/timerTotal)*100;fill.setAttribute('stroke-dashoffset',100-percentage);}
    else fill.setAttribute('stroke-dashoffset',0);
  }

  function tick() {
    if (!timerRunning || !timerEndTime) return;
    const remaining = Math.max(0, Math.ceil((timerEndTime - Date.now()) / 1000));
    timerSecs = remaining;
    updateDisplay();
    if (remaining <= 0) {
      timerSecs = 0; updateDisplay(); stopTimer(true);
    }
  }

  function start(sec) {
    if(timerInterval)clearInterval(timerInterval);
    timerSecs=sec;timerTotal=sec;timerRunning=true;
    timerEndTime = Date.now() + sec * 1000;
    bar.classList.remove('hidden');bar.classList.add('visible');
    updateDisplay();desc.textContent="Resting...";
    playIcon.style.display='none';pauseIcon.style.display='block';
    document.querySelectorAll('.btn-timer-chip').forEach(btn=>{btn.classList.toggle('active',parseInt(btn.dataset.sec)===sec);});
    timerInterval=setInterval(tick, 250);
  }

  function stopTimer(completed=false) {
    if(timerInterval){clearInterval(timerInterval);timerInterval=null;}
    timerRunning=false;timerEndTime=0;playIcon.style.display='block';pauseIcon.style.display='none';
    if(completed){desc.textContent="Time to lift!";playBeep();toast("Rest complete!","success");
      setTimeout(()=>{if(!timerRunning&&timerSecs===0){bar.classList.remove('visible');bar.classList.add('hidden');document.querySelectorAll('.btn-timer-chip').forEach(btn=>btn.classList.remove('active'));}},5000);
    }else{desc.textContent="Paused";}
  }

  function resume() {
    if(timerSecs<=0)return;timerRunning=true;
    timerEndTime = Date.now() + timerSecs * 1000;
    playIcon.style.display='none';pauseIcon.style.display='block';desc.textContent="Resting...";
    timerInterval=setInterval(tick, 250);
  }

  /* Recover timer when returning from background */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && timerRunning && timerEndTime) {
      tick();
    }
  });

  document.addEventListener('click',e=>{const btn=e.target.closest('.btn-timer-chip');if(btn){start(parseInt(btn.dataset.sec));}});
  toggle.addEventListener('click',()=>{if(timerRunning)stopTimer();else if(timerSecs>0)resume();else start(60);});
  reset.addEventListener('click',()=>{if(timerInterval)clearInterval(timerInterval);timerInterval=null;timerEndTime=0;timerSecs=timerTotal;timerRunning=false;updateDisplay();desc.textContent="Reset";playIcon.style.display='block';pauseIcon.style.display='none';});
  close.addEventListener('click',()=>{if(timerInterval)clearInterval(timerInterval);timerInterval=null;timerRunning=false;timerEndTime=0;timerSecs=0;timerTotal=0;bar.classList.remove('visible');bar.classList.add('hidden');document.querySelectorAll('.btn-timer-chip').forEach(btn=>btn.classList.remove('active'));});
  window.triggerRestTimer = start;
}

/* ── Muscle Heatmap Mappings ──────────────────────────────── */
const MUSCLE_MAP = {
  "lat pulldown": ["back"],
  "seated cable row": ["back"],
  "machine-assisted pull-up": ["back", "biceps"],
  "cable bicep curl": ["biceps"],
  "straight-arm lat pulldown": ["back"],
  "dumbbell preacher curl": ["biceps"],
  "dumbbell hammer curl": ["biceps", "forearms"],
  "cable pullover": ["back"],
  "machine row": ["back"],
  "dumbbell shrugs": ["back"],
  "chest press": ["chest", "triceps"],
  "pec deck fly": ["chest"],
  "machine-assisted dip": ["chest", "triceps"],
  "incline dumbbell press": ["chest", "triceps"],
  "tricep rope pushdown": ["triceps"],
  "tricep pushdown": ["triceps"],
  "reverse grip tricep pushdown": ["triceps"],
  "cable overhead tricep extension": ["triceps"],
  "single-arm overhead tricep extension": ["triceps"],
  "leg extension": ["quads"],
  "leg curl": ["hamstrings"],
  "seated leg curl": ["hamstrings"],
  "leg press": ["quads"],
  "calf raises": ["calves"],
  "squats": ["quads", "hamstrings"],
  "lunges": ["quads", "hamstrings"],
  "shoulder press": ["delts"],
  "lateral raises": ["delts"],
  "front raises": ["delts"],
  "face pull": ["delts", "back"],
  "reverse pec deck fly": ["delts", "back"],
  "machine crunch": ["abs"],
  "leg raises": ["abs"],
  "knee raises": ["abs"],
  "wrist curl": ["forearms"]
};

function getMusclesForExercise(exName, dayType = '') {
  const canonical = canonicalName(exName).toLowerCase().trim();
  if (MUSCLE_MAP[canonical]) return MUSCLE_MAP[canonical];
  
  if (dayType.includes('Pull')) return ['back', 'biceps'];
  if (dayType.includes('Push')) return ['chest', 'triceps'];
  if (dayType.includes('Legs')) return ['quads', 'hamstrings'];
  if (dayType.includes('Shoulder')) return ['delts'];
  if (dayType.includes('Core')) return ['abs'];
  
  if (canonical.includes('press') || canonical.includes('dip') || canonical.includes('fly')) {
    if (canonical.includes('shoulder')) return ['delts'];
    if (canonical.includes('leg')) return ['quads'];
    return ['chest', 'triceps'];
  }
  if (canonical.includes('curl')) return ['biceps'];
  if (canonical.includes('extension') || canonical.includes('pushdown') || canonical.includes('kickback')) {
    if (canonical.includes('leg') || canonical.includes('quad')) return ['quads'];
    return ['triceps'];
  }
  if (canonical.includes('row') || canonical.includes('pull')) {
    if (canonical.includes('face')) return ['delts', 'back'];
    return ['back', 'biceps'];
  }
  if (canonical.includes('raise')) {
    if (canonical.includes('leg') || canonical.includes('knee')) return ['abs'];
    if (canonical.includes('calf') || canonical.includes('calves')) return ['calves'];
    return ['delts'];
  }
  if (canonical.includes('squat') || canonical.includes('lunge') || canonical.includes('deadlift')) return ['quads', 'hamstrings'];
  if (canonical.includes('crunch') || canonical.includes('plank')) return ['abs'];
  
  return ['back'];
}

function getAnatomySvg(view, muscleLevels = {}) {
  const getLevelClass = (m) => `m-level-${muscleLevels[m] || 0}`;
  const defsHtml = `
    <defs>
      <linearGradient id="gradL0" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3A3A3C"/><stop offset="100%" stop-color="#1C1C1E"/>
      </linearGradient>
      <linearGradient id="gradL1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FF9500" stop-opacity="0.45"/><stop offset="100%" stop-color="#FF5E00" stop-opacity="0.25"/>
      </linearGradient>
      <linearGradient id="gradL2" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FF9500" stop-opacity="0.75"/><stop offset="100%" stop-color="#FF5E00" stop-opacity="0.55"/>
      </linearGradient>
      <linearGradient id="gradL3" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FFB300" stop-opacity="1"/><stop offset="100%" stop-color="#FF5E00" stop-opacity="0.9"/>
      </linearGradient>
      <filter id="glow3d" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="1.8" result="blur" />
        <feColorMatrix type="matrix" values="1 0 0 0 1 0 0.46 0 0 0.46 0 0 0 0 0 0 0 0 0.8 0" in="blur" result="coloredBlur"/>
        <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <filter id="innerBevel" x="-20%" y="-20%" width="140%" height="140%">
        <feComponentTransfer in="SourceAlpha" result="alpha"/>
        <feGaussianBlur in="alpha" stdDeviation="0.8" result="blur"/>
        <feOffset dx="-0.5" dy="-0.5" in="blur" result="offsetBlur"/>
        <feFlood flood-color="#ffffff" flood-opacity="0.15" result="highlight"/>
        <feComposite in="highlight" in2="offsetBlur" operator="in" result="highlight"/>
        <feComposite in="SourceGraphic" in2="highlight" operator="over" />
      </filter>
    </defs>
  `;

  const bodySilhouette = `M46 27 C46 31, 45 33, 43 35 C39 35, 30 37, 28 44 L23 68 L20 94 C19 98, 20 102, 22 102 C24 102, 25 98, 26 94 L29 68 L34 50 C34 56, 36 68, 35 84 L33 130 L35 178 L30 188 C29 192, 37 192, 39 188 L39 178 L42 130 L48 94 L52 94 L58 130 L61 178 L61 188 C63 192, 71 192, 70 188 L65 178 L67 130 L65 84 C64 68, 66 56, 66 50 L71 68 L74 94 C75 98, 76 102, 78 102 C80 102, 81 98, 80 94 L77 68 L72 44 C70 37, 61 35, 57 35 C55 33, 54 31, 54 27 Z`;

  if (view === 'front') {
    return `<svg class="anatomy-svg" viewBox="0 0 100 200">${defsHtml}
        <ellipse class="anatomy-base" cx="50" cy="18" rx="7" ry="9" filter="url(#innerBevel)"/>
        <path class="anatomy-base" d="${bodySilhouette}" filter="url(#innerBevel)"/>
        <path class="muscle-path ${getLevelClass('chest')}" d="M48 37 L38 37 C35 37, 34 40, 34 44 C34 47, 39 48, 48 45 Z" />
        <path class="muscle-path ${getLevelClass('chest')}" d="M52 37 L62 37 C65 37, 66 40, 66 44 C66 47, 61 48, 52 45 Z" />
        <path class="muscle-path ${getLevelClass('abs')}" d="M49 48 L42 48 C41 52, 41 53, 42 53 L49 53 Z" />
        <path class="muscle-path ${getLevelClass('abs')}" d="M51 48 L58 48 C59 52, 59 53, 58 53 L51 53 Z" />
        <path class="muscle-path ${getLevelClass('abs')}" d="M49 55 L41 55 C41 59, 41 60, 42 60 L49 60 Z" />
        <path class="muscle-path ${getLevelClass('abs')}" d="M51 55 L59 55 C59 59, 59 60, 58 60 L51 60 Z" />
        <path class="muscle-path ${getLevelClass('abs')}" d="M49 62 L41 62 C41 66, 42 67, 43 67 L49 67 Z" />
        <path class="muscle-path ${getLevelClass('abs')}" d="M51 62 L59 62 C59 66, 58 67, 57 67 L51 67 Z" />
        <path class="muscle-path ${getLevelClass('abs')}" d="M43 69 L57 69 L55 80 L45 80 Z" />
        <path class="muscle-path ${getLevelClass('delts')}" d="M37 35 C32 35, 29 37, 28 43 C28 47, 30 50, 33 50 C36 47, 37 42, 37 35 Z" />
        <path class="muscle-path ${getLevelClass('delts')}" d="M63 35 C68 35, 71 37, 72 43 C72 47, 70 50, 67 50 C64 47, 63 42, 63 35 Z" />
        <path class="muscle-path ${getLevelClass('biceps')}" d="M31 48 C29 51, 27 56, 27 62 C28 64, 30 64, 32 62 C33 56, 33 51, 31 48 Z" />
        <path class="muscle-path ${getLevelClass('biceps')}" d="M69 48 C71 51, 73 56, 73 62 C72 64, 70 64, 68 62 C67 56, 67 51, 69 48 Z" />
        <path class="muscle-path ${getLevelClass('forearms')}" d="M26 67 C24 72, 22 80, 22 88 C24 89, 26 89, 27 86 C28 80, 29 72, 29 67 Z" />
        <path class="muscle-path ${getLevelClass('forearms')}" d="M74 67 C76 72, 78 80, 78 88 C76 89, 74 89, 73 86 C72 80, 71 72, 71 67 Z" />
        <path class="muscle-path ${getLevelClass('quads')}" d="M37 86 C35 96, 35 112, 37 122 C39 123, 40 123, 41 122 C41 112, 40 96, 38 86 Z" />
        <path class="muscle-path ${getLevelClass('quads')}" d="M40 88 C40 98, 41 110, 42 122 C44 122, 45 120, 45 115 C45 105, 43 96, 41 88 Z" />
        <path class="muscle-path ${getLevelClass('quads')}" d="M63 86 C65 96, 65 112, 63 122 C61 123, 60 123, 59 122 C59 112, 60 96, 62 86 Z" />
        <path class="muscle-path ${getLevelClass('quads')}" d="M60 88 C60 98, 59 110, 58 122 C56 122, 55 120, 55 115 C55 105, 57 96, 59 88 Z" />
        <path class="muscle-path ${getLevelClass('calves')}" d="M38 132 C37 142, 38 156, 39 170 C40 170, 42 170, 42 168 C42 156, 41 142, 40 132 Z" />
        <path class="muscle-path ${getLevelClass('calves')}" d="M62 132 C63 142, 62 156, 61 170 C60 170, 58 170, 58 168 C58 156, 59 142, 60 132 Z" />
      </svg>`;
  } else {
    return `<svg class="anatomy-svg" viewBox="0 0 100 200">${defsHtml}
        <ellipse class="anatomy-base" cx="50" cy="18" rx="7" ry="9" filter="url(#innerBevel)"/>
        <path class="anatomy-base" d="${bodySilhouette}" filter="url(#innerBevel)"/>
        <path class="muscle-path ${getLevelClass('back')}" d="M50 27 C47 27, 44 31, 43 35 C45 35, 47 37, 50 48 C53 37, 55 35, 57 35 C56 31, 53 27, 50 27 Z" />
        <path class="muscle-path ${getLevelClass('back')}" d="M48 37 C42 38, 36 41, 35 48 C35 56, 37 68, 41 72 C44 65, 47 52, 48 37 Z" />
        <path class="muscle-path ${getLevelClass('back')}" d="M52 37 C58 38, 64 41, 65 48 C65 56, 63 68, 59 72 C56 65, 53 52, 52 37 Z" />
        <path class="muscle-path ${getLevelClass('back')}" d="M50 49 L43 72 L45 82 L55 82 L57 72 Z" />
        <path class="muscle-path ${getLevelClass('delts')}" d="M37 35 C32 35, 29 37, 28 43 C28 47, 30 50, 33 50 C36 47, 37 42, 37 35 Z" />
        <path class="muscle-path ${getLevelClass('delts')}" d="M63 35 C68 35, 71 37, 72 43 C72 47, 70 50, 67 50 C64 47, 63 42, 63 35 Z" />
        <path class="muscle-path ${getLevelClass('triceps')}" d="M31 48 C29 51, 27 57, 27 63 C28 65, 30 65, 32 63 C33 57, 33 51, 31 48 Z" />
        <path class="muscle-path ${getLevelClass('triceps')}" d="M69 48 C71 51, 73 57, 73 63 C72 65, 70 65, 68 63 C67 57, 67 51, 69 48 Z" />
        <path class="muscle-path ${getLevelClass('forearms')}" d="M26 67 C24 72, 22 80, 22 88 C24 89, 26 89, 27 86 C28 80, 29 72, 29 67 Z" />
        <path class="muscle-path ${getLevelClass('forearms')}" d="M74 67 C76 72, 78 80, 78 88 C76 89, 74 89, 73 86 C72 80, 71 72, 71 67 Z" />
        <path class="muscle-path ${getLevelClass('hamstrings')}" d="M36 78 C35 83, 38 87, 48 87 C49 83, 49 79, 48 75 C42 75, 37 76, 36 78 Z" />
        <path class="muscle-path ${getLevelClass('hamstrings')}" d="M64 78 C65 83, 62 87, 52 87 C51 83, 51 79, 52 75 C58 75, 63 76, 64 78 Z" />
        <path class="muscle-path ${getLevelClass('hamstrings')}" d="M37 89 C36 100, 36 114, 38 124 C40 125, 42 125, 43 124 C44 114, 44 100, 43 89 Z" />
        <path class="muscle-path ${getLevelClass('hamstrings')}" d="M63 89 C64 100, 64 114, 62 124 C60 125, 58 125, 57 124 C56 114, 56 100, 57 89 Z" />
        <path class="muscle-path ${getLevelClass('calves')}" d="M37 132 C35 142, 36 156, 38 170 C39 172, 41 172, 42 170 C42 156, 41 142, 39 132 Z" />
        <path class="muscle-path ${getLevelClass('calves')}" d="M63 132 C65 142, 64 156, 62 170 C61 172, 59 172, 58 170 C58 156, 59 142, 61 132 Z" />
      </svg>`;
  }
}

function renderAnatomyMap(container, muscleLevels) {
  container.innerHTML = `
    <div class="anatomy-svg-container"><div class="anatomy-view-label">Front</div>${getAnatomySvg('front', muscleLevels)}</div>
    <div class="anatomy-svg-container"><div class="anatomy-view-label">Back</div>${getAnatomySvg('back', muscleLevels)}</div>
  `;
}

function renderHeatmapInsights(period) {
  const today = new Date();today.setHours(23, 59, 59, 999);
  const startLimit = new Date(today.getTime() - period * 24 * 60 * 60 * 1000);
  const muscleSets = {chest:0,back:0,delts:0,biceps:0,triceps:0,forearms:0,quads:0,hamstrings:0,calves:0,abs:0};
  
  W.forEach(w => {
    const wDate = new Date(w.date + 'T00:00:00');
    if (wDate >= startLimit && wDate <= today) {
      w.exercises.forEach(e => {
        const ms = getMusclesForExercise(e.name, w.dayType);
        ms.forEach(m => { if (m in muscleSets) muscleSets[m] += e.sets.length; });
      });
    }
  });
  
  const levels = {};const is7 = (period === 7);
  for (const [m, count] of Object.entries(muscleSets)) {
    if (count === 0) levels[m] = 0;
    else if (count < (is7 ? 3 : 10)) levels[m] = 1;
    else if (count < (is7 ? 8 : 25)) levels[m] = 2;
    else levels[m] = 3;
  }
  
  const titleEl = document.getElementById('hmPeriodTitle');
  if (titleEl) titleEl.textContent = `${period} Days Activation Focus`;
  const container = document.getElementById('insightsHeatmap');
  if (container) renderAnatomyMap(container, levels);
}

function updateSetupHeatmap(dayType) {
  const container = document.getElementById('setupHeatmap');
  if (!container) return;
  if (!dayType || dayType === 'Choose Split...') {container.style.display = 'none';return;}
  container.style.display = 'flex';
  const muscles = {};
  if (dayType === 'Pull' || dayType.includes('Pull')) {muscles['back'] = 3; muscles['biceps'] = 3;}
  else if (dayType === 'Push' || dayType.includes('Push')) {muscles['chest'] = 3; muscles['triceps'] = 3;}
  else if (dayType === 'Legs' || dayType.includes('Lower') || dayType.includes('Legs')) {muscles['quads'] = 3; muscles['hamstrings'] = 3; muscles['calves'] = 3;}
  else if (dayType === 'Shoulders' || dayType.includes('Shoulders') || dayType.includes('Shoulder')) {muscles['delts'] = 3;}
  else if (dayType === 'Core' || dayType.includes('Core')) {muscles['abs'] = 3; muscles['forearms'] = 3;}
  else if (dayType === 'Upper') {muscles['chest'] = 3; muscles['back'] = 3; muscles['delts'] = 3; muscles['biceps'] = 3; muscles['triceps'] = 3;}
  else if (dayType === 'Full Body') {muscles['chest'] = 3; muscles['back'] = 3; muscles['delts'] = 3; muscles['quads'] = 3; muscles['hamstrings'] = 3;}
  renderAnatomyMap(container, muscles);
}

function updateEditorHeatmap(exName) {
  const container = document.getElementById('editorHeatmap');
  if (!container) return;
  const dayType = document.getElementById('wType').value;
  const ms = getMusclesForExercise(exName, dayType);
  const muscles = {};
  ms.forEach(m => { muscles[m] = 3; });
  renderAnatomyMap(container, muscles);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
})();


