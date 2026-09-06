# Reactive Agents — Roadmap

> **Last updated:** 2026-09-05 (v0.16.0 shipped — resynced this doc against actual release content, `wiki/Architecture/DEBT-REGISTER.md`, and `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md`. Two releases in a row (v0.15, v0.16) shipped real fixes and capabilities pulled forward from dogfooding rather than the planned Arc 2 work — Arc 2 ("The Boundary & The Gate") remains fully unstarted. This revision re-sequences the near-term releases around evidence-backed, ranked leverage instead of re-asserting the old version-to-arc pinning.)
> **The open-source agent framework built for control, not magic.**

This roadmap is the public-facing milestone tracker. The internal authoritative direction lives in `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` (program sequencing + convergence rulings) over `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` (product-arc content, v6.0). When they disagree with this doc, the specs win and this doc is out of date — open an issue.

**Live board:** [github.com/users/tylerjrbuell/projects/1](https://github.com/users/tylerjrbuell/projects/1)

---

## Where we are today (v0.16.0, live on npm, 2026-09-05)

- **v0.16.0** (released): a harness control surface (`.withHarness({...})`, typed config > env var > default), richer chat/session controls (`withToolIntent`, `verifyCitations`, session `onOverflow`), an opt-in lightweight tool index for large tool catalogs, a small tool-authoring toolkit (`defineToolset`, `boundedMap`, `searchThenFetch`/`resolveThenRetrieve`, `withToolObservability`), and a broad correctness sweep: `LLMRequestCompleted` finally has a producer (nine downstream consumers were silently starved), cache-token accounting now works across all four cloud/local providers instead of Anthropic-only, and a kernel lifecycle-hook audit closed three gaps (missing `bootstrap`-`after`, `think` firing on tool passes, missing kernel `observe`).
- **v0.15.0** (released): a security fix (`.withApprovalPolicy({mode:"block"})` was previously an inert switch — a `requiresApproval` tool ran unattended), plus a cluster of correctness fixes found in live-model QA and dynamic OpenAI-compatible provider config.
- **v0.14.0** (released): the audit's façade closed — tool policy enforced at the shared execution choke point on every strategy, abstention honest on all eight strategies, sub-agents fork into the parent fiber tree, `result.receipt` and the process model (`inspect()`/`fork()`/`rax ps`/`rax attach`) shipped.
- **Neither v0.15 nor v0.16 was an Arc milestone.** Both were interim cuts driven by dogfooding and release-prep verification, same as the note in the previous revision of this doc predicted for v0.15 — it turned out true for v0.16 too. **Arc 2 ("The Boundary & The Gate") has not started.** This is not a setback: the fixes that landed instead (harness control surface, cost/tracing accuracy, tool index) are real, shipped value: the pattern just means this doc's old version-to-arc pinning was a guess that didn't hold, so this revision stops pinning arcs to specific version numbers and sequences by ranked leverage instead.
- **Competitive receipts in hand:** public local-model bench (RA vs LangChain vs Vercel AI SDK vs Mastra vs bare LLM) — RA best-of-6 on accuracy after grounded-termination fixes, honest per-dimension trade-offs published. **Still owner-gated, unchanged since v0.14: a third-party benchmark score.** τ-bench's adapter/loader/pass-k harness has existed since before v0.15 and has never been run — see v0.17 below.

**What we learned (and publish honestly):**
- Heavy strategies (reflexion / tree-of-thought / plan-execute) show no quality lift over the reactive kernel on our benches at 3–15× local cost. Documented as frontier/niche options.
- Two more mechanisms cleared or failed the project's own lift rule this cycle: `_enableMemory`/`_enableMemoryConsolidation` (REWORK, stay opt-in — real lift but too much token overhead, or a ceiling effect with zero lift) and `RA_STABLE_TOOL_SURFACE` (REMOVED, +66.5% billed overhead vs a 15% ceiling). The discipline of measuring before defaulting-on keeps paying off — see `wiki/Architecture/DEBT-REGISTER.md` for the full ledger.
- The defensible strengths are unchanged from v0.14: agents that work on local models (per-model calibration, healing pipeline, tier-adaptive context), the local flight recorder (replay + diagnosis CLI, no SaaS), and the durable run rail (crash-resume, HITL, resumable streams).

---

## The Agentic OS program (v0.14 → v1.0)

North star: **runs are processes, execution history is inspectable, trust is a type, the runtime learns the model it drives, and every consenting run improves the platform.** Full detail: `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md`.

Releases below are sequenced by **ranked leverage**, not a fixed arc-per-version mapping — a lesson from this doc's own drift: v0.15 and v0.16 were both supposed to be Arc 2, and both correctly deferred it when higher-leverage dogfooding work showed up instead. This revision names what's actually ready to ship next, in the order the evidence supports.

### v0.17 — "Proof" — clear the oldest open promise
The v0.14 launch gate has had one item stuck `⏳ owner-gated` for three releases: **published third-party bench receipts.** This release exists to clear it.
- **Run τ-bench.** `packages/eval`'s adapter/loader/pass-k harness plus the vendored airline+retail data have existed since before v0.15 and have zero reports in `wiki/Research/Harness-Reports/` (re-verified 2026-09-03). Run it, publish the number — good, bad, or mixed — same honesty discipline as every other published figure in this repo.
- **Ship 4 new `packages/eval` dimensions:** Context Efficiency Ratio, Verification Cost Overhead, Trajectory Recovery Rate, Memory Hygiene Index. `RunLedger` already holds the inputs for all four — this is a projection task, not new instrumentation, which is why it's sequenced before the heavier Arc 2 work below (it makes every ablation after this release measurably better, including Arc 2's own honesty-default-on candidates).
- **Show-HN fires when the τ-bench receipt lands** — the exact gate this doc has carried since v0.14.

