# Asca Gym V2 — Design Overhaul

Research synthesis (Sept 2026) and implementation plan for the V2 redesign.

Direction: **evolution, not revolution.** The Liquid Glass token core is strong and
themeable; the problems V2 fixes are structural (navigation, screen concentration,
session-mode separation) and application-layer drift (4 oranges, 55 font sizes,
ignored blur/motion tokens). The visual language stays; its application gets
normalized.

Protected identity elements: nav-lens tab bar, ASCA conic score ring, consistency
heatmaps (incl. pre-login preview), Winter Arc seasonal skin, Wrapped story deck,
nav-lens physics, PR confetti, count-up numerals.

---

## P0a — Design token & CSS normalization

Pure polish, zero behavioral risk. Makes everything look new overnight.

1. **Base surfaces**: move off pure `#000` to an elevated dark-gray ladder
   (`~#0c0c0d` base, lighter per elevation tier). Better depth hierarchy, no OLED
   smearing. Keep the aurora blobs; keep a true-black option open as a variant.
2. **One orange**: collapse `--accent #FF7600`, heatmap ramp `255,107,0`, button
   stops `255,61,0`, hovers `#FF9F45 / #ff8822` onto one accent family, derived per
   state (hover/pressed) via `color-mix()`.
3. **Type scale**: enforce the 6-step token scale (`:131-136`); no literal rem values
   below `--text-xs`; raise microcopy to ≥11px; fix `--t-4` contrast failures
   (e.g. `.heatmap-cal-month-label` at ~2:1).
4. **Glass recipe routing**: all ~65 `backdrop-filter` call-sites route through
   `--glass-blur/sat/bright` so Winter Arc retuning actually reaches them.
5. **Motion tokens**: delete the ~25 copy-pasted six-property transition strings;
   everything uses `--dur-*` + `--spring/--bounce/--smooth/--arc-settle`.
6. **Grammar collapse**: one chip system (keep `.feed-type`'s `--dt/--dt-bg/--dt-bd`
   pattern and generalize it); pills resolved to capsule *or* `--r-full` rects, not
   both (~20 literal `999px` sites); one overlay idiom — bottom sheets on mobile,
   centered modal only for destructive confirms.
7. **De-glow dense surfaces**: cards on feeds/leaderboards lose the stacked glow
   + sheen + cursor spotlight (drop the `(hover:hover)` desktop spotlight entirely);
   glow reserved for hero elements (score ring, nav-lens, active states).
8. **Fonts**: drop to 3 families — Outfit (display/titles), Plus Jakarta Sans (body),
   JetBrains Mono (numerals). Playfair Display stays only for `.brand-serif`. Bebas
   Neue stays gated to Winter theme. Load via `<link rel="preload">` instead of
   render-blocking `@import`.
9. **`!important` diet**: keep only the lock-slice block (load-bearing for build); fix
   the ≤480px profile-grid override structurally; remove the duplicated sync-badge
   `!important` in the Account hero.
10. Guard rails: `test/css.js` token audit, section markers preserved for build.js,
    `node test/run.js` green before any commit on this workstream.

## P0b — Information architecture rebuild

New shell — 5 slots with a hero center action:

```
[Home]  [Social]  [＋]  [Insights]  [Profile]
```

- **＋ = Log** becomes an enlarged accent-gradient center button in the floating nav.
  It opens a **full-screen workout session mode**: no heatmaps, BW widget, promo
  cards, or dashboard clutter. Existing logging components (split dropdown, exercise
  search, set editor, routines, rest timer) move in. "Finish & Sync" ends the session
  and returns to the previous view. The pre-login/empty state keeps the heatmap
  preview on Home.
- **Social** moves from header icon → bottom bar slot 2. The header keeps only:
  brand, sync badge, exercise-library icon.
- **Home** (new): bento-grid dashboard — ASCA score card (with new state pill),
  continue/start-workout action, streak, week volume, consistency heatmap, muscle
  freshness preview. "What do I do now?" first; history/analytics stay on their tabs.
- **Profile** absorbs Account: the athlete hero (ASCA ring, stats, heatmap) gets the
  mini-profile treatment; settings (appearance, cloud sync, local storage, sign out)
  move behind a gear → bottom sheet. Developer console removed from user surface
  (stays reachable via admin or a build flag).
