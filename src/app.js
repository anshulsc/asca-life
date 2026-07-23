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
  bindHist();bindAna();bindSettings();bindModal();bindLibraryModal();bindVolInsights();bindTimer();bindBodyWeight();bindFriend();bindProgressPics();
  setToday();renderRecent();renderBodyWeight();renderHeatmapCalendar();renderVolWidget();renderProfile();
  restoreSE();
  
  // Backend-first boot: the RTDB is the source of truth. Merge my cloud
  // doc and pull every followed athlete immediately, then the EventSource
  // streams keep everything live — localStorage is only the offline
  // fallback that painted the first frame.
  // Repair days duplicated by the old double-append before anything renders
  // or syncs; the boot fbPush below carries the cleaned day-map up.
  if(dedupeWorkouts(W))save();

  if(fbCfg().connected){
    startRealtimeSync();
    // Push after the restore settles so every signed-in user has a
    // fresh doc + directory entry from their first session — otherwise
    // new accounts are invisible in search and suggestions until they
    // save something.
    fbRestore(false).then(()=>fbPush(false))
      .then(ok=>{if(!ok)setTimeout(()=>fbPush(false),8000);}) // flaky network at open — try once more
      .catch(()=>{});
    fbPullFollowing(false);
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

// localStorage is a plain cache now (Realtime DB is the source of truth,
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
  stripSeededHistory();
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
// to THEIR cloud doc — so only seed for the owner (or standalone
// builds with no backend); everyone else starts from their cloud doc.
// An unset userId does NOT seed: the sign-in flow fills it before
// load(), so an empty id means we don't know whose browser this is.
function canSeedHistorical(){
  const fb=fbCfg();
  if(!fb.backendReady)return true;
  return (fb.userId||'').toLowerCase().startsWith('anshul');
}

// Older builds did seed other accounts. For non-anshul users, remove
// any workout still identical to a seed entry (compared through a
// canonical form that survives the RTDB round-trip, where null weights
// are dropped); anything the user edited is kept. save() pushes the
// cleanup to their cloud doc.
function seedKeyOf(w){
  return JSON.stringify([w.date,w.dayType,(w.exercises||[]).map(e=>[
    canonicalName(e.name||''),
    (e.sets||[]).map(s=>[(s.weight==null||s.weight==='')?null:+s.weight,+s.reps||0,s.notes||''])
  ])]);
}
function stripSeededHistory(){
  if(canSeedHistorical()||typeof HISTORICAL_DATA==='undefined'||!W.length)return false;
  const seeds=new Set(HISTORICAL_DATA.map(seedKeyOf));
  const before=W.length;
  W=W.filter(w=>!seeds.has(seedKeyOf(w)));
  if(W.length===before)return false;
  save();
  console.log(`[Seed cleanup] removed ${before-W.length} workouts that belong to Anshul's baked-in log`);
  return true;
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
  // Desktop uses a vertical sidebar with a CSS active-pill instead of the
  // horizontal liquid lens — hide it and bail so it can't mis-position.
  if (window.matchMedia && window.matchMedia('(min-width: 1024px)').matches) {
    lens.style.display = 'none';
    return;
  }
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
      if(tgt==='Set')renderProgressPics();
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
    renderProfile();
    if(typeof fbPush==='function'&&fbCfg().connected)fbPush(false); // score inputs changed — publish
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
// Grids start at the week of the athlete's first logged workout (capped
// at maxWeeks) — no empty pre-history columns padding out the left edge.
function heatmapWeeks(list,maxWeeks){
  let earliest=null;
  (list||[]).forEach(w=>{if(w&&w.date&&(!earliest||w.date<earliest))earliest=w.date;});
  if(!earliest)return maxWeeks;
  const ed=new Date(earliest+'T00:00:00');
  if(isNaN(ed))return maxWeeks;
  const ws=d=>{const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-x.getDay());return x;};
  const wks=Math.round((ws(new Date())-ws(ed))/(7*86400000))+1;
  return Math.max(1,Math.min(maxWeeks,wks));
}

function renderHeatmapCalendar(){
  const grid=document.getElementById('heatmapCalGrid');
  const monthsEl=document.getElementById('heatmapMonths');
  if(!grid||!monthsEl)return;

  const today=new Date();
  const weeks=heatmapWeeks(W,24);
  const days=weeks*7;
  
  // Build date->workout stats map
  const dateWorkouts={};
  W.forEach(w=>{
    const vol=w.exercises.reduce((s,e)=>s+e.sets.reduce((ss,x)=>ss+((getSetWeightVal(x))*(x.reps||0)),0),0);
    const setsCount=w.exercises.reduce((s,e)=>s+e.sets.length,0);
    const exCount=w.exercises.length;
    const cardio=workoutCardio(w);

    dateWorkouts[w.date] = {
      dayType: w.dayType,
      volume: vol,
      sets: setsCount,
      exercises: exCount,
      cardioMins: cardio.mins,
      cardioKm: cardio.km,
      cardioKcal: cardio.kcal
    };
  });

  // Find max volume / cardio minutes for scaling
  const maxVol = Math.max(...Object.values(dateWorkouts).map(info => info.volume), 1);
  const maxCardio = Math.max(...Object.values(dateWorkouts).map(info => info.cardioMins), 1);
  
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
      const cMins=info?info.cardioMins:0;

      // Any logged activity lights the dot: intensity is whichever of
      // lifted-volume or cardio-minutes ratio is stronger, so a pure
      // cardio day still shows up in the daily-progress grid.
      let lvl='';
      if(vol>0||cMins>0||(info&&info.dayType!=='Rest Day'&&info.exercises>0)){
        const ratio=Math.max(vol/maxVol,cMins/maxCardio);
        if(ratio>0.6)lvl='lvl-3';
        else if(ratio>0.3)lvl='lvl-2';
        else lvl='lvl-1';
      }

      const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
      const formattedDate = d.toLocaleDateString('en-US', options);
      dayMeta[dateStr]={info,formattedDate};

      let tooltip;
      if(info && info.dayType !== 'Rest Day') {
        tooltip = `${formattedDate}\n${info.dayType} Day`;
        if(info.volume>0)tooltip+=`\n• Volume: ${Math.round(info.volume)} kg`;
        if(info.cardioMins>0)tooltip+=`\n• Cardio: ${info.cardioMins} min${info.cardioKm?` · ${info.cardioKm} km`:''}${info.cardioKcal?` · ${info.cardioKcal} kcal`:''}`;
        tooltip+=`\n• Exercises: ${info.exercises}\n• Sets: ${info.sets}`;
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
      const bits=[];
      if(info.volume>0)bits.push(`${Math.round(info.volume)} kg volume`);
      if(info.cardioMins>0)bits.push(`${info.cardioMins} min cardio${info.cardioKm?` · ${info.cardioKm} km`:''}`);
      bits.push(`${info.exercises} ex`,`${info.sets} sets`);
      detailsEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; width:100%; align-items:center; gap:8px; flex-wrap:wrap">
          <span><strong>${formattedDate}</strong>: <span style="color:var(--accent); font-weight:700">${info.dayType} Day</span></span>
          <span style="color:var(--t-4)">${bits.join(' • ')}</span>
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

  // On narrow screens the grid scrolls — land on the newest weeks so
  // today's progress is what greets you, not 6-month-old dots.
  const scroller=grid.closest('.heatmap-main');
  if(scroller)requestAnimationFrame(()=>{scroller.scrollLeft=scroller.scrollWidth;});
}

// Snap every GitHub-style heatmap inside `root` to its newest (right) edge.
function scrollHeatmapsToLatest(root){
  if(!root)return;
  requestAnimationFrame(()=>{
    root.querySelectorAll('.gym-heatmap-wrap').forEach(w=>{w.scrollLeft=w.scrollWidth;});
  });
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

/* ── Progress Codes — legacy decode ───────────────────────── */
/* Progress codes were workouts as gzip+base64 (prefix ASCAGYM2) or
   plain base64 (prefix ASCAGYM1). Nothing encodes them anymore —
   RTDB stores workouts structured — but the decoder stays so old
   blob-format cloud docs still restore/sync. */
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

/* ── Firebase Cloud Sync — backup + friend sync over RTDB ── */
/* FirebaseSync (firebase-sync.js) is the transport and handles auth;
   access is gated by Firebase sign-in and ownership rules. My node
   at gym/{userId} carries the FULL history structured day-wise
   (workouts/{date}/…, it doubles as the cloud backup); a friend's
   node is pulled into the friend cache like every other source. */
function fbCfg(){return (typeof FirebaseSync!=='undefined')?FirebaseSync.getConfig():{};}

/* Resolve a normalized cloud doc into {ts,name,avatar,github,
   following,workouts} — direct for structured docs, decoding the
   compressed blob for docs written by pre-RTDB builds. */
async function cloudPayload(doc){
  if(!doc)return null;
  if(Array.isArray(doc.workouts))return doc;
  if(doc.blob){
    const p=await decodeProgressCode(doc.blob);
    return {
      ts:doc.ts||p.ts||0,
      name:p.name||doc.name||'',
      avatar:p.avatar||'',
      bio:p.bio||'',
      bw:p.bw||0,
      github:p.github||'',
      following:Array.isArray(p.following)?p.following:[],
      workouts:p.workouts
    };
  }
  return null;
}

// Signature of the last payload we successfully wrote to the cloud, so
// background pushes (fired after every save, score edit and on boot) can
// skip re-uploading an identical doc. Interactive backups always write.
let lastPushSig=null;
function pushSignature(cfg){
  return JSON.stringify([W,myBW(),cfg.userId,cfg.displayName,cfg.avatar,cfg.bio,cfg.github,(cfg.following||[]).map(f=>f.id)]);
}
async function fbPush(interactive=true){
  const cfg=fbCfg();
  if(!cfg.connected){
    if(interactive)toast('Connect Firebase in Settings first','error');
    return false;
  }
  const sig=pushSignature(cfg);
  if(!interactive&&sig===lastPushSig)return true; // nothing changed — skip the redundant write
  try{
    const ts=lastLocalWrite||Date.now();
    await FirebaseSync.writeDoc({ts,workouts:W,bw:myBW()});
    lastLocalWrite=ts;
    lastPushSig=sig;
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
  renderRanks();
  renderChart();
}

let activeStreams={};              // id (or "_directory") -> EventSource
let streamMeta={};                 // gym-doc streams: id -> { cb, retries, timer }
let dirMeta={retries:0,timer:null};// directory stream reconnect state
let streamRefreshTimer=null;
let streamsWanted=false;           // false = we intentionally stopped; block reconnects
// A gym session runs for hours, but the auth token baked into each
// EventSource URL expires after ~1h. Rebuild every stream with a fresh
// token well before that, so live sync never dies mid-workout.
const STREAM_REFRESH_MS=45*60*1000;
const STREAM_MAX_BACKOFF=60000;

// Reopen a gym-doc stream after a backoff, fetching a fresh token (the one
// in the dropped URL may simply have expired). Only if we still want it.
function scheduleStreamReconnect(userId,meta){
  if(!streamsWanted||!streamMeta[userId])return;
  const wait=Math.min(2000*Math.pow(2,meta.retries++),STREAM_MAX_BACKOFF);
  if(meta.timer)clearTimeout(meta.timer);
  meta.timer=setTimeout(()=>{ if(streamsWanted&&streamMeta[userId])listenToDoc(userId,meta.cb); },wait);
}

function startRealtimeSync(){
  const cfg=fbCfg();
  if(!cfg.connected)return;
  streamsWanted=true;

  listenToDirectory();

  listenToDoc(cfg.userId,data=>{
    const doc=FirebaseSync.normalizeDocData(data);
    if(doc&&doc.ts>lastLocalWrite){
      cloudPayload(doc).then(payload=>{
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
          if(payload.bio)up.bio=payload.bio;
          if(payload.github)up.github=payload.github;
          if(Object.keys(up).length>0)FirebaseSync.updateConfig(up);
          stripSeededHistory();
          refreshAllUI();
        }
      }).catch(console.warn);
    }
  });

  cfg.following.forEach(f=>{
    listenToDoc(f.id,data=>{
      const doc=FirebaseSync.normalizeDocData(data);
      if(!doc)return;
      cloudPayload(doc).then(p=>{
        if(!p||!Array.isArray(p.workouts))return;
        saveFriendEntry(f.id,{
          ts:doc.ts||p.ts||Date.now(),
          name:p.name||f.name||f.id,
          avatar:p.avatar||'',
          bio:p.bio||'',
          bw:p.bw||0,
          github:p.github||'',
          following:Array.isArray(p.following)?p.following:[],
          workouts:p.workouts
        });
        updateFollowName(f.id,p.name);
        renderFriendsCard();
      }).catch(console.warn);
    });
  });

  // Periodic token-refresh rebuild — the safety net that keeps a 4h+
  // session live even if no error ever fires to trigger a reconnect.
  if(!streamRefreshTimer){
    streamRefreshTimer=setInterval(()=>{
      if(!streamsWanted||!fbCfg().connected)return;
      closeAllSources();
      startRealtimeSync();
    },STREAM_REFRESH_MS);
  }
}

// Apply one RTDB SSE data event onto a running node snapshot, returning the
// new full node. `put` replaces the value at `path`; `patch` merges its
// children in. RTDB only sends a full put at path '/' when the stream opens;
// every later change to a followed athlete (a freshly logged workout) arrives
// as a child put or a patch, so we must fold those in to stay current — not
// just wait for the opening put like the old handler did.
function applyStreamEvent(node,path,data,merge){
  const parts=(path||'/').split('/').filter(Boolean);
  if(!parts.length){                         // event at the node root
    if(merge)return {...(node||{}),...(data||{})};
    return data===null?null:(data||{});
  }
  const root=(node&&typeof node==='object')?{...node}:{};
  let cur=root;
  for(let i=0;i<parts.length-1;i++){         // clone down to the target's parent
    const k=parts[i];
    cur[k]=(cur[k]&&typeof cur[k]==='object')?{...cur[k]}:{};
    cur=cur[k];
  }
  const last=parts[parts.length-1];
  if(data===null)delete cur[last];
  else if(merge&&data&&typeof data==='object'&&!Array.isArray(data))cur[last]={...(cur[last]||{}),...data};
  else cur[last]=data;
  return root;
}

function listenToDoc(userId,callback){
  if(activeStreams[userId])return;
  const cfg=fbCfg();
  if(!cfg.projectId)return;
  const baseUrl=`https://${cfg.projectId}-default-rtdb.firebaseio.com`;
  const meta=streamMeta[userId]||(streamMeta[userId]={retries:0,timer:null});
  meta.cb=callback;

  FirebaseSync.getIdToken().then(token=>{
    if(!streamsWanted||!streamMeta[userId])return;   // stopped while fetching token
    const url=`${baseUrl}/gym/${encodeURIComponent(userId)}.json?auth=${token}`;
    const source=new EventSource(url);
    activeStreams[userId]=source;

    let nodeState=null;   // last-known full gym node, kept live across the
                          // opening put + every later put/patch child event.
    const applyAndEmit=(packet,merge)=>{
      meta.retries=0;
      if(!packet)return;
      nodeState=applyStreamEvent(nodeState,packet.path,packet.data,merge);
      if(nodeState)callback(nodeState);
    };
    source.addEventListener('open',()=>{meta.retries=0;});
    source.addEventListener('put',e=>{
      try{applyAndEmit(JSON.parse(e.data),false);}
      catch(err){console.warn(`[Sync packet err] @${userId}:`,err);}
    });
    source.addEventListener('patch',e=>{
      try{applyAndEmit(JSON.parse(e.data),true);}
      catch(err){console.warn(`[Sync patch err] @${userId}:`,err);}
    });

    source.onerror=err=>{
      console.warn(`[Sync stream err] @${userId}:`,err);
      try{source.close();}catch(_){}
      delete activeStreams[userId];
      scheduleStreamReconnect(userId,meta);          // reopen with a fresh token
    };
  }).catch(err=>{
    console.warn(`[Sync token err] @${userId}:`,err);
    scheduleStreamReconnect(userId,meta);
  });
}

// Close every live EventSource + cancel pending reconnects, but leave
// streamsWanted / the refresh interval alone (used by the rebuild path).
function closeAllSources(){
  Object.values(activeStreams).forEach(source=>{try{source.close();}catch(_){}});
  activeStreams={};
  Object.values(streamMeta).forEach(m=>{if(m&&m.timer)clearTimeout(m.timer);});
  streamMeta={};
  if(dirMeta.timer){clearTimeout(dirMeta.timer);dirMeta.timer=null;}
}

function stopRealtimeSync(){
  streamsWanted=false;
  closeAllSources();
  if(streamRefreshTimer){clearInterval(streamRefreshTimer);streamRefreshTimer=null;}
}

function stopStream(id){
  const m=streamMeta[id];
  if(m&&m.timer)clearTimeout(m.timer);
  delete streamMeta[id];
  if(!activeStreams[id])return;
  try{activeStreams[id].close();}catch(_){}
  delete activeStreams[id];
}

// Live directory stream — one EventSource over directory.json keeps every
// athlete's metadata (name, avatar, bio, following) current, so renames,
// new profile pictures and follower counts update in realtime for everyone.
function listenToDirectory(){
  if(activeStreams._directory)return;
  const cfg=fbCfg();
  if(!cfg.projectId)return;
  const baseUrl=`https://${cfg.projectId}-default-rtdb.firebaseio.com`;
  FirebaseSync.getIdToken().then(token=>{
    const source=new EventSource(`${baseUrl}/directory.json?auth=${token}`);
    activeStreams._directory=source;
    let dir={};
    const setPath=(path,data,merge)=>{
      const parts=path.split('/').filter(Boolean);
      if(!parts.length){dir=merge?{...dir,...(data||{})}:(data||{});return;}
      const id=parts[0];
      if(parts.length===1){
        if(data===null)delete dir[id];
        else if(merge)dir[id]={...(dir[id]||{}),...data};
        else dir[id]=data;
      }else{
        dir[id]={...(dir[id]||{})};
        dir[id][parts[1]]=data;
      }
    };
    const publish=()=>{
      const users=Object.entries(dir).map(([id,u])=>({
        id,
        name:(u&&u.name)||id,
        ts:(u&&u.ts)||0,
        avatar:(u&&u.avatar)||'',
        bio:(u&&u.bio)||'',
        following:(u&&u.following)?(Array.isArray(u.following)?u.following:Object.values(u.following)).map(String):[]
      }));
      saveDirectoryCache(users);
      // Directory name is canonical (displayName||userId at their last
      // push) — mirror renames into my follow list
      (fbCfg().following||[]).forEach(f=>{
        const d=users.find(u=>u.id===f.id);
        if(d)updateFollowName(f.id,d.name);
      });
      renderFriendsCard();
      if(dirChangedHook)dirChangedHook(users);
    };
    source.addEventListener('open',()=>{dirMeta.retries=0;});
    source.addEventListener('put',e=>{try{const k=JSON.parse(e.data);setPath(k.path,k.data,false);publish();}catch(err){console.warn('[Dir stream]',err);}});
    source.addEventListener('patch',e=>{try{const k=JSON.parse(e.data);setPath(k.path,k.data,true);publish();}catch(err){console.warn('[Dir stream]',err);}});
    source.onerror=err=>{
      console.warn('[Dir stream err]',err);
      try{source.close();}catch(_){}
      delete activeStreams._directory;
      scheduleDirReconnect();                        // reopen with a fresh token
    };
  }).catch(err=>{console.warn('[Dir token err]',err);scheduleDirReconnect();});
}

// Reopen the directory stream after a backoff (fresh token), unless we
// intentionally stopped syncing.
function scheduleDirReconnect(){
  if(!streamsWanted)return;
  const wait=Math.min(2000*Math.pow(2,dirMeta.retries++),STREAM_MAX_BACKOFF);
  if(dirMeta.timer)clearTimeout(dirMeta.timer);
  dirMeta.timer=setTimeout(()=>{if(streamsWanted)listenToDirectory();},wait);
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
    const p=await cloudPayload(doc);
    if(!p||!Array.isArray(p.workouts))throw new Error('no data for @'+f.id);
    saveFriendEntry(f.id,{
      ts:doc.ts||p.ts||Date.now(),
      name:p.name||f.name||f.id,
      avatar:p.avatar||'',
      bio:p.bio||'',
      bw:p.bw||0,
      github:p.github||'',
      following:Array.isArray(p.following)?p.following:[],
      workouts:p.workouts
    });
    updateFollowName(f.id,p.name);
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
    const payload=await cloudPayload(doc);
    if(!payload||!Array.isArray(payload.workouts)){
      if(interactive)toast('No cloud backup found yet — tap Backup Now first','error');
      return 0;
    }
    let added=0;
    payload.workouts.forEach(wo=>{
      if(wo&&wo.date&&!W.find(w=>w.date===wo.date)){W.push(wo);added++;}
    });
    // Sessions pulled from an old dirty doc carry the duplicates with them,
    // so clean after merging too — not just at boot off localStorage.
    const cleaned=dedupeWorkouts(W);
    if(added||cleaned){
      W.sort((a,b)=>b.date.localeCompare(a.date));save();
      renderRecent();renderHeatmapCalendar();renderVolWidget();
    }
    stripSeededHistory();
    const up={};
    if(payload.name)up.displayName=payload.name;
    if(payload.avatar)up.avatar=payload.avatar;
    if(payload.bio)up.bio=payload.bio;
    if(payload.github)up.github=payload.github;
    if(Object.keys(up).length>0)FirebaseSync.updateConfig(up);
    // Legacy blob doc → rewrite it structured so the RTDB console shows
    // plain day-wise JSON from now on
    if(doc.blob&&!Array.isArray(doc.workouts))fbPush(false);
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

// Directory cache — the last known directory/{id} metadata for every
// athlete (name, avatar, following ids). Filled by listUsers() searches
// and kept live by the directory EventSource stream; lets us show
// photos in search results and count followers who we don't follow back.
const DIRK='asca_gym_directory_cache';
function getDirectoryCache(){
  try{const d=JSON.parse(localStorage.getItem(DIRK)||'null');if(d&&Array.isArray(d.users))return d.users;}catch(_){}
  return [];
}
function saveDirectoryCache(users){
  try{localStorage.setItem(DIRK,JSON.stringify({ts:Date.now(),users}));}catch(_){}
}
let dirChangedHook=null; // set by bindSettings so the Find Friends UI re-renders on live directory updates

// One lookup for anyone's profile photo: me → config, followed → friends
// cache, everyone else → directory cache. Empty string means "no photo,
// fall back to the gradient initial".
function avatarOf(id){
  const cfg=fbCfg();
  if(id===cfg.userId)return cfg.avatar||'';
  const f=getFriendsCache().friends[id];
  if(f&&f.avatar)return f.avatar;
  const d=getDirectoryCache().find(u=>u.id===id);
  return (d&&d.avatar)||'';
}
// Avatars come from other users' cloud docs, so the raw value is
// untrusted. Only allow an inline image data-URI (what the canvas
// cropper produces) — anything else can't be a real photo and could be
// a crafted string trying to break out of the src="" attribute and
// inject markup into every viewer's feed. Reject → fall back to gradient.
function safeAvatarUrl(av){
  av=String(av||'');
  return /^data:image\/(png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/=\s]+$/i.test(av)?av:'';
}
function avatarHtmlOf(id,name){
  const av=safeAvatarUrl(avatarOf(id));
  return av?`<img src="${av}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`:initialOf(name);
}
function avatarBgOf(id){return safeAvatarUrl(avatarOf(id))?'none':avatarGrad(id);}

// A followed athlete renamed themselves → mirror it into config.following
// so the follow list / leaderboard show the new name everywhere.
function updateFollowName(id,name){
  if(!name)return;
  const c=fbCfg();
  const f=(c.following||[]).find(x=>x.id===id);
  if(f&&f.name!==name)FirebaseSync.updateConfig({following:c.following.map(x=>x.id===id?{...x,name}:x)});
}

// Day-type colour system — the workout's split is information, so it
// gets a consistent hue everywhere it appears (feed rail + chip).
function dayTypeColor(dt){
  const s=String(dt||'').toLowerCase();
  if(s.includes('cardio'))return '#FF375F';
  if(s.includes('push'))return '#FF7600';
  if(s.includes('pull'))return '#0A84FF';
  if(s.includes('leg')||s.includes('lower'))return '#BF5AF2';
  if(s.includes('upper')||s.includes('full'))return '#30D158';
  return '#64D2FF';
}

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
  // Union of the friends cache (rich, only people I follow) and the
  // directory cache (everyone) — followers I don't follow back only
  // appear in the latter.
  const map={};
  Object.entries(getFriendsCache().friends)
    .filter(([id,f])=>Array.isArray(f.following)&&f.following.includes(cfg.userId))
    .forEach(([id,f])=>{map[id]=f.name||id;});
  getDirectoryCache().forEach(u=>{
    if(u.id!==cfg.userId&&Array.isArray(u.following)&&u.following.includes(cfg.userId))map[u.id]=map[u.id]||u.name||u.id;
  });
  return Object.entries(map).map(([id,name])=>({id,name}));
}

function renderProfile(){
  const avatar=document.getElementById('profAvatar');
  if(!avatar)return;
  const cfg=fbCfg();
  const username=cfg.userId||(cfg.user&&cfg.user.username)||'';
  const name=cfg.displayName||username||'Athlete';
  
  const myAv=safeAvatarUrl(cfg.avatar);
  if(myAv){
    avatar.innerHTML=`<img src="${myAv}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
    avatar.style.background='none';
  }else{
    avatar.textContent=(name.trim()[0]||'?');
    avatar.style.background='#17130f';
  }

  document.getElementById('profName').textContent=name;
  document.getElementById('profUser').textContent=username?'@'+username:'@—';
  const bioEl=document.getElementById('profBio');
  if(bioEl){bioEl.textContent=cfg.bio||'';bioEl.style.display=cfg.bio?'':'none';}

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
    const fbBio=document.getElementById('fbBio');
    if(fbMyId)fbMyId.value=cfg.userId||'';
    if(fbDisplayName)fbDisplayName.value=cfg.displayName||'';
    if(fbGithub)fbGithub.value=cfg.github||'';
    if(fbBio)fbBio.value=cfg.bio||'';
  }

  // ASCA Score gauge — the avatar ring is the arc (full circle at 150),
  // the pill under it carries the number
  const bw=myBW();
  const score=ascaScore(periodStatsExtended(W,'week').volume,bw);
  const ring=document.getElementById('profRing');
  if(ring){
    const deg=Math.max(Math.min(score/150,1)*360,8);
    ring.style.background=`conic-gradient(from 220deg, #FF7600, #FFB25A ${deg}deg, rgba(255,255,255,0.07) ${deg}deg)`;
  }
  const pill=document.getElementById('profScorePill');
  if(pill){
    pill.style.display='';
    const num=document.getElementById('profScoreNum');
    if(num)num.textContent=score;
    pill.classList.toggle('approx',!bw);
    pill.title=bw
      ?`ASCA Score — weekly volume ÷ your body weight (${bw} kg): you moved ${score}× your body weight this week`
      :`ASCA Score is approximate — log your body weight (Log tab) for a real score (assuming ${DEFAULT_BW} kg)`;
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

  // Same GitHub-style activity monitor as Social/mini-profile, always
  // rebuilt from live local workouts so today's session shows instantly.
  const hm=document.getElementById('profHeatmap');
  if(hm){
    hm.innerHTML=gymHeatmapHtml(cfg.userId||'me',name,W,score,true);
    scrollHeatmapsToLatest(hm);
  }
}

/* ── ASCA Score — relative strength ───────────────────────── */
/* Weekly volume divided by body weight: how many times you moved
   your own body weight in the last 7 days. Uses each athlete's
   latest logged body weight (synced via their gym doc); when
   unknown, 75 kg is assumed and the score is shown as approximate. */
const DEFAULT_BW=75;
function ascaScore(weekVol,bw){return Math.round((weekVol||0)/(bw||DEFAULT_BW));}
function myBW(){const b=getBodyWeight();return (b&&b.weight)||0;}

/* ── Extended Stats for Leaderboard / H2H ─────────────────── */
let _lbMetric='score';
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
  let cardioMins=0,cardioKm=0,cardioKcal=0;
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
        const c=workoutCardio(w);cardioMins+=c.mins;cardioKm+=c.km;cardioKcal+=c.kcal;
      }
    }
  });
  const spark=[];
  const pts=timeframe==='week'?7:timeframe==='month'?15:30;
  for(let i=pts-1;i>=0;i--){
    const d=new Date(today);d.setDate(d.getDate()-i);
    spark.push(dailyVol[d.toISOString().slice(0,10)]||0);
  }
  return {workouts,volume:vol,sets,heaviest,variety:exNames.size,streak,spark,
    cardioMins:Math.round(cardioMins),cardioKm:Math.round(cardioKm*10)/10,cardioKcal:Math.round(cardioKcal)};
}

