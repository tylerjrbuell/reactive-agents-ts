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
THINK="packages/reasoning/src/kernel/capabilities/reason/think.ts"
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

# Second instance of the same disease class (2026-08-26): guidanceText was
# rendered into the system-prompt tail in think.ts, not system-prompt.ts, so
# the checks above never saw it. RED-ON-CUT: push `guidanceText` (or the
# `pipeline.transform('prompt.guidance', ...)` result) back into `parts` /
# `systemPromptWithDriver` and this exits 1.
if grep -qE 'parts\.push\(guidanceText\)|systemPromptWithDriver = parts\.join.*guidanceText' "$THINK"; then
  echo "FAIL: guidanceText is rendered into the system-prompt parts array in $THINK."
  echo "      System precedes messages in Anthropic's cache hierarchy — any"
  echo "      system-content change invalidates the cache for that call and"
  echo "      everything downstream. Guidance belongs on messagesForRequest."
  fail=1
fi

if ! grep -q "messagesForRequest" "$THINK"; then
  echo "FAIL: $THINK no longer builds messagesForRequest — guidance placement"
  echo "      cannot be verified. If guidance delivery was restructured,"
  echo "      update this check to match the new mechanism, don't delete it."
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK: volatile content renders in the message tail, not the cached prefix."
fi
exit "$fail"
