---
"reactive-agents": minor
---

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