function sparklineSvg(data,color){
  const w=54,h=18,max=Math.max(...data,1);
  const pts=data.map((v,i)=>`${(i/(data.length-1))*w},${h-((v/max)*h*0.85+1)}`).join(' ');
  return `<svg class="lb-spark" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" stroke="${color||'rgba(255,107,0,0.7)'}"/></svg>`;
}

function buildLBRows(){
  const fb=fbCfg();const cache=getFriendsCache();const ids=Object.keys(cache.friends);
  const myName=fb.displayName||fb.userId||'You';
  const mk=(id,name,me,workouts,bw)=>{
    const stats=periodStatsExtended(workouts,_lbTimeframe);
    stats.bw=bw;
    // Score follows the selected timeframe: that period's volume ÷ body weight
    stats.score=ascaScore(stats.volume,bw);
    return {id,name,me,stats,workouts,bw};
  };
  return [mk(fb.userId,myName,true,W,myBW()),
    ...ids.map(id=>mk(id,cache.friends[id].name||id,false,cache.friends[id].workouts||[],cache.friends[id].bw||0))];
}
function metricVal(stats,m){
  const v={score:stats.score,vol7:stats.volume,week:stats.workouts,sets7:stats.sets,cardio:stats.cardioMins,consistency:stats.streak}[m];
  return v===undefined?stats.volume:v; // 0 is a real value (e.g. 0-day streak), not a miss
}
function metricLabel(m){return {score:'score',vol7:'kg',week:'workouts',sets7:'sets',cardio:'min cardio',consistency:'day streak'}[m]||'';}


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
      <div class="podium-avatar" style="background:${avatarBgOf(r.id)}">${avatarHtmlOf(r.id,r.name)}<div class="podium-medal">${medals[origIdx]||''}</div></div>
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
      <div class="lb-rank${rank===1?' lb-gold':rank===2?' lb-silver':rank===3?' lb-bronze':''}">${rank}</div>
      <div class="lb-avatar" style="background:${avatarBgOf(r.id)}">${avatarHtmlOf(r.id,r.name)}</div>
      <div class="lb-main">
        <div class="lb-name">${esc(r.name)}${r.me?'<span class="lb-you">You</span>':''}${sparklineSvg(r.stats.spark,r.me?'#FF6B00':'#0A84FF')}</div>
        <div class="lb-bar"><div class="lb-fill" style="width:${Math.max((v/maxV)*100,2)}%"></div></div>
      </div>
      <div class="lb-val">${fmtStatNum(v)} <span>${metricLabel(metric)}</span></div></div>`;
  }).join('');
  cmp.querySelectorAll('.lb-row').forEach(el=>el.addEventListener('click',()=>showMiniProfile(el.dataset.uid)));
}

function gymHeatmapHtml(id,name,workouts,score,bare){
  const today=new Date();today.setHours(0,0,0,0);
  const weeks=heatmapWeeks(workouts,16),days=weeks*7;
  const volMap={},cardioMap={};
  (workouts||[]).forEach(w=>{if(!w||!w.date||w.dayType==='Rest Day')return;let v=0;
    (w.exercises||[]).forEach(e=>e.sets.forEach(s=>{const wv=getSetWeightVal(s);if(wv&&s.reps)v+=wv*s.reps;}));
    volMap[w.date]=(volMap[w.date]||0)+v;
    const c=workoutCardio(w);if(c.mins)cardioMap[w.date]=(cardioMap[w.date]||0)+c.mins;});
  const maxV=Math.max(...Object.values(volMap),1);
  const maxC=Math.max(...Object.values(cardioMap),1);
  let streak=0,d=new Date(today);
  const dateSet=new Set((workouts||[]).filter(w=>w&&w.dayType!=='Rest Day').map(w=>w.date));
  while(dateSet.has(d.toISOString().slice(0,10))){streak++;d.setDate(d.getDate()-1);}
  let dots='';const startDate=new Date(today);startDate.setDate(today.getDate()-(days-1));startDate.setDate(startDate.getDate()-startDate.getDay());
  for(let i=0;i<days;i++){const dd=new Date(startDate);dd.setDate(startDate.getDate()+i);
    if(dd>today){dots+='<div class="gym-heatmap-dot" style="visibility:hidden"></div>';continue;}
    const ds=dd.toISOString().slice(0,10);const v=volMap[ds]||0;const cm=cardioMap[ds]||0;let lvl='';
    // Cardio-only days count too — intensity is the stronger of the two ratios
    if(v>0||cm>0||dateSet.has(ds)){const r=Math.max(v/maxV,cm/maxC);lvl=r>0.7?'g-4':r>0.4?'g-3':r>0.15?'g-2':'g-1';}
    const tip=cm>0?`${ds} · ${cm} min cardio${v>0?` · ${Math.round(v)} kg`:''}`:v>0?`${ds} · ${Math.round(v)} kg`:ds;
    dots+=`<div class="gym-heatmap-dot ${lvl}${cm>0?' g-cardio':''}" title="${tip}"></div>`;}
  const header=bare===true
    ?`<div class="gym-activity-header gym-activity-header-bare"><div class="gym-activity-streak">${streak?'🔥 '+streak+' day streak':''}</div></div>`
    :`<div class="gym-activity-header">
    <div class="gym-activity-avatar" style="background:${avatarBgOf(id)}">${avatarHtmlOf(id,name)}</div>
    <div class="gym-activity-name">${esc(name)}</div>
    ${score?`<div class="gym-activity-score">${score}<span>score</span></div>`:''}
    <div class="gym-activity-streak">${streak?'🔥 '+streak+' day streak':''}</div></div>`;
  return `<div class="gym-activity-section">${header}
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
  grids.innerHTML=allRows.map(r=>gymHeatmapHtml(r.id,r.name,r.workouts,r.stats.score)).join('');
  scrollHeatmapsToLatest(grids);
}

