#!/usr/bin/env bash
set -euo pipefail

# Compute SHAs at build time
JUDGE_CODE_SHA=$(git -C "$(dirname "$0")/.." rev-parse HEAD)
JUDGE_MODEL_SHA="${JUDGE_MODEL_SHA:-claude-haiku-4-5-20251001}"

cd "$(dirname "$0")/.."

docker build \
  -f packages/judge-server/Dockerfile \
  --build-arg JUDGE_MODEL_SHA="$JUDGE_MODEL_SHA" \
  --build-arg JUDGE_CODE_SHA="$JUDGE_CODE_SHA" \
  -t reactive-agents/judge-server:${JUDGE_CODE_SHA:0:8} \
  -t reactive-agents/judge-server:latest \
  .

echo "Built reactive-agents/judge-server:${JUDGE_CODE_SHA:0:8}"
