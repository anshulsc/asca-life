# CLAUDE.md — Asca Gym

Operating rules and architecture for this repository. This is the landing page: read this
first, then [`SETUP.md`](SETUP.md) if the task is backend/rules setup rather than app code.

This file lives in this repo (`anshulsc/asca-life`) because this repo has no other home for
it — a fresh agent session opened directly here (not inside the `Project_Asca` umbrella
folder) has no access to anything outside these files. See the parent
[`../../CLAUDE.md`](../../CLAUDE.md) only for how this app relates to its two siblings
(Vault budget, Asca's Brain); everything about *this* app's own code lives here.

## What this is

A social workout tracker, single-file static web app plus a native SwiftUI port. No build
tool beyond a bundler script, no dependencies, no framework — vanilla JS, one shared Firebase
backend (`asca-gym`), Realtime Database over plain REST (no SDK, so the app stays a static
Pages bundle).

## Commands

```bash
node build.js          # regenerate index.html from src/ — never hand-edit index.html
node test/run.js        # Winter Arc engine tests (dates, streaks, levels) — no DOM, pure fn
node test/rules.js       # diffs database.rules.json against the two in-app "copy rules" literals
git commit -am "..." && git push   # Pages redeploys https://anshulsc.github.io/asca-life/ in ~30s
```

There are no other tests or linters. The Swift app is run by opening `GymTracker.swiftpm` in
Xcode or Swift Playgrounds and pressing Run (unlock PIN: 1234).

**Never edit the top-level `index.html` directly** — it's generated. Edit `src/` and rerun
`node build.js`. `build.js` bundles the CSS, app HTML, and every `src/*.js` file into a base64
JSON payload and emits `index.html` with a boot script that unpacks and injects it at load;
it also pre-renders the login screen's consistency-heatmap dots by evaluating `data.js` at
build time, so workout history is visible before sign-in. There is no payload encryption —
access control is Firebase Auth alone (the login overlay stays until sign-in succeeds,
sessions auto-restore). `style.css` is split into sections by comment markers
(`/* ── Reset & Base`, `/* ── Lock Screen Overlay`, etc.) that `build.js` extracts by name —
preserve those markers when editing.

## Repository layout

```
index.html              # generated — never hand-edit
database.rules.json     # the RTDB rules, source of truth — see SETUP.md
build.js                # bundles src/ → index.html
src/
  index.html             app markup incl. the login-screen overlay
  style.css              all styling, marker-commented sections (see above)
  data.js                EXERCISE_LIBRARY + HISTORICAL_DATA (Anshul's own log — see
                          "Data consistency" below)
  firebase-sync.js        FirebaseSync — auth + RTDB core (see "Backend" below)
  app.js                  all app logic (IIFE, abbreviated names); localStorage under
                          asca_gym_* is a plain cache, RTDB is the source of truth
  winter.js                WinterArc — season/date primitives, pure, no DOM (see below)
  challenges.js             ChallengeEngine — pure challenge-progress engine (see below)
  arc-sync.js               ArcSync — RTDB access for the Winter Arc nodes (see below)
  admin.js, admin.html      maintainer-only dashboard (see below)
test/                    run.js is the entry point; engine.js, ui.js, css.js, rules.js,
                          smoke.js are what it exercises. `node test/run.js` from repo root.
tools/gen-rules-literal.py  regenerates the two in-app rules literals from database.rules.json
admin/index.html         served admin console (built separately from admin.js/admin.html)
GymTracker.swiftpm/      native SwiftUI port — see "Swift app" below
```

## Backend (`src/firebase-sync.js`)

Firebase Auth (email/password) + Realtime Database (`asca-gym-default-rtdb.firebaseio.com`,
`FIREBASE_RTDB_URL`), both over plain REST. **One shared backend for all users** —
`FIREBASE_PROJECT_ID`/`FIREBASE_API_KEY` are hardcoded at the top of this file; until filled
in, the module is inert and the login screen shows "Backend not configured." Usernames map to
synthetic `<name>@asca-gym.app` emails (an input containing `@` passes through as a real
email); auth tokens persist in `localStorage` (`asca_gym_auth`) with automatic refresh via the
securetoken endpoint, and `restoreSession()` returns `'offline'` for a cached session with no
network, which still unlocks the app with cached data.

**`gym/{syncId}`** — one node per user: `{uid, ts, name, avatar, bio, github, following: [ids],
workouts}`.
- `avatar` — base64 JPEG data-URI, canvas-cropped to 120px.
- `bio` — ≤120-char tagline.
- `bw` — latest logged body weight in kg; feeds the **ASCA Score** (weekly volume ÷ body
  weight, `ascaScore()` in `app.js`) rendered as the hero avatar's conic gauge ring + pill, the
  default leaderboard metric, a radar axis, and the first mini-profile stat. 75 kg is assumed
  and marked ≈ when unlogged.
- `workouts` — **stored day-wise**: `{"YYYY-MM-DD": {dayType, exercises: [{name, sets:
  [{weight, reps, notes}]}]}}`, directly browsable in the RTDB console. `writeDoc({ts,
  workouts})` converts the in-app array to this map; `readDoc`/`normalizeDocData` convert back,
  tolerating RTDB's array→object coercion and dropped `null`s. Old pre-RTDB docs hold a
  gzip+base64 `blob` instead — `cloudPayload()` in `app.js` decodes those on read
  (`decodeProgressCode` survives only for this).

**`directory/{syncId}`** — `{name, ts, avatar, bio, following}`, so `listUsers()` can list
everyone — with photos and follower counts — without downloading workout data.
`listenToDirectory()` in `app.js` keeps one `EventSource` on the whole node so renames, new
photos and follow changes propagate live (cached in `asca_gym_directory_cache`, surfaced via
`dirChangedHook` into the Find Friends UI). Follower counts come from scanning cached
`following` arrays across both caches; follow/unfollow immediately `fbPush`.

**Live sync**: `startRealtimeSync`/`listenToDoc` in `app.js` stream over `EventSource` — my
node plus every followed node, restarting on tab visibility. `fbPush` runs after every save +
on unlock; `fbRestore` union-merges with local winning (fills fresh browsers).
`canSeedHistorical()` stops `HISTORICAL_DATA` (Anshul's own log) from seeding other users'
accounts — only usernames starting with `anshul` get it.

Access is gated by RTDB rules (`database.rules.json` — read requires sign-in, write requires
owning `uid`). **The rules document is shared with the sibling Vault app and publishing either
replaces the whole document — see [`SETUP.md`](SETUP.md) before touching rules.**

Google Sheets sync was removed from the web app entirely (no `sheets-sync.js`, no
Sheets/progress-code UI). The Google Sheet itself still exists for the xlsx workflow and the
Swift app — see "Data consistency" below.

## Social model

Strava-style following, not a closed friend list. Settings tab is "My Account": an
athlete-profile hero card (conic-gradient avatar ring, open stat row, collapsible edit-profile
form), a Find Friends card (search + following list), and an Account card (sign out,
backup/restore, maintainer guide). `config.following` is `[{id, name}]`; `fbPullFollowing`
fetches every followed node in parallel into the friends cache (`asca_gym_friends_cache`,
shape `{ts, friends:{id:{ts,name,workouts}}}`, special ids `_code`/`_sheet` for offline
imports). Insights renders a 7-day leaderboard (me + followed, ranked by volume) plus a
recent-activity feed. A shared `avatarOf`/`avatarHtmlOf` helper renders photo avatars (falling
back to gradient initials) everywhere a user appears.

## Winter Arc (`winter.js`, `challenges.js`, `arc-sync.js`)

A season/challenge layer on top of the base tracker, added after the architecture above was
first written and not previously documented at this level — the source files' own header
comments are thorough and are the primary reference; this is only an index into them.

- **`winter.js` — `WinterArc` global.** Season, theme and date primitives. Everything in the
  app keys off a local `"YYYY-MM-DD"` string rather than `Date`/UTC arithmetic specifically
  because `toISOString()` was once silently wrong across a UTC offset boundary — see the file's
  own comment. Loaded before `app.js`.
- **`challenges.js` — `ChallengeEngine` global.** The challenge-progress engine. Deliberately
  pure — no DOM, no fetch, no `localStorage`, no `Date.now()` of its own (`now` is always
  passed in) — which is what lets `node test/engine.js` exercise it and what makes a
  day-rollover reproducible. Progress is always **recomputed from scratch**, never
  incremented, so editing or deleting a past workout re-derives correctly. Mirrors two
  set-level helpers from `app.js` on purpose (that IIFE exposes neither) — `test/engine.js`
  asserts the mirrors stay exact.
- **`arc-sync.js` — `ArcSync` global.** RTDB access for four new nodes: `arc/{userId}/{seasonId}`
  (private), `arcPublic/{userId}/{seasonId}` (member-readable projection — streak/level/
  xp plus deliberately-social per-habit aggregates; never check-in notes, body weight or
  set-level workout detail), `challenges/{cid}`
  (shared definitions), `challengeMembers/{cid}/{userId}` (each user writes only their own
  key). **Never calls `FirebaseSync.writeDoc()`** — that would replace the entire `gym/{id}`
  node on a single quick-add. Every write is a targeted PATCH to a specific subpath instead.

`node test/run.js` is the entry point for exercising this layer; the app has no other test
runner and, per `test/run.js`'s own comment, that's staying that way — these pure functions
are what's worth testing, not the DOM.

## Admin console (`admin.js`, `admin.html`, `admin/`)

A maintainer-only dashboard (`ADMIN_PREFIXES = ['anshul']`) that reuses `firebase-sync.js` for
auth + reads and lists every athlete's profile, workouts and activity. Gates the console UI
only — the RTDB rules already let any signed-in account read the directory and each
`gym/{id}` node over REST, so this is a convenience surface, not an additional access
boundary.

## Swift app (`GymTracker.swiftpm/`)

Native SwiftUI reimplementation for iOS/macOS, mirroring the web app's features and the
Google Sheets integration (not the Firebase one — see "Data consistency"). Key layout:
`Sources/Models/AppState.swift` (storage, routines, timers, RC4 encryption of saved
sessions), `Sources/Services/SheetsSyncService.swift` (same Sheets read/Apps Script write
pattern as the web app used to have), `Sources/Views/` split by tab (Log, History, Insights,
Settings) plus `Sources/Views/Components/` for custom drawing (LineChart, LiquidLensTabBar,
glass effects). Ignore the `.build/` directory. Run by opening the package in Xcode or Swift
Playgrounds (unlock PIN: 1234).

## Data consistency

Historical workout data exists in **three** places kept in sync by hand, two of which are
outside this repo:

1. `src/data.js` (`HISTORICAL_DATA`, this repo) — what the deployed web app actually seeds.
2. `add_gym_sheet.py` (in the parent `Project_Asca/` folder, a sibling to this repo, not
   inside it) — regenerates the "Gym Log" sheet in `Asca's Life.xlsx` from the same history.
3. The live Google Sheet (spreadsheet ID hardcoded in `Sources/Services/SheetsSyncService.swift`
   above) — the web app no longer talks to it; the Swift app still does.

Live workout data (as opposed to this seeded history) now also accumulates independently in
`gym/{syncId}/workouts/{date}` in the Realtime Database and isn't part of this manual-sync
set. When adding or correcting *historical* workouts, check all three. If this repo is checked
out standalone (not inside the `Project_Asca` umbrella folder), item 2 won't be present at
all — that's expected, not broken; there's simply nothing to keep in sync in that context.

## Known gap

`admin.js`/`admin.html`/`admin/` and the Winter Arc trio existed in this repo before this file
did. The sections above are accurate as far as they go (sourced from each file's own header
comment, not guessed), but none of it has had the same design-review-level pass the rest of
this doc has — if you touch these subsystems and learn something this file gets wrong or
misses, fix it in the same commit rather than carrying the gap forward.
