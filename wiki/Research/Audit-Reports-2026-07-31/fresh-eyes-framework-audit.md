# Fresh-Eyes Framework Audit — Reactive Agents (2026-07-31)

**Method:** 3 parallel read-only code-audit agents (harness core / support layers / simplification+doc-drift, all grep-verified) + hands-on first-user live QA against Ollama `gemma4:12b` (real tool loops, error paths, `.chat()`) + competitive positioning. Scope: `packages/reasoning` (59k LOC) + `packages/runtime` (38k) core harness, plus llm-provider / tools / memory / reactive-intelligence.

Bottom line: the harness is architecturally sound where it counts (clean layer separation, single-owner termination, tool-call healing that genuinely finishes on a 4B local model, error messages that teach). The leverage is in **four structural drags** that cost velocity and undercut the headline claims: a duplicated agent loop, a write-only "memory" layer, a critical async-tool timeout bug, and heavy per-run token overhead.

---

## P0 — Ship now

> **STATUS 2026-07-31: P0-1 + P0-2 FIXED + verified.** `tool-service.ts:405` defaults to 30 s; `sandbox.ts` guards non-finite `timeoutMs` at the boundary (`DEFAULT_TOOL_TIMEOUT_MS`); `resolveLocalTimeoutMs` (`local.ts`) uses `Number.isFinite` rungs. Regression tests added to `sandbox.test.ts` (undefined + NaN). Live re-run: async tool succeeds first try, `receiptToolCalls:[{name:"slow_lookup",ok:true}]`, no `TimeoutNaNWarning`. Tools + llm-provider build green; sandbox/tool-service suites pass.

### P0-1. Async custom tools silently fail at a 1 ms timeout (CONFIRMED live)
`packages/tools/src/tool-service.ts:405` passes `timeoutMs: tool.definition.timeoutMs` with **no default**. A tool registered via the raw object path — `.withTools({ tools: [{ definition, handler }] })`, the shape shown in `builder/types.ts:106` JSDoc and every README custom-tool example — has no `timeoutMs`, so `undefined` flows to `Duration.millis(undefined)` (`execution/sandbox.ts:32`) → NaN → Effect coerces to **1 ms**.

Live repro (a 50 ms async tool, no `timeoutMs`, on `gemma4:12b`):
```
tool-result success:false  preview:"[Tool error: Tool execution timed out after undefinedms ...]"  (×3 retries)
output: "The tool was unable to retrieve the record ... because it repeatedly timed out."
```
The agent then hallucinates around its own broken harness. Synchronous tools survive (finish before the race); any real async tool (HTTP / file / MCP) fails. This directly falsifies the "reliable on every tier" claim for the primary first-user path.

Scope note: `defineTool` (`define-tool.ts:549`) and the fluent `ToolBuilder` (`tool-builder.ts:8`) both default `timeoutMs = 30_000`, so tools built through those are safe. Only the raw-object registration path is broken.

**Fix (1 line, safe — matches the existing 30 s default):**
```ts
// tool-service.ts:405
timeoutMs: tool.definition.timeoutMs ?? 30_000,
```
Also tighten `sandbox.ts:6` — the option type says `timeoutMs: number` but receives `number | undefined`; make it non-optional at the boundary and default upstream. Add a regression test: async tool, no `timeoutMs`, asserts success.

### P0-2. `OLLAMA_TIMEOUT_MS` NaN passthrough (latent, same class)
`llm-provider/src/llm-config.ts:373` — `ollamaTimeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS)`. `resolveLocalTimeoutMs` guards with `??`, which does **not** catch NaN, so any non-numeric env value becomes a 1 ms LLM timeout. Guard with `Number.isFinite`.

---

## P1 — Highest structural leverage

### P1-1. Two parallel agent loops (inline vs kernel) — the confound factory
`runtime/src/execution-engine.ts:741` branches on `reasoningOpt`. The `Some` arm runs the kernel; the `None` arm runs a **~1,580-LOC inline reimplementation** (`engine/phases/agent-loop/inline-{think,act,observe}.ts`, `inline-harness-hooks.ts`, `verification-*.ts`). A bare `createAgent()...build()` **without `.withReasoning()`** takes the inline path (`_enableReasoning` defaults false, `builder.ts:360`) — i.e. the default first-user agent runs the *second* loop. `reasoning-harness-hooks.ts` is literally documented as "Mirror of the inline-path harness hooks."

This is the root of the confound class the project keeps rediscovering (memory records 4 findings retracted to inline-vs-kernel). Every harness improvement must be built and verified twice. **Fix direction:** route the bare builder through the kernel `direct` strategy (already a thin `runKernel(reactKernel)` wrapper, `direct.ts:176`); delete the inline phases. One loop, one place every future fix lands. Risk Med/High (behavior-visible), leverage very high.