let _h2hOpp=null; // survives re-renders so timeframe switches keep the matchup
function renderH2HPicker(allRows){
  const label=document.getElementById('h2hLabel');const card=document.getElementById('h2hCard');const picker=document.getElementById('h2hPicker');
  if(!label||!card||!picker||allRows.length<2){if(label)label.style.display='none';if(card)card.style.display='none';return;}
  label.style.display='block';card.style.display='block';
  const meRow=allRows.find(r=>r.me)||allRows[0];const others=allRows.filter(r=>!r.me);
  if(!others.some(r=>r.id===_h2hOpp))_h2hOpp=others[0].id;
  picker.innerHTML=`<div class="h2h-select" style="text-align:center;font-weight:700;color:#FF6B00">${esc(meRow.name)}</div>
    <div class="h2h-vs">VS</div>
    <select class="h2h-select" id="h2hOpponent">${others.map(r=>`<option value="${esc(r.id)}"${r.id===_h2hOpp?' selected':''}>${esc(r.name)}</option>`).join('')}</select>`;
  const sel=document.getElementById('h2hOpponent');
  const render=()=>{const opp=allRows.find(r=>r.id===sel.value);if(opp)renderH2HBody(meRow,opp);};
  sel.addEventListener('change',()=>{_h2hOpp=sel.value;render();});
  render();
}

