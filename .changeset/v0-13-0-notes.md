---
"reactive-agents": minor
---

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
