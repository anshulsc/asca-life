/* ═══════════════════════════════════════════════════════════════
   WRAPPED — year/season story viewer (Spotify-Wrapped-style)

   Pure-data computation + a small full-screen viewer. Loaded inside
   the IIFE chain by build.js — payload key order: css → html → data →
   winter → challenges → fsync → arcSync → wrapped → app. app.js is the
   only file that *invokes* anything here: openWrapped('year'|'season').

   Kept pure so test/wrapped.js can exercise compute() in Node without
   a DOM, matching the codebase's winter.js/challenges.js precedent.

   Data sources (all already in-app; no new RTDB nodes):
     ∀:    W (workouts), ARC (arc state), bodyweight { weight, ts }
     year: every w with date in [startDate, endDate]
     season: w/checkins/scope whose date is inside the live WinterArc
             season, computed via WinterArc.season()

   Card order is authored for narrative: arrival → effort → constancy →
   strength → body → highlights → coda. Coda hosts the one shareable
   PNG; nothing uploads — image is generated and handed to the native
   share sheet, or saved as a download, and dropped.
   ═══════════════════════════════════════════════════════════════ */
const Wrapped = (() => {
  'use strict';

  /* ── Data layer (pure) ──────────────────────────────────── */

  function dayKey(d) { return WinterArc.dateStr(d); }
  function inRange(dateStr, start, end) {
    return dateStr >= start && dateStr <= end;  // YYYY-MM-DD strings sort
  }
  function startOfYear(y) { return `${y}-01-01`; }
  function endOfYear(y) { return `${y}-12-31`; }
  function dayOfWeekName(dateStr) {
    return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][WinterArc.parseDay(dateStr).getDay()];
  }
  function monthName(dateStr) {
    return ['January','February','March','April','May','June','July','August','September','October','November','December'][WinterArc.parseDay(dateStr).getMonth()];
  }

  // Wrapped is data-pure. These look like restating helpers from app.js —
  // wrapped.js deliberately deliberately doesn't reach outward; a Wrapped
  // number that disagrees with the rest of the app is the exact failure this
  // prevents by being computed the same way here.
  function setWeightVal(s) { return parseFloat(s && (s.weight || s.kg || s.notes && s.notes.match(/level\s+(\d+)/i)?.[1])) || 0; }
  function canonName(n) { return String(n || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function muscleOfName(n) {
    const key = canonName(n);
    const map = {
      'bench press':'push','incline bench press':'push','overhead press':'push','shoulder press':'push','dips':'push','push up':'push','pushup':'push','pec deck':'push',
      'deadlift':'pull','barbell row':'pull','seated row':'pull','lat pulldown':'pull','pull up':'pull','pullup':'pull','chin up':'pull','face pull':'pull','shrug':'pull',
      'squat':'legs','leg press':'legs','hack squat':'legs','romanian deadlift':'legs','rdl':'legs','lunge':'legs','leg curl':'legs','leg extension':'legs','calf raise':'legs','hip thrust':'legs',
      'plank':'core','crunch':'core','leg raise':'core','russian twist':'core','ab wheel':'core',
      'run':'cardio','treadmill':'cardio','cycling':'cardio','bike':'cardio','rows':'cardio','stairmaster':'cardio','elliptical':'cardio','swim':'cardio'
    };
    if (map[key]) return map[key];
    for (const k in map) if (key.includes(k)) return map[k];
    return null;
  }

  function sessionVol(w) {
    let v = 0;
    (w.exercises || []).forEach(ex => (ex.sets || []).forEach(s => {
      const wv = setWeightVal(s);
      if (wv && s.reps) v += wv * s.reps;
    }));
    return v;
  }
  function sessionSets(w) {
    return (w.exercises || []).reduce((s, ex) => s + ((ex.sets || []).length), 0);
  }

  // Longest consecutive-day run of workout dates in [start, end).
  function longestWorkoutStreak(dates) {
    if (!dates.length) return 0;
    let best = 1, cur = 1, prev = WinterArc.parseDay(dates[0]);
    for (let i = 1; i < dates.length; i++) {
      const d = WinterArc.parseDay(dates[i]);
      const gap = (d - prev) / (24 * 3600 * 1000);
      if (gap === 1) { cur++; if (cur > best) best = cur; }
      else if (gap > 1) { cur = 1; }
      prev = d;
    }
    return best;
  }

  // The shared calculator. `scope` is a {start, end, label} object; the
  // caller passes all app data in so this stays unit-testable. Returns
  // everything every card needs; card renderers read by name.
  function compute(scope, W, ARC, bwNow) {
    const scoped = (W || []).filter(w => w && w.date && inRange(w.date, scope.start, scope.end) && w.dayType !== 'Rest Day');
    const dates = scoped.map(w => w.date).sort();

    let volume = 0, sets = 0, cardioMin = 0;
    const exerciseCount = {};
    const exercisePRs = {};
    const muscleVol = {};
    const dayTypeCount = {};
    const monthCount = new Array(12).fill(0);
    const weekdayCount = new Array(7).fill(0);

    scoped.forEach(w => {
      monthCount[WinterArc.parseDay(w.date).getMonth()]++;
      weekdayCount[WinterArc.parseDay(w.date).getDay()]++;
      dayTypeCount[w.dayType] = (dayTypeCount[w.dayType] || 0) + 1;
      volume += sessionVol(w);
      sets += sessionSets(w);
      (w.exercises || []).forEach(ex => {
        const name = canonName(ex.name);
        exerciseCount[name] = (exerciseCount[name] || 0) + (ex.sets || []).length;
        (ex.sets || []).forEach(s => {
          const wv = setWeightVal(s);
          if (wv && (!exercisePRs[name] || wv > exercisePRs[name])) exercisePRs[name] = wv;
        });
        const mg = muscleOfName(ex.name);
        if (mg) muscleVol[mg] = (muscleVol[mg] || 0) + sessionVol({ exercises: [ex] });
      });
    });

    const prs = Object.entries(exercisePRs).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const favSplit = Object.entries(dayTypeCount).sort((a, b) => b[1] - a[1])[0] || ['No data', 0];
    const busiestMonthIdx = monthCount.indexOf(Math.max(...monthCount));
    const busiestDowIdx = weekdayCount.indexOf(Math.max(...weekdayCount));
    const longestSession = scoped.slice().sort((a, b) => sessionSets(b) - sessionSets(a))[0] || null;

    // Arc-window subset (only when scope.seasonId given)
    let arcSum = null;
    if (scope.seasonId && typeof ChallengeEngine !== 'undefined' && ARC && ARC.enrolled) {
      // Feed the engine only the in-window checkins; this keeps the Wrapped
      // numbers honest about "inside this season" regardless of when run.
      const scopedCheckins = {};
      Object.entries(ARC.checkins || {}).forEach(([d, c]) => { if (inRange(d, scope.start, scope.end)) scopedCheckins[d] = c; });
      arcSum = ChallengeEngine.summary({
        workouts: scoped, checkins: scopedCheckins, goals: ARC.goals,
        season: WinterArc.season(scope.seasonId), freezeUsed: (ARC.streak && ARC.streak.freezeUsed) || {},
        now: WinterArc.parseDay(scope.end), challenges: ARC.customChallenges
      });
    }

    return {
      scope,
      sessions: scoped.length,
      volume, sets, cardioMin,
      longestStreak: longestWorkoutStreak(dates),
      weeks: Math.max(1, Math.round((WinterArc.parseDay(scope.end) - WinterArc.parseDay(scope.start)) / (7 * 24 * 3600 * 1000))),
      topExercise: Object.entries(exerciseCount).sort((a, b) => b[1] - a[1])[0] || null,
      favSplit, busiestMonth: monthCount[busiestMonthIdx] > 0 ? { name: monthName(`${scope.start.slice(0, 4)}-${String(busiestMonthIdx + 1).padStart(2, '0')}-01`), n: monthCount[busiestMonthIdx] } : null,
      busiestDay: weekdayCount[busiestDowIdx] > 0 ? { name: ['Sundays','Mondays','Tuesdays','Wednesdays','Thursdays','Fridays','Saturdays'][busiestDowIdx], n: weekdayCount[busiestDowIdx] } : null,
      longestSession,
      prs,
      muscleVol,
      bwNow: bwNow || null,
      arc: arcSum ? {
        xp: arcSum.xp, level: arcSum.level.level,
        streak: arcSum.streak, day: arcSum.day,
        challengesDone: arcSum.challenges.filter(c => c.done).length,
        badges: arcSum.badges
      } : null
    };
  }

  /* ── Narrative copy ─────────────────────────────────────── */

  // "You showed up 127 times in 2026" or "You showed up 34 times on the arc".
  function heroLine(d) {
    const range = d.scope.label;
    const sess = d.sessions;
    if (!sess) return `Nothing recorded ${range === 'this arc' ? 'here' : 'this year'} — your first session starts this story.`;
    return `You showed up ${sess} time${sess === 1 ? '' : 's'} ${range}.`;
  }
  function heroSub(d) {
    if (!d.sessions) return '';
    const v = d.volume >= 10000 ? `${Math.round(d.volume / 1000)}k` : Math.round(d.volume);
    return `${v.toLocaleString()} kg lifted · ${d.sets.toLocaleString()} sets`;
  }
  function consistencyTitle(d) { return `${d.longestStreak} ${d.longestStreak === 1 ? 'day' : 'days'} straight`; }
  function consistencySub(d) {
    if (!d.sessions) return '';
    const per = (d.sessions / Math.max(d.weeks, 1)).toFixed(1);
    return `${per} sessions/week on average across ${d.weeks} weeks`;
  }
  function strengthTitle(d) {
    if (!d.prs.length) return 'No heavy singles yet — log a PR to see it here.';
    const [name, w] = d.prs[0];
    return `${name} — ${w.toLocaleString()} kg`;
  }
  function strengthSub(d) {
    return d.prs.length > 1 ? `and a ${d.prs[1][1]} kg ${d.prs[1][0]} behind it` : 'keep chasing it';
  }
  function muscleLabel(mg) { return { push: 'Push', pull: 'Pull', legs: 'Legs', core: 'Core', cardio: 'Cardio' }[mg] || mg; }
  function bodyTitle(d) {
    return d.bwNow ? `${d.bwNow.weight} kg today` : 'Body weight never logged.';
  }
  function bodySub(d) { return d.bwNow ? 'the number behind everything else' : 'add one in Log tab — this card blooms when you do'; }
  function highlights(d) {
    const items = [];
    if (d.topExercise) items.push({ k: 'Workhorse', v: `${d.topExercise[0]} · ${d.topExercise[1]} sets` });
    if (d.favSplit && d.favSplit[1]) items.push({ k: 'Favorite split', v: `${d.favSplit[0]} · ${d.favSplit[1]}d` });
    if (d.busiestDay) items.push({ k: 'Your day', v: `${d.busiestDay.name} · ${d.busiestDay.n}x` });
    if (d.busiestMonth) items.push({ k: 'Peak month', v: `${d.busiestMonth.name} · ${d.busiestMonth.n} sessions` });
    if (d.longestSession) items.push({ k: 'Longest session', v: `${sessionSets(d.longestSession)} sets · ${dayOfWeekName(d.longestSession.date)}` });
    if (d.arc) items.push({ k: 'Winter Arc', v: `Level ${d.arc.level} · ${d.arc.xp.toLocaleString()} xp · ${d.arc.streak.current}d streak` });
    return items.slice(0, 5);
  }
  function codaLine(d) {
    if (!d.sessions) return 'One logged session is enough to start this story.';
    if (d.busiestMonth && d.busiestMonth.name === monthName(WinterArc.dateStr(new Date()))) return `This month is your strongest yet. Keep going.`;
    if (d.longestStreak >= 7) return `${d.longestStreak} days unbroken. Whatever comes next has to beat that.`;
    return 'Consistency beats intensity. Your numbers already know that.';
  }

  /* ── DOM layer ──────────────────────────────────────────── */

  const ACCENTS = ['#FF7600', '#0A84FF', '#30D158', '#BF5AF2', '#64D2FF', '#FF375F'];

  let overlay = null;
  let open = false;
  let idx = 0;
  let cards = [];
  let scope = null;
  let data = null;
  let bwNow = null;
  let touchStartX = 0;
  /* Story deck playback.
     Auto-advance: each slide has SLIDE_MS of pure show time.
     Progress bar lives in .wrap-dots (per-slide segment widths animate).
     Hold-to-pause: pointerdown pauses, pointerup resumes. Hold duration
     is reconciled against slideStart. */
  const SLIDE_MS = 5200;
  let slideTimer = null, slideStart = 0, paused = false, pausedAt = 0;
  function clearTimer(){ if(slideTimer) clearTimeout(slideTimer); slideTimer = null; }
  function startClock(){
    clearTimer();
    if (prm()) return; /* honor prefers-reduced-motion: stop auto-advance. */
    slideStart = performance.now();
    slideTimer = setTimeout(() => {
      if (paused) return;
      if (idx < cards.length - 1) go(+1);
      else closeWrapped(); /* last slide: auto-advance past the end = close. */
    }, SLIDE_MS);
    /* The .on segment's ::before bar animates SLIDE_MS of width change. */
    paintProgress();
  }
  function pauseClock(){
    if (!slideTimer || paused) return;
    paused = true; pausedAt = performance.now();
    clearTimer();
    if (overlay) overlay.classList.add('is-paused');
    paintProgress();
  }
  function resumeClock(){
    if (!paused) return;
    paused = false;
    /* Remaining time in the slide: SLIDE_MS - how long we already watched. */
    const elapsed = pausedAt - slideStart;
    const left = Math.max(680, SLIDE_MS - elapsed); /* even a 0s resume gets a breath */
    slideStart = performance.now() - (SLIDE_MS - left);
    slideTimer = setTimeout(() => {
      if (paused) return;
      if (idx < cards.length - 1) go(+1);
      else closeWrapped();
    }, left);
    if (overlay) overlay.classList.remove('is-paused');
    paintProgress();
  }
  function paintProgress(){
    const dots = document.getElementById('wrapDots');
    if (!dots) return;
    const nowPaused = paused;
    const elapsed = paused ? (pausedAt - slideStart) : (performance.now() - slideStart);
    const remaining = Math.max(0, SLIDE_MS - elapsed);
    dots.querySelectorAll('.wrap-dot').forEach((d, i) => {
      d.classList.toggle('on', i === idx);
      d.classList.toggle('done', i < idx);
      if (i === idx) {
        const bar = d.querySelector('.wrap-dot-bar');
        if (!bar) return;
        if (nowPaused || prm()) {
          /* Freeze the bar wherever it is. */
          const frozen = getComputedStyle(bar).width;
          bar.style.transition = 'none';
          bar.style.width = frozen;
        } else {
          /* First run of this slide after any manual/auto start. Restart at
             the current fraction, then animate linearly to 100% for the
             time left in the slide. */
          const startPct = Math.min(100, (elapsed / SLIDE_MS) * 100);
          bar.style.transition = 'none';
          bar.style.width = startPct.toFixed(2) + '%';
          void bar.offsetWidth;
          bar.style.transition = `width ${remaining}ms linear`;
          bar.style.width = '100%';
        }
      }
    });
  }

  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'wrappedOverlay';
    overlay.className = 'wrapped-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="wrap-stage" id="wrapStage"></div>
      <div class="wrap-dots"  id="wrapDots"></div>
      <button class="wrap-close" id="wrapClose" aria-label="Close">✕</button>
      <button class="wrap-nav wrap-prev" id="wrapPrev" aria-label="Previous">‹</button>
      <button class="wrap-nav wrap-next" id="wrapNext" aria-label="Next">›</button>
      <button class="wrap-share btn" id="wrapShare">Share card</button>
    `;
    document.body.appendChild(overlay);
    document.getElementById('wrapClose').addEventListener('click', closeWrapped);
    document.getElementById('wrapPrev').addEventListener('click', () => go(-1));
    document.getElementById('wrapNext').addEventListener('click', () => go(+1));
    document.getElementById('wrapShare').addEventListener('click', shareCard);
    // tap-half nav, less obstructive on tiny phones
    overlay.addEventListener('click', e => {
      if (e.target.closest('button, .wrap-close')) return;
      const r = overlay.getBoundingClientRect();
      if (e.clientX < r.width * 0.4) go(-1);
      else if (e.clientX > r.width * 0.6) go(+1);
    });
    /* Hold-to-pause: press anywhere that's not a button. The release
       re-arms the slide timer for whatever time was left. */
    overlay.addEventListener('pointerdown', e => {
      if (e.target.closest('button, .wrap-close')) return;
      touchStartX = e.clientX;
      pauseClock();
    });
    overlay.addEventListener('pointerup',   e => {
      if (e.target.closest('button, .wrap-close')) return;
      const dx = e.clientX - touchStartX;
      resumeClock();
      if (Math.abs(dx) > 40) go(dx < 0 ? +1 : -1);
    });
    overlay.addEventListener('pointercancel', () => resumeClock());
    // keyboard
    document.addEventListener('keydown', e => {
      if (!open) return;
      if (e.key === 'Escape') closeWrapped();
      else if (e.key === 'ArrowLeft')  go(-1);
      else if (e.key === 'ArrowRight') go(+1);
      else if (e.key === ' ') { e.preventDefault(); paused ? resumeClock() : pauseClock(); }
    });
  }

  function makeCards() {
    const accent = i => ACCENTS[i % ACCENTS.length];
    cards = [
      {
        accent: accent(0),
        eyebrow: scope.label,
        title: heroLine(data),
        sub:   heroSub(data),
        graphic: () => bigNumber(data.sessions, 'sessions')
      },
      {
        accent: accent(1),
        eyebrow: 'Consistency',
        title: consistencyTitle(data),
        sub:   consistencySub(data),
      },
      {
        accent: accent(2),
        eyebrow: 'Strength',
        title: strengthTitle(data),
        sub:   strengthSub(data),
        graphic: () => muscleRing(data.muscleVol)
      },
      {
        accent: accent(3),
        eyebrow: 'Body',
        title: bodyTitle(data),
        sub:   bodySub(data),
      },
      {
        accent: accent(4),
        eyebrow: 'Highlights',
        title: '',
        sub:   '',
        list:  highlights(data),
      },
      {
        accent: scope.kind === 'season' ? 'var(--arc-ember, #A8724A)' : accent(5),
        eyebrow: scope.kind === 'season' ? 'Close of chapter' : 'The story so far',
        title: codaLine(data),
        sub:   'tap Share to keep this one',
      },
    ];
  }

  function bigNumber(n, label) {
    return `<div class="wrap-bignum">${n.toLocaleString()}<span>${esc(label)}</span></div>`;
  }

  function muscleRing(mv) {
    const entries = Object.entries(mv).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (!entries.length) return '';
    const total = entries.reduce((s, [, v]) => s + v, 0);
    const SEG_COLORS = ['#FF7600', '#30D158', '#0A84FF', '#BF5AF2'];
    let acc = 0;
    const segs = entries.map(([mg, v], i) => {
      const pct = Math.round((v / total) * 100);
      const from = acc; acc += v;
      const to = acc;
      return `${SEG_COLORS[i]} ${Math.round((from / total) * 360)}deg ${Math.round((to / total) * 360)}deg`;
    });
    return `<div class="wrap-ring" style="background: conic-gradient(${segs.join(',')})">
      <div class="wrap-ring-hole"></div></div>
      <div class="wrap-ring-legend">${entries.map(([mg], i) => `<span><i style="background:${SEG_COLORS[i]}"></i>${muscleLabel(mg)}</span>`).join('')}</div>`;
  }

  function renderCard() {
    /* Manual ↔ auto sequencing: a direct go() unpauses and re-arms the
       slide timer so the new card gets its full window. */
    if (paused) { paused = false; if (overlay) overlay.classList.remove('is-paused'); }
    clearTimer();
    const c = cards[idx];
    const stage = document.getElementById('wrapStage');
    document.getElementById('wrapDots').innerHTML = cards.map((_, i) =>
      `<span class="wrap-dot${i === idx ? ' on' : ''}${i < idx ? ' done' : ''}"><span class="wrap-dot-bar"></span></span>`).join('');
    document.getElementById('wrapPrev').style.opacity = idx === 0 ? 0.25 : 1;
    document.getElementById('wrapNext').style.opacity = idx === cards.length - 1 ? 0.25 : 1;
    document.getElementById('wrapShare').style.display = idx === cards.length - 1 ? '' : 'none';

    stage.innerHTML = `
      <div class="wrap-card" style="--wrap-accent:${c.accent}">
        <div class="wrap-eyebrow">${esc(c.eyebrow)}</div>
        ${c.title ? `<div class="wrap-title" id="wrapTitle">${esc(c.title)}</div>` : ''}
        ${c.sub   ? `<div class="wrap-sub">${esc(c.sub)}</div>` : ''}
        ${c.graphic ? c.graphic() : ''}
        ${c.list ? `<div class="wrap-list">${c.list.map(it => `<div class="wrap-li"><span class="k">${esc(it.k)}</span><span class="v">${esc(it.v)}</span></div>`).join('')}</div>` : ''}
      </div>`;

    // count-up just the hero number — the one stat that deserves a flourish
    const big = stage.querySelector('.wrap-bignum');
    if (big && !prm()) {
      const n = parseInt(big.childNodes[0].textContent.replace(/,/g, ''), 10);
      if (Number.isFinite(n) && n > 0) countUp(big.childNodes[0], n);
    }
    startClock();
  }

  function countUp(textNode, target) {
    const start = performance.now(), dur = 650;
    function tick(now) {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
      textNode.textContent = Math.round(target * eased).toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function go(delta) {
    if (!open) return;
    idx = Math.max(0, Math.min(cards.length - 1, idx + delta));
    renderCard();
  }

  function openWrapped(which) {
    ensureOverlay();
    const start = which === 'season'
      ? (() => { const s = WinterArc.season(); return s ? { start: s.start, end: Math.min(WinterArc.dateStr(new Date()), s.end), kind: 'season', label: 'on this arc', seasonId: s.id } : null; })()
      : (y => ({ start: startOfYear(y), end: endOfYear(y), kind: 'year', label: `in ${y}` }))(new Date().getFullYear());
    if (!start) return;
    scope = start;
    bwNow = typeof getBodyWeight === 'function' ? getBodyWeight() : null;
    data = compute(scope, typeof W !== 'undefined' ? W : [], typeof ARC !== 'undefined' ? ARC : null, bwNow);
    makeCards();
    idx = 0;
    open = true;
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderCard();
  }

  function closeWrapped() {
    if (!overlay) return;
    clearTimer();
    open = false;
    paused = false;
    overlay.classList.remove('open', 'is-paused');
    document.body.style.overflow = '';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function prm() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  }

  /* ── Share PNG ────────────────────────────────────────────
     Drawn on a transient <canvas> — no upload anywhere. */

  // Footer handle: the signed-in user's own identity, @-prefixed —
  // prefer the sync/account id, fall back to the display name.
  function shareHandle() {
    const cfg = (typeof FirebaseSync !== 'undefined' && FirebaseSync.getConfig)
      ? FirebaseSync.getConfig() : {};
    const id = String(cfg.userId || cfg.displayName || 'athlete');
    return '@' + id.replace(/^@/, '');
  }

  function drawShareCard() {
    const Wc = 1080, Hc = 1920;
    const cv = document.createElement('canvas');
    cv.width = Wc; cv.height = Hc;
    const g = cv.getContext('2d');

    const accent = (cards[0] && cards[0].accent) || '#FF7600';
    const bg = '#020407';
    const fg = '#E9EDF1';

    g.fillStyle = bg; g.fillRect(0, 0, Wc, Hc);

    // soft radial ground
    const rg = g.createRadialGradient(Wc / 2, Hc * 0.28, 0, Wc / 2, Hc * 0.28, Hc * 0.6);
    rg.addColorStop(0, `${accent}33`);
    rg.addColorStop(1, 'transparent');
    g.fillStyle = rg; g.fillRect(0, 0, Wc, Hc);

    // hairline frame
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2;
    g.strokeRect(70, 70, Wc - 140, Hc - 140);

    g.textAlign = 'center';

    // brand
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = '600 40px "Plus Jakarta Sans", sans-serif';
    g.fillText('ASCA GYM', Wc / 2, 170);
    // season/year tag
    g.fillStyle = accent;
    g.font = '600 34px "Outfit", sans-serif';
    g.fillText(scope.label.toUpperCase(), Wc / 2, 230);

    // hero number
    g.fillStyle = fg;
    g.font = '900 340px "Outfit", sans-serif';
    g.fillText(String(data.sessions), Wc / 2, 720);
    g.font = '600 60px "Plus Jakarta Sans", sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(data.sessions === 1 ? 'session' : 'sessions', Wc / 2, 830);

    // secondary stats
    g.font = '500 44px "Plus Jakarta Sans", sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    const lines = [
      `${Math.round(data.volume).toLocaleString()} kg lifted`,
      `${data.sets.toLocaleString()} sets`,
      `${data.longestStreak} day best streak`,
    ].filter(Boolean);
    lines.forEach((l, i) => g.fillText(l, Wc / 2, 980 + i * 80));

    // plateaus
    const hl = highlights(data).slice(0, 3);
    g.font = '500 36px "Plus Jakarta Sans", sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.6)';
    hl.forEach((it, i) => g.fillText(`${it.k} — ${it.v}`, Wc / 2, 1320 + i * 60));

    // footer
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.font = '500 30px "Plus Jakarta Sans", sans-serif';
    g.fillText(scope.kind === 'season' ? 'winter arc' : `${scope.start.slice(0, 4)}`, Wc / 2, Hc - 210);
    g.fillStyle = accent;
    g.font = '700 32px "Outfit", sans-serif';
    g.fillText(shareHandle(), Wc / 2, Hc - 160);

    return cv;
  }

  async function shareCard() {
    try {
      const cv = drawShareCard();
      cv.toBlob(async blob => {
        const name = scope.kind === 'season' ? 'winter-arc' : `wrapped-${scope.start.slice(0, 4)}`;
        const file = new File([blob], `asca-${name}.png`, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Asca Gym Wrapped' });
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = file.name;
          a.click();
          URL.revokeObjectURL(a.href);
        }
      }, 'image/png');
    } catch (_) {
      /* canvas tainted / share API absent — fail quietly, no upload happened */
    }
  }

  return Object.freeze({
    openWrapped, closeWrapped,
    compute,                       // exposed for test/wrapped.js
    _internal: {                   // test-only handles — no production use
      heroLine, heroSub, consistencyTitle, codaLine, highlights,
      longestWorkoutStreak, sessionVol, sessionSets
    }
  });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Wrapped;