function renderH2HBody(a,b){
  const body=document.getElementById('h2hBody');if(!body)return;
  const CA='#FF7600',CB='#0A84FF';
  const dims=[
    {label:'Score',aVal:a.stats.score,bVal:b.stats.score,unit:''},
    {label:'Volume',aVal:a.stats.volume,bVal:b.stats.volume,unit:'kg'},
    {label:'Workouts',aVal:a.stats.workouts,bVal:b.stats.workouts,unit:''},
    {label:'Sets',aVal:a.stats.sets,bVal:b.stats.sets,unit:''},
    {label:'Cardio',aVal:a.stats.cardioMins||0,bVal:b.stats.cardioMins||0,unit:'min'},
    {label:'Heaviest',aVal:a.stats.heaviest,bVal:b.stats.heaviest,unit:'kg'},
    {label:'Streak',aVal:a.stats.streak,bVal:b.stats.streak,unit:'days'}
  ];
  const cx=150,cy=122,r=86,n=dims.length;
  const angles=dims.map((_,i)=>(Math.PI*2*i/n)-Math.PI/2);
  const ringPoly=s=>angles.map(a=>`${(cx+Math.cos(a)*r*s).toFixed(1)},${(cy+Math.sin(a)*r*s).toFixed(1)}`).join(' ');
  const rings=[0.33,0.66,1].map((s,i)=>`<polygon points="${ringPoly(s)}" fill="none" stroke="rgba(255,255,255,${i===2?0.12:0.05})" stroke-width="1"/>`).join('');
  const spokes=angles.map(a=>`<line x1="${cx}" y1="${cy}" x2="${(cx+Math.cos(a)*r).toFixed(1)}" y2="${(cy+Math.sin(a)*r).toFixed(1)}" stroke="rgba(255,255,255,0.05)"/>`).join('');
  // Per-axis verdict: label takes the leader's colour
  const labels=dims.map((d,i)=>{
    const lx=cx+Math.cos(angles[i])*(r+22),ly=cy+Math.sin(angles[i])*(r+16);
    const fill=d.aVal===d.bVal?'rgba(255,255,255,0.45)':(d.aVal>d.bVal?CA:CB);
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${fill}" font-size="9.5" font-weight="800" letter-spacing="1" text-anchor="middle" dominant-baseline="central" style="font-family:var(--ff-title),sans-serif;text-transform:uppercase">${d.label.toUpperCase()}</text>`;
  }).join('');
  const norm=vals=>vals.map((v,i)=>{const mx=Math.max(dims[i].aVal,dims[i].bVal,1);return Math.max(v/mx,0.03);});
  const aN=norm(dims.map(d=>d.aVal)),bN=norm(dims.map(d=>d.bVal));
  const pts=nv=>angles.map((ang,i)=>`${(cx+Math.cos(ang)*r*nv[i]).toFixed(1)},${(cy+Math.sin(ang)*r*nv[i]).toFixed(1)}`).join(' ');
  const dots=(nv,c)=>angles.map((ang,i)=>`<circle cx="${(cx+Math.cos(ang)*r*nv[i]).toFixed(1)}" cy="${(cy+Math.sin(ang)*r*nv[i]).toFixed(1)}" r="2.6" fill="${c}" stroke="#000" stroke-width="1"/>`).join('');
  const aWins=dims.filter(d=>d.aVal>d.bVal).length,bWins=dims.filter(d=>d.bVal>d.aVal).length;
  const aLeads=aWins>=bWins;
  const polyA=`<polygon points="${pts(aN)}" fill="url(#h2hFillA)" stroke="${CA}" stroke-width="2" stroke-linejoin="round"${aLeads?' filter="url(#h2hGlow)"':''}/>`;
  const polyB=`<polygon points="${pts(bN)}" fill="url(#h2hFillB)" stroke="${CB}" stroke-width="2" stroke-linejoin="round"${!aLeads?' filter="url(#h2hGlow)"':''}/>`;
  const radar=`<svg viewBox="0 0 300 244" style="width:100%;max-width:320px;display:block;margin:0 auto">
    <defs>
      <linearGradient id="h2hFillA" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${CA}" stop-opacity="0.42"/><stop offset="1" stop-color="#FFB25A" stop-opacity="0.08"/></linearGradient>
      <linearGradient id="h2hFillB" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${CB}" stop-opacity="0.42"/><stop offset="1" stop-color="#64D2FF" stop-opacity="0.08"/></linearGradient>
      <filter id="h2hGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    ${rings}${spokes}
    ${aLeads?polyB+polyA:polyA+polyB}
    ${dots(aN,CA)}${dots(bN,CB)}
    ${labels}</svg>`;
  const verdict=aWins===bWins
    ?`Dead even — ${aWins}–${bWins}`
    :`${esc(aLeads?a.name:b.name)} leads ${Math.max(aWins,bWins)}–${Math.min(aWins,bWins)}`;
  const chip=(row,cls)=>`<div class="h2h-chip ${cls}"><span class="h2h-chip-avatar" style="background:${avatarBgOf(row.id)}">${avatarHtmlOf(row.id,row.name)}</span><span class="h2h-chip-name">${esc(row.name)}</span><b>${row.stats.score}</b></div>`;
  const statRows=dims.map(d=>{const total=d.aVal+d.bVal||1;const aW=Math.max((d.aVal/total)*50,1),bW=Math.max((d.bVal/total)*50,1);
    return `<div class="h2h-stat-left${d.aVal>=d.bVal?' h2h-stat-win':''}">${fmtStatNum(d.aVal)}${d.unit?' '+d.unit:''}</div><div class="h2h-stat-label">${d.label}</div><div class="h2h-stat-right${d.bVal>d.aVal?' h2h-stat-win-b':''}">${fmtStatNum(d.bVal)}${d.unit?' '+d.unit:''}</div><div class="h2h-stat-bar"><div class="h2h-stat-fill-l" style="width:${aW}%"></div><div class="h2h-stat-fill-r" style="width:${bW}%"></div></div>`;}).join('');
  body.innerHTML=`<div class="h2h-legend">${chip(a,'a')}<div class="h2h-verdict">${verdict}</div>${chip(b,'b')}</div>
    <div class="h2h-radar-wrap">${radar}</div><div class="h2h-stats-grid">${statRows}</div>`;
}

// Did this athlete log a non-rest workout within the last `hrs` hours?
// Drives the Instagram-style "story ring" on their avatar.
function trainedRecently(workouts,hrs){
  const cut=Date.now()-(hrs||48)*3600000;
  return (workouts||[]).some(w=>{
    if(!w||w.dayType==='Rest Day'||!Array.isArray(w.exercises)||!w.exercises.length)return false;
    const d=new Date(w.date+'T12:00:00');return !isNaN(d)&&d.getTime()>=cut;
  });
}
// All-time heaviest set per exercise, for PR badges in the feed.
function exerciseMaxes(workouts){
  const m={};
  (workouts||[]).forEach(w=>(w.exercises||[]).forEach(e=>(e.sets||[]).forEach(s=>{
    const wv=getSetWeightVal(s);if(wv>(m[e.name]||0))m[e.name]=wv;
  })));
  return m;
}

function renderActivityFeed(allRows){
  const feedLabel=document.getElementById('feedLabel');const feedCard=document.getElementById('feedCard');const recent=document.getElementById('friendRecent');
  if(!feedLabel||!feedCard||!recent)return;
  const woById={},maxById={};
  allRows.forEach(r=>{woById[r.id]=r.workouts||[];maxById[r.id]=exerciseMaxes(r.workouts);});
  const feed=[];
  allRows.forEach(r=>{(r.workouts||[]).filter(w=>w&&w.dayType!=='Rest Day'&&Array.isArray(w.exercises)&&w.exercises.length).slice(0,6).forEach(w=>feed.push({id:r.id,name:r.name,w}));});
  feed.sort((a,b)=>b.w.date.localeCompare(a.w.date));
  if(!feed.length){feedLabel.style.display='none';feedCard.style.display='none';return;}
  feedLabel.style.display='block';feedCard.style.display='block';
  recent.innerHTML=feed.slice(0,12).map(({id,name,w})=>{
    const sets=w.exercises.reduce((s,e)=>s+e.sets.length,0);
    const vol=w.exercises.reduce((s,e)=>s+e.sets.reduce((ss,x)=>ss+((getSetWeightVal(x))*(x.reps||0)),0),0);
    const cd=workoutCardio(w);
    const dtc=dayTypeColor(w.dayType);
    const maxes=maxById[id]||{};
    let prName='';w.exercises.forEach(e=>e.sets.forEach(s=>{const wv=getSetWeightVal(s);if(wv&&maxes[e.name]&&wv>=maxes[e.name]&&!prName)prName=e.name;}));
    const story=trainedRecently(woById[id])?' has-story':'';
    const route=w.exercises.map(e=>e.name).slice(0,3).join(' · ');
    const detail=w.exercises.map(e=>{
      const setsH=(e.sets||[]).map((s,i)=>`<div class="fd-set"><span class="fd-set-idx">${i+1}</span><span class="fd-set-wr">${isCardioSet(s)?cardioSetLabel(s):`${formatWeightVal(s)} × ${s.reps!=null&&s.reps!==''?s.reps:'—'}`}</span>${s.notes?`<span class="fd-set-note">${esc(s.notes)}</span>`:''}</div>`).join('');
      const isCardioEx=(e.sets||[]).some(isCardioSet);
      return `<div class="fd-ex"><div class="fd-ex-head"><span class="fd-ex-name">${esc(e.name)}</span><span class="fd-ex-sets">${(e.sets||[]).length} ${isCardioEx?'interval':'set'}${(e.sets||[]).length===1?'':'s'}</span></div><div class="fd-sets">${setsH}</div></div>`;
    }).join('');
    return `<article class="feed-card" data-uid="${esc(id)}" style="--dt:${dtc};--dt-bg:${dtc}22">
      <div class="feed-card-bar"></div>
      <div class="feed-card-main">
        <div class="feed-card-head">
          <div class="avatar-ring${story}"><div class="feed-avatar" style="background:${avatarBgOf(id)}">${avatarHtmlOf(id,name)}</div></div>
          <div class="feed-who"><span class="feed-name">${esc(name)}</span><span class="feed-when">@${esc(id)} · ${dayAgo(w.date)}</span></div>
          <span class="feed-type" style="background:${dtc}22;color:${dtc}">${esc(w.dayType||'Workout')}</span>
        </div>
        <div class="feed-stats">
          ${vol>0||cd.mins===0?`<div class="feed-stat"><b>${fmtStatNum(vol)}</b><span>kg volume</span></div>`:''}
          ${cd.mins>0?`<div class="feed-stat feed-stat-cardio"><b>🏃 ${cd.mins}</b><span>min cardio</span></div>`:''}
          ${cd.km>0?`<div class="feed-stat feed-stat-cardio"><b>${cd.km}</b><span>km</span></div>`:''}
          ${cd.kcal>0?`<div class="feed-stat feed-stat-cardio"><b>${cd.kcal}</b><span>kcal</span></div>`:''}
          <div class="feed-stat"><b>${sets}</b><span>sets</span></div>
          <div class="feed-stat"><b>${w.exercises.length}</b><span>exercise${w.exercises.length===1?'':'s'}</span></div>
          ${prName?`<div class="feed-stat feed-stat-pr"><b>🏆 PR</b><span>${esc(prName)}</span></div>`:''}
        </div>
        ${route?`<div class="feed-route"><span class="feed-route-dot" style="background:${dtc}"></span>${esc(route)}${w.exercises.length>3?` +${w.exercises.length-3}`:''}</div>`:''}
        <div class="feed-detail" style="display:none">${detail}</div>
        <div class="feed-actions">
          <button class="feed-act feed-kudo" data-owner="${esc(id)}" data-date="${esc(w.date)}" aria-label="Give kudos">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span class="feed-act-count kudo-count">·</span>
          </button>
          <button class="feed-act feed-comment" data-owner="${esc(id)}" data-date="${esc(w.date)}" aria-label="Comments">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            <span class="feed-act-count comment-count">·</span>
          </button>
          <button class="feed-act feed-expand" aria-expanded="false">Workout<svg class="fd-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></button>
          <button class="feed-act feed-openprofile" data-uid="${esc(id)}">Profile</button>
        </div>
        <div class="feed-comments" data-owner="${esc(id)}" data-date="${esc(w.date)}" style="display:none"></div>
      </div>
    </article>`;
  }).join('');
  recent.querySelectorAll('.feed-card-head').forEach(el=>el.addEventListener('click',()=>{const c=el.closest('.feed-card');if(c)showMiniProfile(c.dataset.uid);}));
  recent.querySelectorAll('.feed-openprofile').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();showMiniProfile(el.dataset.uid);}));
  recent.querySelectorAll('.feed-kudo').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();handleKudo(el);}));
  recent.querySelectorAll('.feed-comment').forEach(el=>el.addEventListener('click',e=>{e.stopPropagation();toggleComments(el);}));
  recent.querySelectorAll('.feed-expand').forEach(el=>el.addEventListener('click',e=>{
    e.stopPropagation();
    const card=el.closest('.feed-card');const d=card&&card.querySelector('.feed-detail');if(!d)return;
    const open=d.style.display==='none';d.style.display=open?'block':'none';
    el.classList.toggle('on',open);el.setAttribute('aria-expanded',open?'true':'false');
  }));
  hydrateFeedSocial(recent);
}

/* ── Feed social: kudos + comments (RTDB kudos/ + comments/ nodes) ──
   Reads are best-effort; if the extended DB rules aren't published yet
   these no-op and the counts stay a dim dot. */