### v0.18 — "The Boundary & The Gate" (Arc 2 — finally)
The original Arc 2 scope, unstarted since it was first named in the v0.14 roadmap:
- **Enforcement at the `ToolService` boundary itself.** `allowedTools`/`forbiddenTools` + the contract deny-list already gate every reasoning path (landed v0.14); this pushes the check into `ToolService.execute` so *non-reasoning* callers inherit it too, plus **approval** and **per-tool budget** enforcement at that same boundary, `IdentityService.authorize()`, and the audit log.
- **Config truthfulness:** unknown builder options rejected loudly; inert combinations warned (e.g. durable checkpoints require the kernel path); the builder never lies.
- **BYO eval gate:** one report shape across `packages/eval` and the lift-gate/ledger (built on v0.17's new dimensions); `rax eval gate` runs on user suites, not just internal benches.
- **HS-236 (filed 2026-09-03, not built):** with no `.withRequiredTools()`/`TaskContract` declared, the framework has *no gate of any kind* on tool use — fully permissive by design. A free static-regex heuristic over deliverable phrasing (not an LLM call) is the proposed direction; scope undecided. This is a natural companion to the boundary work above — evaluate it here, don't build it speculatively before then.

### v0.19 — "Local-Tier Efficiency" — cluster of evidence-gated wins
Three items, each individually cheap, each blocked on the same discipline: measure before defaulting on.
- **W7 — MCP server surface.** `packages/tools/src/mcp/` is client-only; `packages/a2a` already has both client and server. Cheap, unblocked, and it's a real capability gap (agents can consume MCP tools but can't be exposed as one) — not cleanup.
- **Context-budget tuning** (`D-2026-07-30-H`/`D-2026-07-30-I`, DEBT-REGISTER): the `mid`-tier tool-result preserve budget (1200 chars) is smaller than the `local`-tier one (4000), an inverted allocation for a more capable model tier; separately, `predictNumCtx`'s demand-driven context-bucketing is fully built and wired to nothing. Both are owner-gated pending a before/after ablation — the register explicitly warns against a speculative spot-fix.
- **`goal_state` lift measurement** (`D-2026-07-28-C`): wired 2026-09-05 (plan-execute composite steps recite sibling-step titles as remaining sub-goals), live-verified end to end against a real ollama model, but the cross-tier lift has not been measured. The register's own planner note: a future ablation should hand-construct the `Plan` directly rather than rely on a local model's planner naturally choosing `composite` steps.

### v0.20 — "The Team" (Arc 3)
- A2A last mile (executor bridged, server actually started, real SSE) → cross-machine agent collaboration.
- Sub-agent events propagate to the parent bus (observable teams; Cortex team topology).
- Orchestration durability moved onto the RunStore rail (workflow crash-resume).
- MissionBrief / UpwardReport as typed primitives; parents verify child receipts (trust chain).
- Orchestration pattern breadth ships **behind the multi-agent bench** — no headline without lift evidence.

### v0.21 — "The Flywheel" (Arc 4)
- Healing outcomes feed learned aliases back into calibration; auto-calibration for unknown models (probe → community profile → generic).
- Skill/capability contribution to the community API (opt-in, transparent) — the substrate adapter.
- Commons transparency contract enforced: published payload schema, open aggregate data, first-run notice, never content/PII.
- Harness packages with attached eval receipts; verifiable self-improvement (replay-validated, gate-passed, ledgered) — the capstone, last.

### v1.0 — Polish & Release
- Every milestone gate re-run on the integrated codebase; every dead seam wired or deleted (zero declarative debt — `wiki/Architecture/DEBT-REGISTER.md`'s ratchet at zero open items).
- `README.md` states only validated claims; 8-pillar artifact table complete.
- This doc rewritten: what shipped, what was deferred, what was killed and why.

---

## Strategic positioning

The framework's defensible value, per empirical evidence:

- **Local-first reliability** — per-model calibration + live community profiles, capability-signal routing, healing pipeline, tier-adaptive context. Same agent code on a 4B Ollama model and a frontier model.
- **Control** — developer-overridable harness (`.compose()`/`.withHarness()`), killswitches, pause/resume/stop/inspect/fork today. Enforcement moves to the boundary in v0.18 (Arc 2).
- **Observability** — default-on traces, replay + diagnosis CLI, OTel export, and (as of v0.16) accurate cache/billed-token accounting across every provider — all local, no SaaS coupling.
- **Honesty** — we publish our own overhead numbers, negative results, and our own audit's façade findings; claims scope per `01-RESEARCH-DISCIPLINE.md` Rule 11. The receipt (v0.14) makes this a runtime feature, not just a culture; v0.17 extends the same discipline to third-party benchmark exposure.

What we do **not** yet have:
- Named production users / case studies (v0.14 launch began this; still open).
- Third-party-hosted benchmark validation — v0.17 exists to close this.

---

## How to track progress

- **North star** — `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` (direction + arcs + gates)
- **Canonical debt ledger** — `wiki/Architecture/DEBT-REGISTER.md` (every open item, evidence, and the gate that keeps a fix fixed)
- **Decision records** — `wiki/Decisions/`
- **Hot cache** (`wiki/Hot.md`) — current working state
- **Implementation plans** — `wiki/Planning/Implementation-Plans/`
- **Evidence artifacts** — `wiki/Research/Harness-Reports/`
- **Release tags** are cut by CI from `main`; CHANGELOG entries are authoritative

*Roadmap is rewritten on major releases or strategic shifts — not per commit.*
