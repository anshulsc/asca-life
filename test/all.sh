#!/bin/sh
# Run the Winter Arc suite across the timezones that actually break things.
#
# Day keys in this app are LOCAL "YYYY-MM-DD" strings. Anything that derives a
# day from a Date must agree with the local calendar in every zone — positive
# offsets break in the early morning, negative offsets break late at night, and
# a suite run only in the author's zone will happily miss both.
#
#   sh test/all.sh
set -e
cd "$(dirname "$0")/.."

ZONES="Asia/Kolkata Europe/Berlin UTC America/Los_Angeles Pacific/Auckland Pacific/Honolulu"
FAILED=""

for TZ_NAME in $ZONES; do
  printf '\n\033[1m═══ TZ=%s ═══\033[0m\n' "$TZ_NAME"
  if TZ="$TZ_NAME" node test/run.js && TZ="$TZ_NAME" node test/engine.js; then :; else FAILED="$FAILED $TZ_NAME"; fi
done

printf '\n\033[1m═══ CSS + rules (timezone-independent) ═══\033[0m\n'
if node test/css.js && node test/rules.js; then :; else FAILED="$FAILED css/rules"; fi

printf '\n%s\n' "────────────────────────────────────────────────────────────"
if [ -n "$FAILED" ]; then
  printf '\033[31mFAILED in:%s\033[0m\n' "$FAILED"
  exit 1
fi
printf '\033[32mAll zones passed.\033[0m\n'