function socialReady(){return typeof FirebaseSync!=='undefined'&&FirebaseSync.isConnected&&FirebaseSync.isConnected();}
function hydrateFeedSocial(container){
  if(!socialReady())return;
  container.querySelectorAll('.feed-kudo').forEach(async btn=>{
    try{const k=await FirebaseSync.readKudos(btn.dataset.owner,btn.dataset.date);
      const c=btn.querySelector('.kudo-count');if(c)c.textContent=k.count;
      btn.classList.toggle('on',!!k.mine);
    }catch(_){}
  });
  container.querySelectorAll('.feed-comment').forEach(async btn=>{
    try{const list=await FirebaseSync.readComments(btn.dataset.owner,btn.dataset.date);
      const c=btn.querySelector('.comment-count');if(c)c.textContent=list.length;
    }catch(_){}
  });
}
async function handleKudo(btn){
  if(!socialReady()){toast('Sign in to give kudos','error');return;}
  const countEl=btn.querySelector('.kudo-count');
  const was=btn.classList.contains('on');
  const cur=parseInt(countEl.textContent)||0;
  btn.classList.toggle('on',!was);
  countEl.textContent=Math.max(0,cur+(was?-1:1));
  btn.classList.add('pop');setTimeout(()=>btn.classList.remove('pop'),300);
  try{const now=await FirebaseSync.toggleKudos(btn.dataset.owner,btn.dataset.date);btn.classList.toggle('on',now);}
  catch(e){btn.classList.toggle('on',was);countEl.textContent=cur;toast('Kudos need the updated database rules','error');}
}
async function toggleComments(btn){
  const card=btn.closest('.feed-card');const panel=card&&card.querySelector('.feed-comments');
  if(!panel)return;
  if(panel.style.display!=='none'){panel.style.display='none';return;}
  panel.style.display='block';
  panel.innerHTML='<div class="cmt-empty">Loading…</div>';
  let list=[];try{list=await FirebaseSync.readComments(btn.dataset.owner,btn.dataset.date);}catch(_){}
  renderCommentPanel(panel,btn.dataset.owner,btn.dataset.date,list,btn);
}
function renderCommentPanel(panel,owner,date,list,btn){
  const items=list.length
    ?list.map(c=>`<div class="cmt"><span class="cmt-name">${esc(c.name||'athlete')}</span><span class="cmt-text">${esc(c.text)}</span></div>`).join('')
    :'<div class="cmt-empty">No comments yet — be the first.</div>';
  panel.innerHTML=`<div class="cmt-list">${items}</div><div class="cmt-compose"><input class="cmt-input" type="text" maxlength="300" placeholder="Add a comment…"><button class="cmt-send">Post</button></div>`;
  const input=panel.querySelector('.cmt-input');const send=panel.querySelector('.cmt-send');
  const submit=async()=>{
    const t=input.value.trim();if(!t)return;
    if(!socialReady()){toast('Sign in to comment','error');return;}
    send.disabled=true;
    try{const c=await FirebaseSync.addComment(owner,date,t);list.push(c);renderCommentPanel(panel,owner,date,list,btn);
      if(btn){const cc=btn.querySelector('.comment-count');if(cc)cc.textContent=(parseInt(cc.textContent)||0)+1;}
    }catch(e){toast('Comments need the updated database rules','error');send.disabled=false;}
  };
  send.addEventListener('click',submit);
  input.addEventListener('keydown',e=>{if(e.key==='Enter')submit();});
  input.focus();
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
  const dirEntry=getDirectoryCache().find(u=>u.id===userId);
  const bio=isMe?(cfg.bio||''):((friendData&&friendData.bio)||(dirEntry&&dirEntry.bio)||'');
  const theirFollowing=isMe?cfg.following.map(f=>f.id):(friendData&&Array.isArray(friendData.following)?friendData.following:(dirEntry?dirEntry.following:[]));
  const theirFollowers=isMe?getFollowers().length:getDirectoryCache().filter(u=>u.id!==userId&&Array.isArray(u.following)&&u.following.includes(userId)).length;
  const mpWeek=periodStatsExtended(workouts,'week');
  const mpScore=ascaScore(mpWeek.volume,isMe?myBW():((friendData&&friendData.bw)||(dirEntry&&dirEntry.bw)||0));
  const mpStory=trainedRecently(workouts)?' has-story':'';
  const mpTiles=sessions.slice(0,6).map(w=>{const dtc=dayTypeColor(w.dayType);const v=(w.exercises||[]).reduce((s,e)=>s+e.sets.reduce((ss,x)=>ss+(getSetWeightVal(x)*(x.reps||0)),0),0);const c=workoutCardio(w);const valHtml=(v===0&&c.mins>0)?`${c.mins}<em>min</em>`:`${fmtStatNum(v)}<em>kg</em>`;return `<div class="mp-tile" style="--dt:${dtc}"><span class="mp-tile-type">${esc(w.dayType||'Workout')}</span><span class="mp-tile-vol">${valHtml}</span><span class="mp-tile-date">${dayAgo(w.date)}</span></div>`;}).join('');
  content.innerHTML=`<div class="mini-profile-hero"><div class="avatar-ring mp-avatar-ring${mpStory}"><div class="mini-profile-avatar" style="background:${avatarBgOf(userId)}">${avatarHtmlOf(userId,name)}</div></div><div class="mini-profile-name">${esc(name)}${isMe?' <span class="lb-you">You</span>':''}</div><div class="mini-profile-user">@${esc(userId)}</div>${bio?`<div class="mini-profile-bio">${esc(bio)}</div>`:''}<div class="mini-profile-follows"><span><b>${(theirFollowing||[]).length}</b> Following</span><span><b>${theirFollowers}</b> Followers</span></div>${followsMe?'<div class="mini-profile-mutual"><span class="mutual-chip">Follows you</span></div>':''}</div>
    <div class="mini-profile-stats"><div class="mini-profile-stat"><div class="mini-profile-stat-val mini-profile-score">${mpScore}</div><div class="mini-profile-stat-label">Score</div></div><div class="mini-profile-stat"><div class="mini-profile-stat-val">${sessions.length}</div><div class="mini-profile-stat-label">Workouts</div></div><div class="mini-profile-stat"><div class="mini-profile-stat-val">${fmtStatNum(vol)}</div><div class="mini-profile-stat-label">Volume (kg)</div></div>${mpWeek.cardioMins>0?`<div class="mini-profile-stat"><div class="mini-profile-stat-val" style="color:#FF375F">${mpWeek.cardioMins}</div><div class="mini-profile-stat-label">Cardio (min/wk)</div></div>`:''}<div class="mini-profile-stat"><div class="mini-profile-stat-val">${stats.streak}</div><div class="mini-profile-stat-label">Streak 🔥</div></div></div>
    ${!isMe?`<div class="mini-profile-actions">${iAmFollowing?`<button class="btn btn-secondary btn-full" id="mpUnfollow">Following</button>`:`<button class="btn btn-primary btn-full" id="mpFollow">Follow</button>`}</div>`:''}
    ${mpTiles?`<div class="mini-profile-tiles-wrap"><div class="mini-profile-heatmap-title">Recent sessions</div><div class="mini-profile-tiles">${mpTiles}</div></div>`:''}
    <div class="mini-profile-heatmap"><div class="mini-profile-heatmap-title">Activity — Last 16 Weeks</div>${gymHeatmapHtml(userId,name,workouts,mpScore)}</div>`;
  scrollHeatmapsToLatest(content);
  const followBtn=document.getElementById('mpFollow');const unfollowBtn=document.getElementById('mpUnfollow');
  if(followBtn)followBtn.addEventListener('click',()=>{const c=FirebaseSync.getConfig();if(!c.following.some(f=>f.id===userId)){FirebaseSync.updateConfig({following:[...c.following,{id:userId,name:name}]});toast('Following @'+userId,'success');closeMiniProfile();renderFriendsCard();fbPush(false);startRealtimeSync();fbPullFollowing(false);}});
  if(unfollowBtn)unfollowBtn.addEventListener('click',()=>{const c=FirebaseSync.getConfig();FirebaseSync.updateConfig({following:c.following.filter(f=>f.id!==userId)});stopStream(userId);removeFriendEntry(userId);toast('Unfollowed @'+userId);closeMiniProfile();renderFriendsCard();fbPush(false);});
  bg.classList.add('open');bg.addEventListener('click',e=>{if(e.target===bg)closeMiniProfile();},{once:true});
}
function closeMiniProfile(){const bg=document.getElementById('miniProfileBg');if(bg)bg.classList.remove('open');}

