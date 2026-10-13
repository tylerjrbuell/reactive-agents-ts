# Fixtures — rung-0 baseline capture (Local Tier Reliability Program, Task 0)

The measurement substrate for every ⚡ wave's lift verdict (Lift Protocol rung-0).
Captured 2026-10-13 at Wave-0-close HEAD with `scripts/lift/bench.ts`; temperature 0,
Ollama on localhost:11434 (local arms) / Anthropic haiku (rung-2 arms).

## Naming

- `<ULID>.jsonl` — one raw trace per captured run, written by the framework's own
  trace recorder (`.withObservability({ tracing: { dir: here } })`). File name is the
  runId (= taskId). Map runId→arm/scenario in `MANIFEST.md`.
- `baseline-metrics.jsonl` — one extracted metric object per run (same order as the
  MANIFEST table): termination, token/usage sums, assessment rows (evidenceDelta/band/
  outstanding), guard fires, empty-content + false-success classification, per-call
  visible schema counts, wall clock. Crash-safe: appended after each run.
- `workspaces/<arm-id>-run<k>/` — per-run file-tool sandboxes (via `withFileRoot`):
  two committed input files (`sales-q1.txt`, `sales-q2.txt`) plus whatever the model
  wrote (`report.md` — evidence, left as produced).
- `replay-gate/` — S1 replay-determinism gate artifacts.
- `01M4RTC37R52BKE05KGG3YD7E6.jsonl` — pre-existing 2026-10-12 live-probe audit
  trace (historical, not regenerated).

## Regeneration

```bash
bun run scripts/lift/bench.ts list          # arm ids in priority order
bun run scripts/lift/bench.ts s1-qwen34b    # one arm, N runs, appends to baseline-metrics.jsonl
bun test scripts/lift/extractor.test.ts --timeout 15000   # extractor unit smoke
```

Traces rotate out of `~/.reactive-agents/traces` within minutes on this box — these
committed copies exist precisely because rotation is why pinning is urgency-bearing.
Do not rewrite existing rows: later waves diff against these values. New captures go
through new arms/run indices.
