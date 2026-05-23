---
tags: [audit, primitives, fresh-lens, framework-design, agent-canon, research]
date: 2026-05-23
author: Tyler Buell + Claude (Opus 4.7)
companion-required-reading:
  - wiki/Architecture/Specs/00-VISION.md
  - wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md
  - wiki/Architecture/Specs/06-MISSION-STATEMENTS.md
  - wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md
  - wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md
status: draft (audit only; recommendations require gate-validation before becoming roadmap)
lens: combined (kernel runtime + DX surface)
---

# Reactive Agents — Fresh-Lens Primitive Audit

> **Purpose.** Treat Reactive Agents as if encountering it new. Enumerate the primitive set that every serious agent framework ships (drawn from external canon, not our own taxonomy), crosswalk each primitive to packages/files, classify status (present / partial / scaffold-only / missing), then surface gaps *not already* captured in North Star §2.3 or the 2026-05-23 harness-convergence morph plan.
>
> **Anti-goal.** Re-deriving our own 10-capability / 5-trait / 8-pillar canon. North Star v5.0 + Mission Statements already do that. Value here is in the **delta to external canon.**

---

## TL;DR (30-second verdict)

- **Substrate primitives are mature.** LLM provider abstraction, tool registry, MCP client, sandbox, memory, identity, guardrails, HITL approval gates, trace bus, A2A, killswitches, run handles, framework adapters — all present and tested. Coverage of external canon estimated ~85%.
- **Gaps cluster in four patterns:** (a) **canonical capability seams missing as kernel directories** (`recall/`, `learn/`); (b) **declared-but-unwired signals** (cost/budget exists but is not an Arbitrator signal); (c) **multi-agent / workflow depth is thin** relative to LangGraph/AutoGen canon; (d) **modality + structured-output enforcement** at the LLM boundary are narrower than provider capability.
- **Three Tier-1 fixes recommended** (candidates for amendment into a future convergence phase, not auto-merge into the active #104–#125 issue set): **G-A** cost→Arbitrator wiring, **G-C** `kernel/capabilities/recall/`, **G-D** `kernel/capabilities/learn/`. Tier 2–4 items below.

---

## 0. Methodology

Three external canons consulted:

1. **Production agent framework SDKs.** LangGraph (`StateGraph`, `Thread`, checkpointing), OpenAI Agents SDK (`Agent`, `Session`, `Runner`, structured output, handoffs), Claude Agent SDK (`Agent`, `Tools`, `MCP`, computer-use), AutoGen v0.4 (`Team`, `GroupChat`, `Codebench`), Pydantic AI / Mastra / VoltAgent.
2. **Open protocol layers.** Model Context Protocol (MCP — tool + resource + prompt + sampling), Agent-to-Agent (A2A — `AgentCard`, `Task`, `Message`, lifecycle).
3. **Research patterns assumed implementable.** ReAct (`Thought → Action → Observation`), Reflexion (verbal self-reflection memory), Tree-of-Thoughts (branching + voting), Voyager (skill library + curriculum), AutoGPT-class outer loops (plan → execute → critique → revise), NLAH (`arXiv:2603.25723` — sub-agent compute concentration, file-backed state, acceptance-gated narrowing).

Each primitive is the **smallest unit the external canon treats as named and addressable.** Our internal capability decomposition is a *consumer* of these primitives, not a replacement for the audit.

---

## 1. The Primitive Crosswalk

Status legend:

- ✅ **present** — shipped, tested, documented
- 🟡 **partial** — shipped but narrow / underspecified / unwired in some paths
- ⚠️ **scaffold-only** — surface exists, runtime emit/consumer missing (G-9 "scaffold without callers" anti-pattern)
- ❌ **missing** — no implementing code

### 1.1 LLM-substrate primitives

| Primitive | External canon source | Reactive Agents location | Status | Notes |
|---|---|---|---|---|
| Provider abstraction | OpenAI/Anthropic/Gemini/Ollama SDKs | `packages/llm-provider/` | ✅ | 254/254 tests, 7 adapter hooks (M12 KEEP) |
| Native function calling | All major SDKs | `llm-provider/adapters/` + `tools/function-calling/` | ✅ | Provider-uniform via `complete()` + `stream()` both receive `tools` |
| Streaming (text + tool-call deltas) | All SDKs | `core/streaming.ts` FiberRef + `kernel/capabilities/reason/stream-parser.ts` | ✅ | Fiber-local, cross-run safe |
| Multi-modal input (image) | OpenAI/Anthropic/Gemini | `ContentBlock` union in `llm-provider/types.ts:519` | 🟡 | Text + image only; **no audio, no video, no PDF block** |
| Structured output / schema-enforced response | OpenAI `response_format`, Anthropic JSON-mode, Gemini `responseSchema` | — (no `LLMService.complete({schema})` API) | ❌ | Strategies coerce via tools or prompt; provider-native schema enforcement not surfaced |
| Prompt caching | Anthropic / OpenAI | `llm-provider/types.ts` `CacheControl`, `makeCacheable()` | ✅ | First-class on `ContentBlock` |
| Token + cost accounting per call | All SDKs | `TokenUsage`, `cost/cost-service.ts`, trace events | ✅ | Naming inconsistency on `totalTokens` ↔ `tokensUsed` (#126) |
| Cross-provider model routing / fallback | OpenAI `model_settings`, OpenRouter, LiteLLM, Mastra | `cost/routing/complexity-router.ts` (10K) — Provider × ModelTier matrix (anthropic/openai/gemini/ollama/litellm × haiku/sonnet/opus) | ✅ | Cost-aware routing primitive present |

### 1.2 Tool / action primitives

| Primitive | External canon | Location | Status | Notes |
|---|---|---|---|---|
| Tool registry & dispatch | All SDKs | `tools/tool-service.ts` (19K), `tools/registry/` | ✅ | |
| Tool schema (Zod / JSON Schema) | All SDKs | `tools/define-tool.ts` (8K), `tools/validation/` | ✅ | |
| RAG retriever primitive | LangChain, LlamaIndex | `tools/rag/` | ✅ | Wired through tool service |
| MCP client (tools + resources + prompts) | Anthropic MCP spec | `tools/mcp/mcp-client.ts` (26K) | ✅ | Two-phase docker container naming, transport auto-detect |
| Sandbox / code execution | OpenAI `code_interpreter`, Anthropic computer-use | `tools/execution/docker-sandbox.ts` (15K) + `sandbox-image/` | ✅ | First-class — *under-advertised in public docs* |
| Browser-use / web automation | OpenAI Operator, Anthropic computer-use | — | ❌ | No `tools/browser/` |
| Computer-use (desktop control) | Anthropic computer-use API | — | ❌ | No `tools/computer/` |
| Healing / retry on tool error | Mastra retry policies | `tools/healing/` (M4 KEEP, 86.7% recovery) | ✅ | |
| Caching (response / call result) | LangChain `LLMCache` | `tools/caching/` + `cost/caching/` | ✅ | |

### 1.3 Memory / knowledge primitives

| Primitive | External canon | Location | Status | Notes |
|---|---|---|---|---|
| Short-term memory (window) | LangGraph, OpenAI Threads | `kernel/loop/runner.ts` `applyMessageWindow` | ✅ | |
| Long-term memory (SQLite/vector) | LangGraph store, Mem0 | `packages/memory/` (database.ts 12K, search.ts 7K, sqlite-vec) | ✅ | |
| Episodic memory (per-run trajectory) | Reflexion | `memory/` services + RI bandit-store | 🟡 | Recall 100% keyed / 66.7% verbose (M10 IMPROVE) |
| Skill library (Voyager-style) | Voyager, Mastra | `tools/skills/` + RI `skills/skill-synthesis.ts` | 🟡 | Within-session works; cross-session persistence is M6 IMPROVE |
| Memory compaction / extraction | LangChain summarizer | `memory/compaction/`, `memory/extraction/` | ✅ | |
| Memory recall as kernel capability | Implicit in canon | — `kernel/capabilities/recall/` does **not exist** | ❌ | Step 4 of Optimal Execution Algorithm has **no implementing directory.** Memory calls scattered |

### 1.4 Reasoning / control primitives

| Primitive | External canon | Location | Status | Notes |
|---|---|---|---|---|
| ReAct loop (Thought → Action → Observation) | Yao 2022 | `strategies/reactive.ts` + `kernel/loop/runner.ts` | ✅ | Default strategy |
| Reflexion (verbal critique → revise) | Shinn 2023 | `strategies/reflexion.ts` | ✅ | Outer-loop strategy |
| Tree-of-Thoughts | Yao 2023 | `strategies/tree-of-thoughts.ts` | 🟡 | Outer loop bypasses kernel emit (G-10 F1) |
| Plan-Execute-Reflect | LangChain plan-and-execute | `strategies/plan-execute.ts` | 🟡 | Wave scheduler; tool dispatch bypasses single-entry (G-10 #115) |
| Strategy switching (adaptive) | AutoGen orchestrator | `runtime/runtime.ts:915` + `kernel/capabilities/reflect/strategy-evaluator.ts` | ✅ | Default-on May 12 |
| Termination decision (Arbitrator) | Implicit | `kernel/capabilities/decide/arbitrator.ts` | 🟡 | Single-owner shipped (FIX-18) but **does not receive `BudgetSignal`/`CostSignal`** (see Gap G-A) |
| Verifier (post-action correctness check) | OpenAI Agent SDK guardrails | `kernel/capabilities/verify/verifier.ts` | 🟡 | Boolean today; severity ladder is Mission target (Pillar Verify) |
| Killswitch / max-iter / timeout | LangGraph recursion-limit | `compose/killswitches/` (5 switches: budget-limit, max-iter, timeout, watchdog, require-approval) | ✅ | |
| Pause / stop / resume run handle | OpenAI Agents `Runner` cancel | `core/streaming.ts` `RunControllerRef` | ✅ | |

### 1.5 Safety / governance primitives

| Primitive | External canon | Location | Status | Notes |
|---|---|---|---|---|
| Guardrails (input/output filter) | OpenAI Agents `input_guardrails`, `output_guardrails` | `guardrails/detectors/` + `behavioral-contracts.ts` | ✅ | |
| Identity / authz / audit | Enterprise reqs | `identity/` (auth/authz/audit/) | ✅ | Propagation across A2A boundary unverified (Gap G-J) |
| Cost budget enforcement | LangChain budget callback | `cost/budgets/` + `compose/killswitches/budget-limit.ts` | 🟡 | Tracked + can terminate, but **not integrated as Arbitrator signal** (Gap G-A) |
| Approval gate / HITL | LangGraph interrupt, AutoGen UserProxyAgent | `packages/interaction/services/interaction-manager.ts` (approvalGate), `checkpoint-service.ts`, `mode-switcher.ts` | ✅ | **First-class, well-implemented, under-advertised in README/docs** |
| Risk-level on tool | Claude Code permission system | `tools/types.ts` `requiresApproval` | 🟡 | Field exists; gate enforcement varies per caller |

### 1.6 Multi-agent / orchestration primitives

| Primitive | External canon | Location | Status | Notes |
|---|---|---|---|---|
| Sub-agent / delegation primitive | OpenAI Agents handoffs, AutoGen | M8 (NS §2.2 IMPROVE elevated) + `orchestration/multi-agent/worker-pool.ts` (3.7K) | 🟡 | Mechanism exists; lift unvalidated; surface area thin vs NLAH 90%-of-compute claim |
| Worker pool | AutoGen GroupChat | `orchestration/multi-agent/worker-pool.ts` | 🟡 | One file, 3.7K — **thin relative to canon** |
| Workflow / declarative DAG | LangGraph `StateGraph`, Burr, Inngest | `orchestration/workflows/` | 🟡 | Minimal file count; no graph-construction surface like `addNode/addEdge` audited |
| Durable execution / event-sourcing | Temporal, Inngest, Restate | `orchestration/durable/event-sourcing.ts` (3.7K) | 🟡 | One file — **likely scaffold-grade vs Temporal-class durability** |
| A2A messaging | Google A2A spec | `packages/a2a/` (client/server/agent-card) | ✅ | Surface complete; identity propagation through it unaudited |
| Session / conversation as typed primitive | OpenAI Agents `Session`, LangGraph `Thread` | `runtime/gateway-chat.ts` | 🟡 | Implementation exists; **not exposed as a typed framework primitive** — gateway-chat is one consumer, not the canonical type |
| Channels (multi-transport I/O) | n/a (proprietary) | `packages/channels/` (adapters + services) | ✅ | |

### 1.7 Observability / determinism primitives

| Primitive | External canon | Location | Status | Notes |
|---|---|---|---|---|
| Structured trace event bus | LangSmith, OpenAI Agents tracing, Inngest events | `packages/trace/` + `observability/` + `observe/` (3 packages) | ✅ | Rich; capability-scoped emit incomplete (G-10 #113) |
| OpenTelemetry export | All major SDKs | NS §6 Phase B item — *re-verify before claim* | 🟡 | `packages/observe/` exists; OTel completeness not in audit scope |
| Replay (deterministic) | LangSmith replay, OpenAI Threads replay | `packages/replay/` (snapshot, tool-table, replay-controller) | 🟡 | Snapshot+diff + tool-table replay; **no LLM-response cassette** — cannot replay LLM bytes deterministically |
| Telemetry / event bus | All SDKs | RI `telemetry/` + `observability/` | ✅ | |
| Run handle / lifecycle hooks | OpenAI Runner hooks | `core/streaming.ts` + `kernel/state/kernel-hooks.ts` | ✅ | |
| Eval / scenarios / benchmarks | LangSmith eval, Inspect | `packages/eval/`, `scenarios/`, `benchmarks/`, `verification/`, `judge-server/` | ✅ | Five complementary packages |

### 1.8 DX / developer-surface primitives

| Primitive | External canon | Location | Status | Notes |
|---|---|---|---|---|
| Agent builder DSL | OpenAI `Agent(...)`, LangGraph `compile()` | `runtime/builder.ts` (2.4K LOC post-W25) + `packages/reactive-agents/` | ✅ | Post-decomp |
| Compose API (declarative behavior injection) | OpenAI `input_guardrails=[...]`, Mastra workflows | `packages/compose/src/` | ⚠️ | **Index.ts is 100B + only `killswitches/` subdir; 4 dead tags per G-9.** Spec is rich (`2026-05-06-compose-harness-api.md`); runtime is thin |
| Scaffolding CLI | `create-next-app`, `npm init` | `packages/create-reactive-agent/` | ✅ | NS §6 v0.11 launch-readiness |
| Prompt templates / lineage | LangChain `PromptTemplate`, Mastra prompts | `packages/prompts/` | 🟡 | Surface unaudited for versioning/lineage |
| UI framework adapters | Vercel AI SDK React/Svelte/Vue | `packages/react`, `svelte`, `vue` | ✅ | |
| Health / readiness | k8s, observability stack | `packages/health/` | ✅ | |
| HTTP gateway | OpenAI Agents `Runner` + uvicorn, Mastra dev server | `packages/gateway/` | ✅ | |

---

## 2. Primitive Gaps Not Already in North Star

These are the **delta** items. North Star §2.3 (G-3, G-4, G-7, G-8, G-9, G-10) and convergence spec #104–#125 already cover surface-trust, scaffold-without-callers, and capability-emit drift. The items below are **not** in those lists.

### Gap G-A — Cost/budget as Arbitrator signal

**Symptom.** `grep -n "BudgetSignal\|CostSignal\|budgetExceeded\|costExceeded" packages/reasoning/src/kernel/capabilities/decide/` returns **zero matches.** Yet Pillar 6 (Efficiency) and Optimal Execution Algorithm §1 step 6 list `BudgetSignal` as one of six signals fed into the Arbitrator.
**Reality.** Budget enforcement happens via `compose/killswitches/budget-limit.ts` — a parallel termination path, not a Verdict input.
**Classification.** Wiring hole (the surface exists; integration into the canonical decision point does not).
**Recommendation.** Add `BudgetSignal` collector that pulls from `CostService.getBudgetStatus()` and feeds Arbitrator. Termination via killswitch becomes a fallback, not the primary path.

### Gap G-B — Structured output schema enforcement at LLMService boundary

**Symptom.** `LLMService.complete()` has no `schema` / `responseFormat` parameter. All providers natively support this (Anthropic JSON-mode, OpenAI `response_format`, Gemini `responseSchema`).
**Reality.** Strategies coerce to JSON via tools (`structured-output-tool` pattern) or prompt-engineering. Provider-native enforcement underused.
**Classification.** Primitive hole (missing surface).
**Recommendation.** Add typed `complete({ schema: Schema<T> }) → Effect<T, ...>` overload. Backends choose provider-native enforcement when available, fall back to tool-coerced + validate.

### Gap G-C — Recall as named kernel capability directory

**Symptom.** `kernel/capabilities/recall/` does not exist. The 10-capability model (`05-DESIGN-NORTH-STAR.md §3.1`) and Optimal Execution Algorithm step 4 require it; the directory is silently absent.
**Reality.** Memory queries happen inline in `runner.ts` / `attend/context-utils.ts`. No emit point owns `memory-recall`.
**Classification.** Primitive hole at the kernel taxonomy level (the service exists in `packages/memory/`; the *capability seam* does not).
**Recommendation.** Create `kernel/capabilities/recall/` with the three calls Optimal Execution Algorithm step 4 names (`recall`, `findSkills`, `loadProfile`). Emit `memory-recall`. Lift call sites from `attend/` and `runner.ts`.

### Gap G-D — Learn as named kernel capability directory

**Symptom.** `kernel/capabilities/learn/` does not exist. NS §4.3 calls this out (`⚠️ currently missing — Phase 2 of convergence spec creates it; M6/M7/M10 wired but scattered`). Worth foregrounding because the scattering is the bug — bandit logic lives in `reactive-intelligence/learning/`, skill synthesis in `reactive-intelligence/skills/`, calibration writes in `reactive-intelligence/calibration/`. There is no single seam.
**Classification.** Already-known primitive hole; promote priority because of compounding cost on M6/M10/M14.
**Recommendation.** Create `kernel/capabilities/learn/` as the canonical seam. M14 self-evolution hooks attach here, not under RI.

### Gap G-E — Audio / video / PDF modality blocks

**Symptom.** `ContentBlock` union (`llm-provider/types.ts:519`) is text-or-image. Modern multimodal models (Gemini 2.5, GPT-4o, Claude 4.7) support audio + video + PDF content blocks.
**Classification.** Primitive hole; modality limit not catalogued in NS §2.3.
**Recommendation.** Extend `ContentBlock` union with `audio`, `video`, `document` variants. Adapter mapping per provider; gracefully skip on providers that lack support.

### Gap G-F — Deterministic LLM-response replay

**Symptom.** `replay/snapshot.ts` records trace + tool-table; `replay-tool-layer.ts` replays tool results; `replay/load.ts` reads from `~/.reactive-agents/traces/<id>.jsonl`. No cassette-class layer surfaced inside `packages/replay/`. The `packages/testing/` package has a rule-based `MockLLM` (`createMockLLM(rules)` in `testing/mocks/llm.ts`) — useful for tests, but it is rule-based-mock, not byte-recording-of-real-runs.
**Reality.** Replay verifies re-execution produces equivalent trace stats; it does **not** deterministically reproduce the LLM bytes from a recorded production run. For debugging "why did the model say X on iter 7," there is no canonical re-run path. (Full audit of provider-side recording is deferred — adapters may already emit recordable shapes via `llm-exchange` trace events; a recorder/replayer that consumes those is what's missing.)
**Classification.** Primitive hole inside `packages/replay/`.
**Recommendation.** Add `LLMResponseCassette` recording + replay layer that consumes `llm-exchange` events. Frontier-bench reproducibility becomes a property.

### Gap G-G — Multi-agent orchestration depth vs canon

**Symptom.** `orchestration/multi-agent/worker-pool.ts` is one 3.7K file. AutoGen v0.4 `GroupChat`, OpenAI Agents handoffs, and the NLAH paper (NS §2.2 M8 — 90% of compute through children) all imply a much deeper surface: agent topology, handoff semantics, shared context, voting/consensus, manager-worker hierarchies.
**Classification.** Validation hole + primitive hole. M8 is flagged IMPROVE in NS — the *gap* this audit adds is that the *surface area itself* may be insufficient before lift can be measured.
**Recommendation.** Spike on canonical handoff API (e.g., `agent.handoffTo(otherAgent, context)`) and shared `RunContext` before re-running M8 evaluation.

### Gap G-H — Workflow / declarative DAG primitive

**Symptom.** `orchestration/workflows/` exists but minimal. No `addNode` / `addEdge` / `compile()` surface like LangGraph `StateGraph` or Burr. Compose is the per-iter composition primitive; there is no multi-agent / multi-step DAG primitive.
**Classification.** Primitive hole.
**Recommendation.** Evaluate whether this is in mission scope. If yes, design a declarative workflow primitive. If no, document explicitly: "Reactive Agents is single-agent strategies + A2A; multi-step pipelines compose externally."

### Gap G-I — Session / Thread as typed framework primitive

**Symptom.** `runtime/gateway-chat.ts` implements per-sender SQLite session history (40-turn windowing). This is a *consumer* of session, not a *typed primitive.* OpenAI Agents (`Session`), LangGraph (`Thread`), and Mastra (`Thread`) treat session as first-class type that can be passed across agent boundaries.
**Classification.** Primitive hole. Likely the right shape exists internally but is not exported.
**Recommendation.** Promote `Session` to `packages/core/types/session.ts`; have gateway-chat consume it. Enables session sharing across A2A.

### Gap G-J — Identity propagation across A2A / sub-agent boundaries

**Symptom.** `packages/identity/` exists with auth/authz/audit. `packages/a2a/` exists with client/server. No audit found that identity context propagates through a2a message envelope. NLAH-style sub-agent delegation needs to preserve auth context across the boundary.
**Classification.** Wiring hole; security-relevant.
**Recommendation.** Spec required; verify `Message` schema (`core/types/message.ts:metadata`) preserves identity claims through a2a transport.

### Gap G-K — Browser / computer-use primitive

**Note.** Code-execution sandbox is **already shipped** at `tools/execution/docker-sandbox.ts` (15K) + `sandbox-image/` (see §1.2). This gap is **only** about browser / desktop control — not about sandboxes generally.

**Symptom.** No `tools/browser/` or `tools/computer/`. Claude Code, Anthropic's computer-use API, OpenAI Operator, and Mastra all treat browser/computer control as first-class.
**Classification.** Primitive hole, scoped to browser + desktop. May be intentional out-of-scope; if so, document.
**Recommendation.** Decision: in-scope (build) vs out-of-scope (rely on MCP + external integration). Document the call.

---

## 3. Gap classification summary

| Class | Items | Disposition |
|---|---|---|
| **Primitive holes (add new surface)** | G-B structured output, G-C recall dir, G-D learn dir, G-E modality, G-F replay cassette, G-H workflow DAG, G-I Session type, G-K browser/computer | New design specs needed; gate-validate each |
| **Wiring holes (existing surface not integrated)** | G-A cost→Arbitrator, G-J identity through A2A | Convergence-spec-class work; no new packages |
| **Validation/depth holes (exists but thin or unproven)** | G-G multi-agent orchestration depth | Spike before measuring M8 lift |

Cross-reference: G-A overlaps NS Pillar 6 mission target but is not in §2.3 or convergence #104–#125 issue list. G-D is in NS §4.3 footnote but worth promoting. Remaining are net-new.

---

## 4. Recommendations — Prioritized

Tier the gaps by leverage × evidence-readiness:

### Tier 1 — Candidate amendments to a future convergence phase

These are **candidates**, not free-rider additions to the active #104–#125 issue set. Each needs a fresh GH issue and gate-evidence before merging into a numbered phase.

1. **G-A Cost→Arbitrator signal.** Sibling concern to Phase 0.5 cost-quality gates (#110, #111) but **not in scope of either issue.** Proposed amendment: add `BudgetSignal` collector that pulls from `CostService.getBudgetStatus()` and feeds Arbitrator. Test by ablating: agent with budget set to $0.01 should escalate via Arbitrator, not via killswitch interrupt.
2. **G-C Recall capability directory.** Adjacent to Phase 1 capability-scoped emit work (#113 is emit-scope, not directory-reorg). Proposed amendment: create `kernel/capabilities/recall/` and lift call sites from `attend/` and `runner.ts`. Emit `memory-recall`. No new logic — only seam.
3. **G-D Learn capability directory.** Distinct primitive hole, not yet ticketed. Proposed amendment: create `kernel/capabilities/learn/` as the canonical seam. Promotes scattered RI learning (bandit, skill-synthesis, calibration) into a named kernel capability. Unblocks M14 self-evolution clean-attach.

### Tier 2 — Single-cycle research spikes (one Phase 1.5 mechanism each)

4. **G-B Structured output enforcement.** Spike: extend `LLMService.complete` with optional `schema`; per-provider native vs tool-coerced fallback; measure parse-success on a structured-output gate corpus.
5. **G-F Deterministic LLM replay.** Spike: add LLMResponseCassette to replay package; verify bytewise reproduction on `ra-full` suite.
6. **G-J Identity through A2A.** Spike: verify Message metadata preserves auth claims; add propagation test.

### Tier 3 — Strategic decisions (do-or-document)

7. **G-G Multi-agent depth.** Decide: are we shipping a canonical handoff API? If yes, design spec required before M8 lift evaluation is meaningful. If no, document Reactive Agents as "single-agent + A2A only."
8. **G-H Workflow DAG.** Decide: orchestration package is the seam — own it (LangGraph-class), or document out-of-scope.
9. **G-K Browser/computer-use.** Decide: in-scope vs MCP-only.
10. **G-I Session type.** Likely yes — low cost, high DX value, unblocks A2A session sharing. Promote in next runtime/core touch.

### Tier 4 — Modality expansion (driven by external demand)

11. **G-E Audio/video/PDF modality.** Demand-driven; add when first user request lands, or when shipping a multimodal benchmark.

---

## 5. What the audit does NOT change

- **North Star v5.0 stands.** Every gap above is consistent with the v5.0 architecture mandate; none invalidate the 10-capability / 5-trait / 8-pillar canon.
- **Convergence spec stands.** The 22 GH issues #104–#125 remain the immediate Phase 0–3 work. This audit adds candidates for *future* convergence phases or a v0.12 morph.
- **Empirical state stands.** No claim here overrides the multi-model evidence runs from the 2026-05-23 sweep.

---

## 6. Next actions (proposed — require approval)

- [ ] File GH issues for Tier 1 gaps (G-A, G-C, G-D) under `harness-convergence` + `audit-2026-05-23-fresh-lens` labels
- [ ] Update NS §2.3 with G-A (cost wiring) and promote G-D footnote to numbered gap
- [ ] Update `wiki/Hot.md` with this audit reference
- [ ] Discuss Tier 3 decisions in a separate planning doc (do-or-document; not architectural until decided)

---

## Appendix A — External canon table (sources)

| Framework / spec | Primitive set scanned |
|---|---|
| OpenAI Agents SDK | `Agent`, `Session`, `Runner`, `RunContext`, `input_guardrails`, `output_guardrails`, handoffs, structured output, tracing |
| LangGraph | `StateGraph` (addNode/addEdge/compile), `Thread`, checkpointing, `interrupt`, persistence layer |
| Claude Agent SDK | `Agent`, MCP, tools, computer-use, prompt caching |
| AutoGen v0.4 | `Team`, `GroupChat`, `ConversableAgent`, `UserProxyAgent`, `Codebench` |
| Mastra | workflows, threads, retry policies, dev server |
| MCP spec | tools, resources, prompts, sampling, completions |
| A2A spec | `AgentCard`, `Task`, `Message`, lifecycle states |
| Research | ReAct, Reflexion, ToT, Voyager, NLAH (`arXiv:2603.25723`), Self-Refine |

## Appendix B — Sources read for this audit (internal)

- `wiki/Architecture/Specs/00-VISION.md`
- `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` (§§ 1–4 read)
- `wiki/Architecture/Specs/06-MISSION-STATEMENTS.md`
- `wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md` (§§ 0–2 read)
- `wiki/Hot.md`
- `NAVIGATION.md`
- `packages/{compose,reasoning,reactive-intelligence,llm-provider,tools,cost,identity,replay,interaction,guardrails,orchestration,memory,channels,core,verification,a2a}/src/`
- Grep evidence: multimodal `ContentBlock` (text+image only), no `BudgetSignal` in `decide/`, no `kernel/capabilities/{recall,learn}/`, structured-output absent from `LLMService` API
