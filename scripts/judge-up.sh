#!/usr/bin/env bash
# judge-up.sh — bring the frozen judge-server online (the honest-grading half of
# the measurement spine). The judge MUST be a model distinct from the SUT
# (Rule 4, 00-RESEARCH-DISCIPLINE.md); the bench's runSession refuses to score
# if /version reports a judgeModelSha matching any SUT model.
#
# Verified 2026-06-02: live layer grades correctly both directions
# (Paris → accept 1.0, Berlin → reject 0.0) with real per-layer reasoning.
# The live layer was always sound — it just needed to be RUN.
#
# Usage:
#   scripts/judge-up.sh                 # anthropic/claude-haiku-4-5, :8910
#   JUDGE_MODEL=gpt-4o-mini JUDGE_PROVIDER=openai scripts/judge-up.sh
#   PORT=8911 scripts/judge-up.sh
#
# Then point the bench at it:
#   JUDGE_URL=http://127.0.0.1:8910 bun run --cwd packages/benchmarks bench --session <id>
#
# Requires the provider key in .env (Bun auto-loads it): ANTHROPIC_API_KEY for
# the default anthropic judge, OPENAI_API_KEY for openai, etc.
set -euo pipefail

PORT="${PORT:-8910}"
JUDGE_PROVIDER="${JUDGE_PROVIDER:-anthropic}"
JUDGE_MODEL="${JUDGE_MODEL:-claude-haiku-4-5-20251001}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting judge-server: provider=$JUDGE_PROVIDER model=$JUDGE_MODEL port=$PORT"

JUDGE_LAYER=live \
JUDGE_PROVIDER="$JUDGE_PROVIDER" \
JUDGE_MODEL="$JUDGE_MODEL" \
JUDGE_MODEL_SHA="$JUDGE_MODEL" \
JUDGE_CODE_SHA="$(git -C "$ROOT" rev-parse --short HEAD)" \
PORT="$PORT" \
  bun run "$ROOT/packages/judge-server/src/index.ts" &
JUDGE_PID=$!

# Health-gate: wait for /version, then prove the live layer (not stub) grades.
for _ in $(seq 1 15); do
  if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/version" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! curl -fsS --max-time 2 "http://127.0.0.1:$PORT/version" >/dev/null 2>&1; then
  echo "ERROR: judge-server did not come up on :$PORT" >&2
  kill "$JUDGE_PID" 2>/dev/null || true
  exit 1
fi

echo "judge-server up on :$PORT (PID $JUDGE_PID)"
echo "  /version: $(curl -fsS "http://127.0.0.1:$PORT/version")"
echo "  point the bench with: JUDGE_URL=http://127.0.0.1:$PORT"
echo "  stop with: kill $JUDGE_PID"
