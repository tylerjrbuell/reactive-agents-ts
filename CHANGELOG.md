## [Unreleased]

### Breaking — builder surface consolidation (v0.14)

Three redundant builder methods removed; each was already folded into a
config option on a broader method (verified equivalent, back-compat kept for
the rest of the observability/tools families). Migrate:

- `.withTerminalTools(cfg?)` → `.withTools({ terminal: cfg ?? true })`
- `.withTelemetry(cfg?)` → `.withObservability({ telemetry: cfg ?? true })`
- `.withoutTracing()` → `.withObservability({ tracing: false })`

The builder `with*`/`without*` surface is guarded by a monotone-decreasing
ratchet test (`builder-wither-ratchet.test.ts`) per the ratified north-star
architecture §5: new capability arrives as a config option or profile field,
never a new top-level method. Also fixed the `withDocuments` JSDoc, which
advertised a non-existent `withTools({ rag })`.

### Breaking — removed builder methods and options that did nothing (v0.14)

An audit found several public methods and options that a caller could set but
that had **no reader** — the harness silently ignored them. Rather than ship a
promise we don't keep, they are removed; a call that passed them now fails
loudly (compile error, or a runtime throw naming the removal) instead of
misleading you. The builder wither surface drops from 89 to 85 methods.

- **`.withReactiveIntelligence({ autonomy, constraints })` — the `autonomy` and
  `constraints` options are removed.** `autonomy: 'observe'`, `neverEarlyStop`,
  `neverHumanEscalate`, `lockedSkills`, and `protectedSkills` were written but
  never read: a caller who asked for observe-only got a fully autonomous
  controller. This was a no-op **safety** switch, so it is removed outright
  rather than deprecated. The method's working options are unchanged.
- **`.withIdentity()`, `.withInteraction()`, `.withOrchestration()` removed.**
  Each merged a service layer nothing resolved (`.withOrchestration()` was a
  literal no-op). The `@reactive-agents/identity` and `/interaction` packages
  remain for direct use; `.withOrchestration()` has no replacement.
- **`.withProgressCheckpoint()` removed.** Its `autoResume` was never
  implemented. Use `.withDurableRuns()` for real crash-resume.
- **`.withFallbacks()` — the `models` and `errorThreshold` options are removed.**
  Docs claimed it "switches after 3 consecutive errors" and fell back to a
  cheaper model on a 429; neither was implemented. It now does what it always
  actually did — an immediate ordered **provider** cascade (primary → each
  fallback on any error) — and its config is `{ providers }` only.
- **`.withSkills()` now throws on a no-op call.** A bare `.withSkills()` (no
  `paths`) was silently doing nothing, and the `packages`/`overrides` keys were
  dropped. It now requires a non-empty `paths` array and rejects the removed keys.

### Fixed — APIs that now do what they say

- **`.withVerificationStep()` influences the answer.** Previously it burned an
  LLM call per run and wrote the verdict to a field nothing read. A `REVISE`
  verdict now re-runs once with the verification feedback, so the verdict
  actually shapes the final output.
- **`.withCalibration("skip")` is honored.** It was silently rewritten to
  `"auto"` whenever reasoning was enabled, so the opt-out did not exist. `"skip"`
  now skips calibration even with reasoning on; when unset, calibration
  auto-enables only if reasoning is active.
- **Model calibration no longer weakens the harness.** A model with a
  calibration file previously *lost* its four live provider-adapter hooks
  (continuation, error-recovery, synthesis, quality-check) and gained two dead
  ones. Calibration now **composes** with the tier adapter (additive): it can
  refine behavior but can never remove a capability.
- **Error suggestions are valid and accurate.** `errorContext()` no longer emits
  a syntactically invalid `.withGuardrails({ ... })` snippet, no longer tells you
  to `resume()` an agent stopped by the kill switch (stopped/terminated runs are
  not resumable), and its JSDoc names the real `agent.resumeRun(runId)` method.

### Changed — behavior

- **The meta-tool suite is opt-in.** The default toolbox is now task-facing; the
  planning/reflection meta-tools (and their web-egress default) no longer load
  unless you ask for them.

### Fixed — receipt & telemetry truthfulness

A sweep made the run receipt honest across every strategy, not just `reactive`:

- Every strategy now mints the canonical tool ledger, so deliverable receipts,
  `terminatedBy`, `goalAchieved`, and abstention resolve on the plan-execute,
  blueprint, code-action, and inline paths — not only the reactive one.
- `reflexion`, `plan-execute`, `tree-of-thought`, and `blueprint` report their
  real `llmCalls`/`tokensUsed` instead of zeros; a missing declared deliverable
  now caps the trust verdict; result-boundary verification reaches every path.
- Tool events reach the public stream, failing tools stop retrying silently,
  every started tool call completes, and Tree-of-Thought's cost guards became
  reachable. Kernel logs are no longer discarded and carry correlation ids.
- `code-action` (previously structurally broken with real tools) works; the
  inline agent loop and pause/resume/stop/terminate fail clearly instead of
  crashing without a kill switch configured.

### Added

- **Groq and xAI providers** (v0.13.5), both on the shared OpenAI-compatible
  stack (streaming, native function calling, structured output).
- `CompletionEnvelope` — honesty signals cross every strategy boundary uniformly.
- A universal todo-checklist meta-tool (opt-in) and a real-world agent probe
  fleet (10 archetypes with graded receipt checks) for internal evaluation.

## [0.13.6] — 2026-07-06

Declare `@reactive-agents/runtime-shim` as a dependency of the CLI and mark it
`external` in the bundle. The `rax serve` command imports `secureServe` from it;
previously it was inlined into the CLI bundle instead of resolved from
node_modules. Functionally identical for users, but restores the deduplicated
external-dependency packaging the other workspace deps use.

Bump plan `shortId()` entropy from 4 to 6 base36 characters. The 4-char id space
(~1.7M) made a 100-id uniqueness draw collide roughly 0.3% of the time — a real
intermittent CI failure in the plan tests. Six characters (~2.2B) makes it
effectively never, and the id stays within its 8-character budget (`p_` + 6).

## [0.13.5] — 2026-07-06

### Groq and xAI providers

Two new first-class providers, both wired through a shared `makeOpenAICompatProvider` factory so they inherit the full OpenAI-compatible stack — streaming, native function calling, and structured output — without a bespoke adapter each.

```typescript
ReactiveAgents.create().withProvider("groq").withModel("llama-3.3-70b-versatile").build();
ReactiveAgents.create().withProvider("xai").withModel("grok-4").build();
```

- **Live-verified end to end** on both providers: plain completion plus native tool-call round-trips.
- Provider-aware native-function-call fallback; logprobs and embeddings are capability-gated (Groq/xAI expose neither).
- Structured output on Groq is model-dependent — `json_schema` strict works on `gpt-oss` and some models, others accept only `json_object`; the parse-retry loop covers the gap.
- Provider count is now **8** (Anthropic, OpenAI, Gemini, LiteLLM, Ollama, test, Groq, xAI).

### Agentic UI Kit — `@reactive-agents/ui-core`

New framework-agnostic headless package (`@reactive-agents/ui-core`) holding the shared controllers behind the UI bindings: a progressive UI-tree reconciler, a task-inbox fetch controller, and interaction + approval POST controllers. The React, Svelte, and Vue packages now delegate to these controllers instead of each re-implementing the wire protocol.

- **React** rewired onto `ui-core` with a core `useRun` hook and the full v1 family surface — Interact (`AgentPrompt`/`ChoiceCard`), Inbox (`useTaskInbox`/`TaskInbox`), Observe (`useRunCost`/`useRunSteps` + `CostMeter`/`StepTimeline`), Render (`AgentSurface` registry + UI-tree schema), plus a `useResumableRun` hook and an `AgentDevtools` overlay with `testing`/`styles` subpaths.
- **Svelte** and **Vue** rewired onto the same controllers (`createRun`, `createInteractions`, `createResumableRun`, run cost/steps), restoring `requestInit`/header pass-through on structured streams.

### Cortex `request_user_input` interaction rail

Cortex gains a durable request-for-input rail: runner methods plus a `.withInteraction(...)` surface, an interaction-watcher, and a real end-to-end pause → register → respond → resume flow. The Cortex UI renders a live Interact panel and streaming structured previews.

### Surfaced run errors instead of a generic message

Reasoning failures now propagate the real error string to `result.error` end to end. Previously the kernel captured the full message in `state.error` but `normalizeReasoningResult` dropped it during its whitelist rebuild, so callers only ever saw a generic `"Reasoning failed"`. An `error` field now rides `ReasoningResultSchema` / `ExecutionReasoningResult` through normalization; e.g. a bad model id now surfaces `"…404 The model … does not exist"` on `result.error`.

## [0.13.0] — 2026-07-02

<!-- Theme line below is a draft — finalize wording before tagging. -->

**Receipts & first-touch.** Cross-tier native thinking, cost-aware model routing, an overhauled first-ten-minutes developer experience (typed tool authoring, fail-fast `build()`, `ReactiveAgents.quick()`), honest abstention as a first-class terminal, a new efficiency-first Blueprint strategy, two token-waste guards (StallPolicy, FabricationGuard), and a broad sweep of correctness fixes across providers and the kernel.

### Added

- **`.withThinking(...)` — native thinking on every provider, opt-in.** One builder switch (`true` or `{ effort, budgetTokens }`) enables native reasoning across Anthropic, OpenAI, Gemini, and local models. Off by default everywhere: `undefined` never auto-enables. Budgets are bounded and reserved on top of the answer budget so thinking can never starve the visible answer.
- **`.withModelRouting(options?)` — cost-aware model routing, opt-in.** Routes each run to the cheapest capable model of the configured provider by task complexity, on both the inline and reasoning paths. Provider-agnostic, capability-gated (never routes below a model whose context window fits), and advisory — it degrades to the configured model on any error.
- **Tool authoring v2 — schema in, typed args out.** `defineTool({ name, description, input, handler })` accepts a Standard Schema input (Zod, Effect, Valibot) and gives the plain-async handler inferred argument types — no more `Record<string, unknown>` or `as never` casts. `defineTool` also validates its options and rejects wrong field names (e.g. `parameters`/`execute`) with a message naming the correct field instead of crashing with `TypeError: schema.ast`. The Effect-handler form remains as the advanced path.
- **Fail-fast `build()` via `.withStrictValidation()`.** Opt in to catch a missing API key or unknown model at build time with a typed error and fix instructions, instead of a raw 401/404 on the first call.
- **`ReactiveAgents.quick()` — a two-line agent.** Resolves provider, model, and iteration defaults from the environment: `const agent = await ReactiveAgents.quick(); await agent.run("...")`.
- **`.withLlmTimeout(ms)` — per-LLM-call timeout for local models.** Complements the run-level `.withTimeout()`; configures the local/Ollama per-call timeout that was previously hardcoded at 120 seconds (hosted providers keep their own limits). Timeout errors now name the model, elapsed time, and a cold-load/GPU-contention hint, and the in-flight local request is aborted server-side so the GPU stops burning after the client gives up.
- **Harness-forced abstention — a run that cannot succeed says so.** When a task is structurally impossible (a required tool is unavailable, or synthesis is repeatedly ungrounded), the run terminates with `terminatedBy: "abstained"` and a typed `result.abstention { reason, missing }` instead of fabricating an answer.
- **Blueprint strategy — plan once, execute in parallel, zero extra LLM calls.** For static, decomposable tasks the whole plan is knowable up front: Blueprint generates a plan, verifies it, executes independent steps in parallel with no per-step LLM call, then solves. Adaptive routing sends static-decomposable tasks to Blueprint automatically. This is the 7th reasoning strategy.
- **`.withStallPolicy(...)` — fail fast on ignored nudges.** When the model ignores required-tool nudges and makes no progress across consecutive iterations, the harness escalates and delivers accumulated artifacts (or fails) instead of looping to the full nudge cap — bounding wasted iterations/tokens on stuck runs while leaving progressing runs untouched. Sensible defaults apply when unset.
- **`.withFabricationGuard(mode)` — reject invented measurements.** An always-on verifier check (default `"block"`) that rejects empirical performance numbers (benchmark timings, % speed-ups) absent from the tool-observation corpus; high-precision (only perf measurements are policed). Softenable to `"warn"` or `"off"`, also via the `RA_FABRICATION_GUARD` env var.
- **Evaluation gate CLI.** `rax eval gate` runs the project lift rule over a benchmark report (`default-on | opt-in | reject`); `--ledger` appends a weakness→hypothesis→verdict chain and `rax eval ledger` reads it. Benchmark runs capture a per-run `RunDiagnosis` (honesty label, failure modes) when a trace dir is set.
- **Scaffold templates.** `create-reactive-agent` adds `with-structured-output`, `with-approval-gates`, and `with-memory` templates on the current API.
- **`ToolBuilder.create()` static factory.** A convenience entry point for the tool builder.
- **Model coverage.** Static capabilities for `qwen3:4b` and `cogito:8b`; suffix-less `claude-sonnet-4-5` alias; `o5-reasoning` capability entry.
- **Packaging & discoverability.** npm keywords + descriptions added to 31 published packages; docs SEO/AEO foundation (JSON-LD, sitemap, AI-crawler robots); docs site gains stability tags, last-updated stamps, and change indicators.

### Changed

- **Gemini no longer thinks by default.** Thinking is uniformly opt-in via `.withThinking()`; Gemini's former thinks-by-default behavior is off unless enabled. When enabled, its previously unbounded thinking budget is bounded so the answer is never truncated by hidden reasoning.

### Fixed

- **gpt-5.x models work for normal (non-thinking) calls.** The OpenAI adapter chose the token-limit field by thinking state, so gpt-5.x default calls sent `max_tokens` — which those models reject with a 400. The field is now capability-driven: gpt-5.x / o-series always get `max_completion_tokens`; the gpt-4o family is unchanged.
- **Thinking request shapes verified against live provider APIs.** Anthropic uses the adaptive shape on current-generation models and the legacy `budget_tokens` shape on older ones; `temperature` is dropped when thinking is enabled (both Anthropic and OpenAI reject it otherwise).
- **Provider errors are readable.** A model typo now produces one clean error line with a suggestion instead of duplicated raw JSON and an internal stack; the `run()` boundary maps errors to a plain `Error` with cause (full internals behind a debug flag).
- **`withRetryPolicy` now retries the path the kernel actually uses.** It previously wrapped only `complete()`; the reactive kernel runs through `stream()` (and structured output through `completeStructured()`), so a transient failure during a normal run was never retried despite the configured policy. All three call sites are now retried.
- **`withMinIterations(N)` enforces the full floor.** It previously forced only a single extra pass regardless of N (a lone `if`, not a loop). It now loops to the configured minimum.
- **Cross-provider tool-call arguments are never dropped.** Tool-call arguments arriving as a JSON string (some Ollama models) were silently dropped to `{}` at the resolver; they are now coerced, so every adapter delivers parsed arguments.
- **`withVerificationStep({ mode: "loop" })` removed.** The `"loop"` mode was documented but unimplemented (it skipped verification with a log-only warning). `"reflect"` is the only supported mode; the false option is gone.
- **Thinking-mode models no longer starve their own answer.** Gemini (formerly thinking-on by default) consumed the entire output budget with hidden reasoning, truncating the answer; thinking budget is now bounded and reserved on top of the answer budget. Cloud `complete()` timeout raised 30s→120s for thinking models. A non-OK empty-success guard was ported to Anthropic/OpenAI for parity.
- **Blueprint plans over the full tool catalog** with parameter semantics, instead of a truncated tool list.
- **Configured-off phases stay off.** `runGuardedPhase` now honors `phase.skip`, so direct callers no longer execute phase bodies that were disabled by configuration.
- **Context & structured-output correctness sweep.** JSON repair is string-safe (`"True Story"`/`"NaN Industries"` survive); the message window keeps mid-thread user instructions instead of silently dropping them over budget; field-provenance uses boundary matching and recurses into nested objects; duplicate tool names warn at sanitization instead of silently dispatching to the wrong tool; streaming partial-JSON reparse is gated (O(N²) removed) and walkback bounded.
- **Output-ownership invariant.** A run that did real work never ships an empty final answer (terminal synthesis assembles a deliverable when the output is empty but candidates exist).
- **Tree-of-Thought degrades gracefully under a wall-clock budget** instead of being killed mid-exploration on slow thinking models.
- **Parallel-batch tool calls are healed** with the same tier-parity pipeline as single calls; the `healed` flag is corrected.
- Negative cost on Anthropic prompt-cache hits; agent-config serialization drift closed with an AST-driven anti-drift guard; the severed experience-tips loop re-wired; the verifier rejects terminal continuation-intent as a final answer.

## [0.12.0] — 2026-06-17

**v0.12.0 — "Durable & Honest."** Crash-resumable runs, human-in-the-loop approval gates, typed structured output across every provider, and a set of honesty defaults (memory off, grounding opt-in, debrief off the critical path) that stop the framework from over-promising or silently spending tokens.

### Added

- **Durable execution — kill it, resume it.** `.withDurableRuns({ dir?, checkpointEvery? })` persists a lossless serialized `KernelState` per iteration to a SQLite run store (opt-in; zero overhead when off). `agent.resumeRun(runId)` reconstructs a crashed or paused run from its last checkpoint and continues it to completion in a fresh process — without replaying completed tool work; `agent.listRuns({ status? })` enumerates persisted runs. A config-hash guard (system prompt + provider identity) rejects resuming under a drifted config with `DurableConfigMismatchError` (and `DurableRunNotFoundError` for unknown runs). Cross-process crash-resume is verified by a subprocess hard-kill (SIGKILL/exit-137) e2e proving the on-disk checkpoint reconstructs and finishes the run. `withProgressCheckpoint` is clarified as the lighter plan-level hint; durable runs are the crash-resume path.

- **Durable human-in-the-loop approval gates.** `.withApprovalPolicy(...)` pauses a run before a flagged tool call instead of blocking a process in memory: the run terminates with `terminatedBy: "awaiting-approval"`, the paused `KernelState` is checkpointed to the durable run store, and a pending `ApprovalDecisionRef` is surfaced on the result/stream. `agent.approveRun(runId, ...)` / `agent.denyRun(runId, ...)` resume the run from that checkpoint (approve → execute the gated call, deny → observe a denial and continue); `agent.listPendingApprovals()` enumerates what's waiting. An `onApproval` convenience callback covers the in-process case. Works on both `run()` and `runStream()`, and reuses the crash-resume infrastructure rather than a separate in-memory gate.

- **Typed structured output, every tier.** `.withOutputSchema(schema)` returns a typed `result.object` (with `result.objectError` on failure); `agent.streamObject()` yields `{ object: DeepPartial<T> }` deep-partial snapshots as the model writes. Schemas come from any Standard-Schema library — Zod, Valibot, ArkType, or Effect Schema — bridged to per-vendor JSON Schema (top-level arrays and lenient degradation supported). Live-verified across Anthropic, OpenAI, Gemini, and local Ollama (qwen3.5 / gemma). New exports include `extractStructuredOutput`, `toSchemaContract`, `groundedExtract`, `parsePartial`, `StructuredOutputError`, and the `@reactive-agents/svelte` / `@reactive-agents/vue` `useStructuredObject` bindings.

- **Always-on scaffold-leak guard.** A standalone check (`detectScaffoldLeak`) rejects terminal output that echoes framework internals (`[STORED:]`, `_tool_result_N`, "compressed preview") instead of synthesizing a real answer. Separate from grounding, ~zero false-positive rate, and stays on regardless of the grounding opt-in.

- **Cortex studio — durable & structured surfaces.** The Cortex companion app gains: launch durable runs + approval gates from the config panel, an app-wide interactive approval-toast prompt, a structured-output schema editor with a typed-object viewer, budget-cap + evidence-grounding config controls, and the reasoning kernel enabled by default with a clear toggle.

### Changed

