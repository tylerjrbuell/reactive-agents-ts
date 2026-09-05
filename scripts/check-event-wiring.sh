#!/usr/bin/env bash
# Every AgentEvent tag with a CONSUMER must have a PRODUCER.
#
# Finding F-1 (2026-08-24): `LLMRequestCompleted` shipped with nine consumers
# and zero producers for months — the per-call cost stream was structurally
# empty across the bench runner, both observability collectors, the tracer and
# the Cortex readouts. The 2026-08-27 sweep found three more of the same shape,
# one of which (`LLMRequestStarted`) meant RA emitted no OpenTelemetry LLM spans
# at all, because the span map is only ever populated by that event's handler.
#
# A tag with producers and NO consumers is NOT a violation: those are the
# framework's public subscription surface, and the consumer is user code outside
# this repo.
#
# `|| true` on the producers/consumers pipelines (and the `${var:-0}`
# fallback) keep this under `set -e`, same fix as check-cost-accounting.sh:
# when a grep finds zero matches the pipeline itself exits non-zero, which
# would otherwise abort the script at that assignment — silently, before the
# loop ever reaches a real violation.
#
# Producer/consumer matching is quote-agnostic (`_tag: "Foo"` or
# `_tag: 'Foo'`): 23 production call sites publish with single quotes (e.g.
# packages/runtime/src/agent/execute-event.ts), so a double-quote-only match
# false-positived ProactiveActionCompleted as producer-less.
set -euo pipefail
cd "$(dirname "$0")/.."

BUS="packages/core/src/services/event-bus.ts"
FILES=$(find packages apps -type d \( -name dist -o -name node_modules \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.svelte' \) -print \
  | grep -v '\.test\.' | grep -v '\.spec\.')

TAGS=$(grep -oE 'readonly _tag: "[A-Za-z]+"' "$BUS" | grep -oE '"[A-Za-z]+"' | tr -d '"' | sort -u)

VIOLATIONS=""
for t in $TAGS; do
  producers=$(grep -lE "_tag: [\"']$t[\"']" $FILES 2>/dev/null | grep -v "$BUS" | wc -l | tr -d ' ' || true)
  producers=${producers:-0}
  [ "$producers" != "0" ] && continue
  consumers=$(grep -lE "[\"']$t[\"']" $FILES 2>/dev/null | grep -v "$BUS" \
    | xargs -r grep -LE "_tag: [\"']$t[\"']" 2>/dev/null | wc -l | tr -d ' ' || true)
  consumers=${consumers:-0}
  [ "$consumers" = "0" ] && continue
  VIOLATIONS="${VIOLATIONS}\n  $t — $consumers consumer file(s), 0 producers"
done

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: AgentEvent tags are consumed but never produced:"
  printf "%b\n" "$VIOLATIONS"
  echo ""
  echo "Either publish the event at the site that owns the fact, or delete the"
  echo "tag and its consumers. A consumer reading a tag nothing emits is a"
  echo "silently empty metric, span, or UI panel — not a latent feature."
  exit 1
fi
echo "OK: every consumed AgentEvent tag has a producer."