### P1-2. The memory retrieval layer is dead — the loop only writes
`memory/src/search.ts` exposes `searchSemantic`/`searchEpisodic`/`searchVector` — **zero callers** outside the package. The kernel surface (`kernel/state/kernel-state.ts:991`) is `storeSemantic` only; `tool-execution.ts:133` embeds + persists a semantic entry on **every successful tool result**, and nothing ever queries it. So the loop pays the embedding + write cost every step and reads none of it, while the advertised "semantic recall" is non-functional. Worse, the `recall` builtin (`tools/src/skills/recall.ts:64`) is a **second, disconnected** memory — an ephemeral in-run `Map` with its own keyword scorer, unrelated to the SQLite store. And `searchVector` (`search.ts:141`) is an **O(n) JS cosine scan**, not the advertised sqlite-vec KNN. Per-layer upper consumers: Semantic 0, Working 0, Episodic 1, Procedural 2 — the write-only skew is exactly Semantic/Working.

**Fix direction (one coherent move):** either wire `MemorySearchService` into a kernel recall phase and back `recall`'s search with it (gate behind the lift bar), or stop computing+storing embeddings until a reader exists. Removes dead write-cost now; unlocks real cross-step memory later.

### P1-3. Loop detector only catches byte-identical repeated calls
`kernel/capabilities/reflect/loop-detector.ts:56` fires only when the last N **actions** have identical normalized tool+args. A model thrashing with trivially varied args (re-reading different paths, reworded searches, paging) never trips it → neither strategy-switch nor graceful exit fires → the run burns to `maxIterations`. This is the concrete mechanism behind "strategySwitching rarely triggers." **Fix:** add a "no new successful observation" loop signal (the `observationResult.success` field already exists) independent of arg equality. Highest-leverage *behavioral* fix — directly makes stuck runs finish cheaper on every tier. Related: `tier-guards.ts:40` sets `maxSameTool` local=2 / frontier=5, so the weakest models are policed hardest and the strongest escape — reconsider once the signal lands.

### P1-4. `iterate-pass.ts` — 1,644-LOC single function, mutable carrier + hand-written `sync()`
`kernel/loop/iterate-pass.ts` is a verbatim mechanical extraction (comment `:387` "ORIGINAL BODY VERBATIM"), state threaded through a mutable `carrier` with a `sync()` (`:369`) that **every** early `return "break"|"continue"` (~10 sites) must remember to call. A missed `sync()` silently corrupts loop counters/`currentInput`/`switchCount` on the next pass — a latent, hard-to-test bug class in the single hottest control-flow file. **Fix:** return a typed delta per branch instead of mutate-then-sync; split pause/act/loop-detect/required-tool/stall into named steps. Reliability debt paid on every run.

---

## P2 — Duplication / cost / cleanup