- **Arc** keeps its materializing seasonal tab slot (mechanic already works).
- Nutrition, History stay where they are (bottom: Nutrition replaced by Home's
  dashboard role receipt — Nutrition keeps its slot until Home proves itself; the
  5-slot bar may run Home/Nutrition/＋/Insights/Profile with Social via slot swap —
  final bar composition validated on device).

Exact final bottom-bar composition (which 5 of Home/Social/Nutrition/Arc make the
bar vs. header/dedicated entry points) is decided during implementation with
thumb-reach as the deciding test.

## P1a — Logging speed (Hevy/Strong parity)

No new dependencies; all vanilla, RTDB-compatible (extra keys on `sets[]` tolerated).

1. **Ghost values**: each set row shows last session's weight/reps ("20kg × 8");
   one tap fills + completes.
2. **Tap-to-complete set row**: checkbox fills ghost, undims row, auto-starts rest
   timer, scrolls to next set.
3. **Rest timer**: — already exists as floating bar + inline chips; consolidate to
   ONE surface (floating bar) with −15s/+30s/skip.
4. **Plate calculator**: pure function + small SVG/CSS bar diagram, reachable from
   the weight field.
5. **Set types**: warm-up/working/drop/failure cycle icon per set; excluded
   appropriately from PR/volume math.
6. **Live PR toast**: confetti + "+2.5kg since Oct 3" copy on hitting a PR mid-session
   (PR engine exists: reuse `challenges.js`-style pure recompute).
7. Supersets-lite (link two exercises, shared timer) — stretch goal.

## P1b — Social & structural UX

1. **Canonical feed card**: avatar+name+time · day-type chip · 3-stat strip
   (volume/exercises/PRs) · PR chips · kudos row. One anatomy everywhere feed-like
   content appears.
2. **Unified leaderboard idiom**: Arc (8 metrics) and main (6×3) leaderboards share
   one segmented-control component; Arc leaderboard only renders for enrolled
   context.
3. **Feed pagination** (today: hard cap at 12 cards) + skeleton shimmer on all
   async surfaces (leaderboards, feed, directory, heatmaps).
4. Pull-to-refresh on Social/History; swipe-to-delete on history entries; keep the
   manual Sync button as fallback.
5. Onboarding: 3-step first-run (goal → start-empty-or-import → first routine).
   Nutrition Plan rebuilt from the 25-field wall into a guided card flow.

## P2 — Delight & growth surfaces

1. **ASCA state pill**: one number, one color, whole-surface state
   ("Prime / Maintaining / Falling behind") — extend the conic-ring grammar with a
   semantic tint.
2. **Muscle freshness map**: upgrade the existing muscle-activation SVG to answer
   "what should I train today?" (fresh/recovering/fatigued per group, derived from
   EXERCISE_LIBRARY muscle mapping + recent sessions).
3. **Wrapped 2.0**: audit against story-deck checklist (auto-advance, progress bars,
   hold-to-pause, one idea per slide); add canvas share-card export per slide —
   the growth-loop feature.
4. Feed re-bump on kudos (`max(postedAt, lastInteractionAt)` ordering — "athletes"
   second dopamine pass, à la Strava).

---

## Modern CSS toolkit for V2 (now baseline-safe)

`oklch()` + `color-mix()` for color states · container queries for bento cards ·
`backdrop-filter` (already used, route through tokens) · `@property`-animated conic
rings (already used) · same-document View Transitions (already used, extend to tab
switches) · scroll-driven animations as progressive enhancement ·
`text-box-trim` for big-numeral optical centering. All ambient motion stays gated
behind `prefers-reduced-motion: no-preference`.

## Non-goals for V2

- No framework, no build tooling beyond build.js, no new dependencies.
- No neumorphism, no glass behind stat text or forms (NN/g iOS-26 lesson: glass is
  for chrome — nav, modals, sheets — not for data).
- No redesign of the Winter Arc theme beyond what token normalization brings free.
- The Swift port (`GymTracker.swiftpm`) is out of scope; web leads, port follows.

## Working rules for the V2 branch

- Never hand-edit root `index.html`; edit `src/` and run `node build.js`.
- Preserve `/* ── Section Name */` markers in style.css.
- `node test/run.js` must stay green.
- Commit per workstream step, small and revertible.
