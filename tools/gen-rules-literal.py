#!/usr/bin/env python3
"""
Generate the JS object-literal form of database.rules.json's `rules` value.

WHY THIS EXISTS: the RTDB rules document is shared by two apps (this gym
tracker and the separate Vault/budget repo) that hit the SAME Firebase
project, and Firebase has exactly one rules document — publishing REPLACES
it whole. Historically the ruleset was hand-copied into three places
(database.rules.json here, a "Copy Database Rules" button in this repo's
src/app.js, and the equivalent button in budget/src/app.js) and they drifted:
database.rules.json was missing an entire node for months before anyone
noticed. This script removes the hand-copying step.

USAGE — after editing database.rules.json:
    python3 tools/gen-rules-literal.py database.rules.json > /tmp/body.txt
Then paste /tmp/body.txt's content as the value of the `rules:` key inside
BOTH button literals (gym's src/app.js and the budget repo's src/app.js),
adjusting only the surrounding indentation to match each file's existing
style — the generator's own indentation is relative (2 spaces per level)
so re-basing it is a matter of prefixing every line but the first `{`.

Verify afterwards with test/rules.js, which does a genuine eval() round-trip
and diffs the resulting JSON trees for all three copies — not just a rule-
string comparison, which could theoretically miss a structural difference.

Style: unquoted identifier-like keys, quoted ".read"/".write"/".validate",
2-space indent, one explanatory comment per documented top-level node
(comments live in COMMENTS below since JSON itself can't hold them).
"""
import json
import re
import sys

IDENT = re.compile(r'^[A-Za-z_$][A-Za-z0-9_$]*$')

# path -> comment lines, injected immediately before that key's value.
# Kept here (not in the JSON, which can't hold comments) as the one place
# documentation for the ruleset lives outside prose docs.
COMMENTS = {
    'gym': [
        "Any signed-in member can read (Strava-style); only the owner",
        "(uid) may write, and the payload is validated + size-capped so",
        "a hostile client can't store malformed or oversized data.",
    ],
    'directory': [
        "Writable by the node's owner: self-uid stamp (atomic writes) or",
        "the matching gym node's uid (legacy path). Fields are validated.",
    ],
    'progress': [
        "Progress pics stored as base64 JPEG (`img`) directly in RTDB —",
        "no Cloud Storage / billing. Any member can read; only the owner",
        "of that username's gym node may write/delete, the record must",
        "stamp their own uid, and `img` is size-capped (~900KB).",
    ],
    'budget': [
        "Asca Budget app (separate site, same accounts): one private",
        "doc per user at budget/{userId}. Unlike gym data budgets are",
        "NOT social — only the owning account may read its node (a",
        "missing node stays readable so first sync can see it's empty).",
    ],
    'arc': [
        "Winter Arc private season state: goals, daily check-ins, xp/level,",
        "streak, badges. Owner-read-only — sleep/protein/water/steps never",
        "leave this node, which is what makes the social surfaces safe.",
    ],
    'arcPublic': [
        "The narrow social projection of arc/: xp, level, streak, badge",
        "count. Member-readable like directory/. NEVER sleep, protein,",
        "water, steps or body weight — those stay in arc/ only.",
    ],
    'challenges': [
        "Challenge definitions (built-in or friend-created). Any member",
        "may read; only the creator may write, checked both on create",
        "(no existing owner yet) and on every subsequent edit.",
    ],
    'challengeMembers': [
        "Sibling of challenges/, not a child — a member can write ONLY",
        "their own progress here with no write access to the definition.",
        "The owner may also write, to remove a member.",
    ],
    'invites': [
        "The sender creates an invite; the recipient can read + delete",
        "their own inbox (accept = join elsewhere + delete; decline =",
        "delete). Mirrors the gym-node-owner trick used by directory/.",
    ],
}

def key_repr(k):
    return k if IDENT.match(k) else json.dumps(k)

def emit(node, indent, path):
    pad = '  ' * indent
    pad1 = '  ' * (indent + 1)
    if isinstance(node, dict):
        if not node:
            return '{}'
        parts = []
        for k, v in node.items():
            child_path = f'{path}.{k}' if path else k
            comment = ''
            if child_path in COMMENTS:
                comment = ''.join(f'{pad1}// {line}\n' for line in COMMENTS[child_path])
            parts.append(f'{comment}{pad1}{key_repr(k)}: {emit(v, indent + 1, child_path)}')
        return '{\n' + ',\n'.join(parts) + '\n' + pad + '}'
    if isinstance(node, str):
        return json.dumps(node)
    if isinstance(node, bool):
        return 'true' if node else 'false'
    return json.dumps(node)

def main():
    with open(sys.argv[1]) as f:
        doc = json.load(f)
    print(emit(doc['rules'], 0, ''))

if __name__ == '__main__':
    main()
