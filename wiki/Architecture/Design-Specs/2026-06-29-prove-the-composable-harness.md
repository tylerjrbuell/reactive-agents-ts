# Prove the Composable Harness — Proof Vignettes (design, 2026-06-29)

## Pivot

Dropped the self-built "capability benchmark" as the public proof (self-built numbers aren't trusted; official benchmarks are a huge build competitors skip — see `wiki/Research/2026-06-28-agent-benchmark-scoring-practices.md`). For a dev framework, the strongest proof is **reproducibility + transparency**, not a leaderboard.

**Thesis:** *Agentic engineering = the harness is the product.* Prove the **composable harness itself** — for each system, demonstrate what it does FOR the agent, reproducibly, with the trace/receipt as evidence. The with/without comparison is a **demonstration of what each layer buys**, not a contested benchmark score.

Unifying move: **"don't trust us — run it, inspect every decision."** Every vignette is runnable on the user's machine and emits an auditable receipt.

## Proof vignette gallery — "What the composable harness gives your agent"

Each vignette: scenario → with-vs-without the system → observable outcome → the trace event that proves it → one run command. Local-first where possible (no API key).

| Vignette | Harness system | Proves | Trace evidence |
|---|---|---|---|
| Same code, your GPU | tools + reasoning + adaptive FC | local 14B does real tool work; one-line swap → frontier (parity) | `kernel-state-snapshot.toolsUsed` |
| Caught the lie | verifier / grounding | fabrication rejected → grounded retry | `verifier-verdict` failed→passed |
| Self-healed the tool call | healing pipeline | typo'd `file_red` repaired → executes (weak models survive) | `HealingResult.actions` |
| Recovered from failure | resilience loop | API 503×2 → fallback → completes | tool-call retries |
| Survived a crash | durable execution | kill mid-run → resume → finishes | checkpoint + resume |
| Knew when to stop / not touch | scope discipline + RI | read-only honored; stall → intervene/switch | `trace` oracle, `strategy-switched` |
| Stayed in budget | cost routing | hard cap enforced mid-run | cost-track events |

## What carries over (salvage)

All deterministic infra built 2026-06-28 is reused — NOT wasted:
- `verifiable` (shell-aware), `trace` criterion + `scoreTrace`, `schema` oracles → power the vignette "did it work" checks.
- Capability auto-probe (ollama), merge-by-cell writer, `--models` filter, `runsPerCell`.
- SessionReport + reproducibility receipt + the Astro render component.
- `rw-d*` / `cs-*` scenarios → the demo-engine scenarios.

Two surfaces for the salvaged work:
1. **Internal eval arena** — regression + ablation + harness/strategy quality testing (worth it regardless of public proof; already surfaced the rw-d1 RI-regression). `public:false` sessions.
2. **Demo engine** — the same scenarios + traces power the public proof vignettes. `public:true`.

## Execution

1. **Cleanup:** pull `/features/benchmarks` from public nav; retire legacy regex `MultiModelReport` path (`runBenchmarks` + old report shape); add `public?: boolean` to `BenchmarkSession`; relabel self-built suite as internal arena.
2. **Proof system:** vignette runner (reuses sessions + trace inspection) → Astro renders the gallery (cards: what-it-does + with/without outcome + embedded trace snippet + run command). Component pivots from "benchmark table" → "harness proof cards."
3. **Park** τ-bench / LongMemEval as a later one-number bonus (v0.13 Receipts), timeboxed — not the centerpiece.

## Anti-goals
- No self-built "capability score" presented as a standard.
- Don't sink a sprint into official-benchmark integration now.
- Vignettes must be genuinely runnable + the trace must actually show the claimed event (no staged/fake traces).
