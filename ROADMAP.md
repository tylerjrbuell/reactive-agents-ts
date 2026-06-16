# Reactive Agents — Roadmap

> **Last updated:** 2026-06-16 (v0.12 mid-flight: durable exec A–D + HITL landed, memory default-OFF + effect-free hooks shipped)
> **The open-source agent framework built for control, not magic.**

This roadmap is the public-facing milestone tracker. The internal authoritative direction lives in `wiki/Decisions/2026-06-10-roadmap-realignment-v0.12-v1.0.md` + `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`. When they disagree, the decision doc wins and this doc is out of date — open an issue.

**Live board:** [github.com/users/tylerjrbuell/projects/1](https://github.com/users/tylerjrbuell/projects/1)

---

## Where we are today (v0.11.2 published)

- **v0.11.2** on npm (2026-06-10): all 35 packages, 2026-06 model lineup, zero retiring defaults, guard tests pinning every default to the capability table. 6,200+ tests green.
- **v0.11 line shipped:** Compose API (7 chokepoints, killswitches), Snapshot/Replay, `rax-diagnose`, OTel exporter (`@reactive-agents/observe`), `create-reactive-agent`, code-action strategy, skill persistence, gateway chat, Cortex studio with parameterized runs.
- **Architecture:** canonical kernel (capability-grouped, acyclic, single termination owner, unified `project()` context assembly). Independent audit grade: structurally healthy.

**What we learned (and publish honestly):**
- Heavy strategies (reflexion / tree-of-thought / plan-execute) show **no quality lift over the reactive kernel** on our internal benches, at 3–15× cost on local models. We document them as frontier/niche options, not headline features.
- The defensible, externally-demanded strengths are: **agents that actually work on local models** (per-model calibration, 4-stage tool-call healing, tier-adaptive context) and the **local flight recorder** (deterministic replay + diagnosis CLI, no SaaS attached).

---

## v0.12 — "Durable & Honest"

**Goal:** close the one 2026 table-stakes gap, and make the surface match the quality of the internals. One migration event for users.

| Track | Contents | Status |
|---|---|---|
| **Durable execution** | Crash-resume: opt-in `.withDurableRuns()`, SQLite RunStore, checkpoint-every-N, `agent.resume(runId)`. Durable human-in-the-loop: approval requests survive process death (`approve`/`deny` from a new process). Acceptance: SIGKILL mid-run → resume → identical output. | **Phases A–D shipped** (checkpoint seam + state codec, SQLite RunStore + `.withDurableRuns()`, `resumeRun()`, durable HITL via `.withApprovalPolicy`/`approveRun`/`denyRun` on both `run()` and `runStream()` paths). Phase E (Cortex UI) remaining. |
| **DX wave** | Effect-free lifecycle hooks (no `Effect.succeed` required), builder consolidation (observability 5 methods → 1; one canonical hook route; documented config precedence), plain-Error mapping at promise boundaries. | **Shipped** — effect-free hooks (`.withHook()` plain fns) + observability consolidation: `.withObservability({ cortex, telemetry, logging, tracing, health, audit, costs })` fans out to one canonical route (dedicated methods retained, last-call-wins precedence documented). |
| **Memory default OFF** | Breaking-ish: stateless by default, one-line `.withMemory()` opt-in. No more surprise SQLite writes in CI. | **Shipped** (memory default-OFF; `balanced()`/`intelligent()` opt in explicitly). |
| **Cost honesty** | Tier-aware debrief synthesis (skip/template on local — the single largest per-run overhead), meta-tool prompt audit per tier. | **Shipped** — debrief forked off the critical path (~46% faster `run()`) + LLM debrief synthesis now skipped on the local tier (deterministic fallback kept; local synth failed ~52% at ~825 tok/~6s). |
| **Strategy honesty** | Adaptive routing defaults to reactive on local tier; heavy strategies documented per the parity data. | **Shipped** — adaptive defaults to reactive on the local tier (heavy-strategy parity; skips the analysis LLM call) + #195 closed (Compose hooks/killswitches/calibration thread through all 5 strategies, single+batch emit). |

Design spec: `wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md`. **v0.12 milestone issue queue is empty** (#195 closed 2026-06-16). Slipped during 2026-06-16 triage: #188/#47/#35 → v0.13, #43 → v0.14. **Only remaining v0.12 item: durable Phase E (Cortex resume/approval UI)** — greenfield server endpoints + Svelte UI; Cortex currently has zero durable wiring.

---

## v0.13 — "Receipts" (public launch)

**Goal:** prove the differentiated claims reproducibly, then make noise.

- **Public local-model bench:** same task suite, qwen/llama 7–14B via Ollama — Reactive Agents vs Mastra vs LangGraph.js vs raw AI SDK. First-attempt success + token cost. Model + provider + date pinned, ≥3 seed variance, raw traces published. Stop-the-line rule: if external delta >15% from internal, fix the harness — not the result.
- **Flight recorder, front and center:** "record once, debug forever" — deterministic offline replay of the full provider interaction + `rax-diagnose` root-cause CLI. No observability SaaS required.
- **Cost governance demo:** budget + watchdog + approval killswitches composing on one agent, with our own measured overhead published.
- **Infra:** OIDC trusted publishing (no npm token rotation).
- **Show-HN / launch happens here** — with evidence, not adjectives.

---

## v0.14 — "Compounding"

**Goal:** the capability bet — agents that get better across runs.

- Progress recitation and cross-run experience-reuse, behind ablation gates.
- Sequenced after v0.13 deliberately: lift gets measured on the public bench (≥3 percentage-point rule, ≤15% token overhead), making results publishable rather than anecdotal.

---

## v1.0 — Polish & Release

- Every prior milestone gate re-run on the integrated codebase.
- `README.md` states only validated claims; vision pillar artifact table complete — each of the 8 pillars cites a file, bench number, or doc.
- Snapshot/replay determinism re-validated.
- This doc rewritten: what shipped, what was deferred, what was killed and why.

---

## Strategic positioning

The framework's defensible value, per empirical evidence:

- **Local-first reliability** — per-model runtime calibration, capability-signal tool routing, 4-stage healing pipeline, tier-adaptive context. The same agent code runs on a 4B Ollama model and a frontier model.
- **Control** — every harness primitive is developer-overridable via `.compose(harness)`; killswitches; `RunHandle` pause/resume/stop/terminate; (v0.12) durable resume.
- **Observability** — default-on traces/metrics/logs, OTel exporter, deterministic replay + diagnosis CLI — all local, no SaaS coupling.
- **Honesty** — we publish our own overhead numbers and negative results (heavy-strategy parity, falsified optimizations). Claims scope per `01-RESEARCH-DISCIPLINE.md` Rule 11.

What we do **not** yet have:
- Public third-party benchmark (v0.13 gate)
- Production case studies / named users
- Durable execution story complete (v0.12, in flight)

---

## How to track progress

- **Decision record** — `wiki/Decisions/2026-06-10-roadmap-realignment-v0.12-v1.0.md` (why this sequencing)
- **Hot cache** (`wiki/Hot.md`) — current working state
- **Implementation plans** — `wiki/Planning/Implementation-Plans/`
- **Evidence artifacts** — `wiki/Research/Harness-Reports/`
- **Release tags** are cut by CI from `main`; CHANGELOG entries are authoritative

*Roadmap is rewritten on major releases or strategic shifts — not per commit.*
