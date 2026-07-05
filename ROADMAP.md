# Reactive Agents — Roadmap

> **Last updated:** 2026-07-05 (v0.13.0 published; direction re-ratified as the **Agentic OS program** — see `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md`)
> **The open-source agent framework built for control, not magic.**

This roadmap is the public-facing milestone tracker. The internal authoritative direction lives in `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` (north star v6.0, 2026-07-05) + `wiki/Decisions/2026-06-10-roadmap-realignment-v0.12-v1.0.md` (historical sequencing). When they disagree, the north-star spec wins and this doc is out of date — open an issue.

**Live board:** [github.com/users/tylerjrbuell/projects/1](https://github.com/users/tylerjrbuell/projects/1)

---

## Where we are today (v0.13.0 published 2026-07-02)

- **v0.13.0** on npm: all 35 packages. Cross-tier thinking (`.withThinking`), cost-aware model routing, abstention/trust-loop hardening, strict-validation opt-in, agentic UI kit foundation (`@reactive-agents/ui-core` + React/Svelte bindings, durable Interact/Inbox/Resume rails).
- **v0.12.0** (2026-06-17): durable execution + durable HITL, typed structured output, memory default-OFF, effect-free hooks.
- **Competitive receipts in hand:** public local-model bench (RA vs LangChain vs Vercel AI SDK vs Mastra vs bare LLM, cogito:8b + qwen3:14b via Ollama) — RA best-of-6 on accuracy after grounded-termination fixes, with honest per-dimension trade-offs published. Traces + methodology in-repo.
- **Live-probe validation** (2026-07-05): 7 end-to-end probes confirmed the platform's strengths (durable rail, flywheel, cross-tier structured output) and its gaps (result trust surface, introspection, config truthfulness) — `wiki/Research/Harness-Reports/2026-07-05-north-star-live-probe-validation.md`.

**What we learned (and publish honestly):**
- Heavy strategies (reflexion / tree-of-thought / plan-execute) show **no quality lift over the reactive kernel** on our benches at 3–15× local cost. Documented as frontier/niche options.
- The defensible strengths: **agents that work on local models** (per-model calibration + community profiles, healing pipeline, tier-adaptive context), the **local flight recorder** (replay + diagnosis CLI, no SaaS), and the **durable run rail** (crash-resume, HITL, resumable streams).
- The 2026 unmet need we aim at: **verification** — nobody owns runtime-level trust. And our own audit found our declared control surface ahead of our enforced one; closing that gap honestly IS the roadmap.

---

## The Agentic OS program (v0.14 → v1.0)

North star: **runs are processes, execution history is inspectable, trust is a type, the runtime learns the model it drives, and every consenting run improves the platform.** Executed as a *wiring program* — the audit showed most subsystems 70–90% built; we finish and enforce rather than pile new surface. Full detail: `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md`.

### v0.13.1 — patch (imminent)
- File-root sandbox fix (healing pipeline path resolution) — already on `main`, needs release.

### v0.14 — "The Log & The Process" (Arc 1) — **public launch**
- **Complete the record:** LLM exchanges captured with full response payloads (request side already lives), persisted for replay; one canonical event log direction (resolves the stream-union divergence, #188).
- **The process model:** `run.inspect()` (state, tokens, pending calls), `fork()` from any checkpoint (counterfactual restart — honest scope), `rax ps` / `rax attach` / `rax fork`; Cortex replay viewer + fork.
- **Trust receipt:** `result.receipt` on every run — claim→evidence provenance, verdict + confidence + method, Ed25519-signed provenance (not a truth certificate). Consolidates verification/guardrails/honesty/grounding into one spine.
- **Launch gate (fixed, 5 items):** LLM I/O capture ✚ inspect + ps/attach ✚ fork v1 ✚ receipt v1 ✚ published bench receipts → **Show-HN fires here.**

### v0.15 — "The Boundary & The Gate" (Arc 2)
- **Real enforcement at the tool boundary:** allowedTools/approval/per-tool budget enforced in `ToolService.execute`; `IdentityService.authorize()` wired; audit log.
- **Config truthfulness:** unknown builder options rejected loudly; inert combinations warned (e.g. durable checkpoints require the kernel path); the builder never lies.
- **Honesty default-on candidates** through the lift gate: post-condition verification, output-path guardrails.
- **BYO eval gate:** one report shape across `packages/eval` and the lift-gate/ledger; `rax eval gate` runs on user suites.

### v0.16 — "The Team" (Arc 3)
- A2A last mile (executor bridged, server actually started, real SSE) → cross-machine agent collaboration.
- Sub-agent events propagate to the parent bus (observable teams; Cortex team topology).
- Orchestration durability moved onto the RunStore rail (workflow crash-resume).
- MissionBrief / UpwardReport as typed primitives; parents verify child receipts (trust chain).
- Orchestration pattern breadth ships **behind the multi-agent bench** — no headline without lift evidence.

### v0.17 — "The Flywheel" (Arc 4)
- Healing outcomes feed learned aliases back into calibration; auto-calibration for unknown models (probe → community profile → generic).
- Skill/capability contribution to the community API (opt-in, transparent) — the substrate adapter.
- Commons transparency contract enforced: published payload schema, open aggregate data, first-run notice, never content/PII.
- Harness packages with attached eval receipts; verifiable self-improvement (replay-validated, gate-passed, ledgered) — the capstone, last.

### v1.0 — Polish & Release
- Every milestone gate re-run on the integrated codebase; every dead seam wired or deleted (zero declarative debt).
- `README.md` states only validated claims; 8-pillar artifact table complete.
- This doc rewritten: what shipped, what was deferred, what was killed and why.

---

## Strategic positioning

The framework's defensible value, per empirical evidence:

- **Local-first reliability** — per-model calibration + live community profiles, capability-signal routing, healing pipeline, tier-adaptive context. Same agent code on a 4B Ollama model and a frontier model.
- **Control** — developer-overridable harness (`.compose()`), killswitches, pause/resume/stop today; inspect/fork next. Enforcement moves to the boundary in v0.15.
- **Observability** — default-on traces, replay + diagnosis CLI, OTel export — all local, no SaaS coupling.
- **Honesty** — we publish our own overhead numbers, negative results, and our own audit's façade findings; claims scope per `01-RESEARCH-DISCIPLINE.md` Rule 11. The receipt (v0.14) makes this a runtime feature, not just a culture.

What we do **not** yet have:
- Named production users / case studies (v0.14 launch begins this).
- Third-party-hosted benchmark validation (own-bench receipts ship first; third-party integration remains a candidate).

---

## How to track progress

- **North star** — `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` (direction + arcs + gates)
- **Decision records** — `wiki/Decisions/`
- **Hot cache** (`wiki/Hot.md`) — current working state
- **Implementation plans** — `wiki/Planning/Implementation-Plans/`
- **Evidence artifacts** — `wiki/Research/Harness-Reports/`
- **Release tags** are cut by CI from `main`; CHANGELOG entries are authoritative

*Roadmap is rewritten on major releases or strategic shifts — not per commit.*
