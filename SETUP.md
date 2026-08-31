# Asca Gym — Backend Setup Manual

Getting **likes, comments, and Progress Pics** fully working. Everything below
uses the free Firebase **Spark** plan — no billing, no Cloud Storage. Progress
pics are stored as compressed base64 JPEGs directly in the Realtime Database.

**Login:** everything happens in the [Firebase console](https://console.firebase.google.com/)
under the project **`asca-gym`**, signed in with the Google account that owns it.

---

## Part 1 — Build & deploy the app

From `contents/gym-tracker/`:

```bash
node build.js
git commit -am "Backend: rank tiers, progress pics (RTDB), admin delete, live-sync fix"
git push
```

Wait ~30s — GitHub Pages redeploys `https://anshulsc.github.io/asca-life/`.
Hard-refresh the page (Cmd+Shift+R) to pick up the new code.

---

## Part 2 — Publish the Realtime Database rules

*This is what makes likes, comments, and Progress Pics work.*

**Option A — paste the file (fastest):**
1. Open `database.rules.json` from this repo, copy all of it.
2. Firebase console → **Build → Realtime Database** → **Rules** tab.
3. Select all existing text, delete it, paste, click **Publish**.

**Option B — from the app:** On the deployed app, sign in → **My Account** →
**Copy Database Rules** → paste into the same Rules tab → **Publish**.

Both produce identical rules (nodes: `gym`, `directory`, `kudos`, `comments`,
`progress`, `budget`, `arc`, `arcPublic`, `challenges`, `challengeMembers`,
`invites`).

> **The rules document is shared and publishing REPLACES it whole.** The
> `budget` node belongs to the Asca Budget (Vault) app, which lives in a
> separate repo but uses this same Firebase project and the same accounts.
> A ruleset missing `budget` silently breaks Vault's sync. There are three
> copies of this ruleset that must be edited together:
>   1. `database.rules.json` (this repo)
>   2. the `copyFbRules` literal in `src/app.js`
>   3. the `#fb-rules` literal in the budget repo's `src/app.js`
>
> **After editing `database.rules.json`, regenerate the other two rather
> than hand-editing them:**
> ```bash
> python3 tools/gen-rules-literal.py database.rules.json > /tmp/rules_body.txt
> ```
> Paste the output as the value of the `rules:` key in both button
> literals, then run `node test/rules.js` — it `eval()`s all three copies
> and diffs the resulting trees (not just the rule text), so it catches
> a divergence a visual diff would miss. It expects the budget repo
> checked out as a sibling of this repo's parent (`Project_Asca/budget`);
> if it isn't, that half of the check is skipped with a warning, not a
> silent pass.

---

## Part 3 — Verify it works

On the deployed app:

- **Likes:** tap a heart → reload → still filled.
- **Comments:** open a workout's comments → post one → survives a reload.
- **Progress Pics:** My Account → **Add Photo** → pick an image → add
  caption/weight → **Save Photo**. It appears in the grid; tap to view large.

---

## Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| Like reverts / "Kudos need the updated database rules" | RTDB rules not published | Redo **Part 2** |
| "Comments need the updated database rules" | Same | Redo **Part 2** |
| "Progress pics need the updated database rules" | Same | Redo **Part 2** |
| "Photo too large — try a smaller image" | Image exceeds the ~900KB cap after compression | Use a smaller/less-detailed photo |
| Duplicate accounts (e.g. "anshul singh") | Leftover nodes from username changes | Admin console → open each orphan → Danger zone → Delete |

---

## Notes

- **No Cloud Storage / billing.** Progress pics live in the Realtime Database at
  `progress/{userId}/{pushId}` as `{ uid, img, ts, caption, bw }`, where `img`
  is a base64 JPEG data-URI. Kept out of the `gym` node so a workout save can't
  overwrite them.
- Photos are auto-compressed to ≤1000px JPEG (quality 0.75) before saving, and
  the rules cap `img` at ~900KB. Keep an eye on the Spark plan's 1GB stored /
  10GB-per-month download limits if you accumulate a lot of pics.
- Social features (`kudos`, `comments`, `progress`) silently default-deny until
  the RTDB rules are published — that's the #1 cause of "it doesn't work."
