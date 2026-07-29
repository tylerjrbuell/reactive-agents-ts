#!/usr/bin/env bash
# check-volatile-placement.sh — F10 gate.
#
# Per-iteration content must not be rendered into the system prompt. Anthropic
# caches by exact prefix and the system block is inside it, so anything that
# changes between turns invalidates the cache on every turn. Measured cacheRead
# was 0 on the default kernel path before this was fixed.
#
# RED-ON-CUT: move the `Remaining steps:` render back into system-prompt.ts and
# this exits 1.
set -euo pipefail

SYS="packages/reasoning/src/assembly/stages/system-prompt.ts"
TAIL="packages/reasoning/src/assembly/stages/volatile-tail.ts"
fail=0

if grep -q "Remaining steps:" "$SYS"; then
  echo "FAIL: 'Remaining steps:' is rendered in $SYS."
  echo "      It changes every iteration and the system prompt is inside the"
  echo "      cached prefix. It belongs in $TAIL."
  fail=1
fi

if grep -q "renderStandingFrame" "$SYS"; then
  echo "FAIL: the standing frame is rendered in $SYS."
  echo "      Same reason — it changes across passes. It belongs in $TAIL."
  fail=1
fi

if ! grep -q "Remaining steps:" "$TAIL"; then
  echo "FAIL: $TAIL does not render 'Remaining steps:'."
  echo "      Moving volatile content must not DROP it — that is the H1"
  echo "      composed-but-never-rendered regression."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: volatile content renders in the message tail, not the cached prefix."
fi
exit "$fail"