- **Provider streaming duplication.** The tool-call suppress-then-synthesize state machine is copy-pasted across `openai.ts:398`, `gemini.ts:456`, `litellm.ts:335`, `anthropic.ts:334`; extract `streamWithAdapterNormalization(...)` into `streaming-helpers.ts`. And `litellm.ts` is a **766-LOC re-implementation** of the OpenAI-compat provider (`makeOpenAICompatProvider`, already used by openai/groq/xai) despite LiteLLM being OpenAI-compatible — route it through the factory, delete the bespoke fetch loop. `toEffectError` is duplicated ×4 (anthropic/litellm/gemini/openai; openai's is already `provider`-parameterized) — consolidate.
- **Dead extensibility.** `StrategyRegistry.registerKernel/getKernel/listKernels` + the `kernelRef` map (`services/strategy-registry.ts:104`) have **0 call sites**; strategies reach the one kernel by direct import. Delete. `PlanExecuteConfigSchema.patchStrategy` (`types/config.ts:32`) — decoded, documented, **0 readers**. Delete or wire.
- **Default loop-switch pays an extra LLM call.** On loop detection with default config (`strategySwitching.enabled` true, no `fallbackStrategy`), `iterate-pass.ts:1416` calls `evaluateStrategySwitch` — an LLM round-trip — on exactly the runs already going badly. Default `fallbackStrategy` to a deterministic escalation; reserve the evaluator for multi-candidate configs.
- **Public `any` in the tool surface.** `builder/types.ts:121` — `handler: (args) => Effect.Effect<unknown, any>` violates the project's own no-`any` standard on a first-class public type.

---

## Live QA receipts (first-user, `gemma4:12b`)

| Test | Result |
|------|--------|
| Bare `createAgent` run | ✓ 10.3 s, **344 tokens**, `verifierVerdict: pass` |
| Custom sync tool loop | ✓ finished, correct answer, but **5,100 tokens** for one weather call + `TimeoutNaNWarning` |
| Custom **async** tool loop | ✗ **P0-1** — 3× "timed out after undefinedms", agent gives up, 10,769 tokens |
| Unknown config key | ✓ **teaches** — names path, lists all valid keys |
| Invalid provider | ✓ "expected one of anthropic \| openai \| ... got 'claud'" |
| `agent.chat()` | ✓ returns object `{message, tokens, cost}` (README implies a string — minor doc gap) |

**Token overhead is the quiet headline:** 344 tokens bare → 5,100 with one trivial tool → 10,769 with the timeout retries. Even discounting P0-1, ~15× inflation from a single tool schema + harness scaffolding. Matches the project's own recorded 555–640% overhead vs its 15% ceiling. This is the #1 competitive weakness (below).

**Strengths confirmed live:** cross-tier tool loop genuinely finishes on a 4B local model; termination is single-owner; error messages teach; layer separation is clean (no upward `reasoning→runtime` imports).

---

## Competitive positioning (2026)

| Harness | Where it beats RA | Where RA beats it |
|---------|-------------------|-------------------|
| **Vercel AI SDK** | Near-zero token overhead; massive adoption; dead-simple `generateText`+tools | Reasoning strategies, verification, durability, cross-tier healing |
| **Mastra** (closest TS peer) | Docs/DX polish, evals UX, community momentum | Effect-TS compile-time safety; local-model-first reliability; deterministic 12-phase engine |
| **LangGraph** | Graph model, mature checkpointing, HITL ecosystem | Loop-first ergonomics; typed-boundary safety; single-owner termination |
| **OpenAI Agents SDK** | Handoffs, hosted tracing, first-party polish | Provider-agnostic (8 providers incl. local), self-hosted trace/replay |
| **Claude Agent SDK / Claude Code** | Production context management, subagents at scale | Full local control, no-SaaS observability, replayable typed events |

**Read:** RA's thesis (the harness *is* the product; reliability across tiers; everything opt-in and typed) is correct and differentiated — validated by the live local-vs-frontier parity. But it is losing on the two axes users feel first: **token efficiency** (Vercel/Mastra are far leaner) and **DX/docs trust** (Mastra's docs are the bar; RA's are drifted — see below). Effect-TS is a genuine moat *and* an adoption tax; keep the `createAgent` façade as the on-ramp and hide Effect from the 90% path (mostly done — the leaked `any` in `ToolsOptions.handler` is the seam to close).

**What to do differently:** compete on *reliability per token*, not feature count. A leaner default context (P2, prompt scaffolding) + one loop (P1-1) + working memory (P1-2) is a sharper story than adding a 9th strategy.

---

## Build smarter / faster (process, not code)

1. **Collapse the two loops (P1-1) before anything else** — every day it stays, features and fixes cost 2×, and the confound class keeps eating measurement runs. This is the single biggest velocity unlock.
2. **Decompose `iterate-pass.ts` (P1-4)** — the core loop's fragility taxes every kernel change.
3. **Docs drift as a first-class bug.** The `architecture-audit` skill *itself* falsely claims `context-engine.ts` is deleted (it's live, 7+ importers) and self-contradicts within one file; QUICK_START points at a kernel path that doesn't exist (`src/strategies/kernel/`); test/package counts disagree across 4 docs (README "8,294 tests/1061 files" — real files 1127; QUICK_START "6,558 tests / 35 packages" — real 34; facade npm `reactive-agents` pinned **0.10.6** while docs say v0.14). AGENTS.md already build-time-derives its numbers and warns against hand-editing — **extend that discipline to QUICK_START, README badges, and skills**, and add a CI check that greps stale paths. Stale guidance makes both humans and coding agents rediscover reality every session.
4. **Close the ablation backlog.** `harness-flags.ts` exposes ~13 `RA_*` knobs mostly with 2 callers — experiments that never resolved to default-on-or-delete per the project's own lift rule. Each open flag is a config-surface tax and a fork in behavior.
5. **Correct the record (memory hygiene).** Two current memory/skill claims are false and should be retracted so they stop misleading sessions: "two context builders" (there's one — `project()`; `context-engine.ts` is a static-prompt helper it consumes) and "conversation-assembly / compressToolResult superseded by ResultStore" (they're layers of one live pipeline, not competitors).

---

## Recommended sequence

1. **P0-1 + P0-2** timeout fixes + regression test (hours). Restores the headline reliability claim for async tools.
2. **P1-3** loop-detector "no-new-evidence" signal (days) — cheap wins on stuck-run cost across every tier.
3. **P1-1** collapse inline loop into kernel (1–2 wk, gated behind ablation) — the structural unlock.
4. **P1-2** memory: delete dead write-cost now; wire retrieval behind the lift bar next.
5. **P1-4 / P2** iterate-pass decomposition + provider dedup + dead-surface deletion, opportunistically.
6. Docs/skill/memory correction pass (P-process 3–5).

Do **not** treat as defects (verified non-issues): layer separation, single-owner termination, adapter-hook wiring (all 5 hooks read), MCP docker lifecycle, `ToolRegistry`/`ToolService` split, strategy orchestrators (differ genuinely, <70% shared), `context-engine.ts` (live helper, not dead), `overhaulEnabled`/`RA_OVERHAUL` (live).
