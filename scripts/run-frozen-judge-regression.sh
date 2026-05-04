#!/usr/bin/env bash
set -euo pipefail

JUDGE_URL="${JUDGE_URL:-http://127.0.0.1:8910}"
SUT_MODEL="${SUT_MODEL:-claude-sonnet-4-6}"

cd "$(dirname "$0")/.."

mkdir -p harness-reports/phase-0-runs

echo "Run 1..."
bun run --cwd packages/benchmarks src/run.ts \
  --session regression-gate \
  --judge-url "$JUDGE_URL" \
  --model "$SUT_MODEL" \
  --output "$(pwd)/harness-reports/phase-0-runs/run1.json"

sleep 60

echo "Run 2..."
bun run --cwd packages/benchmarks src/run.ts \
  --session regression-gate \
  --judge-url "$JUDGE_URL" \
  --model "$SUT_MODEL" \
  --output "$(pwd)/harness-reports/phase-0-runs/run2.json"

# Diff the average accuracy scores across all tasks
SCORE1=$(jq '[.taskReports[].meanScores[] | select(.dimension == "accuracy") | .score] | add / length' harness-reports/phase-0-runs/run1.json)
SCORE2=$(jq '[.taskReports[].meanScores[] | select(.dimension == "accuracy") | .score] | add / length' harness-reports/phase-0-runs/run2.json)
DELTA=$(echo "scale=4; ($SCORE2 - $SCORE1) * 100" | bc)

echo "Run1 score: $SCORE1"
echo "Run2 score: $SCORE2"
echo "Delta: ${DELTA}%"

# Gate: ±0.5%
if (( $(echo "$DELTA > 0.5 || $DELTA < -0.5" | bc -l) )); then
  echo "FAIL: reproducibility delta exceeds ±0.5%"
  exit 1
fi
echo "PASS: reproducibility delta within ±0.5%"
