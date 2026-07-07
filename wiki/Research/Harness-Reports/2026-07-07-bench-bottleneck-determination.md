# Bench-driven bottleneck determination — 2026-07-07

**Input evidence:** qwen3:14b competitor re-run (90 cells) + cogito:8b final + forensic single-cell reruns + direct Ollama probes. Prior report: [[2026-07-07-public-competitor-bench-qwen3-14b-rerun]].

**Mandate:** learn from failure modes and fix the framework before publishing results; find what's holding RA back on ALL task types.

## The decoded death of rw-2 (data investigation, react, qwen3:14b — 7% accuracy, all 3 ra-full cells dead)

Trace `01KWXQK2D0011BA10XSY1RXBJK` timeline, corrected for the stopReason trace bug (B4):

1. iter 0: model calls `file-read` on the CSV (correct, 18.7s).
2. iter 1: think exchange hits the mid-tier 2000-token cap entirely inside `<think>` → **empty content**, 75s wasted. (`done_reason: length` verified empirically: Ollama + qwen3:14b + `think:true` + low `num_predict` → `content len 0, thinking len >0, done_reason length`.)
3. Kernel max-tokens Stage-1 escalation (think.ts:847) fires → re-runs at 64k → **correct answer produced** (5024 tokens, 184s): "The revenue drop on day 2 ... was primar[ily] ..."
4. **The answer does not terminate the run** — grounded termination expects the final-answer tool; a substantive `end_turn` content answer is treated as a thought. Kernel proceeds to iter 2.
5. iter 2 repeats the 2000-cap empty-think turn (73s; the 64k override is cleared after each success by design) → escalation would re-run again → **420s bench cap kills the run**. Cell scores 0. Agent had solved the task at step 3.

## Ranked bottlenecks

### B1 — Terminal-acceptance gap (highest severity)
Substantive, tool-grounded content answers delivered via `end_turn` never terminate the run; only the final-answer meta-tool does. Weak/thinking models frequently deliver the real answer as plain content. Result: solved-but-dead runs, retry churn, timeout cascades. Every additional iteration also multiplies B2's cost.
- Evidence: rw-2 trace above (answer at iter 1, death at cap); same signature risk on every react-strategy task under thinking models.
- Fix direction: grounded-terminal acceptance branch — when (a) ≥1 substantive tool call succeeded, (b) `end_turn` content is a non-trivial answer (not a plan/continuation), accept it as the terminal answer (route through the same single-owner `terminate()` path; verifier still gates). This is the F1 grounded-terminal invariant gaining its "grounding satisfied" arm — F1 currently only forces engagement, never accepts.
- Blast radius: termination semantics — must keep `scripts/check-termination-paths.sh` green and pass ablation (lift rule) before default-on.

### B2 — Thinking-token starvation thrash
`tierMaxTokens` (think.ts:617) caps mid-tier at 2000 output tokens. Thinking models burn the entire budget inside `<think>` → empty turn → Stage-1 escalation re-runs at 64k. Every substantive turn pays double (capped attempt + full re-run); the override is cleared after success so the thrash repeats every iteration.
- Evidence: two 2000-token empty exchanges in one dead run (~148s of 420s budget); empirical Ollama probe confirms mechanism.
- Fix direction: thinking-aware output budget — capability table knows which models think (`.withThinking` shipped 0.13); when the model is a thinking model on the local/mid tier, either (a) raise the initial `num_predict` to a thinking-adjusted budget, or (b) persist the escalated override across iterations for thinking models instead of clearing it, or (c) request `think:false` for kernel phases where thinking is waste. Measure token overhead vs latency — lift rule applies.

### B3 — Fabrication under forced grounding (research tasks)
Forced tool grounding + empty/noisy web-search results → model synthesizes fabricated entities; judge correctly zeroes. bare/manual-react answer from parametric knowledge and win.
- Evidence: rw-1 probe (EdgeVec, LiveBlocks-as-vector-DB, "MIT (assumed)"); rw-1/rw-2 lifts −67/−47.
- Fix direction: grounding-quality gate — when tool evidence is empty/low-signal, branch to honest fallback: answer-from-knowledge WITH explicit caveat, or abstain — never silent forced synthesis. (The receipt already exposes ungrounded honestly; the harness should also *behave* accordingly.)

### B4 — Trace stopReason fidelity (diagnostics)
`observable-llm.ts` stream accumulator does not capture `stopReason` from `content_complete` events → recorded exchanges say `end_turn` even when the provider reported `max_tokens`. Masked B1/B2 during diagnosis (trace said end_turn; kernel actually saw max_tokens).
- Fix: accumulate `content_complete.stopReason` (mirror the kernel fold at think.ts:726-731). Small; also improves T3 replay fidelity.

### B5 — Bench zombie fibers on cell timeout (infra, filed)
Raced-out `agent.run()` fibers keep consuming GPU; later cells degrade monotonically (248s → 380s → cap). Bench-side abort/reap needed. Filed in [[2026-07-07-public-competitor-bench-qwen3-14b-rerun]].

## Verification protocol per fix
Before/after on the exact failing cells (`--task rw-2` / `rw-1`, `--output`, runs≥3), trace diff (`rax:diagnose diff`), suite green, then full-session re-run and `rax eval gate` lift-rule verdict before any default-on. Publication (launch-gate item 5) BLOCKED until B1–B3 land and the re-run shows the story we can stand behind.