- **Memory is now OFF by default.** `new ReactiveAgentBuilder()` no longer enables the memory layer implicitly (GH #122) — agents are stateless unless you opt in. The `balanced()` and `intelligent()` presets enable it explicitly, and `.withMemory(...)` turns it on for any agent. This stops surprise SQLite writes and recall costs on simple agents. **Migration:** if you relied on implicit memory, add `.withMemory()` (or use a preset that includes it).

- **Post-answer debrief no longer blocks `run()`.** The LLM debrief synthesis is forked off the critical path — measured **4.7s of a 9.8s frontier run (48%)** was the agent synthesizing a debrief *after the answer was already produced* (~6s local; GH #143). `run()` now returns the instant the answer + a deterministic fallback debrief are ready (`result.debrief`, always present on memory runs). The rich LLM debrief synthesizes + persists in a background fiber; await `result.debriefRich()` only when you want it. `agent.getLastDebrief()` upgrades to the rich version once it resolves, and `agent.dispose()` joins pending debrief fibers so a short-lived `run(); dispose()` never drops the persist. Net: ~46% lower perceived `run()` latency on memory-enabled runs. A tier-aware skip avoids the debrief synthesis entirely on small local models where it isn't worth the round-trip. `result.metadata.tokensUsed` now reflects the *answer's* cost (debrief tokens are background; surfaced via `debriefRich()`/telemetry).

- **Evidence-grounding is now opt-in (off by default).** The previous always-on numeric grounding check false-flagged correctly-formatted figures (e.g. `$62,578`) when the tool observation was compressed or reformatted — firing a `failed at evidence-grounded` verifier warning on correct answers. Enable per-agent via `.withGrounding({ mode: "block" | "warn" })`. When enabled it grounds against the **full** tool data (resolved via `storedKey`→scratchpad, not the compressed preview) with **rounding/format tolerance** (`$62,578` ≈ `62578.12` ≈ `$62.5k`). `mode: "warn"` is advisory (surfaces a `verificationWarning`, ships the answer); `mode: "block"` runs one corrective re-synthesis then **degrades to warn** — it never hard-fails a run. The prose claim-grounding pass (which false-rejected legitimate summaries at 64–73%) was removed.

- **Hooks accept plain functions.** `.withHook()` handlers may now be plain sync/async functions — no Effect wrapper required (the Effect form still works). Additive, no migration needed.

- **Observability config unified under `.withObservability(...)`.** The previously scattered observability surfaces collapse to a single configuration entry point.

### Fixed

- **Cortex:** budget limit of `0` now means "unset" rather than a zero-cap that triggered a false `budget_exceeded`; saved/gateway agents correctly thread durable HITL + structured output.
- **Reasoning:** `code-action` sandbox now emits `observation.tool-result` so `.on()` observers see its tool output (closes the FM-I `tool_call` sub-gap, #195).
- **Runtime:** the durable `RunStore` read path now `mkdir`s its parent directory so listing runs from a fresh agent doesn't throw.
- **Build/types:** restored a green `typecheck` across reasoning/core/runtime/cortex (`EntropyScoreLike` contract, durable-HITL sentinel reason, structured-output schema variance, durable test fixtures, `exactOptionalPropertyTypes`), and eliminated a concurrent `apps/cortex/ui/build` double-build race that could fail the release build or ship a partial Cortex UI.

# Changelog

All notable changes to Reactive Agents will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

_Pending release notes live in `.changeset/*.md` and are aggregated into a versioned `## [x.y.z]` section by `scripts/release.ts` when the tag is pushed. Do not hand-edit released sections._

---

## [0.11.2] — 2026-06-11

Canonical kernel architecture refactor. The reasoning kernel is now organized into capability-grouped modules (act, attend, comprehend, decide, learn, reason, recall, reflect, sense, verify) with an acyclic dependency mesh. Termination has a single owner: every exit path routes through the arbitrator and `terminate()`, and a state-grounded post-condition spine validates that "done" claims are backed by evidence before a run completes. Context assembly is unified on the `project()` pipeline — an event log plus content-addressed result store with recency-aware, two-budget projection — replacing the previous parallel assembly paths. Kernel state changes go through `transitionState()` exclusively, making run state machine-checkable.

Refresh cloud-provider model support to the 2026-06 lineup and remove all retiring model defaults. `claude-sonnet-4-20250514` (retires 2026-06-15) is replaced by `claude-sonnet-4-6` in every default path: `provider-defaults.ts`, `getLLMConfig()`, and the `createRuntime()`/`createLightRuntime()` terminal fallbacks. Retired ids removed from presets (`claude-3-5-haiku-20241022`, `gemini-2.0-flash/pro`); new capability entries for `claude-opus-4-8`, `claude-sonnet-4-5`, `gpt-5.5`/`gpt-5.4`/`gpt-5.4-mini`, `gemini-2.5-pro/flash/flash-lite`, `gemini-3.5-flash` with corrected context windows. Two consistency guard tests now pin every default and preset to the static capability table so retired-id drift fails CI loudly.

Helper LLM calls (verification scoring, cost/complexity routing) now run on the agent's own configured provider and model instead of a hard-coded provider. Agents configured for local or non-default providers no longer make surprise cross-provider calls — or fail when only one provider's credentials are present.

API-honesty fix cluster. Memory operations no longer silently swallow telemetry failures; telemetry sinks expose a health counter. `ResultMetadata` gains `complexity` and `llmCalls` fields, and `ReactiveAgent.getLastDebrief()` provides direct access to the most recent debrief. The interaction HITL surface drops a documented-but-nonexistent phantom method, `confidenceFloor` documentation now matches its actual behavior, the cortex UI `AgentStreamEvent` union is fully typed, and the LLM provider schema deep-clone is deduplicated through a shared helper.

Cortex: parameterized runs and chat/builder parity. Agent templates support `{{variable}}` placeholders filled at launch — server-authoritative resolver, `POST /api/template/resolve` live preview, schema-driven fill modal on Lab and saved-agent runs, a Variables editor with auto-detection and inline highlighting in prompt/persona/task fields, and cron/gateway runs resolving from variable defaults (runs 400 on unresolved required variables; the `secret.` namespace is reserved). Chat sessions gain full builder tool parity: MCP servers, agent-tools, and sub-agents now thread into chat agents, with session config editable in a modal and chats startable from a saved agent's config snapshot. Cortex also follows framework provider defaults dynamically (with a refreshed offline model mirror) and disposes cached/ephemeral chat agents correctly so MCP containers tear down.

Tool-calling routing hardening across all model tiers. The model capability signal is now the single master input for native-FC vs text-parse routing, eliminating split-brain drift between resolver and driver. Lazy tool pruning floors at `allowedTools` and can never prune down to meta-tools only. Sanitized tool names are rendered in the prompt so the text the model sees always matches the native function-calling array. Reflexion no longer produces empty outputs when generation comes back blank (clean synthesis backfill), and reflexion / tree-of-thought / plan-execute now forward classifier `relevantTools`, so MCP and user-registered tools are visible to the model in every strategy. Verified across local (Ollama), Anthropic, and OpenAI providers.

Deeper run observability. Traces now record decision-record instrumentation and per-stream cache-token accounting, and `rax-diagnose replay` shows per-iteration tool calls, output, and cache detail for root-cause analysis. Per-tool-call rationale auditing is available opt-in (default off — it measurably affects weak-model behavior when forced).

Chat history fixes for gateway and tool-capable conversations. Conversation history now seeds the kernel on tool-capable chat turns — including streaming — so multi-turn chats with tools no longer lose prior context. History is presented to the model as a clearly labeled context block rather than synthetic function-calling messages, which removes a class of provider confusion on resumed threads. Local providers default to `numCtx` 8192 so longer histories are not silently truncated by the runtime default context window.

# Changelog

All notable changes to Reactive Agents will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] — v0.11 Phase C

### Added

- **`@reactive-agents/replay` package** — deterministic re-run of recorded traces with prompt/model overrides and tool-result freezing. Public surface: `loadRecordedRun`, `replay`, `makeReplayController`, `makeReplayToolLayer`, `diffTraces`, `computeArgsHash`. Strict mode errors on unrecorded/truncated tool calls; lenient mode returns failure marker. Integration via existing `.withLayers(makeReplayToolLayer(ctrl, mode))`.
- **`ToolCallCompleted` event payload extension** — new optional fields `args`, `result`, `error`, `resultTruncated` carry full tool call/response data for replay. Backward compatible (all fields optional). Emission sites updated: `reasoning/src/kernel/state/kernel-hooks.ts`, `runtime/src/engine/phases/agent-loop/inline-act.ts`, `reasoning/src/strategies/plan-execute.ts`.
- **`ToolCallEvent` trace event extension** — `result` + `resultTruncated` projected from `ToolCallCompleted`. Trace recorder truncates results >8KB and substitutes a `{ replayUnserializable: true }` marker for non-JSON-serializable payloads.
- **`rax-diagnose replay-run <runId>` CLI subcommand** — summary of a recorded run (metadata, tool call count, unique tool list) for feeding into the `replay()` API. Supports `--json`.
- **Docs:** `features/snapshot-replay.mdx` (full API + diff shape + determinism guarantee) + index card + stability marker.
- **Public ROADMAP.md alignment to North Star v5.0** — Phase A/B shipped, Phase C in flight, accurate v0.11 line-up.
- **`rax diagnose` unified subcommand** — folds the standalone `rax-diagnose` binary into the main `rax` CLI as `rax diagnose <sub>` (list, replay, replay-run, grep, diff, debrief). Standalone `rax-diagnose` bin retained for backwards compatibility. New programmatic exports from `@reactive-agents/diagnose`: `debriefCommand`, `replayRunCommand`, `ReplayRunOpts`.
- **`.withTools({ focusedTools })` documented** — soft tool-focus guidance (full set stays callable; focused names prioritized), distinct from the hard `allowedTools` allowlist. Resolution order: `focusedTools` → `allowedTools` → all tools.
- **`numCtx` is now a first-class `AgentConfig` field** — previously only reachable via the `.withModel({ numCtx })` builder param, it is now in `AgentConfigSchema` and applied by `agentConfigToBuilder`, so it round-trips through `toConfig()` / `fromJSON()` and the config-driven path. Exposed in the Cortex Studio agent builder as a "Context length (numCtx)" field. Honored by providers with a context-window knob (Ollama `num_ctx`); ignored by cloud providers that don't expose one. Becomes the authoritative denominator for Cortex's context-usage gauge.

### Changed

- **Tool-call rationale is now opt-in.** Previously the kernel unconditionally injected a MANDATORY `<rationale>` instruction on every tool-using run. It is now gated by `auditRationale` (`.withReasoning({ auditRationale: true })` or env `RA_RATIONALE_AUDIT=1`), **off by default**. Rationale is an audit feature, not a performance one — enabling it added ~20–27% output tokens/latency on rationale-emitting local models with no quality change (cross-tier ablation). The `plan-execute-reflect` plan-step rationale is unchanged (always-on schema field). `result.debrief.rationale[]` shape is unchanged.

### Fixed

- **Rationale parser hardened for small-model output** (`@reactive-agents/tools` `parseRationaleBlocks` / `extractRationale`). Opt-in rationale was silently dropped for some local models: strict `JSON.parse` rejected markdown-fenced/prose-wrapped bodies, `why` over 280 chars rejected the whole block, and models that tag every block `call="1"` (e.g. gemma) collided into one map entry (later calls dropped). Now: fenced/prose bodies are tolerated, over-length `why` is truncated, and colliding `call="N"` attributes fall back to sequential positional keys — so opt-in capture is reliable cross-tier.

### Notes

- Snapshot/Replay is the v0.11 Phase C differentiator: every Reactive Agents decision is auditable-by-demo, distinguishing the framework from black-box alternatives.
- The layer-override gate test (`packages/replay/tests/layer-override.test.ts`) pins `Layer.merge(live, replay)` priority — if Effect's merge semantics ever changed, replay would silently call the live tool; this test fails first.
- **Deferred to v0.11.1:** full end-to-end determinism integration test (builder + `TestLLMServiceLayer` + replay layer → assert no-override replay reproduces recorded output). Override mechanism and tool-result freezing are pinned today.

---

## [Unreleased] — v0.11 Phase C

### Added

- **`@reactive-agents/replay` package** — deterministic re-run of recorded traces with prompt/model overrides and tool-result freezing. Public surface: `loadRecordedRun`, `replay`, `makeReplayController`, `makeReplayToolLayer`, `diffTraces`, `computeArgsHash`. Strict mode errors on unrecorded/truncated tool calls; lenient mode returns failure marker. Integration via existing `.withLayers(makeReplayToolLayer(ctrl, mode))`.
- **`ToolCallCompleted` event payload extension** — new optional fields `args`, `result`, `error`, `resultTruncated` carry full tool call/response data for replay. Backward compatible (all fields optional). Emission sites updated: `reasoning/src/kernel/state/kernel-hooks.ts`, `runtime/src/engine/phases/agent-loop/inline-act.ts`, `reasoning/src/strategies/plan-execute.ts`.
- **`ToolCallEvent` trace event extension** — `result` + `resultTruncated` projected from `ToolCallCompleted`. Trace recorder truncates results >8KB and substitutes a `{ replayUnserializable: true }` marker for non-JSON-serializable payloads.
- **`rax-diagnose replay-run <runId>` CLI subcommand** — summary of a recorded run (metadata, tool call count, unique tool list) for feeding into the `replay()` API. Supports `--json`.
- **Docs:** `features/snapshot-replay.mdx` (full API + diff shape + determinism guarantee) + index card + stability marker.
- **Public ROADMAP.md alignment to North Star v5.0** — Phase A/B shipped, Phase C in flight, accurate v0.11 line-up.
- **`rax diagnose` unified subcommand** — folds the standalone `rax-diagnose` binary into the main `rax` CLI as `rax diagnose <sub>` (list, replay, replay-run, grep, diff, debrief). Standalone `rax-diagnose` bin retained for backwards compatibility. New programmatic exports from `@reactive-agents/diagnose`: `debriefCommand`, `replayRunCommand`, `ReplayRunOpts`.
- **`.withTools({ focusedTools })` documented** — soft tool-focus guidance (full set stays callable; focused names prioritized), distinct from the hard `allowedTools` allowlist. Resolution order: `focusedTools` → `allowedTools` → all tools.
- **`numCtx` is now a first-class `AgentConfig` field** — previously only reachable via the `.withModel({ numCtx })` builder param, it is now in `AgentConfigSchema` and applied by `agentConfigToBuilder`, so it round-trips through `toConfig()` / `fromJSON()` and the config-driven path. Exposed in the Cortex Studio agent builder as a "Context length (numCtx)" field. Honored by providers with a context-window knob (Ollama `num_ctx`); ignored by cloud providers that don't expose one. Becomes the authoritative denominator for Cortex's context-usage gauge.

### Changed

- **Tool-call rationale is now opt-in.** Previously the kernel unconditionally injected a MANDATORY `<rationale>` instruction on every tool-using run. It is now gated by `auditRationale` (`.withReasoning({ auditRationale: true })` or env `RA_RATIONALE_AUDIT=1`), **off by default**. Rationale is an audit feature, not a performance one — enabling it added ~20–27% output tokens/latency on rationale-emitting local models with no quality change (cross-tier ablation). The `plan-execute-reflect` plan-step rationale is unchanged (always-on schema field). `result.debrief.rationale[]` shape is unchanged.

### Fixed

- **Rationale parser hardened for small-model output** (`@reactive-agents/tools` `parseRationaleBlocks` / `extractRationale`). Opt-in rationale was silently dropped for some local models: strict `JSON.parse` rejected markdown-fenced/prose-wrapped bodies, `why` over 280 chars rejected the whole block, and models that tag every block `call="1"` (e.g. gemma) collided into one map entry (later calls dropped). Now: fenced/prose bodies are tolerated, over-length `why` is truncated, and colliding `call="N"` attributes fall back to sequential positional keys — so opt-in capture is reliable cross-tier.

### Notes

- Snapshot/Replay is the v0.11 Phase C differentiator: every Reactive Agents decision is auditable-by-demo, distinguishing the framework from black-box alternatives.
- The layer-override gate test (`packages/replay/tests/layer-override.test.ts`) pins `Layer.merge(live, replay)` priority — if Effect's merge semantics ever changed, replay would silently call the live tool; this test fails first.
- **Deferred to v0.11.1:** full end-to-end determinism integration test (builder + `TestLLMServiceLayer` + replay layer → assert no-override replay reproduces recorded output). Override mechanism and tool-result freezing are pinned today.

---

## [0.10.0] — 2026-05-04

### Highlights

v0.10.0 is the **Phase 1 Validation Release** — a production-ready harness with 13 empirically-validated mechanisms (8 KEEP, 5 IMPROVE) and honest deferred claims. The **Adaptive Tool Calling System** delivers a four-layer closed-loop pipeline that makes local models (Ollama, local LLMs) dramatically more reliable: 86.7% FC recovery rate, +80% accuracy improvement, 90% token savings vs LLM reprompt. **Reactive Intelligence dispatcher** with 6 intervention handlers now properly wired (budget threading fixed). **Calibration system** with 3-tier resolver (community profile → observations store) and 14 measurement fields (8 active consumers). **Benchmark Suite v2** with 5 competitor runners, 10 real-world tasks, and CI drift gate. Cortex Studio received its largest update with Beacon, Thalamus, Lab, and living skills.

The release closes with the **`refactor/overhaul` audit + Phase 1 mechanism validation sweep** — a comprehensive empirical validation of all 13 harness mechanisms via TDD-driven spikes (RED → GREEN → ANALYSIS). Single-owner termination oracle enforced; all 9 paths routed through Arbitrator. ToT early-stop fixed. Eval Rule-4 frozen judge implemented. AgentMemory port defined. Cost router consults calibration. **28 packages total; 6 KEEP + 3 KEEP+unstable + 12 FIX (all with concrete action items) + 1 SHRINK + 5 DEFER verdicts.**

### Breaking Changes

None. All existing `ReactiveAgents.create().with*()` builder chains continue to work unchanged. New fields on `ModelCalibrationSchema` (`toolCallDialect`, `knownToolAliases`, `knownParamAliases`) default to `"none"` / empty on decode — existing calibration files are forward-compatible. **Deprecation:** `ProviderCapabilities` and `recommendStrategyForTier` (both removed); migration path documented in audit.

### New Features — 13 Validated Mechanisms

This release features **Phase 1 mechanism validation sweep**: all 13 harness mechanisms spike-tested via TDD (RED → GREEN → ANALYSIS). **8 KEEP verdicts** ship as-is; **5 IMPROVE verdicts** have concrete Phase 1.5 action items with clear success criteria. Evidence at `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md`.

#### M1 — Reactive Intelligence Dispatcher ✅ KEEP
- **Measurement infrastructure complete** — entropy signal + dispatch-rate tracking. Budget threading fixed (W3): RI budget counters no longer dead-zeroed each iteration; suppression gates (`maxFiresPerRun=5`, `maxInterventionTokenBudget=1500`) now reachable.
- **6 intervention handlers fully wired:** `early-stop`, `temp-adjust`, `switch-strategy`, `context-compress`, `tool-inject`, `skill-activate`. 3 RI hooks subscribed (W2): `onSkillActivated`, `onSkillRefined`, `onSkillConflict` now have EventBus subscribers in `builder.ts:2682-2716`.
- **Test evidence:** `packages/reactive-intelligence/tests/m1-dispatcher-validation.test.ts`
- **Phase 2 implication:** RI systems are baseline for strategy switching (M2) and adaptive behavior. Phase 2 should assume RI is stable.

#### M2 — Strategy Switching (ReAct ↔ Plan-Execute ↔ ToT ↔ Reflexion) ✅ KEEP
- **20 passing tests** (339ms execution); 10-task corpus covers FM-B2 (multi-step complexity) and FM-D2 (recovery required). Switching heuristics properly wired via `evaluateStrategySwitch()`.
- **ToT outer-loop early-stop fixed (W5):** Tree-of-Thought BFS frontier now scored via `entropySensor`; `reactiveController` evaluates dispatch patches; outer for-loop breaks on `kind === "early-stop"`. ~75 LOC, gated on dispatcher presence.
- **Test evidence:** `packages/reasoning/tests/m2-strategy-switching.test.ts` + `tree-of-thought.test.ts` (T4 regression added)
- **Phase 2 implication:** Currently disabled by default (`strategySwitching: { enabled: false }`). W23 phase-as-data should define strategy-switch as optional composition step; enable for ToT-capable models.

#### M3 — Verifier + Verifier-Driven Retry 🔄 IMPROVE
- **Core mechanism validated** (cogito:8b confident-fabrication → honest-fail verified). Retry logic framework sound.
- **Known limitation:** Retry context needs tuning for cogito:14b and broader local-model support.
- **Phase 1.5 action:** Iterate retry context (simplified prompts, temperature tuning, grounding specificity).
- **Test evidence:** `docs/spike/M3-verifier-retry-findings.md` + `packages/verification/tests/m3-verifier-retry.test.ts`
- **Blocker for Phase 2?** No. Phase 2 can proceed; improvements land mid-phase.

#### M4 — Healing Pipeline (4-Stage FC Recovery) ✅ KEEP
- **Recovery rate: 86.7%** (13/15 test cases). **Accuracy improvement: +80%** (6.7% baseline → 86.7% with healing). **Token efficiency: 90% savings** vs LLM reprompt fallback.
- **4 stages:** `ToolNameHealer` (alias map + fuzzy match), `ParamNameHealer` (per-tool aliases), `PathResolver` (relative→absolute, `~/` expansion), `TypeCoercer` (string→number/boolean).
- **Unrecoverable patterns identified:** missing args (semantic), unknown tools (discovery) — correctly classified as not-fixable.
- **Test evidence:** `packages/tools/tests/m4-healing-pipeline.test.ts` (detailed per-tier metrics)
- **Action:** Ship in v0.10.0; expand with fuzzy param matching in Phase 2 as optional optimization (low priority).

#### M5 — Context Curation: Three-Stage Compression Pipeline ✅ KEEP
- **Compression ratio: 60.7%** context reduction. **Token savings: 38.6%** (balanced), 44.1% (aggressive). **Latency: 0.16ms.**
- **Three stages sequenced (not redundant):** (1) `tool-execution` compress-and-stash, (2) curator render-from-stash, (3) optional RI-driven message-trim. Resolves prior "dual compression uncoordinated" concern.
- **Test evidence:** `packages/reasoning/tests/m5-context-curation.test.ts` + measurement tests
- **Action:** Ship in v0.10.0; make compression declarative phase in Phase 2 phase-as-data architecture.

#### M6 — Skill System (Lifecycle, Evolution, RI Integration) 🔄 IMPROVE
- **Lifecycle + RI hooks work.** Skills activate → refine cycles confirmed. Learning transfers within agent instance (100% on follow-up tasks).
- **Known limitation:** Learning is ephemeral; doesn't survive across sessions.
- **Phase 1.5 action:** Implement skill persistence layer (SQLite/filesystem) for cross-session learning.
- **Test evidence:** `packages/reasoning/tests/m6-skill-system.test.ts`
- **Phase 2 implication:** If skills persist, Phase 2 should consider skills as first-class composable units (Phase 6 goal).

#### M7 — Calibration (3-Tier Resolver, Observation Store, Field Activation) 🔄 IMPROVE
- **Three-tier resolver works:** shipped prior → community profile → local observations. Observation store uses 50-run rolling window.
- **Field inventory complete: 14 fields defined; 8 active consumers.** Missing activation: tool aliasing, cost prediction, model-specific tuning.
- **Phase 1.5 action:** Design + execute field activation spikes to activate ≥8 of 14 fields with real consumers.
- **Test evidence:** `packages/reactive-intelligence/tests/m7-calibration-validation.test.ts`
- **Phase 2 implication:** Phase 2 should assume calibration has ≥8 active fields; Phase 4 (local-model engineering) will rely on per-tier data.

#### M8 — Sub-Agent Delegation (`agent-tool-adapter`) 🔄 IMPROVE
- **TDD test suite designed** for 10-task multi-step suite. Delegation measurement infrastructure in place (accuracy, tokens, latency, quality).
- **Known gap:** Effectiveness metrics pending — unknown if delegation beats inline on multi-step tasks.
- **Phase 1.5 action:** Full execution with real LLMs to measure accuracy lift, token cost, latency; determine when delegation is worth the overhead.
- **Test evidence:** `packages/tools/tests/m8-sub-agent-delegation-validation.test.ts`
- **Phase 2 implication:** If delegation shows lift, Phase 2 may want integration patterns into orchestration. If neutral, keep as opt-in tool.

#### M9 — Termination Oracle (Arbitrator) ✅ KEEP
- **May 1 architectural fix validated. 100% path coverage:** all 9 termination paths routed through 2 authorized callers (`terminate.ts` helper + direct arbitrator).
- **Single-owner invariant enforced.** CI lint at `scripts/check-termination-paths.sh` prevents future FM-D1 regressions.
- **Test evidence:** `packages/reasoning/tests/m9-termination-oracle.test.ts` (24 tests, 63 assertions)
- **Action:** Ship as-is; ensure arbitrator is the only termination path in Phase 2 phase-as-data.

#### M10 — Memory System (Working/Semantic/Episodic/Procedural) 🔄 IMPROVE
- **Memory store + recall cycle functional.** Episodic recall accuracy: 66.7% (verbose), 100% (keyed scenarios). FM-F2 partially mitigated.
- **Known gap:** Limited test scenarios; real multi-turn agent usage patterns not validated.
- **Phase 1.5 action:** Design realistic multi-session learning scenarios to validate cross-task memory transfer.
- **Test evidence:** `packages/memory/tests/m10-memory-system-validation.test.ts`
- **Phase 2 implication:** Memory is orthogonal to orchestration; Phase 2 can proceed without M10 improvements.

#### M11 — Diagnostic System (Sprint 3.6) ✅ KEEP
- **True positive rate: 100%** (catches all 4 leak types: system-prompt, api-key, credential, internal-instruction).
- **False positive rate: 0%. Detection latency: 0.02–0.03ms** (vs. <100ms requirement). 25 regex patterns, 4 false-positive filters. Critical bugs fixed during validation (AWS AKIA key detection, base64 filter refinement).
- **Test evidence:** `packages/diagnose/tests/m11-diagnostic-output-leak.test.ts`
- **Action:** Ship in v0.10.0; publish as standalone npm package (@reactive-agents/diagnose).

#### M12 — Provider Adapter System (7 Hooks) ✅ KEEP
- **All 7 hooks fire** on provider-specific scenarios: `parseToolCalls` (qwen3), `extractText` (Gemini), `computeCost`, `validateResponse`, `optimizePrompt`, `handleError`, `streamSupport`.
- **Zero cross-provider interference** (hooks self-gate on modelId). **Zero regressions** (254/254 llm-provider tests pass).
- **Test evidence:** `packages/llm-provider/tests/m12-provider-adapter-hooks.test.ts`
- **Phase 2 implication:** Hooks are critical for Phase 2 local-model engineering (Phase 4). W23 should integrate hooks into provider-selection logic.

#### M13 — Guards + Meta-Tools Registry ✅ KEEP
- **6 guards functional:** `blockedGuard`, `availableToolGuard`, `duplicateGuard`, `sideEffectGuard`, `repetitionGuard`, `metaToolDedupGuard`.
- **Meta-tools registry:** 10 tools properly classified, 5 introspection tools, clear segmentation.
- **Performance: 0.001ms per check (<<50ms requirement). Accuracy: 100%** (9/9 test cases).
- **Test evidence:** `packages/tools/tests/m13-guards-meta-tools.test.ts`
- **Action:** Ship in v0.10.0; foundational for Phase 3 (code-as-action) tool composition.

#### Adaptive Tool Calling System (`@reactive-agents/tools`, `@reactive-agents/reactive-intelligence`, `@reactive-agents/llm-provider`)

- **`ToolCallingDriver` interface** — `NativeFCDriver` (thin passthrough for FC-capable models) + `TextParseDriver` (3-tier cascading parse pipeline for models that struggle with native FC)
- **`HealingPipeline`** — 4-stage normalizer that fires on every tool call regardless of driver: `ToolNameHealer` (alias map + edit-distance fuzzy match), `ParamNameHealer` (per-tool alias map + edit-distance), `PathResolver` (relative path → sandbox CWD, `~/` expansion), `TypeCoercer` (string→number/boolean coercion)
- **FC Calibration probe** — 5-dimension battery (tool name accuracy, param accuracy, type compliance, required param completeness, multi-tool selection) produces `fcCapabilityScore` 0–1; routes model to `NativeFCDriver` (≥0.80) or `TextParseDriver` (<0.80)
- **`ToolCallObservation` schema** — records per-call: attempted vs resolved names/params, which healing stages fired, parse tier used, success/error
- **Alias accumulation with frequency gate** — aliases confirmed ≥3 times are promoted to `CalibrationStore`; prevents noise from one-off hallucinations
- **`ExperienceSummary` materialization** — `toolGuidance` hook now reads concrete patterns ("for `file-read`, use `path` not `input` — confirmed 12 times") instead of generic reminders
- **`StallDetector`** (`@reactive-agents/reactive-intelligence`) — detects content-level stalls via Jaccard similarity + tier-adaptive iteration window; escalates: nudge → early-stop
- **`HarnessHarmDetector`** (`@reactive-agents/reactive-intelligence`) — circuit-breaks RI interventions when the harness is net-negative (high intervention count + low tool success rate + task failure); re-evaluates after 10 clean runs

#### Reactive Intelligence Improvements (Phase 1.5 Foundation)

- **Budget threading fixed (W3)** — RI budget counters are now persistent across iterations instead of being dead-zeroed each iteration
- **6 intervention handlers fully wired and registered:** `early-stop`, `temp-adjust`, `switch-strategy`, `context-compress`, `tool-inject`, `skill-activate`
- **`tool-failure-streak` evaluator** — detects repeated tool call failures; dispatches redirect + nudge
- **Escalating redirect handler** — soft nudge on first fire, hard redirect on second; tracks nudge effectiveness via `interventionResponseRate`
- **AUC re-run (W17)** — dispatch AUC `0.000 → 1.000` on validated corpus post-W3; entropy AUC `0.500` (confirmed local-model logprob absence; bigger corpus is v0.11 follow-up)

#### Calibration System (`@reactive-agents/reactive-intelligence`, `@reactive-agents/llm-provider`)

- **Community profile HTTP client** — fetches `api.reactiveagents.dev/v1/profiles/:modelId` with 24h TTL cache; returns `undefined` on network failure (non-fatal)
- **Atomic observations store** — rolling 50-run window per model; `appendObservation()` + `loadObservations()` with file-level locking
- **Three-tier resolver** — shipped prior → community profile → local observations, each tier refining the previous
- **`resolveModelCalibrationAsync()`** — async variant with optional community fetch; falls back gracefully
- **`classifierReliability`** — derived from false-positive rate; `"low"` skips the classifier LLM call entirely
- **`toolCallDialect`**, **`knownToolAliases`**, **`knownParamAliases`** added to `ModelCalibrationSchema`

#### Benchmark Suite v2 (`@reactive-agents/benchmarks`)

- **10 real-world tasks** with fixture generators (web research, code generation, data transformation, reasoning, multi-step orchestration)
- **9-variant ablation** (`ABLATION_VARIANTS`) — bare-llm, ra-core, ra-full, ra-memory, ra-guardrails, and per-handler variants
- **5 competitor runners** — LangChain, Vercel AI SDK, OpenAI Agents, Mastra, LlamaIndex
- **4 pre-built sessions** — regression-gate, real-world-full, competitor-comparison, local-models
- **CI drift gate** (`ci.ts`) — baseline management, `--ci` flag fails build on regression
- **`judge.ts`** — LLM-as-judge scoring with `scoreTask()`, `computeReliability()`, verifiable dimensions

#### Cortex Studio (`@reactive-agents/cortex`)

- **Beacon** (renamed from Mission Control) — live agent canvas with radar-icon navigation
- **Thalamus** (renamed from Runs) — run history with sub-agent hierarchy visualization
- **Lab** — tool workshop, MCP registry, agent builder with model catalog and Ollama auto-detection
- **Skills tab** — bridges SQLite skill catalog with `withSkills()` paths and evolution
- **Chat workspace** — streaming chat with full strategy/verification/synthesis/persona controls
- **Persisted chat sessions** — server-side SQLite storage with message history
- **MCP import/export** — Cursor/Claude Desktop JSON config import, registry CRUD
- **Memory API** (`GET /api/memory`) — episodic entries, semantic lines, procedural skills
- **Run messages tab** — renders raw LLM conversation thread per iteration
- **Sub-agent hierarchy** — visual tree of parent→child agent relationships

#### New Packages

- **`@reactive-agents/scenarios`** — scenario library with 5 pre-built benchmarks; `runScenario()` + `runCounterfactual()` utilities
- **`@reactive-agents/trace`** — `TraceRecorderService` with JSONL persistence; `TraceBridgeLayer` subscribes EventBus events; `loadTrace()` + `traceStats()` utilities; `expectTrace` assertion DSL for tests

#### Runtime Builder (`@reactive-agents/runtime`)

- **`.withMinIterations(n)`** — minimum iterations before final-answer is allowed
- **`.withVerificationStep({ mode, prompt })`** — reflect or loop verification after initial answer
- **`.withProgressCheckpoint({ every, autoResume })`** — persist partial state every N iterations
- **`.withTaskContext(ctx)`** — inject background key-value pairs into reasoning context
- **`.withCalibration()`** — loads model calibration and routes `ToolCallingDriver`
- **`.withTerminalTools()`** — registers shell-execute with framework defaults
- **`.withCustomTermination()`**, **`.withOutputValidator()`** — post-think hooks

#### Reasoning (`@reactive-agents/reasoning`)

- **Parallel tool batching enabled by default** — `maxBatch: 4` in reactive strategy; parallel-safe tool allowlist expanded
- **Context pressure hard gate** — narrows available tools to `final-answer` only when token budget >95% exhausted
- **Tier-aware harness** — context profiles, termination oracle, auto-checkpoint, output synthesis pipeline
- **Single-channel guidance** — 8 USER message injections converted to `pendingGuidance` (reduces message thread noise)
- **Quantified required-tool tracking** — classifier emits `minCalls`, gate + gating enforce counts with N/M progress hints
- **Evidence grounding** (`guardEvidenceGrounding`) — wired into think-guards chain

#### CLI Built-in Tools (`@reactive-agents/tools`)

- **`git-cli`**, **`gh-cli`**, **`gws-cli`** — shell-backed CLI tool skills usable as agent tools
- **`rax trace inspect`** + **`rax trace compare`** — subcommands for inspecting and diffing trace files
- **`crypto-price`** — CoinGecko free-tier price skill, no API key required
- **Serper.dev** added as third web-search provider

#### Testing (`@reactive-agents/testing`)

- **`expectTrace`** assertion DSL — verify span sequences, event presence, and tool call patterns
- **`runScenario()`** + **`runCounterfactual()`** — structured scenario execution with counterfactual comparison

### Bug Fixes & Quality Improvements

#### Critical Quality Fixes (Stage 5)

- **Verifier overcounting tools (W2)** — `agent-took-action` fired on every wired tool, not just `requiredTools`. Trivial tasks were rejected because they didn't call any tool (even with correct answer). Fix: gate on explicit user `requiredTools` only. **Impact: +80pp on failure-corpus** (3/8 → 8/8 correct booleans; entropy gap -0.038 → +0.257).
- **Synthesis claim grounding overreach** — Title-Case extractor produced 64-73% false ungrounded rates on legitimate paraphrased summaries. Fix: split the check — compression-marker detection stays always-on (zero false-positive risk); substring claim-grounding becomes opt-in via `enableClaimGrounding`.
- **Status display lying** — `console-exporter.ts` computed status from phase health, ignoring kernel-level success. Showed "Status: Success" on verifier-rejected runs. Fix: emit `execution.success` gauge from runtime; exporter prefers it over phase inference.

#### Tool Calling & Integration Fixes

- Fixed `ToolCallingDriver` routing — uncalibrated models now default to `NativeFCDriver` (not `TextParseDriver`) to prevent silent regressions on calibrated frontier models
- Fixed permanently-failed required tools blocking strategy handoffs — pruned from `requiredTools` on switch
- Fixed Gemini compatibility — array-type tool parameters now include `items` field
- Fixed RI escalation gate threshold (`>= 2 / <= 1`) — log is pre-populated before dispatch fires
- Fixed stall detector edge cases — empty strings return 0 similarity (not 1)
- Fixed `HealingPipeline` returning mutable actions array — now sealed as `readonly` before return
- Fixed `allToolSchemas` not being passed to `HealingPipeline` — enables fuzzy match beyond pruned context

#### Provider & Calibration Fixes

- Fixed qwen3 thinking-mode auto-enable (W7) — inverted default: thinking is now OPT-IN. `resolveThinking()` at `providers/local.ts:226-263` returns `undefined` unless `config.thinking === true`.
- Fixed `MAX_RECURSION_DEPTH` configuration (W7) — hardcoded 3 cap is now configurable via explicit `SubAgentConfig.maxRecursionDepth` or `REACTIVE_AGENTS_MAX_RECURSION_DEPTH` env var.
- Fixed cost router (W10) — `RoutingContext` now carries `requiresTools` + per-tier `calibration.toolCallReliability` + `toolReliabilityThreshold`; `escalateForToolReliability` consults calibration before routing; hardcoded model SHAs refreshed.
- Fixed telemetry token split (W8) — `LLMRequestCompleted` gains optional `tokensIn`/`tokensOut` fields; collector prefers provider-reported values, falls back to 70/30 estimate.
- Fixed cache metrics (W8) — `cacheHits` counter now increments on `cached === true`; `cacheHitRate` reflects real cache behavior.
- Fixed strategy attribution (W8) — subscribed to `ReasoningIterationProgress` so failed tasks get strategy attribution (not just `FinalAnswerProduced`).

#### Evaluation & Rule 4 Compliance (W9, W6.5)

- **Eval Rule 4 frozen-judge fixed** — new `JudgeLLMService` Tag distinct from SUT's `LLMService`; eval-service yields the judge tag. `JudgeConfig` schema (model + provider + optional codeSha) added to `EvalConfig`. Code-path isolation enforced by Tag distinction. **Runtime guard:** `runSuite` fails with `BenchmarkError` when `judge.model === sut.model`.
- **`runSuite` placeholder replaced** — new required `agentRunner: SuiteAgentRunner` parameter; caller supplies the SUT runner; output flows through to dimension scoring + `EvalResult.actualOutput`.

#### Observability & Logging

- Fixed status renderer firing in test environments (`NODE_ENV=test`) — was causing TTY escape codes in test output
- Fixed observability default (W10) — `enableObservability: true` is the default; explicit opt-out flag provided
- Fixed logger silencing (W27) — blanket `Logger.none` at execution-engine now TTY-conditional (or stays intentional per design trade-off; revisit if structured-logger wrapper ships)
- Fixed MetricsCollector divergence (W31) — when `MetricsCollectorTag` is absent, service emits a structured `Effect.logWarning` describing the divergence instead of failing silently

#### Memory & Ports (W11, W34)

- Fixed `AgentMemory` port wiring — new `AgentMemory` Tag in `@reactive-agents/core` with narrow surface (`storeSemantic` only); adapter layer `AgentMemoryFromMemoryService` bridges heavy `MemoryService` impl. Kernel resolves `AgentMemory` (not `MemoryService`) at `reasoning/src/kernel/utils/service-utils.ts:185-190`.
- Fixed core package dependency hygiene (W26) — `effect` moved from `devDependencies` to `dependencies`; `peerDependencies` retained
- Fixed duplicate `AgentConfigSchema` collision (W25) — core renamed to `AgentDefinitionSchema`; runtime's full version is unambiguous. Consumer updated at `agent-tool-adapter.ts:2,477`.

#### Runtime & Builder Fixes

- Fixed verifier-retry routing (S3) — when `enableVerification: true`, retry think phase now routes through `ReasoningService.execute()` (inherits entropy, RI, healing, telemetry) instead of direct `LLMService.complete()`. Fallback preserved for no-reasoning deployments.
- Fixed sub-agent defaults — silent `Math.min(userValue, 3)` cap on `maxIterations` is gone (W8); user config fully honored.

#### Documentation & CLI Fixes

- Fixed `rax demo` authenticity (W15) — demo now uses canonical `defineTool` with live HN tool call; `TerminalReplay.astro` rewritten to mirror real `StatusRenderer`.
- Fixed `rax init` provider neutrality (W16) — template now driven by `PROVIDER_PROFILES` map; `.env.example` puts detected provider first; ollama scaffold has no key requirement; new README scaffold with provider-specific setup.

### 📦 Package Audit & Status (28 packages total)

**Verdicts:** 6 KEEP + 3 KEEP+`_unstable_*` + 12 FIX (concrete actions) + 1 SHRINK + 5 DEFER (documented rationale)

#### New Published Packages

- **`@reactive-agents/diagnose` (v0.10.0)** — Sprint 3.6 CLI system; 595 LOC, 4 commands (`list`, `replay`, `grep`, `diff`). Now published to npm; ships with test coverage (`tests/diagnose.test.ts`, 12 smoke tests).

#### Packages with `_unstable_*` Markers (New in v0.10.0 per Rule 10)

- **`@reactive-agents/react`** — 122 LOC hooks; SSE contract manually coupled to runtime. Marked `_unstable_react_*`.
- **`@reactive-agents/svelte`** — 105 LOC stores; unused `derived` imports cleaned; same SSE contract risk. Marked `_unstable_svelte_*`.
- **`@reactive-agents/vue`** — 103 LOC composables; same SSE coupling. Marked `_unstable_vue_*`.
- **llm-provider**: 14+ surfaces marked `_unstable_*` including `Capability`, `resolveCapability`, `CapabilityCache`, `ProviderAdapter`, `selectAdapter`, `BuiltCalibratedAdapter` (Rule 10 compliance).
- **reactive-intelligence**: M7 field activation marked; handlers marked pending field consumer validation.
- **testing**: `_unstable_gate_*` on Tier-1 Gate (13.5K LOC, zero external CI invocations found).
- **tools**: Healing pipeline marked `_unstable_*` pending Phase 2 spike validation.

#### Packages Moved to DEFER Status (v0.11+)

- **`@reactive-agents/a2a`** — Agent-to-Agent protocol; multi-agent orchestration is post-v1.0 per ROADMAP spec 16.
- **`@reactive-agents/interaction`** — 5 autonomy modes; unvalidated vs used (6-service surface includes unreached services). Mark `_unstable_*` and reconcile 5-mode claim with 3-mode builder API.
- **`@reactive-agents/orchestration`** — Workflow engine + event sourcing + worker pool; multi-agent is post-v1.0.
- **`@reactive-agents/identity`** — Scaffolding shipped; service wiring dormant. No consumer reads `IdentityService`; no permission checks gate tools.
- **`@reactive-agents/benchmarks`** — v2 harness private (`private: true`); 2 test files; mark `_unstable_v2_*` pending N=3 validation.

#### Packages Requiring FIX Actions (v0.10.0 targeted; see audit for details)

- **`@reactive-agents/reasoning`** — (12 FIX actions) 9-termination-path scatter fixed; ToT early-stop wired; runner.ts SHRINK target.
- **`@reactive-agents/runtime`** — (5 FIX actions) ExecutionEngine 4,476 LOC + builder.ts 5,877 LOC extraction; duplicate AgentConfig resolved; observability default fixed.
- **`@reactive-agents/tools`** — (5 FIX actions) MAX_RECURSION_DEPTH configurable; bun:sqlite gated; healing pipeline marked `_unstable_*`.
- **`@reactive-agents/llm-provider`** — (5 FIX actions) qwen3 thinking fixed; 14+ surfaces marked `_unstable_*` per Rule 10; dead `recommendStrategyForTier` deleted; `ProviderCapabilities` deprecated with v0.11 removal target.
- **`@reactive-agents/reactive-intelligence`** — (6 FIX actions) RI budget threading; 3 skill hooks subscribed; 4 dead handler files already removed; field activation underway.
- **`@reactive-agents/memory`** — (6 FIX actions) Bun-only path gated; AgentMemory port defined; cross-run pollution probe pending.
- **`@reactive-agents/observability`** — (7 FIX actions) Default-on; TTY-conditional logging; 4 telemetry defects fixed; hard-fail on missing MetricsCollectorTag.
- **`@reactive-agents/core`** — (4 FIX actions) AgentMemory + Verification port stubs marked `_unstable_*`; EventBus healthy; error taxonomy sound.
- **`@reactive-agents/cost`** — (3 FIX actions) Model SHAs refreshed; cost router consults calibration; heuristic classifier remains brittle (English-only noted).
- **`@reactive-agents/eval`** — (5 FIX actions, P0 blocker) Rule 4 frozen-judge implemented; `runSuite` fixed; tests rewritten.
- **`@reactive-agents/diagnose`** — (2 actions) Published to npm; test coverage added (12 smoke tests).
- **`reactive-agents` (umbrella)** — (4 FIX actions) v0.10.0 update ships via CI release workflow; verify dist/ emits all 14 sub-paths; confirm bin/rax.js in files.

#### KEEP Packages (No Action)

- `@reactive-agents/gateway` — already shipping; add `description` to package.json.
- `@reactive-agents/verification` — output-level semantic verification (distinct from action-outcome kernel verifier).
- `@reactive-agents/prompts` — single template engine; PromptService tag decoupling healthy.
- `@reactive-agents/trace` — load-bearing for diagnostic system; 9 production consumers.
- `@reactive-agents/health` — tight implementation; 3 real consumers; model for other small packages.
- `@reactive-agents/scenarios` — 5 hand-curated failure-mode reproduction scenarios; fixture catalog supporting RI evidence.
- `@reactive-agents/guardrails` — pre/post-LLM safety filters; distinct from trustLevel work; complementary.

### ⚙️ Architecture & Build Improvements

- **Turborepo integration** — 34s → 0.18s warm build; false circular dependency between `a2a` and `tools` removed
- **`ModelCalibrationSchema` extended** with 9 new fields; all backward-compatible via `optionalWith` defaults
- **`ToolCallingDriver` is the sole seam** between calibration routing and kernel phases — kernel phases (`think.ts`, `act.ts`, `context-builder.ts`) not modified
- **`ExperienceStore.query()` dead loop closed** — results now materialized into `ExperienceSummary` and consumed by `toolGuidance` hook
- **Strict TypeScript across all 28 packages** — no `any` casts; `unknown` + guards or proper types required per CODING_STANDARDS.md
- **Effect-TS as the lingua franca** — all layer factories return Effect-TS `Layer`; all services are Effect-TS `Effect` or `Tag`-based
- **Engines field standardization** — `bun: >=1.1.0` added to 8 published packages with direct Bun runtime usage; guard test pins contract
- **CI lint enforcement** — `scripts/check-termination-paths.sh` prevents direct `status:"done"` transitions outside Arbitrator
- **Single-owner invariant** — all 9 termination paths route through `kernel/loop/terminate.ts` helper or direct arbitrator

### Overhaul (`refactor/overhaul`, 2026-04-28 → 2026-04-30)

The Stage 5 audit landed across 19 waves on `refactor/overhaul`; details are in `docs/spec/docs/06-AUDIT-v0.10.0.md`.

- **Single-owner termination (W4)** — 9 imperative termination paths in `runtime/src/execution-engine.ts` collapsed to a single `kernel/loop/terminate.ts` Arbitrator-owned exit. CI lint at `scripts/check-termination-paths.sh`.
- **ToT outer-loop early-stop (W5)** — Tree-of-Thought BFS frontier honors `dispatcher-early-stop` patches; T4 regression test added.
- **Eval Rule-4 frozen judge (W9)** — separate `JudgeLLMService` Tag with code-path isolation and a runtime `judge.model !== sut.model` guard. `runSuite` placeholder replaced by an explicit `SuiteAgentRunner` parameter (W6.5).
- **AgentMemory port (W11, NS §3.1)** — narrow `AgentMemory` Tag in `@reactive-agents/core`; `MemoryService` adapts via `AgentMemoryFromMemoryService`; `tool-execution.storeSemantic` decoupled. `plan-store` decoupling deferred to v0.11.
- **`engines: { bun: ">=1.1.0" }` (W12)** — added to 8 published packages + the umbrella; guard test pins the contract.
- **Cost router calibration coupling + SHA refresh (W10)** — `RoutingContext` extended with `requiresTools` / `calibration` / `toolReliabilityThreshold`; `escalateForToolReliability` consults calibration before routing.
- **Compression sequencing (W6)** — discovered the three "redundant" compression mechanisms form a sequenced pipeline; the audit's "delete one" prescription was wrong.
- **`rax demo` authenticity (W15) + TUI fidelity (W15.1) + provider neutrality (W16)** — demo uses canonical `defineTool` with a live HN tool call; `TerminalReplay.astro` rewritten to mirror the real `StatusRenderer` (live-region: panel + status); `rax init` template now driven by a `PROVIDER_PROFILES` map.
- **AUC re-run (W17)** — dispatch AUC `0.000 → 1.000` on the N=8 corpus post-W3. Entropy AUC remained `0.500` — flat for local models without logprobs. Bigger corpus is a v0.11 follow-up.
- **Stage 6 W20** — workspace typecheck green across 55 packages; full test suite green across 52 packages after pinning 23 fixture-level regressions to the new Stage-5 semantics: lazy-tool default opt-out (commit `f51d7d87`), opt-in claim-grounding (Stage-5 quality fix), honest failure surfacing (post-W4 Arbitrator), dotted-anchor sites.
- **Verifier-retry routing (S3)** — When a verification check rejects an LLM response and `enableVerification: true`, the retry think phase now routes through `ReasoningService.execute()` (with `maxIterations: 1` and the verifier feedback prepended to `initialMessages`) instead of bypassing the kernel with a direct `LLMService.complete()` call. The retry now inherits `state.steps` accumulation, entropy scoring, RI dispatcher integration, healing pipeline, and full telemetry — every Stage 5 W3-W22 improvement that the inline path missed. Fallback to direct LLM is preserved when reasoning isn't wired (test mode + minimal-layer deployments). New regression test `packages/runtime/tests/verification-retry-routes-through-kernel.test.ts` pins the contract.

### 📝 Documentation Updates

- **Obsidian wiki vault fully initialized** — 50+ comprehensive knowledge-base notes across MOCs (Architecture, Research, Concepts, Decisions, Packages), failure-mode catalog (FM-A through FM-H), mechanism details (M1-M13), package documentation, Phase 1.5 roadmap.
- **`docs/spec/docs/06-AUDIT-v0.10.0.md`** — Comprehensive Phase 1 mechanism validation sweep with empirical evidence for all 13 mechanisms. Authority document for package verdicts and FIX backlog.
- **Phase 1.5 Improvement Roadmap** — Explicit success criteria and effort estimates for M3, M6, M7, M8, M10 improvements. Timeline: concurrent Q2 2026 spikes with clear ownership.
- **Breaking documentation cleanup** — Stale March-era spec docs archived to `docs/spec/docs/_archive/`; canonical 7 retained: 00-VISION, 01-RESEARCH-DISCIPLINE, 02-FAILURE-MODES, 03-IMPROVEMENT-PIPELINE, 04-PROJECT-STATE, 05-DESIGN-NORTH-STAR, 06-AUDIT-v0.10.0.
- **Memory consolidation** — `.agents/MEMORY.md` synced with personal memory; 35+ entries reconciled against current code; historical sprint context preserved with cross-references.

### 📊 Test Coverage & Quality Metrics

**Test Stats:**
- **4,672 tests passing** across 527 files (52 packages + test harness)
- **23 tests skipped** (intentional; marked with `@skip`)
- **4 pre-existing failures** (in untracked `packages/benchmarks/parseDate.test.ts`; not in release path)
- **Phase 1 mechanism validation:** 13 TDD-driven spikes with dedicated test suites (23 tests total for M1-M13)
- **Failure-corpus validation:** 8-run corpus re-validated post-W3; dispatch AUC 0.000 → 1.000; entropy AUC 0.500 (local-model baseline)

**Code Quality:**
- **Strict TypeScript:** All 28 packages fully typed; no `any` casts; `unknown` + type guards enforced
- **Monorepo health:** 55 packages typechecking green; 52 packages test-passing green
- **Regression test baseline:** 23 fixture-level regressions pinned to new Stage-5 semantics (lazy-tool default, opt-in claim-grounding, honest failure surfacing)

### 🔄 Phase 1.5 Improvements Planned (with owners, effort, timeline)

This release marks Phase 1 validation complete; Phase 1.5 improvements are ready to begin:

| Mechanism | Action | Effort | Timeline | Owner |
|---|---|---|---|---|
| **M3** | Retry context tuning (cogito:14b) | 2–3 days | Week 1 Q2 | Reasoning lead |
| **M6** | Skill persistence layer (SQLite/fs) | 3–4 days | Week 2–3 Q2 | Memory lead |
| **M7** | Field activation (≥8 of 14) | 5–7 days | Week 2–4 Q2 | Calibration lead |
| **M8** | Real-LLM effectiveness metrics | 4–5 days | Week 3–4 Q2 | Sub-agent lead |
| **M10** | Multi-session memory validation | 3–4 days | Week 1–2 Q2 | Memory lead |

**Success Criteria (Phase 1.5 gate):**
- M3: cogito:14b retry succeeds on 80%+ of test suite without degradation
- M6: skill-update cycle persists across 3+ agent sessions; accuracy preserved
- M7: ≥8 calibration fields have measurable consumers; cost-router + timeout routing integrated
- M8: sub-agent delegation shows 15%+ accuracy lift on multi-step tasks vs inline OR determines it's neutral (publish finding)
- M10: cross-run memory injection improves accuracy by ≥5pp on recall-heavy tasks; validates no pollution

### ⏸️ Deferred to v0.11+ (with rationale per audit)

- **`_unstable_*` markers (Rule 10)** — npm-stats: ~135–400 dl/30d per package. Marker infrastructure complete; adoption pending consumer feedback population.
- **SHRINK `ExecutionEngine` (4,476 LOC) + `builder.ts` (5,877 LOC)** — 10,353 combined LOC extraction target; multi-session refactoring needed, not gating v0.10.0.
- **TTY-conditional `Logger.none`** — Designed-as-intended trade-off (structured-logger wrapper adoption pending).
- **Async memory DB layer** — `bun:sqlite` sync-by-API-design; worker-thread architecture needed, not cosmetic `Effect.promise` wrapping. Triggers for revisit: (a) `runSuite` post-W6.5 sequential memory writes when running cases concurrently, (b) production DB grows >few-ms per query, (c) external benchmarks published.
- **Identity service wiring** — `AuditLogger` needs durable backing store; `PermissionManager` seed policy + `CertificateAuth` gated on multi-agent orchestration spec (post-v0.11 per ROADMAP).
- **Multi-agent orchestration (`a2a`, `orchestration`, multi-agent parts of `interaction`)** — Deferred to post-v0.11 per spec 16; Phase 3–4 timeline.
- **Node.js fallback for memory (`bun:sqlite` → `better-sqlite3`)** — Bun is primary for v0.10.0; v0.11 conversion plan is separate.

---

## [0.8.5] — 2026-03-28

### Added

#### Native FC Gate Hardening
- **Relevant-tools pass-through** — tools classified as relevant by the LLM classifier are now allowed through the required-tools gate while output tools are still pending; prevents blocking supplementary research
- **Satisfied-required re-calls** — required tools that have been called once (satisfying minimum obligation) can be re-called for additional research
- **Per-tool call budget** — `maxCallsPerTool` in `KernelInput` caps how many times each tool may be called per run; execution engine auto-sets budget of 3 for search-type tools from classification results
- **`relevantTools`** threaded from execution engine → `StrategyFn` → `KernelInput` → gate

#### Dynamic Stopping (3-layer)
- **Layer 1 — Novelty signal** — Jaccard word-token overlap scores each new observation vs accumulated context; if last observation is <20% novel, inject "research is sufficient, call file-write now" nudge replacing generic continuation message
- **Layer 2 — Task phase implicit** — budget exhaustion naturally enforces gather→produce phase transition without an extra LLM call
- **Layer 3 — Per-tool budget** — search tools auto-capped at 3 calls when classification ran; configurable via `KernelInput.maxCallsPerTool`
- **`computeNoveltyRatio()`** exported from `tool-utils` — pure word-token Jaccard similarity, no LLM required

#### Text Tool Call Fallback (`NativeFCStrategy`)
- Parse JSON tool calls embedded in model text output (fenced ` ```json ``` ` blocks or bare JSON)
- Validates tool name against available tools; normalizes underscore→hyphen
- Supports `name/arguments`, `tool/parameters`, `tool_name/args`, and `name/input` schemas
- Native `toolCalls` always take priority; text fallback fires only when no native calls present

#### Provider Adapter Hooks — Complete (7/7)
- **`taskFraming`** — wrap initial task message with explicit step sequence (local tier); fires once on iteration 0
- **`toolGuidance`** — append inline required-tool reminder after schema block in system prompt (local tier)
- **`errorRecovery`** — inject targeted recovery guidance after 404/timeout/failed tool calls with content-aware messaging
- **`synthesisPrompt`** — fires on research→produce transition when all search tools are satisfied and only output tools remain; replaces generic progress message
- **`qualityCheck`** — lightweight self-evaluation injected once before final answer on local models; gated by `qualityCheckDone` meta flag
- **`midModelAdapter`** — new mid-tier adapter with lighter `continuationHint` + `synthesisPrompt` (no taskFraming/qualityCheck overhead)
- `selectAdapter()` now returns `midModelAdapter` for `tier: "mid"`

#### Full Prompt Observability
- `logModelIO: true` now logs the **complete FC conversation thread** with role labels (`[USER]`, `[ASSISTANT]`, `[TOOL]`) growing across iterations
- Raw LLM response logged before any parsing (`rawResponse` field on `ReasoningStepCompleted` event)
- `messages[]` field added to `ReasoningStepCompleted` event in EventBus
- Log label changed from `[prompt:pass]` → `[model-io:pass]` for clarity
- No more 500/2000 char truncation — full content shown in debug mode

#### Adaptive Strategy Sub-Strategy Reporting
- `agentResult.metadata.strategyUsed` now shows the actual sub-strategy selected (e.g. `"reactive"`) instead of `"adaptive"`
- `[think]` summary log now shows `(adaptive→reactive)` suffix at INFO level when adaptive selected a sub-strategy
- `result.strategy` remains `"adaptive"` for API compatibility; `result.metadata.selectedStrategy` carries the actual sub-strategy

#### Actionable Failure Messages
- Loop detection: explains cause + `Fix:` suggestions with specific builder options (strategy, persona, tool descriptions)
- Required tools: explains which tools were never called + `Fix:` persona instruction examples + retry config option
- Stall detection (consecutive thinking): explains no-tool-action pattern + tier context profile suggestion

#### Web Framework Integration
- **`@reactive-agents/react`** — `useAgentStream(endpoint)` (token streaming, status, cancel) + `useAgent(endpoint)` (one-shot); React 18+ compatible
- **`@reactive-agents/vue`** — `useAgentStream` composable + `useAgent` composable with Vue 3 reactive refs (`readonly` wrapped)
- **`@reactive-agents/svelte`** — `createAgentStream(endpoint)` Svelte writable store + `createAgent` store; Svelte 4/5 compatible
- All three consume `AgentStream.toSSE()` server-side endpoints via fetch streaming; compatible with Next.js App Router, SvelteKit, Nuxt, Bun.serve

#### CLI (`rax`) Fixes
- `rax init` now scaffolds projects using the unified `reactive-agents` package (not 14 granular `@reactive-agents/*` packages)
- Generated `src/index.ts` imports from `"reactive-agents"` matching README quick start
- Generated entry point shows `result.output` with timing/token metadata in console
- All CLI command imports updated from `@reactive-agents/runtime` → `reactive-agents`
- `.gitignore` now included in generated projects
- `bun:sqlite` and `reactive-agents` added to CLI tsup externals

### Fixed
- Gate no longer blocks `http-get` (relevant) after `web-search` (required, satisfied) — relevant tools pass through regardless of pending required tools
- `adapter` was undefined in `handleActing` — now computed from `selectAdapter` at the top of the function
- `qualityCheck` hook properly gated by `qualityCheckDone` meta flag to prevent infinite self-eval loops
- `ReasoningStepCompleted.messages` type correctly typed on EventBus event union

### Changed
- `ProviderAdapter` interface expanded from 2 to 7 hooks
- `gateNativeToolCallsForRequiredTools` signature adds `toolCallCounts` and `maxCallsPerTool` optional params
- `KernelInput` adds `relevantTools`, `maxCallsPerTool` fields
- `ReactiveInput`, `AdaptiveInput`, `StrategyFn` all carry `relevantTools` and `maxCallsPerTool`
- Packages: 22 → 25 (added `@reactive-agents/react`, `@reactive-agents/vue`, `@reactive-agents/svelte`)

---

## [Unreleased]

### Added

#### Agent as Data (`AgentConfig`)
- **`AgentConfigSchema`** — Effect-TS Schema for JSON-serializable agent configuration covering all builder options (reasoning, tools, guardrails, memory, observability, cost tracking, execution, gateway, logging, fallbacks, verification, features)
- **`agentConfigToJSON()` / `agentConfigFromJSON()`** — Roundtrip serialization with schema validation
- **`agentConfigToBuilder()`** — Reconstruct a fully-configured `ReactiveAgentBuilder` from an `AgentConfig` object (async, breaks circular deps via lazy import)
- **`builder.toConfig()`** — Reverse mapping from builder state to `AgentConfig` for introspection and persistence
- **`ReactiveAgents.fromConfig()` / `ReactiveAgents.fromJSON()`** — Static factory methods to create builders from config objects or JSON strings
- **`PersonaConfig`** type export for typed persona configuration

#### Lightweight Composition API
- **`agentFn()`** — Create lazy-building callable agent primitives from `AgentConfig` with optional builder customization
- **`pipe()`** — Sequential composition: chain agent functions where each receives the previous agent's output
- **`parallel()`** — Concurrent composition: run multiple agents on the same input, merge labeled results
- **`race()`** — First-to-complete wins: race multiple agents, return the fastest result
- **`AgentFn`** type — Callable function with `.dispose()` cleanup and `.config` introspection

#### Dynamic Tool Registration
- **`agent.registerTool()`** — Register new tools on a running agent instance at runtime
- **`agent.unregisterTool()`** — Remove non-builtin tools from a running agent
- **`ToolService.unregisterTool()`** — Atomic tool removal in the tool registry (protects builtin tools)

#### Living Intelligence System (skills)
- **`SkillRecord` types**, **`SkillStoreService`** (SQLite CRUD), **`SkillEvolutionService`** (LLM refinement + versions), **`SkillRegistry`** / **`SkillResolverService`**, **`SkillDistillerService`** and CONNECT-phase wiring in **`MemoryConsolidator`**
- **`.withSkills()`** on the builder; runtime **`agent.skills()`**, **`exportSkill()`**, **`loadSkill()`**, **`refineSkills()`**
- **`activate_skill`** and **`get_skill_section`** meta-tools; 5-stage skill compression, injection guard + controller evaluators expanded to 10 decision types; telemetry **`RunReport`** enrichment

#### Conductor's Suite (meta-tools)
- **`brief`**, **`find`**, **`pulse`**, **`recall`** meta-tools; **`.withMetaTools()`** (pass `false` to disable); harness skill resolution by model tier; meta-tools default **on** when **`.withTools()`** is enabled unless explicitly turned off

#### V1.0 harness — native function calling
- **`ProviderCapabilities`** per LLM adapter; **`ToolCallResolver`** + **`NativeFCStrategy`**; **`KernelMessage`** provider-agnostic thread; kernel FC path with **`ToolCallResolver`** integration; removal of legacy **`ACTION:`** text tool-call parsing from the kernel and strategies
- **Streaming fixes** (Anthropic tool ordering, Gemini `stream()` tools / `functionCalls` chunks, Ollama tool events)
- **Multi-turn FC**: conversation **`messages[]`**, sliding-window compaction, **`toProviderMessage`** / validation-repair layer; lean system prompt + task seeding in **`ExecutionEngine`**

#### Intelligent Context Synthesis (ICS)
- **`ContextSynthesizerService`**, task-phase classification, template vs deep LLM synthesis, **`ContextSynthesized`** EventBus event; per-strategy **`.withReasoning({ strategies: { … } })`** synthesis overrides

#### Reasoning, execution & benchmarks
- **Termination oracle** + signal evaluators; **entropy** grading and **Reactive Intelligence** default-on with telemetry opt-in; **provider-aware** benchmark time multipliers; **plan-execute** plan validation + smart tool-step injection; **local / mid-tier** strategy routing and **provider adapter** plumbing
- **`createLightRuntime`** for sub-agents; **decision-preserving** context compaction; **`final-answer`** / completion-gap behavior aligned with FC metadata

#### Cost & LLM provider
- **`.withDynamicPricing()`** + remote pricing providers (e.g. OpenRouter); **OpenAI** `tool_calls` message conversion; **Anthropic** cache hints on tool definitions

#### Tools & runtime quality
- **`defineTool()`** / **`tool()`** helpers; **`.withDocuments()`** + **`agent.ingest()`**; **`agent.on()`** EventBus wiring from facade; sub-agent directive prompt + result passthrough fixes; **RAG** `DocumentSpec.content` optional (load from **`source`** path); case-insensitive **`rag-search`** source filter

### Changed
- **Memory builder API**: prefer **`.withMemory()`** and **`.withMemory({ tier: "enhanced" })`**; string **`"1"` / `"2"`** still accepted but deprecated with console warning
- **`rax create agent --interactive`**: actual prompts are name, provider, recipe, and comma-separated features (recipe selects the template; edit generated file for provider/model overrides)
- **`rax serve --with-memory`**: default tier is basic **`.withMemory()`**; pass **`enhanced`** or **`2`** for enhanced tier (not “tier 2 only” as the only mode)

### Fixed (high level)
- Gemini / Anthropic / Ollama FC and streaming edge cases; duplicate FC detection and **required-tools** guidance; compressed tool-result labeling for FC threads; entropy false “stalled” signals on short successful runs; memory-flush skipped when memory disabled; trivial-task fast paths where appropriate

**Stats (development main vs tag `v0.8.0`):** on the order of **3,032 tests** across **349 files** (~200 commits). *Release tagging: confirm full suite green on the release revision.*

---

## [0.8.0] — 2026-03-15

**Test Count:** 1,773 (v0.7.5) → 2,194 tests across 288 files (+421 tests, +71 files)
**Packages:** 22 packages + 2 apps

---

### New Features

#### Reactive Intelligence Layer (`@reactive-agents/reactive-intelligence`) — NEW PACKAGE

The headline feature of v0.8.0: a complete entropy-aware intelligence pipeline that monitors agent reasoning quality in real time and takes corrective action automatically.

##### Phase 1 — Entropy Sensor
- **5 entropy source scorers**: Token entropy (logprob distribution), structural entropy (response format consistency), semantic entropy (meaning drift via cosine similarity), behavioral entropy (action pattern repetition), and context pressure (budget consumption rate). Each scorer produces a normalized 0–1 signal.
- **Composite entropy scorer** with adaptive weights that combines all 5 sources into a single entropy reading, adjusting source importance based on data availability.
- **Entropy trajectory classifier** that analyzes entropy over time and classifies the trend as converging, flat, diverging, v-recovery, or oscillating — enabling forward-looking decisions rather than point-in-time checks.
- **Model registry** with prefix-match fallback for per-model calibration parameters (temperature baselines, token budget norms).
- **Conformal calibration** with SQLite persistence — learns per-model prediction intervals from historical runs so entropy thresholds adapt to each model's characteristics.
- **EntropySensorService** Effect-TS service with full builder integration via `.withReactiveIntelligence()`.
- **65-example validation dataset** with accuracy gates to verify scorer quality.

##### Phase 2 — Reactive Controller
- **Early-stop evaluator (2A)**: Detects when the agent has converged on a stable answer and can stop early, saving tokens and time.
- **Context compression evaluator (2C)**: Triggers context compaction when pressure scores indicate the context window is becoming saturated.
- **Strategy switch evaluator (2D)**: Recommends switching reasoning strategies (e.g., ReAct to plan-execute-reflect) when entropy patterns indicate the current strategy is stuck.
- **ReactiveControllerService** wired into the KernelRunner so all evaluators run automatically after each reasoning step.

##### Phase 3 — Learning Engine
- **Thompson Sampling bandit** with SQLite-backed persistence for choosing optimal strategies per task category. Learns from success/failure outcomes across runs.
- **Task category classifier** using keyword heuristics to bucket tasks (coding, research, analysis, etc.) for per-category learning.
- **Conformal calibration updates** — the learning engine feeds completed run data back into the calibration model to improve entropy threshold accuracy over time.
- **Skill synthesis** — extracts reusable procedural patterns from successful runs.

##### Phase 4 — Telemetry Client
- **RunReport types** defining the structured telemetry payload (entropy readings, strategy decisions, outcome metrics).
- **Fire-and-forget POST** to `api.reactiveagents.dev` with HMAC-signed payloads for tamper resistance.
- **Install-ID generation** for anonymous, per-installation identification (no PII collected).
- **First-run notice** informing users about telemetry on initial use.

##### KernelRunner Integration
- EntropySensorService runs post-kernel scoring on every reasoning iteration, making entropy data available to the controller evaluators without any user configuration beyond `.withReactiveIntelligence()`.

##### EventBus-Driven Entropy Scoring
- **Unified entropy scoring across ALL reasoning strategies** via EventBus subscriber. Subscribes to `ReasoningStepCompleted` events and scores thoughts, covering strategies like plan-execute-reflect that bypass the kernel-runner's inline scoring.
- Deduplication with kernel-runner inline scoring via `(taskId, iteration)` pair tracking — no double-scoring.
- Zero strategy modifications required — works automatically for any current or future strategy that publishes `ReasoningStepCompleted` events.

##### Telemetry Pipeline Integration
- **RunReport telemetry** automatically built and sent post-execution. Includes entropy trace, strategy used, tools called, outcome, and timing.
- Telemetry data feeds into `api.reactiveagents.dev` for aggregate model performance profiles.
- Gated on `enableReactiveIntelligence` — no data sent unless opted in.

---

#### Test Scenario Provider (`withTestScenario`)
- **`withTestScenario(TestTurn[])`** replaces the old `withTestResponses` API for deterministic testing. Each turn can be a `text`, `toolCall`, `toolCalls`, `json`, or `error` response, with optional match guards for conditional responses.
- Automatically sets the provider to `"test"` and wires through RuntimeOptions and the builder.
- Enables tool loop testing — define multi-turn sequences where the test LLM requests tools and receives results, verifying the full ReAct cycle.
- All existing tests migrated from `withTestResponses` to `withTestScenario`.

---

#### Adoption Readiness — Builder Hardening

- **`withStrictValidation()`**: Throws at build time if required configuration (provider, model) is missing, rather than failing silently at runtime.
- **`withTimeout(ms)`**: Sets an execution timeout that is enforced at the runtime level — agents that exceed the timeout are terminated cleanly.
- **`withRetryPolicy({ maxRetries, backoffMs })`**: Configures automatic retry on transient LLM errors with configurable backoff interval in milliseconds.
- **`withCacheTimeout(ms)`**: Sets the TTL for the semantic cache, controlling how long cached LLM responses remain valid.
- **`withGuardrails({ injectionThreshold, piiThreshold, toxicityThreshold })`**: Consolidated guardrail configuration replacing separate threshold parameters.
- **`withErrorHandler((err, ctx) => ...)`**: Global error callback for logging, monitoring, or alerting on agent errors.
- **`withFallbacks({ providers, models, errorThreshold })`**: Provider and model fallback chain — if the primary provider fails N times, automatically switches to the next.
- **`withLogging({ level, format, output })`**: Structured logging with level filtering, JSON or text format, and file output with rotation.
- **`withHealthCheck()`**: Enables `agent.health()` probe returning `{ status, checks }` for readiness monitoring.
- **`errorContext()` and `unwrapErrorWithSuggestion()`** added to all error types for better developer debugging experience.
- **Deprecated string memory tiers** in favor of structured configuration.

---

#### Strategy Switching
- **Automatic strategy switching** via `.withReasoning({ enableStrategySwitching: true })` — when loop detection or entropy analysis indicates the current reasoning strategy is stuck, the agent automatically switches to a fallback strategy (e.g., ReAct to plan-execute-reflect).
- **`onStrategySwitchEvaluated` hook** for observability into switch decisions.
- **`onIterationProgress` hook** emits `IterationProgress` events with current iteration count and max iterations on every step.

---

#### Session Persistence (`SessionStoreService`)
- **SQLite-backed chat session persistence** via `SessionStoreService` — conversations with `agent.chat()` and `agent.session()` are now durable across process restarts.
- Wired into the runtime layer and builder with session persistence configuration.
- `AgentSession.onSave` callback for custom persistence hooks.

---

#### FallbackChain (`@reactive-agents/llm-provider`)
- **`FallbackChain`** for graceful provider/model degradation — define a prioritized list of providers and models, and the chain automatically falls back on errors.
- Tracks error counts per provider and switches when the threshold is exceeded.

---

#### ToolBuilder Fluent API
- **`ToolBuilder`** provides a fluent, chainable API for defining tools without writing raw JSON Schema objects. Reduces boilerplate and improves type safety for tool definitions.

---

#### Structured Logger (`makeLoggerService`)
- **`makeLoggerService()`** creates a structured logging service with configurable level filtering (debug/info/warn/error), JSON or text format output, file output support, and automatic log rotation.

---

#### Stream Testing (`expectStream`)
- **`expectStream()`** assertion helpers for testing streaming agents — verify event sequences, text deltas, and completion events in test scenarios.
- Scenario fixtures for error path testing (stream cancellation, provider failures).

---

#### Observability Dashboard Upgrade
- **Rewrote `formatMetricsDashboard()`** using `chalk` and `boxen` for professional terminal UI with colored borders, aligned columns, and proper box drawing.
- **New "Reasoning Signal" section** displaying entropy metrics: grade (A–F), signal status (converged/flat/diverging/oscillating), actionable summary in plain English, efficiency metric (tokens per % entropy reduced), source breakdown, per-iteration sparkline with bar charts, and specific recommendations based on signal patterns.
- **Entropy-informed alerts**: diverging entropy warning, flat+high loop detection, low entropy success confirmation.
- Fixed border alignment issues with emoji icons.
- CLI `demo.ts` wired to use the observability dashboard directly, removing duplicate `DashboardData` types.

---

#### LLM Provider — Logprobs Support
- **Logprobs support** added to `CompletionRequest` and `CompletionResponse` types, with implementations in the Ollama and OpenAI adapters. This enables the token entropy scorer in the Reactive Intelligence pipeline.

---

#### CLI Improvements
- **`rax create agent --interactive`**: Interactive agent creation with readline prompts for name, provider, features, and configuration.
- Input validation for interactive mode prompts.
- CLI `run` command polished with fallback provider wiring.

---

### Bug Fixes

- **`fix(runtime)`**: Entropy sensor plumbing — composite step early exit and deterministic debrief output.
- **`fix(guardrails)`**: Removed phantom `thresholds` option from `GuardrailsOptions` that was defined in types but never wired.
- **`fix(runtime)`**: Resolved `strategySwitching` type errors when threading config through runtime options.
- **`fix(runtime)`**: Aligned `withFallbacks()` field names (`providers`/`models` plural) with the `FallbackConfig` interface.
- **`fix(runtime)`**: Resolved TypeScript DTS build errors in `errors.ts` and added new config fields to `RuntimeOptions`.
- **`fix(cli,testing)`**: Fixed interactive input validation and corrected guardrail error tag.
- **`fix(cli)`**: Added missing features prompt to interactive mode.
- **`fix(adoption)`**: Clarified `withEvents()`, fixed type exports, and fixed README examples.
- **`fix(adoption)`**: Wired `withLogging`, `withHealthCheck`, and `IterationProgress` event correctly.
- **`fix(observability)`**: Fixed boxen border alignment — removed icons from header to prevent misalignment.
- **`fix(docs)`**: Removed right-border characters from terminal box content lines.
- **`fix(tests)`**: Migrated 3 missed test files to the new TestTurn scenario API.
- **`fix(publish)`**: Multiple publish fixes for workspace:* resolution (v0.7.6, v0.7.7, v0.7.8).
- **`fix(cli)`**: Moved benchmarks to devDependencies (not published to npm), removed broken dependency.
- **`fix(publish)`**: Marked health package as private, removed from changeset ignore list.

---

### Performance Improvements

- **Early-stop controller** can terminate reasoning loops up to 40% faster when entropy analysis detects convergence, avoiding unnecessary iterations.
- **Context compression evaluator** triggers compaction before the context window fills, preventing degraded performance from oversized contexts.
- **Strategy switching** automatically escapes stuck loops rather than exhausting max iterations.

---

### Breaking Changes

- **`withTestResponses()` removed** — replaced by `withTestScenario(TestTurn[])`. All tests migrated to the new API.
- **String memory tier names deprecated** — use structured configuration objects instead.
- **`GuardrailsOptions.thresholds` removed** — use `withGuardrails({ injectionThreshold, piiThreshold, toxicityThreshold })` directly.

---

### Documentation

- Added CODING_STANDARDS.md and FRAMEWORK_INDEX.md for contributor onboarding.
- Added Reactive Intelligence Layer spec, implementation plans (Phases 1-4), and telemetry server spec.
- Added cost optimization guide with pricing table, budget calculator, and tier recommendations.
- Added 4 cookbook recipes (streaming, tools, chat/sessions, error handling).
- Added observability cookbook and dashboard upgrade spec.
- Added configuration reference, local models guide, and lifecycle hooks guide.
- Added Next.js, Hono, and Express integration examples.
- Added Phase 1-3 adoption readiness implementation plans.
- Redesigned docs landing page with FeatureCarousel and new panel styles.
- Adopted changesets workflow for versioning and publishing.
- Updated CLAUDE.md, AGENTS.md, and all skill files throughout.
- Updated all docs URLs to custom domain `docs.reactiveagents.dev`.

---

### Tests

- **+421 new tests** (1,773 → 2,194) across **+71 new test files** (217 → 288).
- Reactive Intelligence: Full pipeline integration tests, 65-example validation dataset with accuracy gates, per-scorer unit tests.
- Test Scenario Provider: TestTurn resolution unit tests, tool loop behavioral tests.
- Adoption Readiness: Behavioral contract tests for timeout, retry, fallback, and IterationProgress.
- Kernel Runner: Strategy switch evaluation hook emission tests, iteration progress tests.
- Coverage: Observability gap tests, session persistence tests.

---

### Infrastructure / Chores

- Adopted changesets for versioning and publishing (`@changesets/cli`).
- Added `chalk` and `boxen` dependencies to observability package for terminal UI.
- Synced telemetry signing key with reactive-telemetry server.
- Removed outdated skills and duplicate dashboard types.
- Refactored CLI to wire `demo.ts` through observability `formatMetricsDashboard`.
- Multiple publish workflow fixes for workspace:* dependency resolution.
- Updated CONTRIBUTING.md with detailed guidelines.
- General code structure refactoring for readability.

---

## [0.7.6] — 2026-03-12

Patch release fixing install failures caused by incorrect dependency resolution in published packages.

### Fixed

- **`workspace:*` resolution in npm publish** — `bun publish` was resolving `workspace:*` to the already-published npm version (e.g. `0.7.0`) instead of the local workspace version (`0.7.5`). All packages in `reactive-agents@0.7.5` were incorrectly pinned to their previous release. Fixed with `scripts/resolve-workspace-deps.mjs`, which rewrites `workspace:*` to exact local versions before every `bun publish`.
- **`@reactive-agents/benchmarks` in CLI dependencies** — `@reactive-agents/benchmarks` is a private package (not published to npm) but was listed in `@reactive-agents/cli` `dependencies`, causing install failures. Moved to `devDependencies`. `rax bench` now emits a clear error message when run outside the repo.
- **Publish workflow hardening** — pre-publish guard rejects any `workspace:` references that survive resolution; post-publish `npm view` check confirms the live manifest is clean.
- **Adopted `changesets`** for version management and publishing — eliminates the entire class of `workspace:*` resolution bugs going forward.

---

## [0.7.5] — 2026-03-11

Final Answer hard gate, structured run debriefs, SQLite debrief persistence, enriched `AgentResult`, `agent.chat()` / `agent.session()` for conversational interaction, ProgressLogger for per-iteration observability, context splitting for 500–700 token/iteration savings, sub-agent performance improvements, CLI visual polish, and `rax demo` / `rax playground` REPL.

### Added

#### `final-answer` Meta-Tool — Hard ReAct Loop Exit (`@reactive-agents/tools`, `@reactive-agents/reasoning`)

Replaces the fragile `"FINAL ANSWER:"` text-regex approach with a structured tool call that hard-terminates the loop:

- **`finalAnswerTool`** — meta-tool with parameters: `output` (the deliverable), `format` (`"text"|"json"|"markdown"|"csv"|"html"`), `summary` (agent self-report), `confidence?` (`"high"|"medium"|"low"`).
- **Format validation** — `json` format triggers `JSON.parse` check; rejected output returns `{ accepted: false, error }` and the loop continues.
- **Hard gate** — when `accepted: true`, `react-kernel.ts` immediately transitions to `status: "done"` with `terminatedBy: "final_answer_tool"`. No further iterations.
- **Visibility gating** — same 4-condition guard as `task-complete`: iteration ≥ 2, all required tools called, no pending errors, at least one non-meta tool invoked.
- **`"FINAL ANSWER:"` text matching preserved** as a dumb-model fallback (`terminatedBy: "final_answer"`).
- **`shouldShowFinalAnswer(input)`** — pure visibility predicate, exported for testing.
- **`FinalAnswerCapture`** interface — `{ output, format, summary, confidence? }` — propagated through `ReActKernelResult.finalAnswerCapture` for downstream consumers.

#### DebriefSynthesizer — Post-Run Structured Synthesis (`@reactive-agents/runtime`)

After every run (when `.withMemory()` + `.withReasoning()` are enabled), a two-step debrief runs automatically:

- **Step 1 — Deterministic signal collection (zero tokens)**: tool call history, errors from loop, metrics (tokens/duration/iterations/cost), agent self-report from `final-answer` call.
- **Step 2 — One small LLM call**: structured output requesting `{ summary, keyFindings, errorsEncountered, lessonsLearned, caveats }`. Falls back to agent self-report on JSON parse failure.
- **`synthesizeDebrief(input: DebriefInput): Effect<AgentDebrief, Error, LLMService>`** — exported function.
- **`formatDebriefMarkdown(d)`** — deterministic Markdown renderer; produces `## Summary`, `## Key Findings`, `## Lessons Learned`, `## Tools Used`, `## Metrics` sections.
- **`deriveOutcome()`** — `"success"` when `terminatedBy` is `final_answer_tool|final_answer` and no errors; `"partial"` otherwise.

#### DebriefStore — SQLite Persistence (`@reactive-agents/memory`)

New `agent_debriefs` table alongside episodic/semantic/procedural memory in the existing memory DB:

- **`DebriefStoreService`** — `Context.Tag` with `save()`, `findByTaskId()`, `listByAgent(agentId, limit)` methods.
- **`DebriefStoreLive`** — `Layer.Layer<DebriefStoreService, DatabaseError, MemoryDatabase>`. Uses shared `MemoryDatabase` connection (WAL mode). No separate DB file.
- Schema: `id`, `task_id`, `agent_id`, `created_at`, `task_prompt`, `terminated_by`, `output`, `output_format`, `debrief_json`, `debrief_markdown`, `tokens_used`, `duration_ms`, `iterations`, `outcome`. Indexed on `agent_id`, `task_id`, `created_at`.
- Automatic — enabled whenever `.withMemory()` is configured. No extra builder call needed.

#### Enriched `AgentResult` — New Optional Fields (`@reactive-agents/runtime`, `@reactive-agents/core`)

`AgentResult` gains three backward-compatible optional fields:

- **`result.format?`** — `OutputFormat` (`"text"|"json"|"markdown"|"csv"|"html"`) declared by the agent via `final-answer`.
- **`result.terminatedBy?`** — `TerminatedBy` (`"final_answer_tool"|"final_answer"|"max_iterations"|"end_turn"`) — how the run ended.
- **`result.debrief?`** — full `AgentDebrief` struct (present when memory + reasoning both enabled).
- **`result.metadata.confidence?`** — `"high"|"medium"|"low"` from the `final-answer` tool call.
- **`OutputFormat`** and **`TerminatedBy`** exported as Schema types from `@reactive-agents/core`.
- **`AgentDebrief`** exported from `@reactive-agents/runtime`.

#### `agent.chat()` + `agent.session()` — Conversational Interaction (`@reactive-agents/runtime`)

Two new methods on `ReactiveAgent` for Q&A outside of `run()`:

- **`agent.chat(message, options?): Promise<ChatReply>`** — adaptive routing: heuristic intent classifier routes action-oriented messages through a lightweight ReAct loop; conversational questions go direct to the LLM with debrief context injected.
- **`agent.session(options?): AgentSession`** — multi-turn conversation with auto-managed history. History is forwarded to the LLM on every turn for genuine multi-turn context.
- **`ChatReply`** — `{ message: string, toolsUsed?: string[], fromMemory?: boolean }`.
- **`AgentSession`** — `{ chat(msg): Promise<ChatReply>, history(): ChatMessage[], end(): Promise<void> }`. History cleared on `end()`.
- **Intent routing** — zero-token heuristic: patterns like `search|fetch|find|get|write|create|send|run|execute` route to ReAct; all others go direct LLM.
- **Debrief context injection** — `agent.chat()` automatically injects `lastDebrief.summary` + `keyFindings` as system context so the agent can answer "what did you do last time?" accurately.
- **Agent-level history accumulation** — direct `agent.chat()` calls (outside a session) accumulate in `_chatHistory` so follow-up questions have prior context.
- **`requiresTools(message)`**, **`directChat()`**, **`buildContextSummary()`** exported from `@reactive-agents/runtime` for custom routing implementations.

#### ProgressLogger — Per-Iteration Observability (`@reactive-agents/observability`)

New `ProgressLogger` utility wired into the execution engine's 10-phase loop:

- **`logIteration(n, phase)`**, **`logToolExecution(name, status, duration)`**, **`logCheckpoint(msg)`**, **`logIterationSummary(result)`** — structured per-iteration output at `verbose`/`debug` verbosity levels with graceful fallback.
- Integrated with `ObservabilityService` — no extra builder call required; appears automatically at `verbosity: "verbose"` or higher.
- `TaskResult.metadata` gains an **`iterations`** field (distinct from `stepsCount`) tracked throughout the execution loop and forwarded to debrief metrics.
- `ResultMetadataSchema` updated with optional `iterations` field.

#### Agent Performance Optimizations (`@reactive-agents/reasoning`)

Context and loop optimizations that reduce tokens-per-iteration by 500–700:

- **Context splitting** — static context (system prompt: tool schemas + RULES) built once per run; dynamic context (history, observations) rebuilt per iteration. Eliminates repeated schema tokens from every LLM call.
- **Pure-thought circuit breaker** — fails after 3 consecutive thought steps with no action, preventing reasoning spirals.
- **Single tool list fetch** — consolidates triple `listTools()` calls into one cached fetch per run.
- **Tier-adaptive RULES** — 4 core rules for `local`/`mid` models; full rule set for `large`/`frontier` models.
- **Richer tool result previews** — 3→5 items with smart coverage hints to reduce unnecessary scratchpad-read iterations.
- **LLM-based tool classification** — structured output pipeline for required/relevant tool inference, replacing keyword heuristics.
- **Dynamic completion guard on all exit paths** — `final-answer` tool, `"FINAL ANSWER:"` text, and `end_turn` all pass through `checkCompletionGaps()`.
- **Final-answer error forgiveness** — errors forgiven after iteration 4 to prevent spinning when early tool failures are recoverable.

#### Sub-Agent Performance Improvements (`@reactive-agents/tools`)

- **Delegation-aware completion guard** — `detectCompletionGaps()` recognizes `spawn-agent` delegations and skips namespaces handled by sub-agents, preventing false "incomplete task" loops.
- **Word-boundary namespace matching** — prevents false positives when forwarded text contains namespace keywords incidentally.
- **Auto-scope sub-agent tools** — `filterToolsByRelevance()` applied automatically when no explicit tool whitelist is given, reducing sub-agent context noise.
- **Lower sub-agent iteration cap** — 6→4 max iterations for sub-agents (focused tasks complete in 1–3 steps).
- **`name` parameter required on `spawn-agent`** — descriptive kebab-case guidance enforced. Fallback `deriveSubAgentName()` extracts meaningful words from the task (replaces generic "dynamic-agent").

#### CLI Visual Polish + `rax demo` + `rax playground` REPL (`@reactive-agents/cli`)

- **`rax demo`** — zero-config scripted demo with test provider, paced output, and professional metrics dashboard. Designed for `npx reactive-agents demo` onboarding flow.
- **`rax playground` REPL rewrite** — full rewrite using `agent.session()`. Supports 11 slash commands (`/help`, `/exit`, `/clear`, `/model`, `/provider`, `/tools`, `/stream`, `/verbose`, `/history`, `/reset`, `/debrief`), inline spinners safe for readline, and provider/model switching mid-session.
- **UI overhaul** — chalk/ora/boxen brand colors, `banner()`, `agentResponse()`, `renderDashboard()`, `inlineSpinner()` for readline-safe feedback.
- **`ChatReply` enriched** — `tokens`, `steps`, `cost` fields added from LLM response metadata.
- **`AgentSession.chat()` accepts `ChatOptions`** — `useTools` passthrough for per-message tool control.
- **Meta-package bin wrapper** — `packages/reactive-agents` now exposes a `reactive-agents` binary for `npx reactive-agents` support.
- **Docs** — animated `TerminalReplay` component added to the Starlight docs site; `npx reactive-agents demo` CTA on the landing page.

#### Built-in Tool Hardening (`@reactive-agents/tools`)

- **`web-search`** — throws `ToolExecutionError` on missing `TAVILY_API_KEY` instead of returning empty results. Prevents agents wasting iterations distinguishing "no results" from "search unavailable".
- **`http-get`** — returns only `{ status, statusText, body }`, dropping all response headers (~20–30 per request, 500–1000+ tokens). Description updated to match actual return type.
- **`docker-execution`** — timeout reduced 60s→30s for faster failure detection in agent loops.
- **`file-read`** — exponential backoff retry (3 attempts, 100ms→200ms) with path normalization.

#### Chat Context Forwarding (`@reactive-agents/runtime`)

- `agent.chat()` and `agent.session()` now receive actual tool observations and analysis thoughts from the most recent `agent.run()`, not just the final answer text.
- `reasoningSteps` forwarded from execution context to `TaskResult.metadata`; `buildContextSummary()` captures `[Tool result]` and `[Agent analysis]` steps (capped at 3K chars).
- Tool name normalization — underscore→hyphen for built-in tools (e.g. `final_answer`→`final-answer`) handles small-model naming inconsistencies.

### Changed

- `@reactive-agents/core`: `ResultMetadataSchema.confidence` changed from `Schema.Number.pipe(Schema.between(0, 1))` to `Schema.Literal("high", "medium", "low")`. More readable, consistent with `AgentDebrief.confidence`.
- `@reactive-agents/runtime`: `AgentResult.format` and `AgentResult.terminatedBy` use `OutputFormat` and `TerminatedBy` imported from `@reactive-agents/core` — single source of truth.
- `@reactive-agents/reasoning`: `terminatedBy` union in `react-kernel.ts` extended with `"final_answer_tool"` value.
- `@reactive-agents/tools`: `metaToolDefinitions` array now includes `finalAnswerTool` alongside `contextStatusTool` and `taskCompleteTool`.
- `@reactive-agents/memory`: `agent_debriefs` DDL added to `MemoryDatabase` schema alongside existing tables.

### Stats

- 1,773 tests across 217 files (was 1,735/211 in v0.7.0, +38 new tests)
- 20 packages (unchanged)

---

## [0.7.0] — 2026-03-08

Quality & reliability sprint: required tools guard, circuit breaker, embedding cache, benchmarks, Docker sandbox, adaptive LLM inference, heuristic-first tool selection, sub-agent MCP inheritance, ContextEngine scoring, ExperienceStore, MemoryConsolidatorService, meta-tools, and parallel/chain tool execution.

### Added

#### ContextEngine — Per-Iteration Context Scoring (`@reactive-agents/reasoning`)

Replaces 6 static context builders (`buildInitialContext`, `buildCompactedContext`, `progressiveSummarize`, `buildCompletedSummary`, `buildPinnedToolReference`, `buildIterationAwareness`) with a unified pipeline:

- **`buildContext(input: ContextBuildInput)`** — scores every history item per iteration using recency decay (`e^{-0.3 * iterDiff}`), keyword overlap relevance, type weight (obs 0.8 > action 0.6 > thought 0.4), failure urgency boost (1.5×), and pin score (1.0). Tool schemas always pinned; memory relevance threshold 0.3. Model-profile-adaptive full-detail step count.
- **`scoreContextItem(item, context)`** — exported scoring primitive; useful for testing and external context assembly.
- **`allocateContextBudget(profile, total)`** — exported budget-allocation primitive; returns per-section token budgets.

#### ExperienceStore — Cross-Agent Learning (`@reactive-agents/memory`)

SQLite-backed cross-run intelligence for tool pattern reuse and error recovery:

- **`ExperienceStore.record(entry)`** — upserts `(taskType, patternKey)` row accumulating count, success rate, avg steps/tokens; upserts error recovery hints keyed by `(tool, errorPattern)`.
- **`ExperienceStore.query(taskDescription, taskType, modelTier)`** — returns tool patterns (filtered to ≥50% confidence AND ≥2 occurrences) and error recovery hints; generates human-readable `tips[]` array injected at agent bootstrap.
- **`.withExperienceLearning()`** builder method — enables `ExperienceStoreLive` in the runtime; execution engine injects tips at bootstrap and records outcomes after each run.

#### MemoryConsolidatorService — Background Memory Intelligence (`@reactive-agents/memory`)

Background decay/replay/compress cycle for episodic entries:

- **`MemoryConsolidatorService.consolidate(agentId)`** — COMPRESS: decays all episodic `importance` × 0.95, prunes entries below 0.1. REPLAY: counts recent episodic entries added since last consolidation run. Persists state to `consolidation_state` SQLite table.
- **`MemoryConsolidatorService.notifyEntry()`** — increments pending counter; returns `true` when threshold (default 10) reached to signal consolidation is due.
- **`MemoryConsolidatorServiceLive(config?)`** — factory `Layer`; accepts `{ threshold?, decayFactor?, pruneThreshold? }`.
- **`.withMemoryConsolidation(config?)`** builder method — enables `MemoryConsolidatorServiceLive` in the runtime.

#### Meta-Tools — Agent Self-Awareness (`@reactive-agents/tools`)

Two new kernel-level meta-tools for agent introspection and guarded completion:

- **`context-status`** — zero-parameter tool that reports `iteration`, `maxIterations`, `remaining`, `toolsUsed`, `toolsPending`, `storedKeys`, `tokensUsed`. Always visible; helps agents orient when lost.
- **`task-complete`** — single-parameter (`summary`) tool for explicit task signalling. Visibility-gated: only shown when all 4 conditions hold: (1) all required tools called, (2) iteration ≥ 2, (3) no pending errors, (4) at least one non-meta tool invoked.
- **`makeContextStatusHandler(state)`** and **`makeTaskCompleteHandler(state)`** — factory functions for dynamic state wiring at kernel level.
- **`shouldShowTaskComplete(input)`** — pure visibility predicate; exported for testing and custom kernels.
- **`metaToolDefinitions`** array — exported for schema inspection without live state wiring.

#### Parallel & Chain Tool Execution (`@reactive-agents/reasoning`)

Agents can now issue multiple tool calls from a single thought:

- **Parallel** — multiple `ACTION:` lines in a single thought → `Effect.all(..., { concurrency: "unbounded" })` → combined numbered observation. Capped at 3 to prevent runaway fan-out. Side-effect prefixes (`send_`, `create_`, `delete_`, etc.) force single mode.
- **Chain** — `ACTION:` followed by `THEN:` → sequential execution with `$RESULT` placeholder forwarding between steps. Fails fast on any step error. Capped at 3.
- **`parseToolRequestGroup(thought)`** — exported primitive returning `ToolRequestGroup { mode: "single"|"parallel"|"chain", requests }`.
- **`executeToolGroup(toolService, group, config)`** — dispatches the group; single delegates to existing `executeToolCall`.

#### Sub-Agent Fixes (`@reactive-agents/tools`)

- **`ALWAYS_INCLUDE_TOOLS`** — constant `["scratchpad-read", "scratchpad-write"]` auto-merged into every sub-agent's tool list so sub-agents always have scratchpad access regardless of parent config.
- **Iteration cap** — `effectiveMaxIter = Math.min(config.maxIterations ?? 6, 6)` prevents runaway sub-agents.
- **Scratchpad key forwarding** — `SubAgentResult.forwardedScratchpadKeys` lists keys written with `sub:<agentName>:<key>` prefix; parent agent can read forwarded context.

#### Required Tools Guard + Adaptive LLM Inference (`@reactive-agents/runtime`)

Guarantees that the agent must call specific tools before it can complete a task:

- **`.withRequiredTools({ tools: string[], adaptive?: boolean })`** — lists tools the agent must invoke before `final-answer` or `task-complete` become visible. Prevents premature task signalling.
- **Adaptive inference** — when `adaptive: true`, the runtime uses heuristic keyword matching to automatically select required tools from the available set without an extra LLM call. Falls back to a single LLM selection call only when heuristics are inconclusive.
- **Sub-agent inheritance** — required tools config propagates to statically-defined sub-agents so constraints are preserved across delegation boundaries.
- **Smart MCP tool inheritance** — sub-agents now proxy their parent's MCP tools automatically. No need to re-declare `withMCP()` on each sub-agent config.

#### Quality & Resilience Batch (`@reactive-agents/runtime`, `@reactive-agents/llm-provider`)

Production-readiness improvements:

- **Circuit breaker** — `CircuitBreakerService` wraps LLM calls with configurable failure threshold, timeout, and half-open probe. Prevents cascading failures on provider outages.
- **Embedding cache** — LRU cache for embedding vectors; repeated semantic queries skip the embedding API call entirely. Configurable size and TTL.
- **Budget persistence** — daily token budget state survives process restarts via SQLite. Agents won't exceed their configured budgets across restarts.
- **Telemetry** — structured telemetry events emitted to EventBus for external monitoring integrations.
- **Docker sandbox** — code execution tool now runs in an isolated Docker container with `--cap-drop ALL --security-opt no-new-privileges --memory 512m`. Falls back to subprocess sandbox when Docker is unavailable.
- **JSON repair** — malformed LLM JSON outputs (missing quotes, trailing commas, truncated objects) are automatically repaired before parse rather than failing.
- **Tool result caching** — deterministic tool calls (read-only, same inputs) can be cached per session to avoid redundant API calls.

#### Benchmarks Package (`@reactive-agents/benchmarks`)

New package for measuring framework overhead and reasoning quality:

- **20 benchmark tasks** across 5 complexity tiers (trivial → expert).
- **`rax bench`** CLI command — runs the full suite and renders a results table.
- **Overhead measurement** — isolates framework time from LLM time; tracks tokens, duration, iterations per task.
- **`BenchmarkResults` Astro component** — renders live benchmark data in the docs site.

#### ReAct Quality Improvements (`@reactive-agents/reasoning`)

Eight targeted fixes to improve local-model reliability:

- **Token budget increases** — local tier 800 → 1,200 tokens, mid tier 1,500 → 2,000 tokens. Prevents context truncation on longer tasks.
- **Model tier reclassification** — capable local models (7B+, e.g., qwen3:14b, cogito) now classified as `mid` tier, enabling better prompt templates and higher budgets.
- **Heuristic-first tool selection** — keyword match attempted before any LLM call for adaptive tool inference; LLM only invoked when heuristics are inconclusive. Reduces overhead ~40% on tool selection.
- **Stop sequence hardening** — `\nObservation:` (newline-prefixed) prevents mid-sentence cuts from false stop sequence matches.
- **Anti-fabrication rule** — RULES section tightened: explicit "never fabricate tool results" instruction added alongside scratchpad guidance.
- **Secondary tool collapsing** — tool sets >15 have secondary tools collapsed to names-only in context. Prevents token budget overflow on large MCP server collections.
- **Side-effect duplicate guard** — side-effect tools (`send_`, `create_`, `delete_`, etc.) blocked from re-execution when already in completed steps.
- **Delegation keyword matching** — improved sub-task routing in multi-agent flows.

#### Context Engine Fixes (`@reactive-agents/reasoning`)

- **Full tool schemas at context top** — all tool definitions (name + parameters) now included at the top of every context window, not just the compact summary. Fixes MCP tool call failures where agents couldn't see required parameter shapes.
- **Namespaced tool filtering** — `filterToolsByRelevance` no longer false-positives on namespace names (e.g., all 40+ `github/*` tools no longer shown as primary when the task merely mentions "GitHub"). Only matches on distinctive local slug parts.

### Changed

- `@reactive-agents/reasoning`: `react-kernel.ts` net −200 lines — 6 static context helpers replaced by single `buildContext()` call.
- `@reactive-agents/memory`: new `services/` sub-directory with `ExperienceStoreLive` and `MemoryConsolidatorServiceLive` exported from `src/index.ts`.
- `@reactive-agents/tools`: `src/index.ts` now exports `ALWAYS_INCLUDE_TOOLS`, `contextStatusTool`, `makeContextStatusHandler`, `ContextStatusState`, `taskCompleteTool`, `shouldShowTaskComplete`, `makeTaskCompleteHandler`, `TaskCompleteVisibility`, `TaskCompleteState`.
- `@reactive-agents/reasoning`: `src/index.ts` now exports `buildContext`, `ContextBuildInput`, `ContextItem`, `MemoryItem`, `ScoringContext`, `BudgetResult`.

### Stats

- 1,735 tests across 211 files (was 1,588/190 in v0.6.3, +147 new tests)
- 20 packages + 1 new (`@reactive-agents/benchmarks`)

---

## [0.6.4] — 2026-03-08 (pre-release)

### Added

#### Required Tools Guard & Adaptive Inference (`@reactive-agents/runtime`, `@reactive-agents/reasoning`)

Ensure agents use critical tools before producing a final answer — with optional LLM-powered inference for dynamic tool detection:

- **`.withRequiredTools(config)`** — unified config API: `{ tools?: string[], adaptive?: boolean, maxRetries?: number }`
  - `tools: ["web-search"]` — static tool list; agent must call these before answering
  - `adaptive: true` — LLM analyzes the task and available tools to infer which are required (no static list needed)
  - `maxRetries: 2` — number of retry loops if required tools are missed (default: 2)
- **`inferRequiredTools()`** — structured-output LLM call that analyzes task + available tool schemas to determine required tools, with hallucination guard filtering against actual tool names
- **Required tools threaded through all 5 strategies** — `requiredTools` and `maxRequiredToolRetries` added to `ReactiveInput`, `PlanExecuteInput`, `ReflexionInput`, `TreeOfThoughtInput`, `AdaptiveInput` and forwarded to kernel calls
- **`KernelRunner` enforcement** — after kernel produces a final answer, runner checks if all required tools were called; if not, injects a nudge message and re-enters the kernel loop (up to `maxRetries` times)
- **6 new tests** for `inferRequiredTools` covering empty tools, inferred names, hallucination filtering, malformed JSON, and system prompt threading

#### Circuit Breaker (`@reactive-agents/llm-provider`)

- **`CircuitBreaker`** — protects LLM calls with configurable failure thresholds and recovery timeouts. States: `CLOSED` → `OPEN` → `HALF_OPEN`. Prevents cascading failures during provider outages
- **`CircuitBreakerConfig`** — `{ failureThreshold, resetTimeoutMs, halfOpenRequests }`
- **4 new tests** covering state transitions, timeout recovery, and success reset

#### Embedding Cache (`@reactive-agents/llm-provider`)

- **`EmbeddingCache`** — LRU + TTL cache for embedding vectors. Avoids redundant embedding API calls for repeated text
- **`EmbeddingCacheConfig`** — `{ maxSize, ttlMs }`
- **4 new tests** covering cache hits/misses, TTL expiry, and eviction

#### Token Counter Improvements (`@reactive-agents/llm-provider`)

- **Model-specific token estimation** — refined token counting for Anthropic, OpenAI, and Gemini models using calibrated chars-per-token ratios
- **3 new tests** for provider-specific counting accuracy

#### Budget Persistence (`@reactive-agents/cost`)

- **`BudgetDB`** — SQLite-backed persistence for budget state across agent restarts. Records per-session and daily spend with automatic recovery
- **Enhanced `BudgetEnforcer`** — integrates with `BudgetDB` for durable spend tracking. Supports warm-start from persisted state
- **4 new tests** for persistence, recovery, and cross-session continuity

#### Enhanced Complexity Router (`@reactive-agents/cost`)

- **27 complexity signals** — expanded heuristic classifier covers code blocks, math expressions, multi-part questions, constraint satisfaction, creative tasks, and domain-specific indicators
- **3 new tests** for edge-case classification accuracy

#### Memory Extractor Improvements (`@reactive-agents/memory`)

- **Structured extraction pipeline** — extracts facts, decisions, preferences, and action items from conversation turns with confidence scoring
- **Priority-based consolidation** — higher-confidence extractions override lower-confidence duplicates
- **8 new tests** covering extraction categories, confidence scoring, and deduplication

#### Hybrid Search (`@reactive-agents/memory`)

- **FTS5 + semantic score fusion** — search results now combine keyword (FTS5) and vector (semantic) scores with configurable weighting
- **Reciprocal Rank Fusion (RRF)** — merges ranked lists from both search backends into a single relevance-sorted result
- **4 new tests** for hybrid scoring and rank fusion

#### Telemetry System (`@reactive-agents/observability`)

- **`TelemetryCollector`** — collects anonymized usage telemetry with configurable opt-in/opt-out and batched upload
- **`LocalAggregator`** — aggregates telemetry events locally before transmission, computing percentiles, histograms, and counters
- **`PrivacyPreserver`** — strips PII and sensitive data from telemetry payloads using pattern-based redaction and differential privacy noise injection
- **`TelemetrySchema`** — typed telemetry event schemas covering LLM calls, tool usage, strategy selection, and cost tracking
- **12 new tests** across telemetry collection, aggregation, privacy, and schema validation

#### OTLP Exporter (`@reactive-agents/observability`)

- **`OTLPExporter`** — exports traces and metrics to any OpenTelemetry-compatible backend (Jaeger, Grafana, Datadog, etc.) via OTLP/HTTP
- **Enhanced `MetricsCollector`** — extended with histogram buckets, counter resets, and per-phase P50/P95 latency tracking

#### Enhanced Tracer (`@reactive-agents/observability`)

- **Span attributes** — traces now carry model name, provider, token counts, and cost as structured span attributes
- **Parent-child span correlation** — proper parent span propagation through reasoning and tool execution

#### Docker Sandbox (`@reactive-agents/tools`)

- **`DockerSandbox`** — execute code in isolated Docker containers with resource limits (CPU, memory, timeout), network isolation, and volume mounts
- **`DockerSandboxConfig`** — `{ image, memoryMb, cpuShares, timeoutMs, networkMode }`
- **Docker execution skill** — `docker-execution.ts` tool handler for containerized code execution
- **5 new tests** covering container lifecycle, resource limits, and error handling

#### Tool Result Cache (`@reactive-agents/tools`)

- **`ToolResultCache`** — LRU + TTL cache for tool execution results. Avoids redundant tool calls for identical inputs within a session
- **`ToolResultCacheConfig`** — `{ maxSize, ttlMs, hashStrategy }`
- **Wired into `ToolService`** — cache lookups happen transparently before tool execution
- **6 new tests** covering hit/miss, TTL, eviction, and hash strategies

#### JSON Repair (`@reactive-agents/reasoning`)

- **`repairJson()`** enhanced — handles unbalanced braces/brackets, trailing commas inside nested structures, unquoted keys at any depth, and truncated JSON from interrupted LLM responses
- **Structured output pipeline hardened** — retry loop now passes parse error context back to LLM for self-correction
- **4 new tests** for deep nesting repair, truncation recovery, and edge cases

#### Plan Wave Execution (`@reactive-agents/reasoning`)

- **Parallel wave execution** — plan steps with no inter-dependencies execute concurrently in waves, with dependency ordering automatically resolved
- **5 new tests** for wave detection, ordering, and parallel execution semantics

#### Enhanced Context Utilities (`@reactive-agents/reasoning`)

- **Improved token estimation** — context budget allocation now accounts for tool schema verbosity and system prompt length
- **Step history compaction** — smarter progressive compaction preserves error steps and high-value observations

#### Enhanced Tool Execution (`@reactive-agents/reasoning`)

- **Retry with backoff** — tool execution failures trigger configurable retry with exponential backoff before marking as error
- **Timeout enforcement** — per-tool timeout limits prevent runaway tool calls from blocking the reasoning loop

#### Benchmark Suite (`@reactive-agents/benchmarks`) — New Package

- **20 benchmark tasks** across 5 complexity tiers (trivial, simple, moderate, complex, expert)
- **`runBenchmarks(options)`** — runs tasks with configurable provider, model, tier filter, and concurrency
- **Framework overhead measurement** — measures runtime creation, full-feature runtime creation, and complexity classification latency
- **CLI entry point** — `bun run src/run.ts [--provider test] [--tier simple,moderate] [--output report.json]`
- **6 new tests** for task definitions, tier filtering, and ID uniqueness

#### Builder API Extensions (`@reactive-agents/runtime`)

- **Runtime type exports** — `RequiredToolsConfig`, `RequiredToolsSchema` exported from runtime index
- **Builder validation tests** — 4 new tests for `withRequiredTools()` configuration patterns

#### CLI Enhancements (`apps/cli`)

- `apps/cli/tests/cli-contracts.test.ts` — provider CLI contract tests for local Docker, Fly, Railway, Render, Cloud Run (`gcloud`), and DigitalOcean (`doctl`) command/flag compatibility; includes version baselines and optional slow container-image availability checks (`RUN_SLOW_TESTS=1`)
- `rax playground` now launches a real interactive REPL session (single agent instance, `/help` + `/exit`, optional `--stream`) via `apps/cli/src/commands/playground.ts`
- `rax inspect` now performs concrete local diagnostics (Docker/Compose checks, compose status, recent log matching by agent ID, optional `--json`) via `apps/cli/src/commands/inspect.ts`
- `apps/meta-agent` now runs dedicated competitor intelligence crons every 12 hours with staggered tracks: TypeScript-first sweep (`0 */12 * * *`) and Python-first sweep (`30 */12 * * *`)
- `apps/meta-agent` now runs an hourly competitive scorecard cron (`0 * * * *`) that drafts evidence-backed summaries of where reactive-agents is excelling vs behind competition

### Changed

- `@reactive-agents/llm-provider`: Anthropic, OpenAI, Gemini, and Ollama providers now include circuit breaker protection and embedding cache integration
- `@reactive-agents/cost`: Complexity router expanded from 12 to 27 complexity signals for more accurate model tier selection
- `@reactive-agents/memory`: Semantic memory search now uses hybrid FTS5 + vector scoring with reciprocal rank fusion
- `@reactive-agents/observability`: `MetricsCollector` extended with histogram buckets, P50/P95 latency, and OTLP export support
- `@reactive-agents/reasoning`: Structured output pipeline enhanced with improved JSON repair and LLM-guided self-correction
- `@reactive-agents/tools`: `ToolService` now transparently caches tool results via `ToolResultCache`
- `@reactive-agents/verification`: `fact-decomposition` and `semantic-entropy` layers use refined confidence thresholds
- `rax deploy` now uses provider adapter dispatch end-to-end with structured `--dry-run` preflight output and target auto-detection
- `rax run --stream` is now fully implemented using `agent.runStream()` token output path
- `rax dev` now runs a real Bun watch workflow with entrypoint overrides (`--entry`, `--no-watch`)
- `rax serve` input validation tightened (provider validation, memory tier parsing)

### Fixed

- **Duplicate prompt-trace events in reasoning loop** — `react-kernel.ts` emitted a `[prompt-trace]` thought event before every LLM call, causing doubled step counts in all 5 strategies. Removed the redundant event
- **Metrics dashboard now correctly shows failed tool calls** — `ToolCallCompleted` events were always published with `success: true`; updated `KernelHooks.onObservation` to propagate actual success status from `ObservationResult`
- Removed dead code in deploy dispatcher (`listProviders` unused import and unused parse-options parameter)

### Stats

- 1,588 tests across 190 files (was 1,381/180 in v0.6.0, +207 new tests)
- 21 packages (was 20; added `@reactive-agents/benchmarks`)

---

## [0.6.3] - 2026-03-05

Patch release — gateway and streaming examples, `AgentStream` API fix, and public re-exports.

### Added

- `apps/examples/src/gateway/22-persistent-gateway.ts` — runnable gateway example: `.withGateway()`, heartbeat, crons, policies, `agent.start()` / `handle.stop()`, `GatewaySummary`; works in test mode without an API key
- `apps/examples/src/streaming/23-token-streaming.ts` — demonstrates `runStream()` in both `"tokens"` and `"full"` density modes
- `apps/examples/src/streaming/24-streaming-sse-server.ts` — `AgentStream.toSSE()` SSE endpoint via `Bun.serve`; validates headers in test mode, starts a real HTTP server with an API key

### Fixed

- `AgentStream.toSSE()`, `toReadableStream()`, and `collect()` now accept `AsyncIterable<AgentStreamEvent>` (the return type of `agent.runStream()`) in addition to Effect `Stream` — the documented `AgentStream.toSSE(agent.runStream(...))` pattern now compiles and works correctly
- All 20 existing examples updated to import from `"reactive-agents"` instead of `"@reactive-agents/runtime"` — copy-pasted code now works out of the box
- `AgentStream`, `AgentStreamEvent`, and `StreamDensity` exported from the `reactive-agents` umbrella package

### Changed

- Clarified Effect install instructions: `effect` ships as a dependency of `reactive-agents`; only add it explicitly when importing from `effect` directly

---

## [0.6.2] - 2026-03-05

Patch release — fixes 0.x semver dependency resolution. `workspace:^` resolves to `^0.5.5` which in 0.x semver means `>=0.5.5 <0.6.0`, excluding `0.6.x`. Changed all `workspace:^` to `workspace:*` so published packages use exact version pins (e.g., `0.6.2`) which any higher version satisfies.

### Fixed

- All `workspace:^` changed to `workspace:*` across 7 package.json files
- `bun add reactive-agents` and `bun add @reactive-agents/runtime` now correctly resolve to 0.6.2 sub-packages

---

## [0.6.1] - 2026-03-05

Patch release — fixes npm dependency resolution. v0.6.0 was published with stale `workspace:^` resolutions pointing to `^0.5.5` instead of `^0.6.0`. Also adds `@reactive-agents/gateway` and `@reactive-agents/testing` to the publish workflow (were missing from the PACKAGES list).

### Fixed

- All cross-package dependencies now resolve to `^0.6.1` (was `^0.5.5` in 0.6.0)
- `@reactive-agents/gateway` added to npm publish workflow
- `@reactive-agents/testing` added to npm publish workflow

---

## [0.6.0] - 2026-03-04

Agent Streaming, Gateway persistent agent harness, Composable Kernel Architecture, Structured Plan Engine, Strategy SDK Refactor, Foundation Fixes, documentation pass with 13 agent skills. 20 packages bumped to 0.6.0, 1,381 tests across 180 files.

### Added

#### Agent Streaming (`@reactive-agents/runtime` + `@reactive-agents/core`)

Token-by-token output streaming via `runStream()` AsyncGenerator with FiberRef-based TextDelta propagation:

- **`stream-types.ts`** — `AgentStreamEvent` 8-variant discriminated union, `StreamDensity` type (`"tokens"` | `"full"`)
- **`agent-stream.ts`** — `AgentStream` adapter namespace: `toSSE()` (Response with auto-close), `toReadableStream()`, `toAsyncIterable()`, `collect()` (stream → AgentResult)
- **`StreamingTextCallback` FiberRef** — Fiber-local callback set via `Effect.locally` in `executeStream()`, read by react-kernel during LLM streaming
- **`executeStream()` on ExecutionEngine** — Queue + forkDaemon architecture: unbounded queue bridges execution fiber to consumer, `Stream.unfoldEffect` yields events
- **`.withStreaming()` builder method** — Sets default density; per-call override via `runStream(input, { density })`
- **`AgentStreamStarted` / `AgentStreamCompleted`** EventBus events with density, taskId, agentId, durationMs

#### Documentation & Skills Discovery

- **Streaming docs page** — `apps/docs/src/content/docs/features/streaming.md` covering events, density modes, adapters, architecture
- **13 agent skills** — Discoverable at `/.well-known/skills/` via Astro integration: streaming, gateway, a2a, reasoning, memory, observability, orchestration, context-engineering, cost, identity, mcp, verification, framework overview
- **Skills loader** — `apps/docs/src/content/skills-loader.ts` + Astro config integration for auto-discovery
- **New guides** — choosing-a-stack, security-hardening, troubleshooting, agent-skills

#### Composable Kernel Architecture (`@reactive-agents/reasoning`)

Three-layer separation: ThoughtKernel (single-step algorithm) → KernelRunner (universal loop) → Strategy (policy wrapper).

- **`kernel-state.ts`** — `KernelState` immutable state, `ThoughtKernel` contract, `KernelContext`, serialization helpers for collective learning/replay
- **`tool-execution.ts`** — Shared `executeToolCall()`, `makeObservationResult()`, `truncateForDisplay()` — replaces ~260 lines of duplication across reactive.ts and react-kernel.ts
- **`kernel-hooks.ts`** — `buildKernelHooks()` wires `onThought/onAction/onObservation/onDone/onError` to EventBus. Single source of truth for `ToolCallCompleted` events
- **`kernel-runner.ts`** — `runKernel()` universal execution loop with embedded tool call guard (catches bare tool calls in FINAL ANSWER text)
- **`reactKernel: ThoughtKernel`** — ReAct algorithm as first kernel implementation. Single-step state transition dispatching on "thinking"/"acting" status
- **Custom kernel registration** — `StrategyRegistry.registerKernel()/getKernel()/listKernels()` for swappable reasoning algorithms

### Fixed

- **Output containing raw tool call text** — Embedded tool call guard in KernelRunner detects `tool_name({...})` in output and executes the tool instead of returning raw text
- **Double tool metrics** — Removed duplicate `obs.recordHistogram` in execution-engine.ts reasoning path. KernelHooks.onObservation is now the single source of `ToolCallCompleted`

### Changed

- `reactive.ts` collapsed from ~905 lines to ~128 lines (delegates to `runKernel(reactKernel, ...)`)
- `reflexion.ts` generate/improve passes use `runKernel()` directly instead of `executeReActKernel()` wrapper
- `tree-of-thought.ts` Phase 2 execution uses `runKernel()` directly
- `react-kernel.ts` rewritten as `ThoughtKernel` with backwards-compatible `executeReActKernel()` wrapper

---

### Structured Plan Engine (`@reactive-agents/reasoning` + `@reactive-agents/memory`)

Complete rewrite of the plan-execute-reflect strategy with structured JSON plans, replacing fragile text-parsed numbered lists:

- **`packages/reasoning/src/types/plan.ts`** — `Plan`, `PlanStep`, `LLMPlanOutput` type-safe schemas. `hydratePlan()` generates deterministic short IDs (`s1`, `s2`). `resolveStepReferences()` for `{{from_step:sN}}` interpolation.
- **`packages/reasoning/src/structured-output/`** — Reusable 4-layer structured output pipeline: high-signal prompting → JSON repair → Schema validation → retry with error feedback. `extractJsonBlock()` and `repairJson()` handle markdown fences, trailing commas, single quotes, truncated JSON.
- **`packages/llm-provider`** — `StructuredOutputCapabilities` interface. Each provider reports JSON mode, schema enforcement, prefill, and grammar support.
- **`packages/memory`** — `plans` + `plan_steps` SQLite tables. `PlanStoreService` for persistent plan CRUD.
- **`packages/reasoning/src/strategies/plan-execute.ts`** — Rewritten with structured JSON plans, hybrid step execution (tool_call direct dispatch, analysis/composite scoped kernel), graduated retry → patch → replan, plan persistence.
- **`packages/reasoning/src/strategies/shared/plan-prompts.ts`** — Tier-adaptive prompt builders: plan generation, patch, step execution, reflection.
- **`PlanExecuteConfig`** — Extended with `planMode` ("linear" | "dag"), `stepRetries`, `patchStrategy`.

### Fixed

#### Plan Persistence & Error Handling (`@reactive-agents/reasoning` + `@reactive-agents/memory`)

- **`PlanStoreServiceLive` wired into memory layer** — Was missing from `createMemoryLayer()` in `packages/memory/src/runtime.ts`, so `Effect.serviceOption` always returned `None` and plans were never persisted despite the tables existing
- **Step status updates use correct ID** — `updateStepStatus()` was called with composite `${planId}_${stepId}` but DB primary key is just `stepId`
- **Effect error handling** — Replaced broken `try/catch` (doesn't catch Effect typed errors in generators) with `Effect.exit()` + `Exit.isSuccess()` + `Cause.squash()` pattern for reliable retry loop
- **Goal stored as plain text** — `extractGoalText()` unwraps JSON-wrapped `{"question":"..."}` from execution engine's `JSON.stringify(task.input)`
- **"FINAL ANSWER:" stripped from step outputs** — `stripFinalAnswerPrefix()` prevents ReAct protocol artifacts from leaking into tool args via `{{from_step:sN}}` references
- **Analysis steps use direct `llm.complete()`** — Removed unnecessary ReAct kernel overhead for pure reasoning steps (no tools needed)
- **Tool signatures show required vs optional** — `name` vs `name?` in plan generation prompt helps LLM include all required parameters
- **Planning rules enforce efficiency** — Min steps, prefer tool_call, max ONE analysis step, combine related work

#### Duplicate Step Prevention (`@reactive-agents/reasoning`)

- **All-steps-completed guard** — If every plan step completed successfully, treat as satisfied regardless of LLM reflection text. Prevents false-negative refinement loops that re-execute side-effecting actions (e.g., sending duplicate messages)
- **Carry-forward refinement** — Plan generation moved outside refinement loop. Completed steps preserved across cycles — only failed/pending steps get patched and re-executed via `buildPatchPrompt`
- **`isSatisfied()` case-insensitive** — Now matches `"Satisfied:"`, `"Status: Satisfied"`, etc. Reflection prompt restructured to force `SATISFIED:` or `UNSATISFIED:` as first word
- **Granular observability** — Step start, retry, failure, patch, skip, reflection events all published via EventBus for full plan execution visibility

#### Tool Metrics & Prompt Quality (`@reactive-agents/reasoning`)

- **ToolCallCompleted events from plan-execute** — Direct tool dispatch now publishes `ToolCallCompleted` to EventBus so MetricsCollector tracks tool calls in the dashboard (was missing because plan-execute bypasses the execution engine's act phase)
- **`{{from_step:sN}}` self-reference guard** — Runtime check fails the step if unresolved references remain in toolArgs (prevents literal `{{from_step:s3}}` being sent as message content)
- **Plan generation self-reference prevention** — Prompt now explicitly states steps can ONLY reference EARLIER steps (s3 can reference s1/s2, not s3)
- **Analysis step directive prompt** — System prompt changed to "Produce the requested content directly. Never ask questions or offer to do something" to prevent conversational output like "Would you like me to send this?"
- **Step execution structured RULES** — Added explicit rules: no labels/prefixes, no follow-up questions, output is passed directly to next step

#### Output Sanitization (`@reactive-agents/reasoning` + `@reactive-agents/runtime`)

Cross-cutting output sanitization prevents internal agent metadata from reaching users across all 5 reasoning strategies:

- **`sanitizeAgentOutput()`** in `quality-utils.ts` — Strips `FINAL ANSWER:` prefix, `<think>` tags, `[STEP/EXEC/SYNTHESIS/REFLECT]` markers, ReAct protocol prefixes (`Thought:`/`Action:`/`Observation:`), tool call echo lines (`tool/name: {json}`), raw JSON with internal keys (`recipient`, `toolName`)
- **`sanitizeToolOutput()`** in `plan-execute.ts` — Action tools (send/write/post/create) that echo back request payloads get sanitized to clean confirmations; data-fetching tools keep full output
- **Wired into all exit points**: `buildStrategyResult()` (reflexion, plan-execute, ToT, adaptive), `buildResult()` (reactive), execution engine `TaskResult` assembly (safety net)
- **Synthesis prompt hardened** — Explicitly instructs LLM to exclude tool names, JSON payloads, recipient numbers, and execution metadata from final answer
- **17 new tests** covering sanitization patterns, integration with `buildStrategyResult`, and edge cases

#### Strategy Type Threading (`@reactive-agents/reasoning`)

Full type-safe parameter threading from execution engine through all 5 reasoning strategies:

- **`StrategyFn` type extended** — `resultCompression`, `contextProfile`, `taskId`, `agentId`, `sessionId` now explicitly typed (was silently accepted via structural typing)
- **`resultCompression` wired** — All 3 kernel-backed strategies (Reflexion, Plan-Execute, ToT) forward compression config to `executeReActKernel()`
- **`kernelMaxIterations` config** — Reflexion: `config.strategies.reflexion.kernelMaxIterations` (default 3); Plan-Execute: `config.strategies.planExecute.stepKernelMaxIterations` (default 2)
- **Real `agentId`/`sessionId`** — Replaces hard-coded `"reasoning-agent"`/`"reasoning-session"` in react-kernel.ts and reactive.ts; execution engine passes `config.agentId` and `taskId`

#### Reflexion Cross-Run Learning (`@reactive-agents/reasoning` + `@reactive-agents/runtime`)

- **`priorCritiques`** — New optional field on `ReflexionInput`; seeds the critique loop from prior episodic memory
- **Critique persistence** — After reflexion completes, critiques stored to episodic memory tagged `["reflexion", "critique", taskType]`

#### Hallucination Detection Layer (`@reactive-agents/verification`)

New verification layer for catching fabricated claims:

- **`extractClaims(text)`** — Heuristic sentence-level claim extraction with confidence classification (certain/likely/uncertain)
- **`checkHallucination(response, source, threshold?)`** — Keyword overlap verification, passes if rate ≤ 10%
- **`checkHallucinationLLM(response, source, llm, threshold?)`** — LLM-based claim extraction + verification, falls back to heuristic
- **Verification pipeline integration** — Wired as optional layer via `enableHallucinationDetection` config flag

#### `@reactive-agents/testing` — New Package

Reusable test infrastructure for agent testing:

- **`createMockLLM(rules)`** — Ordered rule matching with call tracking
- **`createMockLLMFromMap(responses)`** — Simple key→response mapping
- **`createMockToolService(toolResults)`** — Records calls, returns configured results
- **`createMockEventBus()`** — Captures published events for assertion
- **`assertToolCalled()`**, **`assertStepCount()`**, **`assertCostUnder()`** — Test assertion helpers

### Changed

- `@reactive-agents/reasoning`: All strategy input types (`ReactiveInput`, `ReflexionInput`, `PlanExecuteInput`, `TreeOfThoughtInput`, `AdaptiveInput`) now include `agentId?`, `sessionId?`, `resultCompression?`
- `@reactive-agents/reasoning`: `ReasoningService.execute` params extended with `taskId`, `resultCompression`, `agentId`, `sessionId`
- `@reactive-agents/verification`: `VerificationConfigSchema` extended with `enableHallucinationDetection`, `hallucinationThreshold`

#### Shared Reasoning Kernel (`@reactive-agents/reasoning`)

Extracted a shared execution primitive and utility library from the 5 reasoning strategy files:

- **`shared/react-kernel.ts`** — `executeReActKernel()` — the ReAct Think→Act→Observe loop extracted from `reactive.ts` and parameterized for reuse by all strategies. Accepts `priorContext`, `availableToolSchemas`, `maxIterations`, `contextProfile`, `resultCompression`, `taskId`, `parentStrategy`.
- **`shared/tool-utils.ts`** — `parseToolRequest`, `parseAllToolRequests`, `hasFinalAnswer`, `extractFinalAnswer`, `evaluateTransform`, `formatToolSchemas`, `compressToolResult` (consolidated from reactive.ts + kernel copy)
- **`shared/quality-utils.ts`** — `isSatisfied`, `isCritiqueStagnant`, `parseScore`
- **`shared/context-utils.ts`** — `buildCompactedContext`, `formatStepForContext`
- **`shared/service-utils.ts`** — `resolveStrategyServices`, `compilePromptOrFallback`, `publishReasoningStep`
- **`shared/step-utils.ts`** — `makeStep`, `buildStrategyResult`
- **`shared/index.ts`** — barrel export for entire shared layer

#### Tool Awareness for All Strategies

All 5 strategies are now tool-aware:

- **Reflexion** — generation and improvement passes call `executeReActKernel`; critique pass stays pure LLM
- **Plan-Execute** — each plan step runs through the kernel (`maxIterations: 2` per step)
- **Tree-of-Thought** — Phase 2 execution (best-path follow-through) replaced with single kernel call
- **Adaptive** — threads `availableToolSchemas` to all dispatched sub-strategies
- **Reactive** — unchanged algorithm; private duplicates removed, shared imports added

#### New Input Fields

`availableToolSchemas?: readonly ToolSchema[]` added to `ReflexionInput`, `PlanExecuteInput`, `TreeOfThoughtInput`, `AdaptiveInput`.

- `@reactive-agents/reasoning`: `reactive.ts` — removed private duplicates (`hasFinalAnswer`, `extractFinalAnswer`, `parseToolRequest*`, `formatStepForContext`, `buildCompactedContext`, `compilePromptOrFallback`, local `ToolSchema`/`ToolParamSchema`), replaced with shared imports. Re-exports `evaluateTransform` and `parseToolRequestWithTransform` for backwards compat.
- `@reactive-agents/reasoning`: `reflexion.ts`, `plan-execute.ts`, `tree-of-thought.ts` — removed local copies of `isSatisfied`, `isCritiqueStagnant`, `compilePromptOrFallback`, `buildResult`; all `tot*` duplicate parsing functions removed.
- `@reactive-agents/reasoning`: `adaptive.ts` — replaced boilerplate with shared utils.
- `compressToolResult` + `nextToolResultKey` consolidated into `shared/tool-utils.ts` — previously live in `reactive.ts` and duplicated in `react-kernel.ts`.

---

## [0.5.6] — 2026-02-28

### Added

#### Agent Gateway (`@reactive-agents/gateway`) — New Package

Persistent autonomous agent harness that runs agents as long-lived services with deterministic infrastructure:

- **GatewayService** — central orchestrator with policy-driven event processing, stats tracking, and state management
- **PolicyEngine** — composable policy chain (sorted by priority, first non-null decision wins) with 4 built-in policies:
  - **AdaptiveHeartbeat** — skip ticks when agent state unchanged (3 modes: always, adaptive, conservative)
  - **CostBudget** — daily token budget enforcement with critical-priority bypass
  - **RateLimit** — hourly action cap with critical-priority bypass
  - **EventMerging** — deduplicate events sharing the same merge key
- **SchedulerService** — zero-dependency cron parser (5-field standard syntax with steps, ranges, day names), heartbeat/cron event factories
- **WebhookService** — route-based dispatch with signature validation adapters:
  - **GitHub adapter** — HMAC-SHA256 signature validation via `crypto.createHmac` + `timingSafeEqual`
  - **Generic adapter** — configurable signature header/algorithm for arbitrary webhook sources
- **InputRouter** — routes events through policies, publishes `GatewayEventReceived` and `ProactiveActionSuppressed` to EventBus
- **10 new EventBus event types**: `GatewayStarted`, `GatewayStopped`, `GatewayEventReceived`, `ProactiveActionInitiated`, `ProactiveActionCompleted`, `ProactiveActionSuppressed`, `PolicyDecisionMade`, `HeartbeatSkipped`, `EventsMerged`, `BudgetExhausted`
- **Builder integration**: `.withGateway(options?)` on `ReactiveAgentBuilder`, wired through `createRuntime()`
- **Design philosophy**: "Harness vs Horse" — deterministic infrastructure handles event routing without LLM calls; LLM only invoked when intelligence is genuinely needed

### Changed

- `@reactive-agents/core` 0.5.5 → 0.5.6: 10 new gateway event variants in `AgentEvent` union
- `@reactive-agents/runtime` 0.5.5 → 0.5.6: `.withGateway()` builder method, `enableGateway`/`gatewayOptions` in `RuntimeOptions`

### Stats
- 1001 tests across 139 files (was 909/124 in v0.5.5, +92 new tests)
- 18 packages (was 17)

---

## [0.5.5] — 2026-02-27

### Added

#### Full Real-Time EventBus Coverage (`@reactive-agents/core`, `@reactive-agents/runtime`, `@reactive-agents/reasoning`, `@reactive-agents/guardrails`, `@reactive-agents/memory`)

**New event types in `AgentEvent` union:**
- **`AgentStarted`** — emitted before Phase 1 (BOOTSTRAP) with `taskId`, `agentId`, `provider`, `model`, `timestamp`
- **`AgentCompleted`** — emitted in the COMPLETE phase with `totalIterations`, `totalTokens`, `durationMs`
- **`LLMRequestStarted`** — emitted before each `llm.complete()` call in the direct-LLM path; shares `requestId` with the existing `LLMRequestCompleted` for request correlation
- **`FinalAnswerProduced`** — emitted when a reasoning strategy reaches its final answer, with `strategy`, `answer`, `iteration`, `totalTokens`
- **`GuardrailViolationDetected`** — emitted before `GuardrailViolationError` is thrown, with the `violations` array, `score`, and `blocked: true`

**Previously defined but never emitted — now wired:**
- `ExecutionHookFired` — emitted after each lifecycle hook fires (`timing: "before"` | `"after"`)
- `ExecutionCancelled` — emitted before the `ExecutionError` fail when a task is cancelled
- `AgentPaused` / `AgentResumed` — emitted from `KillSwitchService.pause()` and `.resume()`
- `AgentStopped` — emitted when `stop()` is confirmed in `checkLifecycle`
- `MemoryBootstrapped` — emitted from `MemoryServiceLive.bootstrap()` after context is loaded
- `MemoryFlushed` — emitted from `MemoryServiceLive.flush()` after memory.md is written

**taskId correlation bug fixed:**
- All 5 reasoning strategies (`reactive`, `plan-execute`, `tree-of-thought`, `reflexion`, `adaptive`) hardcoded their own name as the `taskId` in `ReasoningStepCompleted` events, making cross-event correlation impossible
- Added `readonly taskId?: string` to all 5 strategy input interfaces
- Execution engine now passes `taskId: ctx.taskId` to `ReasoningService.execute()`
- All emit sites now use `input.taskId ?? "strategyName"` (safe fallback)

#### Professional Metrics Dashboard (`@reactive-agents/observability`, `@reactive-agents/runtime`)

Agents with observability enabled now render a structured execution summary on completion:

- **`MetricsCollector`** — auto-subscribed to EventBus `ToolCallCompleted` events via `MetricsCollectorLive` layer; no manual instrumentation required
- **`formatMetricsDashboard(metrics)`** — renders a 4-section dashboard:
  - **Header card** — overall status, total duration, step count, tokens, estimated cost (~$0.003/1M tokens), model name
  - **Execution timeline** — per-phase duration with percentage of total time; ⚠️ icons for phases ≥10s
  - **Tool execution summary** — grouped by tool name: success count, error count, average duration
  - **Alerts & insights** — smart warnings about bottlenecks, high iteration counts, tool failures (only shown when relevant)
- **`exportMetrics()`** — prints the formatted dashboard to stdout; wired into `ConsoleExporter.flush()`
- **Tool execution tracking** — `ExecutionEngine` records each tool call with name, duration, and success/error status into `MetricsCollector`
- **20 new tests** across metrics collector, dashboard formatter, and wiring

#### Reasoning Strategy Fixes (`@reactive-agents/reasoning`, `@reactive-agents/runtime`)

- **`defaultStrategy` wired end-to-end** — `.withReasoning({ defaultStrategy: "plan-execute" })` now correctly propagates through `RuntimeOptions` → `ReactiveAgentsConfig` → `ReasoningService.execute()` → strategy selection; was previously silently ignored
- **Tree-of-Thought plan-then-execute** — ToT now uses a two-phase approach: BFS planning generates the thought tree, then the best branch is executed via ReAct tool loop; replaces naive single-pass synthesis
- **Adaptive routing connected** — `adaptive.enabled` flag now gates delegation to sub-strategies; previously the flag existed in config but was never checked
- **ToT score parsing robustness** — score extraction regex updated to handle thinking-mode LLM outputs that wrap scores in XML tags or extra whitespace

#### Tool Result Compression (`@reactive-agents/reasoning`, `@reactive-agents/tools`, `@reactive-agents/runtime`)

Replaces blind `head+tail` truncation with structured, accurate compression for large tool results:

- **`compressToolResult(result, toolName, budget, previewItems)`** — detects JSON arrays, JSON objects, and plain text; generates compact structured previews that fit within budget
  - JSON arrays: shows item count, flattened schema (top-level + one-level-deep keys), and first N items as compact `key=val` rows
  - JSON objects: shows top-level keys with values (strings truncated to 60 chars, nested objects shown as `{...}`)
  - Plain text: shows first N lines with total line count
- **Scratchpad overflow store** — full result auto-stored in per-execution `Map<string, string>` under `_tool_result_N` key; agent can retrieve via `scratchpad-read("_tool_result_N")`
- **`scratchpad-read` short-circuit** — when agent calls `scratchpad-read("_tool_result_N")`, the execution engine intercepts before hitting the tool and returns the stored value directly
- **Pipe transform syntax** — `ACTION: tool(args) | transform: <js-expr>` evaluated in-process via `new Function("result", ...)` so only the transform output enters context; falls back to standard preview on error
- **`ResultCompressionConfig`** type in `@reactive-agents/tools` — `{ budget?, previewItems?, autoStore?, codeTransform? }` — user-configurable on `.withTools({ resultCompression: {...} })`
- **ReAct prompt updated** — explains `[STORED: ...]` format and `| transform:` syntax so models know how to use both mechanisms
- **15 new tests** in `packages/reasoning/tests/strategies/reactive-compression.test.ts` covering preview generation, pipe parsing, transform evaluation, and wiring

#### MCP Streamable-HTTP Transport (`@reactive-agents/tools`)

- **`streamable-http` transport type** — new MCP transport mode that connects to remote MCP servers over HTTP with streaming support (complements existing `stdio` and `sse` transports)
- **Headers, env, and cwd support** — `MCPServerConfig` extended with `headers?: Record<string, string>`, `env?: Record<string, string>`, and `cwd?: string` for full subprocess and remote server configuration
- **Spec compliance** — MCP tool discovery and invocation now follows the MCP 1.0 spec more strictly; `tools/call` result handling updated to extract text content from structured response parts

#### Examples Suite (`apps/examples`)

- **21 runnable examples** organized into 5 categories: `foundations/`, `tools/`, `multi-agent/`, `trust/`, `advanced/`, `interaction/`
- **Unified `index.ts` runner** — `bun run index.ts [category] [--live]` runs all or filtered examples; `--live` mode uses real LLM providers
- **Category READMEs** — each category has a README explaining the examples and prerequisites
- **New examples added**:
  - `tools/05-builtin-tools`, `tools/06-mcp-filesystem`, `tools/07-mcp-github`
  - `multi-agent/08-a2a-protocol`, `multi-agent/09-orchestration`, `multi-agent/10-dynamic-spawning`
  - `trust/11-identity`, `trust/12-guardrails`, `trust/13-verification`
  - `advanced/14-cost-tracking` through `advanced/18-self-improvement`
  - `reasoning/19-react`, `reasoning/20-plan-execute`, `interaction/21-interaction-modes`

### Fixed

- **`scratchpad-read` bare string arg** — calling `scratchpad-read("_tool_result_1")` now correctly resolves the key; previously fell back to `args.key` which was `undefined` on a string value
- **Pipe transform line boundary** — transform expression no longer captures trailing newlines or subsequent text when the model writes multi-line thoughts
- **Cost-route model routing** — `complexity-router` now correctly selects model tiers for non-Anthropic providers (OpenAI, Gemini, Ollama, LiteLLM); was previously defaulting to Anthropic model names for all providers
- **MCP connections scope** — MCP server connections are now established inside `Layer.effectDiscard` scope so they are properly torn down and re-established on each `agent.run()` call

### Changed

- `@reactive-agents/core` 0.2.0 → 0.5.5: typed `EventBus.on<T>()`, 5 new event types, `AgentEventTag` and `TypedEventHandler<T>` exports
- `@reactive-agents/cost` 0.2.0 → 0.5.5: complexity-router model routing fix for non-Anthropic providers
- `@reactive-agents/guardrails` 0.1.0 → 0.5.5: `GuardrailViolationDetected` event emission wired
- `@reactive-agents/identity` 0.1.0 → 0.5.5: `MemoryBootstrapped` / `MemoryFlushed` event wiring (via memory service)
- `@reactive-agents/llm-provider` 0.5.0 → 0.5.5: `LLMRequestStarted` event emission in direct-LLM path
- `@reactive-agents/memory` 0.1.0 → 0.5.5: emits `MemoryBootstrapped` from `bootstrap()` and `MemoryFlushed` from `flush()`
- `@reactive-agents/observability` 0.2.0 → 0.5.5: `MetricsCollector`, `formatMetricsDashboard()`, `exportMetrics()`, tool execution tracking
- `@reactive-agents/prompts` 0.1.0 → 0.5.5: no API changes; version aligned to release
- `@reactive-agents/reasoning` 0.5.1 → 0.5.5: strategy fixes (defaultStrategy, ToT plan-then-execute, adaptive routing, score parsing), tool result compression, taskId correlation
- `@reactive-agents/runtime` 0.5.4 → 0.5.5: metrics wiring, MCP scope fix, execution engine tool tracking
- `@reactive-agents/tools` 0.4.1 → 0.5.5: `ResultCompressionConfig`, streamable-http MCP transport, headers/env/cwd in `MCPServerConfig`
- `@reactive-agents/verification` 0.2.0 → 0.5.5: no API changes; version aligned to release
- `reactive-agents` meta-package 0.5.2 → 0.5.5
- `@reactive-agents/cli` 0.5.4 → 0.5.5

### Stats
- 909 tests across 124 files (was 855/120 in v0.5.3, +54 new tests)
- 21 example apps across 6 categories

---

## [0.5.3] — 2026-02-25

### Added

#### Real Ed25519 Cryptography (`@reactive-agents/identity`)
- **`crypto.subtle.generateKey("Ed25519")`** — real asymmetric key generation for agent certificates, replacing placeholder key stubs
- **Signature verification** — `crypto.subtle.sign()` / `crypto.subtle.verify()` used for certificate authentication
- **SHA-256 fingerprints** — certificate fingerprints computed via `crypto.subtle.digest("SHA-256")` over the DER-encoded public key

#### LiteLLM Provider (`@reactive-agents/llm-provider`)
- **5th LLM provider adapter**: `packages/llm-provider/src/providers/litellm.ts` — connects to any LiteLLM proxy endpoint, unlocking 100+ model backends (OpenAI-compatible format)
- Builder: `.withProvider("litellm")` — requires `LITELLM_BASE_URL` env var (e.g., `http://localhost:4000`)
- Full tool calling, streaming, and structured output support via the LiteLLM OpenAI-compatible API

#### Kill Switch & Lifecycle Control (`@reactive-agents/guardrails`)
- **`KillSwitchService`** — per-agent and global halt capability with full lifecycle control API:
  - `trigger(agentId, reason)` — hard stop at next phase boundary
  - `triggerGlobal(reason)` — halt all agents globally
  - `pause(agentId)` / `resume(agentId)` — suspend and resume execution at phase boundaries
  - `stop(agentId, reason)` — graceful stop (completes current phase, then exits)
  - `terminate(agentId, reason)` — immediate termination
  - `getLifecycle(agentId)` — query current state: `"running" | "paused" | "stopping" | "terminated" | "unknown"`
  - `waitIfPaused(agentId)` — used by execution engine to block at phase boundaries when paused
- Builder: `.withKillSwitch()` — wires `KillSwitchService` and exposes `agent.pause()`, `agent.resume()`, `agent.stop()`, `agent.terminate()` on the `ReactiveAgent` facade
- `guardedPhase()` wrapper — every execution phase is wrapped to check kill switch state before entering
- Emits `AgentPaused` / `AgentResumed` / `AgentStopped` events to EventBus when wired

#### Behavioral Contracts (`@reactive-agents/guardrails`)
- **`.withBehavioralContracts(contract)`** builder method — enforces typed behavioral boundaries:
  - `deniedTools: string[]` — tool names the agent may never call
  - `allowedTools: string[]` — if set, only these tools may be called (whitelist)
  - `maxIterations: number` — per-contract iteration cap that cannot be overridden at runtime
- Contract violations throw `BehavioralContractError` at the guardrail phase before the LLM executes

#### Code Sandbox via Subprocess (`@reactive-agents/tools`)
- **`Bun.spawn()` isolation** in `packages/tools/src/skills/code-execution.ts` — code snippets now execute in a subprocess with `cwd: "/tmp"` and a minimal environment (`PATH` only, no inherited secrets)
- Replaces the previous `new Function()` eval approach; prevents environment variable leakage and file system escapes

#### Multi-Source Verification (`@reactive-agents/verification`)
- **Real LLM claim extraction + Tavily search** in `packages/verification/src/layers/multi-source.ts` — the Multi-Source verification layer now extracts factual claims from the output via LLM, then cross-references each claim with a Tavily web search
- Previously documented as "not fully implemented"; now functional when `TAVILY_API_KEY` is set

#### Prompt A/B Experiment Framework (`@reactive-agents/prompts`)
- **`ExperimentService`** in `packages/prompts/src/services/experiment-service.ts` — structured A/B testing for prompt variants
- Define experiments with variant groups, traffic splits, and success metrics; `ExperimentService.assign()` deterministically routes requests to variants; `ExperimentService.record()` logs outcomes for analysis

#### Cross-Task Self-Improvement (`@reactive-agents/runtime`, `@reactive-agents/reasoning`)
- **`StrategyOutcome` episodic logging** — after each completed task, strategy name, task description, outcome (success/failure), and step count are logged as episodic memories
- **`.withSelfImprovement()`** builder method — enables outcome logging and retrieves relevant past strategy outcomes at bootstrap to bias strategy selection on similar future tasks

#### Integration Scenarios
- **S14** (`test.ts`) — code sandbox env isolation: verifies spawned code processes cannot read `ANTHROPIC_API_KEY` from the environment
- **S15** (`test.ts`) — self-improvement two-run scenario: second run on similar task uses fewer iterations than first run, validated via episodic memory retrieval

### Changed
- `@reactive-agents/identity` 0.5.2 → 0.5.3: real Ed25519 key generation and signature verification
- `@reactive-agents/llm-provider` 0.5.0 → 0.5.3: LiteLLM adapter (5th provider)
- `@reactive-agents/guardrails` 0.5.2 → 0.5.3: KillSwitchService, BehavioralContractError, `.withKillSwitch()` / `.withBehavioralContracts()`
- `@reactive-agents/tools` 0.5.1 → 0.5.3: Bun.spawn subprocess isolation in code-execute handler
- `@reactive-agents/verification` 0.5.2 → 0.5.3: functional Multi-Source layer with LLM + Tavily
- `@reactive-agents/prompts` 0.2.0 → 0.5.3: ExperimentService
- `@reactive-agents/runtime` 0.5.2 → 0.5.3: `.withSelfImprovement()` builder method, StrategyOutcome logging
- `@reactive-agents/reasoning` 0.5.1 → 0.5.3: StrategyOutcome type, episodic outcome logging

### Stats
- 855 tests across 120 files (was 812/116 in v0.5.2, +43 new tests)
- 2 new integration scenarios: S14 (code sandbox), S15 (self-improvement)

---

## [0.5.2] — 2026-02-24

### Added

#### Agent Persona / Steering API (`@reactive-agents/runtime`, `@reactive-agents/reasoning`, `@reactive-agents/tools`)

- **`AgentPersona` Interface** — Structured alternative to raw system prompts. Fields: `name?`, `role?`, `background?`, `instructions?`, `tone?` — all optional.
- **`.withPersona(persona)` Builder Method** — Enables steerable, type-safe behavior configuration for main agents. Personas are composed into system prompt sections.
- **Persona Composition** — When both persona and systemPrompt are set, persona comes first (`${personaPrompt}\n\n${systemPrompt}`), allowing layered behavior guidance.
- **Subagent Personas** — Static subagents (`.withAgentTool()`) and dynamic subagents (`spawn-agent` tool) now accept persona configuration. Parent agents can dynamically generate persona parameters (`role`, `instructions`, `tone`) to steer specialized subagents at runtime.
- **Enhanced `spawn-agent` Tool** — New tool parameters enable parent agents to specify subagent personas: `role` (e.g., "Data Analyst"), `instructions` (e.g., "Focus on accuracy"), `tone` (e.g., "professional").

#### Critical Bug Fix: System Prompt Forwarding in Reasoning Path
- **Bug**: When `enableReasoning: true`, custom systemPrompt (from `.withSystemPrompt()` or composed persona) was silently ignored by all reasoning strategies (ReAct, Plan-Execute, Tree-of-Thought, Reflexion, Adaptive).
- **Root Cause**: ReasoningService had no mechanism to pass systemPrompt to strategies; each strategy hardcoded its own default fallback.
- **Fix** (6 files):
  1. Added `systemPrompt?: string` to `ReasoningService.execute()` params
  2. Added `systemPrompt?: string` to `StrategyFn` type in strategy-registry
  3. Updated all 5 strategy input types to include `systemPrompt?`
  4. Updated all 5 strategies to use `input.systemPrompt` in fallback when available
  5. Updated execution-engine to pass `config.systemPrompt` to reasoning execute
  6. Fixed Context.GenericTag type in execution-engine to include systemPrompt

### Changed
- `@reactive-agents/runtime` 0.5.1 → 0.5.2: AgentPersona type, `.withPersona()` method, persona composition, subagent persona support
- `@reactive-agents/reasoning` 0.5.0 → 0.5.1: ReasoningService params include systemPrompt, all strategies accept and use systemPrompt
- `@reactive-agents/tools` 0.4.0 → 0.4.1: SubAgentConfig includes persona, spawn-agent tool has role/instructions/tone parameters

### Stats
- 812 tests across 116 files (was 804/114 in v0.5.1, +8 new tests)
- 2 new test files: `persona.test.ts`, `subagent-persona.test.ts`

---

## [0.5.1] — 2026-02-24

### Added

#### Context Engineering Revolution (`@reactive-agents/reasoning`, `@reactive-agents/tools`, `@reactive-agents/runtime`)

- **Structured Tool Observations** (`ObservationResult`) — Typed replacement for `startsWith("✓")` string checks. Every tool result now carries `{ success, toolName, category, resultKind, preserveOnCompaction }`. Categories: `file-write`, `file-read`, `web-search`, `http-get`, `code-execute`, `agent-delegate`, `scratchpad`, `custom`, `error`.
- **Model Context Profiles** — Four model tiers (`local`, `mid`, `large`, `frontier`) each with calibrated thresholds: compaction frequency, full-detail window, tool result size limits, rules complexity, prompt verbosity, and tool schema detail. Builder API: `.withContextProfile({ tier: "local" })`.
- **Context Budget System** — `allocateBudget()` dynamically allocates token budget per section (system prompt, tool schemas, memory, step history, rules). Budget tracks usage per iteration and adapts aggressiveness as tasks progress.
- **Real Sub-Agent Tool** — `.withAgentTool(name, config)` now spawns real sub-runtimes (clean context, focused task, structured `SubAgentResult` summary capped at 1500 chars). Depth-limited to `MAX_RECURSION_DEPTH=3`. Previously this was a stub.
- **Scratchpad Built-in Tool** — Two new built-in tools: `scratchpad-write(key, content)` and `scratchpad-read(key?)`. Persistent notes outside the context window — survives compaction. Total built-in tools: 7 (was 5).
- **Progressive Context Compaction** — Four-level compaction: full detail → one-line summary → grouped sequence → dropped. Uses `ObservationResult.preserveOnCompaction` to protect error steps and important observations. Budget-adaptive: escalates level under pressure.
- **Prompt Template Variants** — Tier-aware prompt resolution: compiles `${templateId}:${tier}` first, falls back to base template. New templates: `react-system:local` (ultra-lean), `react-system:frontier` (rich guidance), `react-thought:local`, `react-thought:frontier`.

#### New Exports (`@reactive-agents/reasoning`)
- `ModelTier`, `ContextProfileSchema`, `ContextProfile`, `CONTEXT_PROFILES`, `mergeProfile`, `resolveProfile`
- `ContextBudgetSchema`, `ContextBudget`, `allocateBudget`, `estimateTokens`, `wouldExceedBudget`, `trackUsage`
- `ObservationResult`, `ObservationResultSchema`, `ObservationCategory`, `ResultKind`, `categorizeToolName`, `deriveResultKind`
- Progressive compaction utilities: `formatStepFull`, `formatStepSummary`, `shouldPreserve`, `clearOldToolResults`, `groupToolSequences`, `progressiveSummarize`

#### Dynamic Sub-Agent Spawning (`@reactive-agents/tools`, `@reactive-agents/runtime`)

- **`withDynamicSubAgents(options?)`** builder method — registers the built-in `spawn-agent` tool, enabling the model to delegate subtasks to ad-hoc sub-agents at runtime without pre-configured named agent tools
- **`createSpawnAgentTool()`** exported from `@reactive-agents/tools` — constructs the `spawn-agent` ToolDefinition with parameters: `task` (required), `name?`, `model?`, `maxIterations?`
- Sub-agents receive a clean context window with no parent history; inherit parent's provider and model by default
- Depth-guarded at `MAX_RECURSION_DEPTH = 3`; spawned sub-agents do not receive `spawn-agent` by default, naturally containing recursion
- Tool result routed through the `agent-delegate` observation category (same as `.withAgentTool()`)
- **test.ts S13** scenario added for dynamic spawn; 12/12 pass (7.7 avg steps, 2,366 avg tokens, 4.8s avg)
- Total built-in tools: **8** (was 7)

#### New Exports (`@reactive-agents/tools`)
- `SubAgentConfig`, `SubAgentResult`, `createSubAgentExecutor`
- `scratchpadWriteTool`, `scratchpadReadTool`, `makeScratchpadStore`, `makeScratchpadWriteHandler`, `makeScratchpadReadHandler`
- `createSpawnAgentTool`

#### Type Safety
- Replaced all `as any` casts introduced by context engineering with specific types: branded `Task`/`TaskResult` via `generateTaskId()`/`Schema.decodeSync(AgentId)()`, `Partial<ContextProfile>` replacing `unknown`, typed `RemoteAgentClient` parameters, narrow service interface assertions for dynamic ToolService access.
- `ReactiveAgent` engine type updated from `(task: any) => Effect<any, any>` to properly typed `(task: Task) => Effect<TaskResult, RuntimeErrors | TaskError>`.
- `contextProfile` in config schema updated from `Schema.Unknown` to `Schema.partial(ContextProfileSchema)`.

### Changed
- `@reactive-agents/reasoning` 0.4.0 → 0.5.0: context engineering types, profiles, budget, compaction, observation result
- `@reactive-agents/tools` 0.3.0 → 0.4.0: sub-agent executor, scratchpad tools, spawn-agent tool (8 built-ins)
- `@reactive-agents/runtime` 0.5.0 → 0.5.1: `.withContextProfile()` builder method, real sub-agent wiring, type safety
- `@reactive-agents/prompts` 0.1.0 → 0.2.0: tier-aware variant resolution, 4 new tier-specific templates

### Fixed
- Fixed Layer scope bug where `withAgentTool()` and `withDynamicSubAgents()` tool registrations were lost between `build()` and `run()` calls — agent and spawn-agent tools are now always available on every `run()` call by composing registrations as `Layer.effectDiscard` baked into the runtime layer so they re-run on every scope evaluation

### Stats
- 804 tests across 114 files (was 720/106 in v0.5.0, +84 new tests)
- 7 new test files: `observation.test.ts`, `context-profile.test.ts`, `context-budget.test.ts`, `compaction.test.ts`, `sub-agent.test.ts`, `scratchpad.test.ts`, `prompt-variants.test.ts`
- Verified with real Ollama agent (cogito:14b): 8/9 scenarios pass, avg 6.4 steps, 2,093 tokens, 4.4s

---

## [0.5.0] — 2026-02-23

### Added

#### A2A Protocol Package (`@reactive-agents/a2a` 0.1.0) — NEW
- **Full A2A (Agent-to-Agent) protocol implementation** based on Google's A2A specification
- **Agent Card** — `generateAgentCard()` pure function produces A2A-compliant Agent Cards with skills, capabilities, and provider metadata; `toolsToSkills()` maps tool definitions to `AgentSkill[]`
- **JSON-RPC 2.0 Server** — `A2AHttpServer` with `Bun.serve()` binding, routes `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, `agent/card`; serves `GET /.well-known/agent.json` for standard agent discovery
- **Task Handler** — `createTaskHandler()` persists tasks via Effect `Ref`, transitions through `submitted → working → completed/failed` states, extracts text from message parts, stores artifacts on completion
- **SSE Streaming** — `createSSEStream()` produces `ReadableStream` + `Queue` for real-time task updates; `formatSSEEvent()` serializes events with JSON-RPC 2.0 wrapping
- **Client** — `A2AClient` (Effect-TS service) with `sendMessage()`, `getTask()`, `cancelTask()`, `getAgentCard()` via fetch-based JSON-RPC; supports bearer and API key auth
- **Discovery** — `discoverAgent()` tries `/.well-known/agent.json` then falls back to `/agent/card`; `discoverMultipleAgents()` runs up to 5 discoveries concurrently
- **Capability Matcher** — `matchCapabilities()` scores agents by skill ID (10pts), tag overlap (5pts each), input mode (2pts each); `findBestAgent()` returns top-scoring result
- **A2AService** — unified Effect-TS service wrapping both server and client operations
- **Types** — full Schema.Struct types: `AgentCard`, `A2ATask`, `A2AMessage`, `Part` (Text/File/Data), `Artifact`, `TaskState`, `JsonRpcRequest/Response`, `SendMessageParams`, `TaskQueryParams`, `TaskCancelParams`, `A2AServerConfig`
- **Errors** — `A2AError`, `DiscoveryError`, `TransportError`, `TaskNotFoundError`, `TaskCanceledError`, `InvalidTaskStateError`, `AuthenticationError`

#### Agent-as-Tool Pattern (`@reactive-agents/tools` 0.3.0, `@reactive-agents/runtime` 0.5.0)
- **`createAgentTool()`** — wraps a local agent as a `ToolDefinition`
- **`createRemoteAgentTool()`** — wraps a remote A2A client call as a tool with `MAX_RECURSION_DEPTH=3`
- **Builder wiring** — `.withAgentTool(name, config)` and `.withRemoteAgent(name, url)` now register tools via `ToolService` (was placeholder comment)
- Dynamic import of `ToolService` and adapters at build time; remote agents use `fetch`-based JSON-RPC

#### CLI A2A Support (`@reactive-agents/cli` 0.5.0)
- **`rax serve`** — fully functional A2A HTTP server via `Bun.serve()`:
  - `GET /.well-known/agent.json` and `GET /agent/card` for discovery
  - `POST /` JSON-RPC endpoint: `message/send` (runs agent async, returns taskId), `tasks/get`, `tasks/cancel`, `agent/card`
  - In-memory task store, SIGINT/SIGTERM graceful shutdown
  - Configurable: `--port`, `--name`, `--provider`, `--model`, `--with-tools`, `--with-reasoning`, `--with-memory`

#### Test Coverage Hardening (35+ new tests)
- `packages/a2a/tests/a2a-client.test.ts` — 6 tests: JSON-RPC send/get/cancel, discovery, transport errors, error propagation
- `packages/a2a/tests/agent-card.test.ts` — 6 tests: minimal/full config, defaults, toolsToSkills mapping
- `packages/a2a/tests/a2a-service.test.ts` — 6 tests: server integration, JSON-RPC routing, error mapping
- `packages/a2a/tests/integration.test.ts` — 6 tests: send→poll→complete, discovery, capability matching, full pipeline, task cancellation
- `packages/cost/tests/semantic-cache.test.ts` — 11 tests: cache hit/miss, TTL expiration, stats, eviction, case-insensitive matching

#### Example Apps
- `apps/examples/src/04-a2a-agents.ts` — two agents communicating via A2A protocol
- `apps/examples/src/05-agent-composition.ts` — agent-as-tool pattern with coordinator/specialist
- `apps/examples/src/06-remote-mcp.ts` — MCP server configuration (stdio + SSE transports)

#### Real-Time Observability (`@reactive-agents/observability`, `@reactive-agents/runtime`)
- **`withObservability({ verbosity, live, file? })`** — builder now accepts options:
  - `live: true` — each log line written to stdout immediately as it fires, not buffered until flush
  - `verbosity: "minimal" | "normal" | "verbose" | "debug"` — controls log detail level
  - `file?: string` — optional JSONL file exporter path
- **`LiveLogWriter`** — synchronous callback wired into `StructuredLogger` via `Effect.suspend`
- **`makeLiveLogWriter(options?)`** — factory exported from observability package; ANSI colors + timestamps
- **Structured phase logs**: `◉ [bootstrap/strategy/think/act/complete]` at `normal`; `┄ [thought/action/obs/llm/ctx]` at `verbose`/`debug` — streaming live as each step fires
- **`ConsoleExporter`** — ANSI-colored span tree with timing + metrics summary, printed at flush
- **`FileExporter`** — JSONL output with one entry per span/log
- **Tracer correlation IDs** — `withSpan()` propagates `traceId` via `FiberRef`; child spans inherit parent context

#### ThoughtTracer (`@reactive-agents/observability`)
- **`ThoughtTracerService`** — new Effect-TS service that auto-subscribes to `ReasoningStepCompleted` events and exposes `getThoughtChain(strategy)` / `clearChain()`
- **`ThoughtTracerLive`** — wired via `Layer.provideMerge(ThoughtTracerLive, EventBusLive)` pattern

#### EventBus Reasoning Events (`@reactive-agents/reasoning`)
- All 5 strategies (`reactive`, `plan-execute`, `tree-of-thought`, `reflexion`, `adaptive`) publish `ReasoningStepCompleted` via `Effect.serviceOption(EventBus)` after each thought/action/observation step
- No hard dependency — runs gracefully when EventBus is absent from context
- EventBus extended with `on(tag, handler)` method for filtered subscriptions

#### Foundation Hardening
- **Semantic cache embeddings** — `makeSemanticCache(embedFn?)` factory; cosine similarity matching (>0.92 threshold, hash fast path)
- **LLM-based prompt compressor** — `makePromptCompressor(llm?)` factory; heuristic first pass + LLM second pass when over `maxTokens`
- **InteractionManager approval gates** — `approvalGate()` waits async until `resolveApproval()` called; 5-minute timeout
- **WorkflowEngine approval gates** — `requiresApproval` on `WorkflowStep`; `approveStep()` / `rejectStep()` on `OrchestrationService`
- **LLM hook context enrichment** — `lastLLMRequest`, `lastLLMResponse`, `availableTools`, `traceId` in every hook context
- **LLM episodic memory** — LLM calls and tool results logged as episodic memory items during execution
- **Semantic entropy** — both heuristic + LLM-based (paraphrase embeddings) implementations in verification
- **Fact decomposition** — both heuristic + LLM-based (atomic claim extraction + status scoring) in verification
- **Feature contract tests** — 18 tests verifying user-observable behavior (hooks, iterations, tool visibility, stepsCount, tokensUsed, TaskResult shape)

### Changed
- `@reactive-agents/runtime` 0.4.0 → 0.5.0: agent-tool builder wiring, A2A integration, observability verbosity, live streaming wiring
- `@reactive-agents/cli` 0.4.0 → 0.5.0: `rax serve` with real HTTP server
- `@reactive-agents/a2a` 0.1.0: new package
- `@reactive-agents/core` 0.1.0 → 0.2.0: EventBus `on(tag, handler)` method + 6 new event types (LLMRequestCompleted, ToolCallStarted/Completed, ExecutionPhaseCompleted, ReasoningStepCompleted, ExecutionLoopIteration)
- `@reactive-agents/observability` 0.1.0 → 0.2.0: ConsoleExporter, FileExporter, ThoughtTracer, live streaming, verbosity API, tracer correlation IDs
- `@reactive-agents/reasoning` 0.3.0 → 0.4.0: all 5 strategies publish ReasoningStepCompleted events, ReAct prompt hardening (stop sequences, one-action rule, extractFinalAnswer)
- `@reactive-agents/cost` 0.1.0 → 0.2.0: `makeSemanticCache(embedFn?)` and `makePromptCompressor(llm?)` factories
- `@reactive-agents/verification` 0.1.0 → 0.2.0: LLM-based semantic entropy and fact decomposition
- `@reactive-agents/interaction` 0.1.0 → 0.2.0: `approvalGate()` with `resolveApproval()` and 5-minute timeout
- `@reactive-agents/orchestration` 0.1.0 → 0.2.0: `requiresApproval` on WorkflowStep, `approveStep()`/`rejectStep()`
- `@reactive-agents/llm-provider` 0.4.0 → 0.5.0: LLMRequestEvent type + ObservabilityVerbosity field
- Build order: added `@reactive-agents/a2a` to `build:packages` (after orchestration, before runtime)
- `serve.ts` uses lazy `import()` for `@reactive-agents/a2a` to avoid module resolution in non-serve contexts

### Fixed
- CI lockfile: `bun.lock` updated for new `@reactive-agents/a2a` package (was causing `--frozen-lockfile` failures)
- CLI test failures from top-level `@reactive-agents/a2a` import — converted to dynamic `import()` in `serve.ts`
- ReAct `iteration: 0` bug — fixed to start at 1
- `[act]` hook never firing in reasoning path — fixed: action steps extracted post-reasoning, synthetic act/observe phases fired
- `stepsCount: 0` in TaskResult — fixed: reads from reasoning result metadata
- `maxIterations` override silently ignored — `defaultReactiveAgentsConfig` now accepts optional overrides param

### Stats
- 720 tests across 106 files (was 442/77 in v0.4.0)
- 17 packages + 2 apps
- 3 new example apps (6 total)

---

## [0.4.0] — 2026-02-22

### Added

#### Enhanced Builder API (`@reactive-agents/runtime` 0.4.0)
- **`.withReasoning(options?)`** — accepts optional `ReasoningOptions` for `defaultStrategy`, per-strategy config, and adaptive settings
- **`.withTools(options?)`** — accepts optional `ToolsOptions` with custom tool definitions (definition + handler pairs) registered at build time
- **`.withPrompts(options?)`** — accepts optional `PromptsOptions` with custom `PromptTemplate` objects registered at build time
- All three methods remain zero-arg compatible for simple use cases
- New exported interfaces: `ReasoningOptions`, `ToolsOptions`, `PromptsOptions`

#### Structured Tool Results (`@reactive-agents/llm-provider` 0.4.0, `@reactive-agents/runtime` 0.4.0)
- **LLMMessage type extended** with `{ role: "tool", toolCallId: string, content: string }` variant
- Execution engine OBSERVE phase now emits structured tool result messages with `toolCallId` references (was plain text `"Tool result: ..."`)
- **Anthropic adapter**: tool messages converted to `{ role: "user", content: [{ type: "tool_result", tool_use_id, content }] }`
- **OpenAI adapter**: tool messages mapped to `{ role: "tool", tool_call_id, content }`
- **Gemini adapter**: tool messages converted to `functionResponse` parts
- **Ollama adapter**: tool messages filtered (unsupported by Ollama API)

#### EvalStore Persistence (`@reactive-agents/eval` 0.2.0)
- **`makeEvalServiceLive(store?)`** factory wires optional `EvalStore` (SQLite) into `EvalService`
- `saveRun()` persists to both in-memory Ref and SQLite store when provided
- `getHistory()` reads from SQLite store when available, falls back to in-memory Ref
- **`makeEvalServicePersistentLive(dbPath?)`** convenience function — one-line persistent eval setup
- `EvalServiceLive` remains backwards compatible (in-memory only)

#### CLI Improvements (`@reactive-agents/cli` 0.4.0)
- `--stream` flag now prints informational warning ("not yet implemented") instead of silently ignoring

#### Integration Smoke Tests (6 new test files, 26 tests)
- `packages/runtime/tests/smoke-builder-combinations.test.ts` — 8 tests: minimal, tools-only, reasoning-only, tools+reasoning, full stack, custom system prompt, custom max iterations, withTestResponses
- `packages/runtime/tests/smoke-tool-pipeline.test.ts` — 3 tests: register → call → observe → complete, tool-not-found graceful error, tool timeout handling
- `packages/runtime/tests/smoke-guardrails.test.ts` — 3 tests: injection blocked, clean input passes, guardrails + reasoning combo
- `packages/runtime/tests/smoke-error-recovery.test.ts` — 4 tests: max iterations, missing provider, invalid input, structured error shape
- `packages/runtime/tests/smoke-memory.test.ts` — 3 tests: memory tier 1, multi-turn sequential, memory + reasoning combo
- `packages/eval/tests/smoke-eval-store.test.ts` — 5 tests: saveRun → loadHistory, compareRuns dimension changes, unknown ID returns null, cross-instance persistence, limit option

#### Performance & Quality Benchmarks (3 test files, 19 tests)
- `packages/eval/tests/benchmarks.test.ts` — extended with: `agent.run()` e2e < 100ms, all layers enabled < 200ms, prompt template compilation < 2ms average
- `packages/eval/tests/quality-regression.test.ts` — 6 tests: ReAct thought sequence, Reflexion critique cycle, Plan-Execute plan sequence, Tree-of-Thought branching + synthesis, Adaptive strategy delegation, all strategies return valid ReasoningResult shape
- `packages/prompts/tests/template-compilation.test.ts` — 6 tests: template structure validation, compilation with dummy variables, token estimation, PromptService registration, unique IDs, valid variable types

### Changed
- `@reactive-agents/runtime` 0.3.1 → 0.4.0: enhanced builder API with optional params, structured tool results in execution engine
- `@reactive-agents/llm-provider` 0.3.0 → 0.4.0: LLMMessage extended with tool role, all 4 provider adapters updated
- `@reactive-agents/eval` 0.1.0 → 0.2.0: EvalStore wired into EvalService, persistent layer factory
- `@reactive-agents/cli` 0.3.0 → 0.4.0: --stream warning
- `reactive-agents` meta-package 0.3.1 → 0.4.0

### Fixed
- All documentation code examples now reflect actual builder API signatures
- Removed all references to non-existent `defineTool()` function — replaced with actual `ToolService.register()` pattern or builder `.withTools({ tools: [...] })` option
- Fixed `.withTools([tool])`, `.withReasoning({ defaultStrategy })`, `.withPrompts({ system })` examples across 18+ documentation files to match real API
- Updated stale test/file counts in README and CLAUDE.md

### Stats
- 442 tests across 77 files (was 361/66)
- 41 files changed, 1238 insertions, 285 deletions

---

## [0.3.1] — 2026-02-21

### Added

#### Ollama SDK Integration (`@reactive-agents/llm-provider` 0.3.0)
- **Replaced raw `fetch()` with `ollama` npm SDK** — lazy-imported via `await import("ollama")` (same pattern as Gemini)
- Native tool calling: `tools` param passed to `ollama.chat()`, `response.message.tool_calls` parsed into `CompletionResponse.toolCalls`
- `done_reason` mapping: `"stop"` → `end_turn`, `"length"` → `max_tokens`, tool_calls present → `tool_use`
- `keep_alive: "5m"` for model caching between requests
- `embed()` rewritten to use `ollama.embed()` with batched input array
- `completeStructured()` uses `format: "json"` for native JSON mode
- Configurable endpoint via `new Ollama({ host })` from `config.ollamaEndpoint`

#### MCP Tool Parameter Population (`@reactive-agents/tools` 0.3.0)
- MCP `tools/list` response now parsed for full `{ name, description, inputSchema }` tuples (was name-only)
- `MCPServer.toolSchemas` field added for rich tool metadata
- `connectMCPServer()` converts `inputSchema.properties` → `parameters[]` array with proper types and `required` flags
- Tool descriptions use actual MCP description (was generic "MCP tool from ...")

#### MCP Server Configuration (`@reactive-agents/runtime` 0.3.1)
- `MCPServerConfig` interface and `mcpServers` field added to `RuntimeOptions`
- `mcpServers` implicitly enables tools when set
- `.withMCP(config)` builder method — accepts single config or array, implicitly sets `_enableTools = true`
- Builder `buildEffect()` connects MCP servers after layer construction via dynamic `ToolService` import
- Exported `RuntimeOptions` and `MCPServerConfig` types from runtime index

#### CLI MCP Support (`@reactive-agents/cli` 0.3.0)
- `--mcp-config <path>` / `--mcp <path>` flag for `rax run` — points to JSON config file
- Auto-loads `.rax/mcp.json` from project root if present (no flag needed)
- Config format: `{ "servers": [{ "name", "transport", "command", "args", "endpoint" }] }`

#### Web Search: Tavily Integration
- `webSearchHandler` checks `TAVILY_API_KEY` at execution time
- If set: POST to `https://api.tavily.com/search`, returns `{ title, url, content }` results
- If not set: returns existing stub (zero breakage for users without API key)

#### Exports
- `builtinTools` array exported from `@reactive-agents/tools` index
- `MCPToolSchema` type exported from tools index

#### New Tests
- `packages/tools/tests/builtin-tools.test.ts` — 5 tests: httpGet (real HTTP), fileRead, fileWrite, webSearch stub, codeExecute stub
- `packages/llm-provider/tests/ollama-tools.test.ts` — 6 tests: complete(), tools pass-through, tool_calls parsing, done_reason mapping, embed(), getModelConfig()
- `packages/runtime/tests/builder-tools.test.ts` — 5 tests: .withTools() build, run with tools, .withMCP() config, array configs, full pipeline
- `packages/tools/tests/tool-service.test.ts` — +1 test: MCP parameter population

### Changed
- `@reactive-agents/llm-provider` 0.2.0 → 0.3.0: Ollama SDK rewrite with tool calling support
- `@reactive-agents/tools` 0.2.0 → 0.3.0: MCP parameter population, Tavily web search, builtinTools export
- `@reactive-agents/runtime` 0.3.0 → 0.3.1: MCP server config in builder and runtime
- `@reactive-agents/cli` 0.2.1 → 0.3.0: --mcp-config flag, .rax/mcp.json auto-loading
- `reactive-agents` meta-package 0.3.0 → 0.3.1

### Stats
- 361 tests across 66 files (was 340/63)

---

## [0.3.0] — 2026-02-21

### Added

#### Foundation Integration — All Services Wired Through Execution Engine

The 10-phase execution engine now calls every configured service. Agents can think, use tools, observe results, verify output, track costs, and log audit trails — all in a single execution loop.

**Tools in Reasoning (C1)**
- `ReasoningService` captures `ToolService` optionally at layer construction time
- Strategies like ReAct receive ToolService in their Effect context — tools execute for real during reasoning
- `createRuntime()` restructured: tools layer built before reasoning layer and provided as a dependency

**OpenAI Function Calling (C2)**
- `toOpenAITool()` converter maps tool definitions to OpenAI's function_calling format
- `tools` array sent in OpenAI API request body when tools are provided
- `tool_calls` extracted from responses; `function.arguments` JSON parsed into `ToolCall[]`
- `finish_reason: "tool_calls"` mapped to `stopReason: "tool_use"`; `content: null` handled

**3 New Reasoning Strategies (C3)**
- **Plan-Execute-Reflect** — Generate plan → execute steps → reflect → refine (configurable `maxRefinements`, `reflectionDepth`)
- **Tree-of-Thought** — BFS expansion → score branches → prune below threshold → synthesize best path (configurable `breadth`, `depth`, `pruningThreshold`)
- **Adaptive** — Meta-strategy: analyze task complexity via LLM → delegate to optimal sub-strategy
- All 5 strategies registered in `StrategyRegistryLive` initial map

**Tool Type Adapter (C4)**
- Execution engine calls `toFunctionCallingFormat()` before LLM loop, converting tools package format to LLM-compatible `{ name, description, inputSchema }` format

**Token Tracking (C5)**
- `tokensUsed` added to `ExecutionContext` schema, initialized to 0
- Accumulated from `response.usage.totalTokens` after each LLM call
- Final `TaskResult` reports accurate token count (was hardcoded to 0)

**Observability Integration (H1)**
- `ObservabilityService` acquired optionally at start of `execute()`
- `runObservablePhase()` wrapper wraps every phase in `obs.withSpan()` when available
- All `runPhase()` calls replaced with `runObservablePhase()`
- Spans include `taskId`, `agentId`, and `phase` attributes

**Stub Phases Wired to Real Services (H2)**
- Phase 2 (Guardrail): `GuardrailService.check(inputText)` — fails with `GuardrailViolationError` if `!result.passed`
- Phase 3 (Cost Route): `CostService.routeToModel(task)` — selects optimal model tier
- Phase 6 (Verify): `VerificationService.verify(response, input)` — stores score and risk in context metadata
- Phase 8 (Cost Track): `CostService.recordCost()` — logs token counts, latency, and cost
- Phase 9 (Audit): `ObservabilityService.info()` — logs task summary with iterations, tokens, cost, strategy, duration

**Context Window Management (H3)**
- `ContextWindowManager.truncate()` called before each LLM call to stay within token limits

**Memory Integration in Reasoning Loop (H5)**
- OBSERVE phase logs tool results as episodic memories via `MemoryService.logEpisode()`
- Phase 7 (Memory Flush) calls `flush()` in addition to `snapshot()` for full persistence

#### Documentation Overhaul
- **12 new documentation pages** (28 total, up from 15)
- 7 feature docs: LLM Providers, Verification, Cost Tracking, Identity/RBAC, Observability, Orchestration, Prompt Templates
- 4 cookbook pages: Testing Agents, Multi-Agent Patterns, Custom Strategies, Production Deployment
- Rewritten landing page with tabbed code examples and framework comparison cards
- New sidebar sections: Features, Cookbook
- Neural network logo design, favicon

#### README Rewrite
- Architecture tables mapping phases to services
- Strategy comparison matrix with use cases
- Multi-provider capability matrix
- Cleaner badge layout, updated stats

#### New Tests
- `packages/runtime/tests/foundation-integration.test.ts` — token accumulation, tools-to-LLM, observability spans, guardrails/verify/cost phases, OpenAI tool_calls
- `packages/reasoning/tests/strategies/plan-execute.test.ts` — 3 tests
- `packages/reasoning/tests/strategies/tree-of-thought.test.ts` — 3 tests
- `packages/reasoning/tests/strategies/adaptive.test.ts` — 3 tests
- `packages/llm-provider/tests/openai-tools.test.ts` — OpenAI tool format

### Changed
- `@reactive-agents/runtime` 0.2.0 → 0.3.0: major execution engine rewrite, all phases wired
- `@reactive-agents/reasoning` 0.2.0 → 0.3.0: 3 new strategies, ToolService integration
- `@reactive-agents/llm-provider` 0.1.1 → 0.2.0: OpenAI function calling support
- `reactive-agents` meta-package 0.2.1 → 0.3.0
- Updated existing docs: reasoning (5 strategies), tools (reasoning integration), guardrails (execution engine wiring), agent lifecycle (service calls per phase), builder API reference (Gemini provider)

### Stats
- 340 tests across 63 files (was 318/56)
- 28 documentation pages (was 15)

---

## [0.2.1] — 2026-02-20

### Added

#### Evaluation Framework (`@reactive-agents/eval`)
- **`@reactive-agents/eval` 0.1.0** — LLM-as-judge evaluation framework for agent quality measurement
- 5 built-in scoring dimensions: `accuracy`, `relevance`, `completeness`, `safety`, `cost-efficiency`
- Custom dimension support via generic LLM-as-judge prompting
- `EvalService.runSuite(suite, agentConfig)` — runs all cases, scores all dimensions, builds summary with pass/fail counts
- `EvalService.runCase(evalCase, agentConfig, dimensions, actualOutput, metrics)` — score a single case with real agent output
- `EvalService.compare(runA, runB)` — per-dimension improvement/regression/unchanged classification (±0.02 delta threshold)
- `EvalService.checkRegression(current, baseline, threshold?)` — regression detection with configurable threshold (default 0.05)
- `EvalService.getHistory(suiteId)` — retrieve past runs from in-memory history ref
- `DatasetService.loadSuite(path)` — load eval suite from JSON file (Schema-validated)
- `DatasetService.loadSuitesFromDir(dir)` — batch-load all `*.json` suites from a directory
- `rax eval run --suite <path> [--provider anthropic|openai|test]` — CLI command with summary table and dimension score bars
- 11 tests: eval-service (7) and dataset-service (4)

### Changed
- `reactive-agents` meta-package 0.2.0 → 0.2.1: adds `@reactive-agents/eval` dep and `./eval` subpath export
- `@reactive-agents/cli` 0.2.0 → 0.2.1: real `rax eval run` implementation (was placeholder)
- `@reactive-agents/reasoning` type fixes for correct DTS output (no API changes)

### Fixed
- Build order: `@reactive-agents/tools` now builds before `@reactive-agents/reasoning` (DTS dependency)
- `reactive.ts` type errors in DTS output from `typeof ToolService.Service` — replaced with explicit local interface

### Stats
- 318 tests across 56 test files (was 307/54)

---

## [0.2.0] — 2026-02-20

### Added

#### Tools in Reasoning
- **ReAct strategy now executes real tools** — `ACTION: tool_name({"param": "value"})` JSON format is dispatched to registered tools via `ToolService`
- String arguments are mapped to the first required parameter of the tool definition as a fallback
- Tool errors are captured as observations (no crashes, no runaway loops); graceful degradation when `ToolService` is absent
- `ExecutionEngine` think phase populates `availableTools` from real registered tool names (was hardcoded empty `[]`)
- `ExecutionEngine` act phase calls real `ToolService.execute()` with `concurrency: 3` (was a `[Tool ${name} executed]` placeholder)
- 5 new integration tests in `packages/reasoning/tests/strategies/reactive-tool-integration.test.ts`

#### MCP Stdio Transport
- **Real stdio transport** for MCP (Model Context Protocol) via `Bun.spawn()` — line-delimited JSON-RPC 2.0
- Background stdout reader loop with pending request tracking and Promise-based resolution
- Subprocess kill on disconnect; `activeTransports` map for lifecycle management
- SSE and WebSocket transports remain stubs (planned for v0.2.x)

### Changed
- `@reactive-agents/reasoning` 0.1.0 → 0.2.0: adds `@reactive-agents/tools` dependency; ReAct rewired
- `@reactive-agents/tools` 0.1.1 → 0.2.0: MCP client rewritten with real stdio transport
- `@reactive-agents/runtime` 0.1.2 → 0.2.0: updated tools/reasoning deps; real act phase
- `@reactive-agents/cli` 0.1.7 → 0.2.0: updated runtime dep

### Stats
- 307 tests across 54 test files (was 300/52)

---

## [0.1.1] — 2026-02-20

### Added

#### Provider Improvements
- All 4 LLM providers (Anthropic, OpenAI, Gemini, Ollama) handle both `string` and `ModelConfig` model parameters
- Gemini provider defaults to `gemini-2.5-flash` with fallback logic for non-Gemini model names
- **Reflexion reasoning strategy** — self-critique loop with reflection memory

#### Tools System
- `@reactive-agents/tools` — dynamic tool registration, execution, sandboxing, risk levels (`low`/`medium`/`high`/`critical`)
- Function-to-tool auto-adaptation: convert any TypeScript function to a typed tool
- Tool input validation with risk-level gates
- Sandbox with timeout enforcement and structured error handling

#### CLI Enhancements
- `rax run --tools` flag — register built-in tools for a run
- `rax run --reasoning` flag — enable reasoning strategy
- `rax run --model <model>` — select model at runtime
- Version string now read dynamically from `package.json` (no hardcoding)

### Fixed
- `ExecutionEngine` now reliably initializes `selectedModel` from config in bootstrap phase
- Model parameter plumbing verified end-to-end: builder → runtime config → execution context → LLM `complete()` call
- `ReasoningService.execute` takes a single `params` object (not positional args)
- CLI binary now uses Bun shebang for correct runtime detection
- npm dependency resolution fixed for published packages

### Changed
- `@reactive-agents/runtime` 0.1.0 → 0.1.1–0.1.2
- `@reactive-agents/cli` 0.1.0 → 0.1.2–0.1.7 (incremental fixes)
- `@reactive-agents/llm-provider` updated with model parameter handling
- Restored `reactive-agents` unscoped meta-package to npm registry

---

## [0.1.0] — 2026-02-20

### Added

#### Core Framework
- `@reactive-agents/core` — EventBus, AgentService, TaskService, shared types and schemas
- `@reactive-agents/runtime` — 10-phase ExecutionEngine, ReactiveAgentBuilder, `createRuntime()` compositor
- `@reactive-agents/llm-provider` — LLM adapters for Anthropic, OpenAI, Ollama, and a deterministic test provider
- `reactive-agents` — single meta-package that bundles all layers for simplified installation

#### Memory System
- `@reactive-agents/memory` — Working, Semantic, Episodic, and Procedural memory backed by `bun:sqlite`
- Tier 1: FTS5 full-text search
- Tier 2: vector embeddings via `sqlite-vec` for semantic similarity (KNN)
- Zettelkasten-style note linking

#### Reasoning Strategies
- `@reactive-agents/reasoning` — ReAct (Reason + Act), Plan-Execute, and Tree-of-Thought strategies
- Configurable max iterations and strategy selection per task

#### Safety & Verification
- `@reactive-agents/guardrails` — prompt injection detection, PII scanning, toxicity filtering
- `@reactive-agents/verification` — semantic entropy scoring and fact decomposition

#### Cost Management
- `@reactive-agents/cost` — complexity-based model routing (Haiku / Sonnet / Opus)
- Session and per-request budget enforcement

#### Identity & Access
- `@reactive-agents/identity` — agent certificates, role-based access control (RBAC)

#### Observability
- `@reactive-agents/observability` — distributed tracing, metrics, structured logging

#### Interaction Modes
- `@reactive-agents/interaction` — 5 autonomy modes: Autonomous, Supervised, Collaborative, Consultative, Interrogative
- Dynamic mode transitions based on confidence and cost
- Human-in-the-loop checkpoints and collaboration sessions

#### Orchestration
- `@reactive-agents/orchestration` — multi-agent workflow engine, parallel and sequential coordination

#### Prompts
- `@reactive-agents/prompts` — template engine with variable interpolation, built-in prompt library

#### CLI (`rax`)
- `@reactive-agents/cli` — `rax` CLI (Reactive Agents eXecutable)
- `rax init <name> --template minimal|standard|full` — scaffold a new project
- `rax create agent <name> --recipe basic|researcher|coder|orchestrator` — generate agent files
- `rax run <prompt> --provider anthropic|openai|ollama` — run an agent from the command line
- `rax dev`, `rax eval`, `rax playground`, `rax inspect` — development utilities

#### Documentation
- Starlight (Astro) documentation site at https://docs.reactiveagents.dev/
- 16 pages covering guides, concepts, and API reference

#### CI/CD
- GitHub Actions: CI (typecheck + test), docs deployment to GitHub Pages, npm publish on version tags
- 283 tests across 52 files