function renderFriendsCard(){
  renderProfile();
  const label=document.getElementById('friendLabel');const card=document.getElementById('friendCard');
  if(!label||!card)return;
  const fb=fbCfg();const cache=getFriendsCache();const ids=Object.keys(cache.friends);
  const hasRemote=fb.connected&&fb.following.length>0;
  const emptyCard=document.getElementById('socEmptyCard');
  if(!hasRemote&&!ids.length){
    label.style.display='none';card.style.display='none';
    ['activityLabel','activityCard','h2hLabel','h2hCard','feedLabel','feedCard'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    if(emptyCard){
      emptyCard.style.display='block';
      const cta=document.getElementById('socEmptyCta');
      if(cta&&!cta.dataset.bound){
        cta.dataset.bound='1';
        cta.addEventListener('click',()=>{
          const b=document.querySelector('.bot-btn[data-v="Set"]');if(b)b.click();
          const s=document.getElementById('fbSearch');if(s)setTimeout(()=>s.focus(),350);
        });
      }
    }
    return;
  }
  if(emptyCard)emptyCard.style.display='none';
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
    _lbMetric=t.dataset.metric||'score';const allRows=buildLBRows();renderPodium(allRows,_lbMetric);renderLeaderboardRows(allRows,_lbMetric);});
  
  const tfTabs=document.getElementById('lbTimeframeTabs');
  if(tfTabs)tfTabs.addEventListener('click',e=>{const t=e.target.closest('.lb-timeframe-tab');if(!t)return;
    tfTabs.querySelectorAll('.lb-timeframe-tab').forEach(b=>b.classList.remove('on'));t.classList.add('on');
    _lbTimeframe=t.dataset.timeframe||'week';const allRows=buildLBRows();renderPodium(allRows,_lbMetric);renderLeaderboardRows(allRows,_lbMetric);renderH2HPicker(allRows);});
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
  eMode = isCardioExercise(eEx) ? 'cardio' : isLevelDefault ? 'level' : 'weight';

  if (eMode !== 'cardio') for (const w of W) {
    let found = false;
    for (const e of w.exercises) {
      if (canonicalName(e.name) === eEx) {
        if (e.sets.some(isCardioSet)) { eMode = 'cardio'; found = true; break; }
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

  if (eMode === 'cardio') {
    // One session row, pre-filled from the last time this cardio was logged
    const lc = lastCardio(eEx);
    eSets = [{cardio:true, mins:lc.mins, km:lc.km, kcal:lc.kcal, speed:lc.speed, incline:lc.incline, hr:lc.hr, notes:'', completed:false}];
  } else {
    const lw=lastW(eEx);
    eSets=[{weight:lw,reps:'',notes:'',completed:false},{weight:lw,reps:'',notes:'',completed:false},{weight:lw,reps:'',notes:'',completed:false}];
  }
  
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
    <button type="button" class="segment-btn ${eMode==='cardio'?'active':''}" data-mode="cardio">Cardio</button>
  `;
  parent.appendChild(tog);

  tog.querySelectorAll('.segment-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const prev = eMode;
      eMode = e.currentTarget.dataset.mode;
      tog.querySelectorAll('.segment-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === eMode));
      // Switching to/from cardio changes the row shape — reset the rows
      if ((prev === 'cardio') !== (eMode === 'cardio')) {
        eSets = eMode === 'cardio'
          ? [{cardio:true, mins:'', km:'', kcal:'', speed:'', incline:'', hr:'', notes:'', completed:false}]
          : [{weight:'',reps:'',notes:'',completed:false},{weight:'',reps:'',notes:'',completed:false},{weight:'',reps:'',notes:'',completed:false}];
      }
      renderSets();
    });
  });
}

function lastCardio(n){
  for(const w of W){
    for(const e of (w.exercises||[])){
      if(canonicalName(e.name)===n){
        const s=(e.sets||[]).find(isCardioSet);
        if(s)return {mins:s.mins||'',km:s.km||'',kcal:s.kcal||'',speed:s.speed||'',incline:s.incline||'',hr:s.hr||''};
      }
    }
  }
  return {mins:'',km:'',kcal:'',speed:'',incline:'',hr:''};
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
    if(eMode==='cardio'){
      eSets.push({cardio:true,mins:'',km:'',kcal:'',speed:'',incline:'',hr:'',notes:'',completed:false});
    }else{
      const lw=eSets.length?eSets[eSets.length-1].weight:'';
      eSets.push({weight:lw,reps:'',notes:'',completed:false});
    }
    renderSets();
  });
  document.getElementById('seCl').addEventListener('click',()=>{eEx=null;eSets=[];document.getElementById('se').style.display='none';});
  document.getElementById('svEx').addEventListener('click',saveEx);
}

// Notes are auto-growing textareas: the box expands with the text so
// nothing you type scrolls out of view (matters most on mobile).
function autoGrowNote(el){el.style.height='auto';el.style.height=el.scrollHeight+'px';}

function renderSets(){
  const g=document.getElementById('seG');
  const isL = eMode === 'level';
  if (eMode === 'cardio') { renderCardioSets(g); return; }
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
        <textarea class="set-input set-notes-input" data-i="${i}" data-f="notes" rows="1" placeholder="Add note for set ${i+1}..." ${s.completed?'disabled':''}>${esc(s.notes||'')}</textarea>
        <div class="note-tags-row">
          ${tagsHtml}
        </div>
      </div>`;
    g.appendChild(r);
  });
  g.querySelectorAll('.set-notes-input').forEach(autoGrowNote);

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
      if(f==='notes')autoGrowNote(e.target);
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

/* Cardio editor rows: one row = one session/interval logging
   duration · distance · calories instead of weight × reps. */
function renderCardioSets(g){
  g.innerHTML=`
    <div style="display:grid;grid-template-columns:30px 1fr 1fr 1fr 28px;gap:8px;margin-bottom:6px;align-items:center">
      <div class="set-label" style="text-align:center;color:var(--accent);font-size:0.75rem">Done</div>
      <div class="set-label">Min</div>
      <div class="set-label">Km</div>
      <div class="set-label">Kcal</div>
      <div></div>
    </div>`;
  const tags=["Zone 2","Intervals","Steady pace","Fasted","All-out"];
  eSets.forEach((s,i)=>{
    const r=document.createElement('div');r.className=`set-row-container cardio-row ${s.completed?'completed':''}`;
    const tagsHtml=tags.map(t=>`<button type="button" class="note-tag" data-i="${i}" data-val="${t}">${t}</button>`).join('');
    const pace=cardioPace(s);
    r.innerHTML=`
      <div class="set-grid-main cardio-grid-main">
        <button class="btn-set-check ${s.completed?'completed':''}" data-i="${i}" aria-label="Toggle interval completion">
          ${s.completed?`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><polyline points="20 6 9 17 4 12"/></svg>`:i+1}
        </button>
        <input type="number" class="set-input" data-i="${i}" data-f="mins" value="${s.mins||''}" placeholder="min" min="0" step="1" inputmode="decimal" ${s.completed?'disabled':''}>
        <input type="number" class="set-input" data-i="${i}" data-f="km" value="${s.km||''}" placeholder="km" min="0" step="0.1" inputmode="decimal" ${s.completed?'disabled':''}>
        <input type="number" class="set-input" data-i="${i}" data-f="kcal" value="${s.kcal||''}" placeholder="kcal" min="0" step="1" inputmode="numeric" ${s.completed?'disabled':''}>
        <button class="set-del" data-i="${i}" aria-label="Delete interval">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="cardio-extra-row">
        <div class="cardio-extra-field"><span>Speed</span><input type="number" class="set-input" data-i="${i}" data-f="speed" value="${s.speed||''}" placeholder="km/h" min="0" step="0.1" inputmode="decimal" ${s.completed?'disabled':''}></div>
        <div class="cardio-extra-field"><span>Incline</span><input type="number" class="set-input" data-i="${i}" data-f="incline" value="${s.incline||''}" placeholder="%" min="0" step="0.5" inputmode="decimal" ${s.completed?'disabled':''}></div>
        <div class="cardio-extra-field"><span>Avg HR</span><input type="number" class="set-input" data-i="${i}" data-f="hr" value="${s.hr||''}" placeholder="bpm" min="0" step="1" inputmode="numeric" ${s.completed?'disabled':''}></div>
        <div class="cardio-pace-badge">${pace?`⏱ ${pace}`:''}</div>
      </div>
      <div class="set-notes-wrap cardio-notes-wrap">
        <textarea class="set-input set-notes-input" data-i="${i}" data-f="notes" rows="1" placeholder="Add note for this interval..." ${s.completed?'disabled':''}>${esc(s.notes||'')}</textarea>
        <div class="note-tags-row">${tagsHtml}</div>
      </div>`;
    g.appendChild(r);
  });
  g.querySelectorAll('.set-notes-input').forEach(autoGrowNote);
  g.querySelectorAll('.set-input').forEach(inp=>{
    inp.addEventListener('input',e=>{
      const idx=+e.target.dataset.i,f=e.target.dataset.f;
      let v=e.target.value;
      if(f!=='notes')v=v?parseFloat(v):'';
      eSets[idx][f]=v;
      if(f==='notes')autoGrowNote(e.target);
      if(f==='mins'||f==='km'){ // live-derived pace
        const badge=e.target.closest('.set-row-container').querySelector('.cardio-pace-badge');
        if(badge){const p=cardioPace(eSets[idx]);badge.textContent=p?`⏱ ${p}`:'';}
      }
    });
  });
  g.querySelectorAll('.note-tag').forEach(btn=>{
    btn.addEventListener('click',e=>{
      const idx=+e.currentTarget.dataset.i;
      const val=e.currentTarget.dataset.val;
      const cur=eSets[idx].notes||'';
      if(cur.includes(val))return;
      eSets[idx].notes=cur?`${cur}, ${val}`:val;
      renderSets();
    });
  });
  g.querySelectorAll('.set-del').forEach(b=>b.addEventListener('click',e=>{eSets.splice(+e.currentTarget.dataset.i,1);renderSets();}));
  g.querySelectorAll('.btn-set-check').forEach(btn=>{
    btn.addEventListener('click',e=>{
      const idx=+e.currentTarget.dataset.i;
      eSets[idx].completed=!eSets[idx].completed;
      renderSets();
    });
  });
}

function saveEx(){
  if(!eEx)return;
  const isCardio=eMode==='cardio';
  const v=eSets.filter(s=>isCardio?(s.mins||s.km||s.kcal||s.speed||s.incline||s.hr||s.notes):(s.weight||s.reps||s.notes));
  if(!v.length){toast(isCardio?'Enter at least one interval':'Enter at least one set','error');return;}
  SE.push({
    name:eEx,
    sets:v.map(s=>isCardio?({
      cardio:true,
      mins:s.mins||null,
      km:s.km||null,
      kcal:s.kcal||null,
      speed:s.speed||null,
      incline:s.incline||null,
      hr:s.hr||null,
      weight:null,
      reps:null,
      notes:s.notes||''
    }):({
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
    const isCardio=ex.sets.length>0&&isCardioSet(ex.sets[0]);
    const isL=!isCardio&&ex.sets.length>0&&ex.sets[0].isLevel;
    const modeLabel=isL?'Level':'kg';
    const sh=ex.sets.map(s=>isCardioSet(s)
      ?`<div class="chip chip-cardio"><span class="chip-w">${cardioSetLabelShort(s)}</span></div>`
      :`<div class="chip"><span class="chip-w">${formatWeightVal(s)}</span><span class="chip-x">×</span><span class="chip-r">${s.reps!=null?s.reps:'—'}</span></div>`).join('');
    const togBtn=isCardio
      ?`<span class="btn-toggle-mode" style="pointer-events:none">Cardio</span>`
      :`<button class="btn-toggle-mode" data-tog="${idx}" title="Switch between kg and Level"><svg class="toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>${modeLabel}</button>`;
    c.innerHTML=`<div class="logged-header"><div class="logged-name">${esc(ex.name)}</div><div class="logged-actions">${togBtn}<button class="btn btn-ghost btn-sm" data-rm="${idx}">Remove</button></div></div><div class="set-chips">${sh}</div>`;
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

// Guards against a second Finish landing while the first is still awaiting
// fbPush — that race used to append the whole session twice.
let finishing=false;

async function finish(){
  if(finishing)return;
  const d=document.getElementById('wDate').value,t=document.getElementById('wType').value;
  if(!d){toast('Pick a date','error');return;}
  if(!t){toast('Pick a split focus','error');return;}
  if(t!=='Rest Day'&&!SE.length){toast('Add at least one exercise','error');return;}
  finishing=true;
  const finBtn=document.getElementById('fin');if(finBtn)finBtn.disabled=true;
  // Drain the session synchronously: even if something re-enters before the
  // await below settles, there is no longer a batch left to double-log.
  const batch=t==='Rest Day'?[]:SE;
  SE=[];persistSE();
  try{
    const wo={date:d,dayType:t,exercises:batch};
    const idx=W.findIndex(w=>w.date===d);
    if(idx>=0){wo.exercises=mergeExercises(W[idx].exercises,batch);W[idx]=wo;}else W.unshift(wo);
    W.sort((a,b)=>b.date.localeCompare(a.date));save();
    const synced=fbCfg().connected?await fbPush(false):false;
    toast(synced?'Saved & Synced':'Saved locally','success');
    eEx=null;eSets=[];document.getElementById('se').style.display='none';
    document.getElementById('acts').style.display='none';renderLogged();
    renderHeatmapCalendar();renderVolWidget();renderProfile();
  }finally{
    finishing=false;if(finBtn)finBtn.disabled=false;
  }
}

// Fold a newly logged batch into an existing day. Repeating an exercise on
// the same date extends that exercise's sets instead of creating a second
// entry with the same name — which is what made a day read as duplicated.
function mergeExercises(existing,batch){
  const out=(existing||[]).map(ex=>({...ex,sets:[...(ex.sets||[])]}));
  (batch||[]).forEach(ex=>{
    if(!ex||!ex.name)return;
    const hit=out.find(e=>e.name===ex.name);
    if(hit)hit.sets=[...hit.sets,...(ex.sets||[])];
    else out.push({...ex,sets:[...(ex.sets||[])]});
  });
  return out;
}

// One-time repair for days already corrupted by the old double-append: an
// exercise entry whose name AND full set list exactly repeat an earlier
// entry in the same day can only have come from a duplicated write, so drop
// it. Genuine repeat sets inside a single exercise are untouched.
function setSig(s){return s?`${s.weight??''}|${s.reps??''}|${s.notes||''}|${s.isLevel?1:0}|${s.mins??''}|${s.km??''}|${s.kcal??''}|${s.speed??''}|${s.incline??''}|${s.hr??''}`:'';}
function dedupeWorkouts(list){
  let removed=0;
  (list||[]).forEach(w=>{
    if(!w||!Array.isArray(w.exercises))return;
    const seen=new Set(),keep=[];let dropped=0;
    w.exercises.forEach(ex=>{
      if(!ex||!ex.name){keep.push(ex);return;}
      const sig=ex.name+'::'+(ex.sets||[]).map(setSig).join(';');
      if(seen.has(sig)){dropped++;return;}
      seen.add(sig);keep.push(ex);
    });
    if(dropped){w.exercises=keep;removed+=dropped;}
  });
  return removed;
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
      if (isCardioSet(s)) {
        return `<div class="tl-set-row"><span class="tl-set-idx">Int ${idx+1}</span><span class="tl-set-weight-reps">${cardioSetLabel(s)}</span>${noteStr}</div>`;
      }
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
  if(filt==='Cardio')data=W.filter(w=>w.dayType.toLowerCase().includes('cardio')||(w.exercises||[]).some(e=>(e.sets||[]).some(isCardioSet)));
  else if(filt!=='all')data=W.filter(w=>w.dayType.toLowerCase().includes(filt.toLowerCase()));
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
    const cd=workoutCardio(wo);

    const mD={Pull:0,Push:0,Legs:0,Shoulders:0,Core:0,Cardio:0,Other:0};
    wo.exercises.forEach(e=>{const g=findG(e.name);mD[g in mD?g:'Other']+=e.sets.length;});
    const cL={Pull:'var(--c-blue)',Push:'var(--c-red)',Legs:'var(--c-green)',Shoulders:'var(--c-orange)',Core:'var(--c-purple)',Cardio:'#FF375F',Other:'var(--c-cyan)'};
    let mbHtml='';
    Object.entries(mD).forEach(([g,c])=>{if(c>0)mbHtml+=`<div class="tl-m-seg" style="width:${(c/ns)*100}%;background:${cL[g]}"></div>`;});

    const exH=wo.exercises.map(ex=>{
      const cardioBest=(ex.sets||[]).filter(isCardioSet).sort((a,b)=>cardioNum(b.mins)-cardioNum(a.mins))[0];
      if(cardioBest){
        return `<div class="tl-ex"><div><div class="tl-ex-name">${esc(ex.name)}</div><div class="tl-ex-sets">${ex.sets.length} interval${ex.sets.length===1?'':'s'}</div></div><div class="tl-ex-best"><div class="tl-best-icon tl-cardio-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div><span class="tl-best-val">${cardioSetLabelShort(cardioBest)}</span></div></div>`;
      }
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
            ${cd.mins>0?`<div class="tl-stat"><span class="tl-stat-v tl-stat-cardio">${cd.mins}m</span><span class="tl-stat-l">Cardio</span></div>`:''}
            ${(vol>0||cd.mins===0)?`<div class="tl-stat"><span class="tl-stat-v">${vol>=1000?(vol/1000).toFixed(1)+'k':vol}</span><span class="tl-stat-l">Volume</span></div>`:''}
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
        const noteStr = s.notes ? ` (${s.notes})` : '';
        if (isCardioSet(s)) return `${cardioSetLabel(s)}${noteStr}`;
        const wVal = formatWeightVal(s);
        const repVal = s.reps ?? '—';
        return `${wVal} × ${repVal}${noteStr}`;
      }).join(' | ');
      txt += `• ${ex.name} : ${setsStr}\n`;
    });
  }
  txt += `─────────────────────────`;
  navigator.clipboard.writeText(txt).then(()=>{toast('Copied!','success');}).catch(()=>{toast('Failed to copy','error');});
}

function dayC(t){t=t.toLowerCase();if(t.includes('cardio'))return'cardio';if(t.includes('pull'))return'pull';if(t.includes('push'))return'push';if(t.includes('leg'))return'legs';if(t.includes('shoulder'))return'shoulders';if(t.includes('upper')||t.includes('core'))return'core';return'other';}

function findG(name){
  const cn=canonicalName(name);const L=lib();
  for(const[g,exs]of Object.entries(L)){if(exs.some(e=>e===cn))return g;}
  if(isCardioExercise(cn))return'Cardio';
  const n=cn.toLowerCase();
  if(n.includes('lat')||n.includes('row')||n.includes('pull')||n.includes('curl')||n.includes('bicep')||n.includes('hammer')||n.includes('shrug'))return'Pull';
  if(n.includes('press')||n.includes('fly')||n.includes('dip')||n.includes('tricep')||n.includes('incline')||n.includes('pec'))return'Push';
  if(n.includes('leg')||n.includes('calv')||n.includes('squat'))return'Legs';
  if(n.includes('shoulder')||n.includes('lateral')||n.includes('front raise')||n.includes('face pull')||n.includes('reverse'))return'Shoulders';
  if(n.includes('ab')||n.includes('crunch')||n.includes('wrist')||n.includes('knee raise'))return'Core';
  return'Other';
}

function getSetWeightVal(s) {
  if (isCardioSet(s)) return 0; // cardio never contributes to lifted volume
  if (s.weight !== null && s.weight !== undefined && s.weight !== '') return parseFloat(s.weight);
  if (s.notes) { const m = s.notes.match(/level\s*(\d+)/i); if (m) return parseFloat(m[1]); }
  return 0;
}

/* ── Cardio sets ────────────────────────────────────────────
   A cardio "set" is one session/interval: {cardio:true, mins, km, kcal,
   incline, speed, hr, notes}. weight/reps stay null so every volume
   computation degrades to 0. Pace (min/km) is derived from mins ÷ km. */
function isCardioSet(s){return !!s&&(s.cardio===true||s.mins!=null||s.km!=null||s.kcal!=null||s.incline!=null||s.speed!=null||s.hr!=null);}
function cardioNum(v){const n=parseFloat(v);return isNaN(n)?0:n;}
// "5'30"/km" from minutes and distance
function cardioPace(s){
  const m=cardioNum(s.mins),k=cardioNum(s.km);
  if(!m||!k)return '';
  const pace=m/k,pm=Math.floor(pace),ps=Math.round((pace-pm)*60);
  return `${pm}'${String(ps).padStart(2,'0')}"/km`;
}
function workoutCardio(w){
  let mins=0,km=0,kcal=0;
  ((w&&w.exercises)||[]).forEach(e=>((e&&e.sets)||[]).forEach(s=>{
    if(isCardioSet(s)){mins+=cardioNum(s.mins);km+=cardioNum(s.km);kcal+=cardioNum(s.kcal);}
  }));
  return {mins:Math.round(mins),km:Math.round(km*10)/10,kcal:Math.round(kcal)};
}
function cardioSetLabel(s){
  const p=[];
  if(cardioNum(s.mins))p.push(`${cardioNum(s.mins)} min`);
  if(cardioNum(s.km))p.push(`${cardioNum(s.km)} km`);
  const pace=cardioPace(s);if(pace)p.push(pace);
  if(cardioNum(s.speed))p.push(`${cardioNum(s.speed)} km/h`);
  if(cardioNum(s.incline))p.push(`${cardioNum(s.incline)}% incline`);
  if(cardioNum(s.hr))p.push(`${cardioNum(s.hr)} bpm`);
  if(cardioNum(s.kcal))p.push(`${cardioNum(s.kcal)} kcal`);
  return p.length?p.join(' · '):'—';
}
// Compact variant for tight rows (chips, history best-set)
function cardioSetLabelShort(s){
  const p=[];
  if(cardioNum(s.mins))p.push(`${cardioNum(s.mins)} min`);
  if(cardioNum(s.km))p.push(`${cardioNum(s.km)} km`);
  if(cardioNum(s.kcal))p.push(`${cardioNum(s.kcal)} kcal`);
  return p.length?p.join(' · '):cardioSetLabel(s);
}
// Cardio minutes over a timeframe — the Social tab's cardio currency
function cardioMinsInPeriod(list,timeframe){
  const today=new Date();today.setHours(23,59,59,999);
  let start=new Date(0);
  if(timeframe==='week')start=new Date(today.getTime()-7*86400000);
  else if(timeframe==='month')start=new Date(today.getTime()-30*86400000);
  let mins=0,km=0,kcal=0;
  (list||[]).forEach(w=>{
    if(!w||!w.date)return;
    const d=new Date(w.date+'T00:00:00');
    if(isNaN(d)||d<start||d>today)return;
    const c=workoutCardio(w);mins+=c.mins;km+=c.km;kcal+=c.kcal;
  });
  return {mins:Math.round(mins),km:Math.round(km*10)/10,kcal:Math.round(kcal)};
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

/* ── Exercise Ranks (Wood → Diamond mastery tiers) ─────────
   Levelling is driven by accumulated sets logged for an exercise, so it's
   fair across every movement — no per-exercise weight calibration that
   would make a lateral raise unrankable next to a deadlift. Thresholds are
   tunable here; nothing else needs to change if they move. */
const RANK_TIERS=[
  {name:'Wood',     min:0,   color:'#a67c52', emoji:'🪵'},
  {name:'Bronze',   min:12,  color:'#cd7f32', emoji:'🥉'},
  {name:'Silver',   min:30,  color:'#c0c6cf', emoji:'🥈'},
  {name:'Gold',     min:60,  color:'#f4c542', emoji:'🥇'},
  {name:'Platinum', min:120, color:'#5fd3c4', emoji:'💠'},
  {name:'Diamond',  min:260, color:'#5aa9ff', emoji:'💎'}
];
function tierForSets(sets){
  let idx=0;
  for(let i=0;i<RANK_TIERS.length;i++)if(sets>=RANK_TIERS[i].min)idx=i;
  return {tier:RANK_TIERS[idx],next:RANK_TIERS[idx+1]||null,sets};
}
// Aggregate every logged set by canonical exercise → tier + quick stats.
function exerciseRankStats(){
  const m={};
  W.forEach(w=>(w.exercises||[]).forEach(ex=>{
    const k=canonicalName(ex.name);
    if(!m[k])m[k]={name:k,sets:0,vol:0,maxW:0};
    (ex.sets||[]).forEach(s=>{
      m[k].sets++;
      const wv=getSetWeightVal(s);
      if(wv&&s.reps)m[k].vol+=wv*s.reps;
      if(wv>m[k].maxW)m[k].maxW=wv;
    });
  }));
  return Object.values(m).map(e=>({...e,...tierForSets(e.sets)}))
    .sort((a,b)=>(b.tier.min-a.tier.min)||(b.sets-a.sets));
}
function renderRanks(){
  const el=document.getElementById('rankList');if(!el)return;
  const rows=exerciseRankStats();
  if(!rows.length){el.innerHTML='<p class="rank-empty">Log some sets to start ranking up your exercises.</p>';return;}
  el.innerHTML=rows.map(r=>{
    const t=r.tier,nx=r.next;
    const prog=nx?Math.max(4,Math.min(100,Math.round(((r.sets-t.min)/(nx.min-t.min))*100))):100;
    const sub=nx?`${nx.min-r.sets} more set${nx.min-r.sets===1?'':'s'} → ${nx.name}`:'Max tier reached';
    return `<div class="rank-row">
      <div class="rank-badge" style="border-color:${t.color};box-shadow:0 0 14px ${t.color}44"><span class="rank-emoji">${t.emoji}</span></div>
      <div class="rank-main">
        <div class="rank-head"><span class="rank-name">${esc(r.name)}</span><span class="rank-tier" style="color:${t.color}">${t.name}</span></div>
        <div class="rank-bar"><div class="rank-fill" style="width:${prog}%;background:${t.color}"></div></div>
        <div class="rank-sub">${r.sets} set${r.sets===1?'':'s'}${r.maxW?` · best ${r.maxW}kg`:''} · ${sub}</div>
      </div>
    </div>`;
  }).join('');
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
/* ── Progress Pics (base64 JPEG in RTDB, synced) ─────────── */
let _ppxCache=[];         // last-listed pics for the signed-in user
let _ppxPendingImg=null;  // compressed JPEG data-URI waiting on the compose modal

function ppxReady(){return typeof FirebaseSync!=='undefined'&&FirebaseSync.isConnected&&FirebaseSync.isConnected();}

// Shrink an uploaded photo and re-encode as a JPEG data-URI. Kept small
// because the image is stored in (and downloaded from) the Realtime
// Database, same as avatars — just a larger cap.
function compressToJpeg(file,maxDim,quality){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxDim||h>maxDim){const r=Math.min(maxDim/w,maxDim/h);w=Math.round(w*r);h=Math.round(h*r);}
        const cv=document.createElement('canvas');cv.width=w;cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        try{resolve(cv.toDataURL('image/jpeg',quality));}
        catch(_){reject(new Error('Could not process image'));}
      };
      img.onerror=()=>reject(new Error('Could not read image'));
      img.src=ev.target.result;
    };
    reader.onerror=()=>reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

function renderProgressPics(){
  const grid=document.getElementById('ppxGrid');if(!grid)return;
  if(!ppxReady()){grid.innerHTML='<p class="ppx-empty">Sign in to sync progress pics.</p>';return;}
  grid.innerHTML='<p class="ppx-empty">Loading…</p>';
  FirebaseSync.listProgressPics(fbCfg().userId).then(list=>{
    _ppxCache=list;
    if(!list.length){grid.innerHTML='<p class="ppx-empty">No progress pics yet — tap Add Photo to start your timeline.</p>';return;}
    grid.innerHTML=list.map(p=>`<button class="ppx-thumb" data-pid="${esc(p.pid)}" style="background-image:url('${esc(p.img)}')" type="button">
      <span class="ppx-thumb-tag">${esc(new Date(p.ts).toLocaleDateString('en-US',{month:'short',day:'numeric'}))}</span>
    </button>`).join('');
    grid.querySelectorAll('.ppx-thumb').forEach(el=>el.addEventListener('click',()=>openPpxViewer(el.dataset.pid)));
  }).catch(()=>{grid.innerHTML='<p class="ppx-empty">Could not load pics.</p>';});
}

function bindProgressPics(){
  const addBtn=document.getElementById('ppxAdd');
  const fileIn=document.getElementById('ppxUpload');
  const compBg=document.getElementById('ppxComposeBg');
  const compImg=document.getElementById('ppxPreview');
  const compCap=document.getElementById('ppxCaption');
  const compBw=document.getElementById('ppxBw');
  const compSave=document.getElementById('ppxComposeSave');
  const compCancel=document.getElementById('ppxComposeCancel');
  const viewBg=document.getElementById('ppxViewBg');
  const viewClose=document.getElementById('ppxViewClose');
  if(!addBtn||!fileIn||!compBg||!viewBg)return;

  addBtn.addEventListener('click',()=>{
    if(!ppxReady()){toast('Sign in to add progress pics','error');return;}
    fileIn.click();
  });
  fileIn.addEventListener('change',async e=>{
    const f=e.target.files[0];e.target.value='';if(!f)return;
    try{
      _ppxPendingImg=await compressToJpeg(f,1000,0.75);
      compImg.src=_ppxPendingImg;
      compCap.value='';compBw.value=myBW()||'';
      compBg.classList.add('show');
    }catch(err){toast(err.message||'Could not process image','error');}
  });
  const closeComp=()=>{compBg.classList.remove('show');_ppxPendingImg=null;};
  compCancel.addEventListener('click',closeComp);
  compBg.addEventListener('click',e=>{if(e.target===compBg)closeComp();});
  compSave.addEventListener('click',async()=>{
    if(!_ppxPendingImg)return;
    compSave.disabled=true;compSave.textContent='Saving…';
    try{
      await FirebaseSync.addProgressPic(_ppxPendingImg,{caption:compCap.value.trim(),bw:parseFloat(compBw.value)||0});
      closeComp();toast('Progress pic saved','success');renderProgressPics();
    }catch(err){toast(err.message||'Save failed','error');}
    finally{compSave.disabled=false;compSave.textContent='Save Photo';}
  });

  viewClose.addEventListener('click',()=>viewBg.classList.remove('show'));
  viewBg.addEventListener('click',e=>{if(e.target===viewBg)viewBg.classList.remove('show');});
}

function openPpxViewer(pid){
  const p=_ppxCache.find(x=>x.pid===pid);if(!p)return;
  const viewBg=document.getElementById('ppxViewBg');if(!viewBg)return;
  document.getElementById('ppxViewImg').src=p.img;
  document.getElementById('ppxViewCap').textContent=p.caption||'';
  document.getElementById('ppxViewSub').textContent=`${new Date(p.ts).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}${p.bw?' · '+p.bw+' kg':''}`;
  // Rebuild the delete button so a fresh two-step handler is bound each open.
  const old=document.getElementById('ppxViewDel');
  const del=old.cloneNode(true);old.parentNode.replaceChild(del,old);
  del.textContent='Delete Photo';let armed=false,timer=null;
  del.addEventListener('click',async()=>{
    if(!armed){armed=true;del.textContent='Tap again to confirm';timer=setTimeout(()=>{armed=false;del.textContent='Delete Photo';},4000);return;}
    clearTimeout(timer);del.disabled=true;del.textContent='Deleting…';
    try{await FirebaseSync.deleteProgressPic(p.pid);viewBg.classList.remove('show');toast('Photo deleted');renderProgressPics();}
    catch(err){toast(err.message||'Delete failed','error');del.disabled=false;armed=false;del.textContent='Delete Photo';}
  });
  viewBg.classList.add('show');
}

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
      const fbBioIn=document.getElementById('fbBio');
      const prevId=fbCfg().userId||'';
      const newId=fbMyId.value.trim().toLowerCase();
      // The username doubles as the RTDB node key, so it must be a legal
      // key ([a-z0-9_-], no . $ # [ ] /) — otherwise the cloud write fails
      // silently and a crafted value could inject markup elsewhere.
      if(!newId){toast('Pick a username to sync','error');return;}
      if(!/^[a-z0-9_-]{1,40}$/.test(newId)){
        toast('Username can only use letters, numbers, dashes and underscores','error');
        fbMyId.value=prevId;return;
      }
      // Repointing to a different id moves your cloud node — confirm so a
      // typo doesn't silently orphan your history and followers.
      if(prevId&&newId!==prevId){
        const go=window.confirm(`Change your username from @${prevId} to @${newId}?\n\nYour existing cloud history stays under @${prevId}; @${newId} starts a fresh node and current followers keep following @${prevId}.`);
        if(!go){fbMyId.value=prevId;return;}
      }
      const updateObj={
        userId:newId,
        displayName:fbDisplayName?fbDisplayName.value.trim():'',
        bio:fbBioIn?fbBioIn.value.trim().slice(0,120):'',
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
      renderFollowList();renderSearchResults();renderFriendsCard();renderSuggestions();
      toast(`Following @${id}`,'success');
      fbPush(false);            // publish my new following list (their follower count)
      startRealtimeSync();      // open a live stream on the new friend
      fbPullFollowing(false).then(()=>{renderFollowList();});
    }

    function unfollow(id){
      const cfg=FirebaseSync.getConfig();
      FirebaseSync.updateConfig({following:cfg.following.filter(f=>f.id!==id)});
      stopStream(id);           // or their stream re-adds them to the cache
      removeFriendEntry(id);
      renderFollowList();renderSearchResults();renderFriendsCard();renderSuggestions();
      toast(`Unfollowed @${id}`);
      fbPush(false);
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
      
      const av=safeAvatarUrl(avatarOf(u.id)||u.avatar||'');
      const avatarHtml=av?`<img src="${av}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`:initialOf(u.name||u.id);
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

    // Suggested follows: directory athletes you don't follow yet —
    // people who follow you first, then the most recently active.
    // Rendered in Find Friends and inside the Social empty state.
    function renderSuggestions(){
      const wrap=document.getElementById('suggestList');
      const lab=document.getElementById('suggestLabel');
      const socWrap=document.getElementById('socSuggest');
      if(!wrap&&!socWrap)return;
      const cfg=fbCfg();
      const dir=userDirectory||getDirectoryCache()||[];
      const sugg=dir.filter(u=>u.id!==cfg.userId&&!isFollowing(u.id))
        .sort((x,y)=>{
          const xf=Array.isArray(x.following)&&x.following.includes(cfg.userId)?1:0;
          const yf=Array.isArray(y.following)&&y.following.includes(cfg.userId)?1:0;
          if(xf!==yf)return yf-xf;
          return (y.ts||0)-(x.ts||0);
        }).slice(0,12);
      // Horizontal carousel of athlete cards — several visible at once
      const html=sugg.length?`<div class="sug-row">${sugg.map(u=>{
        const followsMe=Array.isArray(u.following)&&cfg.userId&&u.following.includes(cfg.userId);
        return `<div class="sug-card">
          <div class="sug-avatar" style="background:${avatarBgOf(u.id)}">${avatarHtmlOf(u.id,u.name)}</div>
          <div class="sug-name">${esc(u.name||u.id)}</div>
          <div class="sug-sub">${followsMe?'Follows you':(u.ts?timeAgo(u.ts):'new athlete')}</div>
          <button class="btn btn-primary btn-sm" data-follow="${esc(u.id)}" data-fname="${esc(u.name||'')}">Follow</button>
        </div>`;
      }).join('')}</div>`:'';
      if(wrap){
        wrap.innerHTML=html;
        if(lab)lab.style.display=sugg.length?'block':'none';
        if(sugg.length)bindUserRowButtons(wrap);
      }
      if(socWrap){
        socWrap.innerHTML=html;
        if(sugg.length)bindUserRowButtons(socWrap);
      }
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
            try{userDirectory=await FirebaseSync.listUsers();renderSuggestions();}
            catch(_){searchResults.innerHTML='<p class="search-empty">Could not reach the athlete directory — check your connection.</p>';return;}
          }
          renderSearchResults();
        },250);
      });
    }

    renderFollowList();
    renderSuggestions();

    // Live directory updates (EventSource in listenToDirectory) land here:
    // refresh the search results + follow/follower lists with fresh
    // names, photos and counts.
    dirChangedHook=users=>{
      userDirectory=users;
      renderFollowList();
      renderFollowerList();
      renderSearchResults();
      renderSuggestions();
    };

    // Strava-style: tapping the hero's Followers / Following stats jumps
    // to the matching tab of the Find Friends card.
    const jumpToFollowTab=tab=>{
      const t=followTabs&&followTabs.querySelector(`.seg-tab[data-tab="${tab}"]`);
      if(t)t.click();
      const card=followTabs&&followTabs.closest('.card');
      if(card)card.scrollIntoView({behavior:'smooth',block:'start'});
    };
    [['profFollowers','followers'],['profFollowing','following']].forEach(([id,tab])=>{
      const el=document.getElementById(id);
      const stat=el&&el.parentElement;
      if(stat){stat.style.cursor='pointer';stat.addEventListener('click',()=>jumpToFollowTab(tab));}
    });

    const bFbBackup=document.getElementById('bFbBackup');
    if(bFbBackup)bFbBackup.addEventListener('click',()=>fbPush(true));
    const bFbRestore=document.getElementById('bFbRestore');
    if(bFbRestore)bFbRestore.addEventListener('click',()=>fbRestore(true));
  }

  const copyRulesBtn=document.getElementById('copyFbRules');
  if(copyRulesBtn){
    copyRulesBtn.addEventListener('click',()=>{
      const rules=JSON.stringify({
        rules: {
          gym: {
            // Any signed-in member can read (Strava-style); only the owner
            // (uid) may write, and the payload is validated + size-capped so
            // a hostile client can't store malformed or oversized data.
            $userId: {
              ".read": "auth != null",
              ".write": "auth != null && (data.exists() ? data.child('uid').val() === auth.uid : newData.child('uid').val() === auth.uid)",
              ".validate": "newData.hasChildren(['uid','ts']) && newData.child('uid').val() === auth.uid && newData.child('ts').isNumber()",
              name:   { ".validate": "newData.isString() && newData.val().length <= 60" },
              bio:    { ".validate": "newData.isString() && newData.val().length <= 120" },
              github: { ".validate": "newData.isString() && newData.val().length <= 40" },
              avatar: { ".validate": "newData.isString() && newData.val().length <= 200000" },
              bw:     { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 700" }
            }
          },
          directory: {
            ".read": "auth != null",
            // Writable by the node's owner: self-uid stamp (atomic writes) or
            // the matching gym node's uid (legacy path). Fields are validated.
            $userId: {
              ".write": "auth != null && (newData.child('uid').val() === auth.uid || root.child('gym').child($userId).child('uid').val() === auth.uid)",
              uid:    { ".validate": "newData.val() === auth.uid" },
              name:   { ".validate": "newData.isString() && newData.val().length <= 60" },
              bio:    { ".validate": "newData.isString() && newData.val().length <= 120" },
              avatar: { ".validate": "newData.isString() && newData.val().length <= 200000" },
              bw:     { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 700" },
              ts:     { ".validate": "newData.isNumber()" }
            }
          },
          kudos: {
            ".read": "auth != null",
            $ownerId: { $date: { $likerUid: {
              ".write": "auth != null && auth.uid === $likerUid",
              ".validate": "newData.val() === true"
            } } }
          },
          comments: {
            ".read": "auth != null",
            $ownerId: { $date: { $commentId: {
              ".write": "auth != null && (!data.exists() ? newData.child('uid').val() === auth.uid : data.child('uid').val() === auth.uid)",
              ".validate": "newData.hasChildren(['uid','text','ts']) && newData.child('uid').val() === auth.uid && newData.child('text').isString() && newData.child('text').val().length <= 300 && newData.child('ts').isNumber()"
            } } }
          },
          progress: {
            // Progress pics stored as base64 JPEG (`img`) directly in RTDB —
            // no Cloud Storage / billing. Any member can read; only the owner
            // of that username's gym node may write/delete, the record must
            // stamp their own uid, and `img` is size-capped (~900KB).
            ".read": "auth != null",
            $ownerId: { $picId: {
              ".write": "auth != null && root.child('gym').child($ownerId).child('uid').val() === auth.uid && (!newData.exists() || newData.child('uid').val() === auth.uid)",
              ".validate": "!newData.exists() || (newData.hasChildren(['uid','img','ts']) && newData.child('uid').val() === auth.uid && newData.child('img').isString() && newData.child('img').val().length <= 900000 && newData.child('ts').isNumber())"
            } }
          }
        }
      }, null, 2);
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
  // Only the icon is trusted markup; the message can carry user-controlled
  // text (usernames, error strings) so it goes in as text, never HTML.
  const icon=document.createElement('span');icon.className='toast-icon-svg';icon.innerHTML=svg;
  const body=document.createElement('div');body.textContent=msg;
  t.appendChild(icon);t.appendChild(body);
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

/* ── Timer sound ──────────────────────────────────────────── */
/* The ring must fire even when the app is backgrounded, where browsers
   suspend Web Audio and throttle JS timers. So: starting the timer (a
   user gesture) plays a looping silent WAV through a real <audio>
   element — that keeps the page's audio session alive (and its timers
   running) — and when time's up the ring plays through that same,
   already-unlocked element. Both sounds are synthesized at runtime, no
   audio assets in the bundle. */
const timerSound=(()=>{
  let el=null,ringUrl=null,silenceUrl=null;
  function wavUrl(render,seconds){
    const sr=22050,n=Math.floor(sr*seconds);
    const buf=new ArrayBuffer(44+n*2),v=new DataView(buf);
    const ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    ws(0,'RIFF');v.setUint32(4,36+n*2,true);ws(8,'WAVEfmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
    ws(36,'data');v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++){const s=Math.max(-1,Math.min(1,render(i/sr)));v.setInt16(44+i*2,s*32767,true);}
    return URL.createObjectURL(new Blob([buf],{type:'audio/wav'}));
  }
  // Two rounds of a rising three-note chime (A5 → D6 → G6)
  function getRing(){
    if(!ringUrl)ringUrl=wavUrl(t=>{
      let s=0;
      [[0,880],[0.28,1174.7],[0.56,1568],[1.2,880],[1.48,1174.7],[1.76,1568]].forEach(([at,f])=>{
        const dt=t-at;
        if(dt>0&&dt<0.5)s+=Math.sin(2*Math.PI*f*dt)*0.32*Math.exp(-dt*7);
      });
      return s;
    },2.5);
    return ringUrl;
  }
  function getSilence(){
    if(!silenceUrl)silenceUrl=wavUrl(()=>0,1);
    return silenceUrl;
  }
  function ensureEl(){
    if(!el){el=new Audio();el.setAttribute('playsinline','');el.preload='auto';}
    return el;
  }
  return {
    arm(){ // call from the user gesture that starts/resumes the timer
      try{
        const a=ensureEl();a.loop=true;
        if(a.src!==getSilence())a.src=getSilence();
        a.play().catch(()=>{});
      }catch(_){}
    },
    ring(){
      try{if(navigator.vibrate)navigator.vibrate([300,150,300,150,600]);}catch(_){}
      try{
        const a=ensureEl();a.loop=false;a.src=getRing();
        a.play().catch(()=>{playBeep();});
      }catch(_){playBeep();}
    },
    disarm(){try{if(el){el.pause();el.loop=false;}}catch(_){}}
  };
})();

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
    timerSound.arm();
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
    if(completed){desc.textContent="Time to lift!";timerSound.ring();toast("Rest complete!","success");
      setTimeout(()=>{if(!timerRunning&&timerSecs===0){bar.classList.remove('visible');bar.classList.add('hidden');document.querySelectorAll('.btn-timer-chip').forEach(btn=>btn.classList.remove('active'));}},5000);
    }else{desc.textContent="Paused";timerSound.disarm();}
  }

  function resume() {
    if(timerSecs<=0)return;timerRunning=true;
    timerSound.arm();
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
  reset.addEventListener('click',()=>{if(timerInterval)clearInterval(timerInterval);timerInterval=null;timerEndTime=0;timerSecs=timerTotal;timerRunning=false;timerSound.disarm();updateDisplay();desc.textContent="Reset";playIcon.style.display='block';pauseIcon.style.display='none';});
  close.addEventListener('click',()=>{if(timerInterval)clearInterval(timerInterval);timerInterval=null;timerRunning=false;timerEndTime=0;timerSecs=0;timerTotal=0;timerSound.disarm();bar.classList.remove('visible');bar.classList.add('hidden');document.querySelectorAll('.btn-timer-chip').forEach(btn=>btn.classList.remove('active'));});
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
  if (!dayType || dayType === 'Choose Split...' || dayType === 'Cardio') {container.style.display = 'none';return;}
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
  if (isCardioExercise(exName)) { container.innerHTML = ''; return; }
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


