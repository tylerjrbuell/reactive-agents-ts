---
type: implementation-plan
status: active
created: 2026-11-10
updated: 2026-11-10
tags: [implementation-plan, cortex, convergence, dogfooding, runtime, ui-core, tools, gateway, trace]
---

# Cortex ↔ framework convergence (plan 10)

**Goal:** Cortex shows what Reactive Agents offers and is built on it. Every feature has one home:
- Where Cortex's version is more robust and generally useful, it moves into the right package and Cortex consumes it (**OFFLOAD**).
- Where the framework's version is better, Cortex deletes its copy (**ADOPT**).
- Where each side has parts the other lacks, they are merged into one named home (**MERGE**).
- Studio-only concerns stay in Cortex (**KEEP**).

No existing behavior regresses, and every move is pinned by tests before code changes.

**Evidence base:** six read-only, feature-by-feature comparisons (2026-11-10), each finding cited to file:line. They cover:
- context, compaction and token accounting
- human-in-the-loop (HITL)
- capability surface (skills, MCP, tools, templates)
- operations and observability
- agent config and build path
- UI stores vs ui-core/svelte

Raw notes: session scratchpad, summarized below. Line numbers are as of 2026-11-10; re-check with `bun run repo find` before editing.

## Principles

1. **Pin, move, consume, delete.**
   1. Pin current behavior with tests where the code lives now.
   2. Move the code and its tests unchanged.
   3. Point Cortex at the new home.
   4. Delete the copy, after a grep that shows it has no other caller.
   5. Run `repo verify` on every touched package, then `repo check --all`.
2. **Framework first, studio presets second.** Cortex defaults (memory off in chat, meta-tools on, `numCtx=8192`) become named presets layered on framework config. They never become framework defaults.
3. **Public APIs grow additively.** A behavior change to a default needs a changeset. If it changes what the model sees, it also needs `ablation-warden`.
4. **Modality-neutral.** New ui-core chat types use typed parts, never assume string turns (plan 9, principle 8).
5. **Ownership.** Domain edits go to the owning warden (`bun run repo scope <files>`). The main thread dispatches, verifies, integrates and commits, one concern per commit.

## Verdict matrix

| Area | Feature | Verdict | Target home | Owner |
|---|---|---|---|---|
| Config | 11 builder "overlays" with no config leaf: metaTools, skills, subAgents (agentTools / remote / dynamic), verification step `reflect`, durable approvalPolicy + interaction, terminal/shell options, outputSchema JSON, modelRouting, documents, reasoning synthesis | OFFLOAD | `runtime` `AgentConfigSchema` | runtime-warden |
| Config | `BuildCortexAgentParams` (52 keys), 3 per-path mappers, `AgentConfigBodyFields` | ADOPT, then delete | one `StoredAgent = {config: AgentConfig, studio, v:2}` + surface presets | cortex-warden |
| Config | Manifest: item shapes, `default`, `group`, `stability`, option sources | OFFLOAD | `runtime` `config-fields.ts` | runtime-warden |
| Chat | Hold a paused turn and resume later (framework `ChatEngine` records the placeholder reply as the answer: `engine.ts:375,497`) | OFFLOAD (also fixes a framework defect) | `runtime` `ChatEngine` / `AgentSession` | runtime-warden |
| Chat | Structured 6-section conversation summary, transcript bounding | OFFLOAD | `runtime/src/chat/compaction.ts` + `session.compact()` / `replaceHistory()` | runtime-warden |
| Chat | History window: chars-only 8,000 cap ignores the model's window (`engine.ts:19-21,558-563`) | MERGE | `runtime` chat engine, budgeted from the model window | runtime-warden + ablation-warden |
| Chat | Chat history persistence (SQLite rows, rewind, fork, cost) | KEEP | Cortex; document the `initialHistory` host seam | cortex-warden |
| Chat | Proposals / session-control tool, goals service | KEEP | Cortex (goals gain a `pendingHuman` state) | cortex-warden |
| Chat | Durable pending-gate columns duplicated from the RunStore | ADOPT | read via `agent.listPending*`; keep a slim session→run join | cortex-warden |
| Chat | Multi-owner desk approval registry | KEEP | Cortex | cortex-warden |
| Tokens | Server per-turn `reported*` counters (double-count a repeated `callId`) | ADOPT | ui-core `summarizeUsage` via the turn recorder | cortex-warden |
| Tokens | Session usage fold (`splitOfTurn`, sub-agent spend, totals) | OFFLOAD | ui-core `foldSessionUsage` | cortex-warden (ui-core: check scope) |
| Tokens | 6 token estimators across packages; ui-core's is the only script-aware one | MERGE | `core` (ui-core re-exports) | per-package wardens |
| Tokens | `contextLevel` thresholds written twice; `ContextPressure` carries no window size | MERGE | `core` + `windowTokens` field on the event | kernel-warden |
| UI | Chat session client (send / stop / queue / draft / optimistic turns) | OFFLOAD | ui-core `createChatSession` + svelte/react/vue bindings | cortex-warden + UI package owner |
| UI | Turn stream driver, live usage fold, `hydrateTurnTrace`, sub-agent projection, interaction form helpers | OFFLOAD | ui-core | same |
| UI | Interaction/approval POST: 3 raw fetches | MERGE | ui-core controller accepts `endpoint: (runId) => string` | same |
| UI | Run desk reducer (AgentEvent stream) | KEEP; fix O(n²) cost | Cortex | cortex-warden |
| UI | svelte `framework.ts` barrel: bypassed, only test callers | DELETE, or replace with real use of `createChatSession` | — | cortex-warden |
| Tools | MCP config import (written 6 times: Cortex, CLI ×2, transport inference ×3) | OFFLOAD | `tools/src/mcp/config-file.ts` + `.withMCP({ fromFile })` | tools-warden |
| Tools | MCP discovery (`listMcpServerTools`), `toolParamsFromJsonSchema` | OFFLOAD | `tools` | tools-warden |
| Tools | Tool catalog view, playground, Lab echo tools | KEEP (fix bugs) | Cortex | cortex-warden |
| Skills | Skill discovery (Cortex lists skills a run never loads) | ADOPT | `reactive-intelligence` `discoverSkills` | cortex-warden |
| Prompts | Template tokenizer (Cortex handles spaces, lists unresolved tokens, reserves `secret.`) | MERGE | `prompts` | owner via `repo scope` |
| Output | `jsonSchema()` helper | OFFLOAD | `reasoning` / `runtime` (also in config row 1) | runtime-warden |
| Workspace | Directory check | ADOPT | `runtime` `resolveWorkspaceDir` (export it) | cortex-warden |
| Docs | Document fetch cache | KEEP; fix `allowPrivateHosts`; runtime exports `hasUrlScheme` | Cortex | cortex-warden |
| Ops | Cron scheduling (evaluated in **UTC**, no catch-up) | MERGE | `gateway` `SchedulerService` (timezone, catch-up, policies) | owner via `repo scope` |
| Ops | Outbound lifecycle webhooks | OFFLOAD | `gateway` `LifecycleWebhookSink` (HMAC, EventBus) | same |
| Trace | Trace file lookup (3 resolvers; ignores `REACTIVE_AGENTS_TRACE_DIR`) | MERGE | `trace` `findRunTrace` / `findRunTreeTraces` | harness-warden (owns trace) |
| Trace | Run-view cause and attribution | ADOPT | `trace` `analyzeCause` / `attributeFailure` | cortex-warden |
| Eval | Score a recorded run | ADOPT | `eval` `runCase(actualOutput)` | cortex-warden |
| Export | Transcript Markdown (server imports UI code: layer violation) | OFFLOAD | ui-core `renderTranscriptMarkdown` + `formatUsd` | cortex-warden |
| Export | Chat title helper | OFFLOAD (optional) | `runtime/src/chat` | runtime-warden |
| Observe | CortexReporter drops events sent before the socket opens | Fix in place | `observability` (bounded pre-open queue) | owner via `repo scope` |
| Ingest | Ingest, bridge, store, live stats, turn evidence | KEEP | Cortex | — |

## Phases

The order is chosen so each phase stands alone: bugs first, then the structural moves that reduce the cost of every later change, then offloads.

### P0: Stabilize the in-flight work (blocking)

The working tree holds four uncommitted workstreams: token accounting, the queue/draft/compaction fixes, the token-split fixes, and confirm modals. Land them before any move.

- [ ] Reasoning consumers of optional token halves (kernel-warden, in flight): restore `reasoning` typecheck; one `addKnown` rule.
- [ ] Runtime and cost consumers from that report (runtime-warden); include the half-unknown rule for `run-budget-arm.ts`, `debrief.ts`, `cost-track.ts`.
- [ ] Cortex split fixes (cortex-warden):
  - S3 compaction keeps `tokens_in`/`tokens_out` sums.
  - S4 live split from reported halves only, no 70/30 guess.
  - S6/E1 partial sums labeled as lower bounds.
  - E2 last-reply split checked against the total.
  - Aborted in-flight call marked as a lower bound.
  - Server per-turn counters replaced by the turn recorder's `summarizeUsage` (fixes the duplicate-`callId` double count).
- [ ] Changesets:
  - `llm-provider` optional halves (public type) and Gemini thinking tokens counted in output.
  - runtime child split.
  - Cortex queue/compaction (exists).
- [ ] Docs metrics regen for the new test files (`bun run --cwd apps/docs metrics && … metrics:sync-readme`).
- [ ] Live browser check of queue, Restore, compaction sections, ring after compact, and confirm modals. Blocked: stray pid 195650 shares the DB, so start the check on a separate `CORTEX_PORT` and DB.
- [ ] Commits split by concern; `repo check --all` green; `bun run build` green.

**Exit:** clean tree, all gates green.

### P1: Correctness quick wins (no architecture moves)

Each is small, independently shippable, and pinned by a new test.

- [ ] **Cron runs in UTC.** Store a timezone per gateway agent and chat schedule and pass it to `shouldFireAt` (`gateway-process-manager.ts:280`, `chat-schedule-service.ts:256`). The UI shows the timezone and the next fire time in local time.
- [ ] **MCP discovery and playground drop `auth`, so OAuth servers can't be discovered.** Pass `auth`. Persist `inputSchema` (new cache column) so catalog params stop being `[]` (`tool-catalog.ts:166`) and the Lab hint is true. Remove `as any` at `tool-playground-invoke.ts:114`. Disconnect on error.
- [ ] **Trace lookup ignores `REACTIVE_AGENTS_TRACE_DIR`** (`run-trace-file.ts:10`).
- [ ] **Missing `success` is shown as `completed`** (`ingest-service.ts:98-99`): show `unknown` until trace cause says otherwise.
- [ ] **RunChatTab Stop is impossible** (`RunChatTab.svelte:197`), and **history loses tools and thinking on reload** (no hydration, `:82`).
- [ ] **Config PATCH or proposal Apply while a turn is pending** later fails with `DurableConfigMismatchError`: return 409, with a clear message.
- [ ] **Runner and gateway pending approvals vanish after restart:** rebuild them at boot from each durable dir.
- [ ] **Lab duplicate controls:** a generic edit is silently overridden by the curated control (`AdvancedFrameworkConfig.svelte:33-42`). Add the paths to `CURATED` now; P2 removes the class.
- [ ] **Document cache:** pass `allowPrivateHosts` (`chat-document-cache.ts:26`).
- [ ] **`sending` and `activeController` are global** (`chat-store.ts:624`): make them per-session so the Stop button and queue follow the session.
- [ ] **CortexReporter:** bounded pre-open queue (observability).
- [ ] **Dead code:** non-stream send `chat-store.ts:461-520` (confirm it has no caller first).
- [ ] **Stale docs:** `apps/cortex/AGENTS.md` (dogfooding claim, `cortex-broadcast` gotcha, pitfall 2 vs `run-store.ts:398-429`).

### P2: One agent config (highest structural leverage)

Today a new builder flag costs about 8 Cortex edits (`apps/cortex/AGENTS.md`, "When You Change Cortex"). Target: zero.

- [ ] **Framework (runtime-warden):** promote the 11 overlays to `AgentConfigSchema` leaves with `agentConfigToBuilder` support. `correspondenceCoverage` and `config-serialization-drift.test.ts` pin each one. `agentConfigToBuilder` adds the names of tools it registers itself to `allowedTools`. Terminal options are security-sensitive: keep the "tools-off chat never gets shell" pin.
- [ ] **Framework:** add the `jsonSchema()` helper and `AgentConfig.outputSchema` (closes the code-only gap at `agent-config.ts:360-367`).
- [ ] **Framework:** enrich the manifest (array item and record value shapes, `default`, `group`, `stability`, `x-options-source`).
- [ ] **Cortex (cortex-warden):** `StoredAgent v2` plus a one-time v1→v2 migrator.
  - Golden v1 fixtures must produce identical `toConfig()` output.
  - Keep the v1 reader for one release.
  - One `build(stored, surface)` with presets `chat | desk | gateway | utility`.
  - Delete `BuildCortexAgentParams`, `launchParamsToBuildParams`, `gatewayConfigToBuildParams`, the curated part of `buildChatAgentParams`, and `cortexParamsToAgentConfig`.
  - Parity tests shrink to the golden migration test plus a preset-diff test.
- [ ] **Cortex UI:**
  - `AdvancedFrameworkConfig` becomes the primary panel; curated sections become thin renderers keyed by path.
  - The harness JSON textarea becomes generic `reasoning.harness.*` rows with stability badges.
  - Every quickbar chip goes through one `patchConfig(path, value)`, so "Save chat as agent" is a lossless copy.
  - Add an "effective config" view (preset + user).

**Exit:** a new framework config flag appears in the Lab with no Cortex edit, and the `build-path-parity` tests pass in their reduced form.

### P3: Chat runtime primitives

- [ ] **Paused-turn primitive in `ChatEngine` / `AgentSession`:**
  - A paused turn records 0 turns and holds `{runId, userText}`.
  - Add `session.pending()`, `decide(runId, decision, reason)`, `respond(runId, value)`, and a typed `PendingTurnError`.
  - Pin it with an engine test.
  - Cortex then deletes `settle`, `replyOf` and the eviction workaround, and keeps its 13 `chat-durable-approval` tests green.
- [ ] **`session.compact({ keepLast, summarize })` / `replaceHistory()`, plus the structured summary in `runtime/src/chat/compaction.ts`:**
  - Move `COMPACTION_SECTIONS`, `boundTranscript`, `structureCompactionSummary` and `utilityOutput` with their tests.
  - Add `structuredSummaryOverflow()`, memoized on the dropped prefix.
  - Cortex stops rebuilding the agent on every compaction.
- [ ] **Window-aware history**, budgeted from the model window (same maths as `stages/compact-history.ts:35-42`), with a marker instead of silent drops.
  - This changes what the model sees on every chat, so `ablation-warden` must decide before it is on by default. Until then it is opt-in through `SessionOptions`.
- [ ] **Failure cause on the stream:** `StreamCompleted` (`runtime/src/stream-types.ts`) has no `error` field; only `AgentCompleted.error` has it. Cortex fills the gap from the event bus (`server/services/chat-run-errors.ts`), but every other `runStream` consumer sees only `llm_error`. Add `error` to `StreamCompleted`, then delete the Cortex bus workaround.
- [ ] **Non-streaming chat (tools off) never marks a failed turn:** `session.chat()` exposes neither the run id nor the outcome.
- [ ] **Failed answers steer later turns.** Live repro, 2026-11-10, `mimo-v2.6`: after two "no document loaded" replies, the same question failed again in that session. The model's thoughts cited "the prior assistant said no document". In a clean session it answered correctly after one `find` call. An earlier run also saw the user's own request called "prompt-injection-style". Design question for the chat engine: how failed or abstaining replies, and compaction summaries of failures, are framed in model-visible history. Spike against traces before changing anything.
- [ ] **Goals:** add `GoalSegmentResult.pendingHuman`. A goal whose segment pauses for approval ends paused, not blocked.
- [ ] **Interaction form helpers** (`choiceOptions`, `formFields`, `replyControl`, `formValue`) move to ui-core; `answerText` moves to runtime.

### P4: One token and context vocabulary

- [ ] `estimateTokens` moves into `core`; the other five estimators switch to it one by one. Estimates shift slightly for non-Latin text; tests are updated deliberately, not loosened.
- [ ] `contextLevel` moves into `core`; `emitContextPressure` uses it and emits `windowTokens`. Cortex stops deriving `used + available` in two places.
- [ ] `foldSessionUsage` moves into ui-core; the Cortex server and UI both use it.
- [ ] **Cost entries record wrong halves** (`runtime/src/engine/phases/cost-track.ts:46-47`):
  - `inputTokens` is always 0, because no runtime source writes `ctx.metadata.inputTokens`.
  - `outputTokens` records the run total.
  - Fix: read `readSettledRunSplit`, and make the `CostEntrySchema` halves optional (`cost/src/types.ts:37-38`). Owner: cost package, via `repo scope`.

### P5: ui-core chat client (makes the dogfooding claim true)

- [ ] **Phase A, pure parts:**
  - `foldLiveUsage`
  - turn-stream driver (`apply` injected; rAF scheduler injected, no DOM dependency)
  - `hydrateTurnTrace` (round-trip property test with `finishTurnTrace`)
  - sub-agent projection
  - interaction `endpoint` function
- [ ] **Phase B:** `createChatSession({ endpoints, fetchImpl })` with send, stop, queue, draft and optimistic turns. Includes svelte, react and vue bindings, plus a react/vue smoke test.
- [ ] **Phase C:** Cortex `chat-store` wraps `createChatSession` through `@reactive-agents/svelte`, keeping its REST utilities (fork, rewind, compact). Shared `ChatTurnBubble.svelte` for ChatPanel and RunChatTab. Delete the `framework.ts` barrel.
- [ ] **Guard:** the existing chat-store, chat-stream (×3), chat-queue and chat-draft tests stay green unchanged.

### P6: Capability surface

- [ ] `tools/src/mcp/config-file.ts`: `parseMcpConfigJson`, `loadMcpConfigFile`, `inferHttpTransportType`, `normalizeMcpHttpTransport`. Cortex, the CLI (`run.ts`, `mcp.ts`) and runtime `tool-init-layer.ts` use them. Add `.withMCP({ fromFile })`. Port the Cortex import tests unchanged.
- [ ] `listMcpServerTools` (connect, list, disconnect, with `Effect.ensuring`) and `toolParamsFromJsonSchema` in tools.
- [ ] Skills: Lab listing backed by `discoverSkills`, rooted at the session workspace. Show collisions and the source root of each skill. New test: the skill Lab lists is the one the runtime resolves.
- [ ] `prompts`: canonical tokenizer; `interpolate` delegates to it. `{{ x }}` with spaces now resolves; this is accepted in the changeset.
- [ ] Workspace check adopts `resolveWorkspaceDir`.
- [ ] Lab custom tools labeled "prototype (echo)", with an export as `defineTool` code.

### P7: Operations and observability

- [ ] Gateway `SchedulerService` owns cron decisions for Cortex: per-agent `checkCrons`, timezone, missed-minute catch-up, cost and rate policies. Cortex keeps building and firing the agent.
- [ ] `LifecycleWebhookSink` in gateway (pure select and payload functions, optional HMAC, error sites reported). Port the Cortex unit tests.
- [ ] `trace`: `findRunTrace` / `findRunTreeTraces`. Cortex and diagnose use them, and `CORTEX_TRACE_DIR` becomes an alias.
- [ ] Run view: `GET /api/runs/:id/cause` returns a "Why it ended" card with cause, confidence, evidence and `traceStats` extras. It says when it fell back to the event log. The Runs list gets a cause badge per failed run.
- [ ] "Score run" action using `eval` `runCase` with a judge stub test. Judge cost is shown before running.
- [ ] `renderTranscriptMarkdown` + `formatUsd` in ui-core; removes the server-to-UI import.
- [ ] Retention: coordinate DB run pruning with `pruneTraceDir`.

### P8: Smaller tool surface (owner decision 2026-11-10)

Design basis: [[2026-11-10-tool-surface-leading-practice]] (leading-practice research and decisions). Order: trap census first, then single-tool trap fixes (file-read on a directory, grep literal fallback), then the meta-tool merge behind the ablation gate.

Live Playwright pass, Cortex chat, `ollama/mimo-v2.6` (9B), 2026-11-10:
- **`gh-cli` doubled root.** The model wrote `gh repo view …` and got `gh gh … unknown command "gh"`, 3 times in one run. It also sent `ls` to `gh-cli` and concluded the tool was "a proxy with limited subcommands".
- **`find` returned 4 hits the model never saw.** The kernel object preview reduces `results: [...]` to `Array(3)` (`tool-formatting.ts:563-576`). The model also had no way to learn which documents were loaded, and searching by document name ("README") matched nothing.

In flight (bug fixes, no surface change):
- [ ] Object-envelope preview renders the records of its dominant array (kernel-warden).
- [ ] CLI root healing in the shared runner, plus short errors for wrong subcommands (tools-warden).
- [ ] `find` names the loaded documents, boosts document-name matches, and hints when nothing matches (tools-warden).

Decision: **fold `gh-cli`, `git-cli` and `gws-cli` into `shell-execute` presets.** `shell-execute` already supports `allowedCommands` (`shell-execute-definition.ts:87-89`).
- [ ] **Spike first** (no build until both are known):
  - Count how often the CLI tools are called, and how often they fail, in existing traces.
  - Confirm `shell-execute` with `allowedCommands: ["gh"]` runs on the host with the user's `gh` auth and the workspace cwd, and refuses anything else.
- [ ] **Presets:**
  - Toolset aliases `git` and `workspace` resolve to `shell-execute` with `allowedCommands` `[git, gh]` and `[gws]`, so old configs keep working.
  - The tool description lists the allowed programs.
  - A CLI preset must not imply full host-shell access: it stays scoped even when the terminal is off.
- [ ] **Opt-in first:** deprecate the three tool names (accepted as aliases for one release). `ablation-warden` measures the smaller surface on 2+ model tiers before it becomes the default.
- [ ] **Ollama qwen3.5 tool-call parser (upstream).** Ollama 0.40.15 drops inline `<parameter=…>` blocks: about 17 of 24 direct calls came back with `arguments: {}`. Sometimes it hard-fails instead: `XML syntax error … element <function> closed by </parameter>`. The adapter passes through what Ollama returns (verified). Two follow-ups:
  - Consider a single retry on this provider parse error in llm-provider. It is a general resilience rule, not tied to one model.
  - Owner decides whether to file the upstream issue; repro scripts are in the session scratchpad.
- [ ] **Scoped shell: allow-list instead of more block-list rules.** The git guard now refuses `-c`, `--config*`, `--upload-pack`, `--receive-pack`, `--exec`, `clone -u` and `--exec-path=` (`tools/src/skills/shell-git-guard.ts`). Command-running paths remain open, the same as with the deleted `git-cli`:
  - `git config <key> <value>` writes the repo config (`core.pager`, `core.hooksPath`, `core.fsmonitor`, `alias.x='!cmd'`), and the next git call runs that code.
  - `clone --template=<dir>` / `init --template` copy in hooks, and `post-checkout` runs during the clone.
  - `rebase -x`, `bisect run`, `submodule foreach`, `difftool -x` and `filter-branch` run commands directly.

  Regexes will never be complete. Recommended design: an optional subcommand allow-list per preset (e.g. a read-mostly `git` preset: `status log diff show branch fetch pull push commit add ...`; `gh` read and PR commands), with the full set only when the user opts in. Decide before making the presets the default surface.
- [ ] **A run can end on an intention instead of an answer.** Live, 2026-11-10: three empty `shell-execute` calls (Ollama parser), then the run ended with the reply "I need to call shell-execute with a command parameter. Let me get the git log." That is a thought delivered as the final answer. Check the terminal gate (`finalizeStrategyResult` / exit gate) for "the final text announces a next action and no deliverable exists"; it should continue or abstain honestly.
- [ ] **Ollama adapter call ids.** The adapter ignores the `call_…` id Ollama now sends and makes its own (`local.ts`). Use the provided id when present.
- [ ] **Further consolidation candidates**, same spike-then-ablate rule:
  - `find` and `recall` (the model tried `recall("Cortex README")`).
  - `web-search` vs `find(scope: web)`.

## UI/UX track

Each item ships with the phase that touches its screen.

| Item | Where | Phase |
|---|---|---|
| Run view stays smooth on long runs: incremental folds, `(ts,type,seq)` dedup, rAF batching, replay cursor instead of REST+WS double load | `run-store.ts:282,291`, `trace-store.ts:96`, `timeline-store.ts:82`, `signal-store.ts:49` | P1 (perf) |
| Ring after compaction: label it "history only" or add the system-prompt size, so it doesn't drop and then jump back | `compaction-summary.ts:114`, ChatContextMeter | P0/P1 |
| Offer `/compact` when the context level reaches high or critical | ChatContextMeter | P1 |
| Billed, reasoning and cache totals show `~ partial` when older turns lack usage | `chat-session-context.ts:94-99` | P0 |
| Desk approval deny asks for a reason (currently fixed "Denied from Cortex") | `approval-watcher.ts:37` | P1 |
| Resume after config drift: specific message instead of a generic failure | `chat-approvals.ts:337` | P1 |
| Beacon: push approvals and interactions over the broadcast WS instead of three polls; pending badge on agent nodes | `approval-watcher.ts:47`, `interaction-watcher.ts:22`, `+layout.svelte:234` | P5 |
| Chat `request_user_input` pauses appear in the desk interaction list | AGENTS.md pitfall 6 | P3 |
| Queued message stays visible and editable after a stop or error | `chat-queue.ts:40-48` | P5 |
| Schedules show timezone and next fire time | Lab, chat schedules | P1 |
| "Why it ended" card and cause badges | RunOverview, Runs list | P7 |
| Lab: generic rows replace the harness JSON textarea; stability badges; effective config view | AgentConfigPanel | P2 |
| Lab tools: discovery failure reason on the server row; prototype label; skill source root and collisions | ToolWorkshop, skills tab | P1/P6 |

## Decisions for the owner

1. **Window-aware chat history (P3).** Leaving it on by default changes what every chat model sees. Recommended: ship opt-in, run `ablation-warden`, and flip the default only on a PASS.
2. **Stored config migration (P2).** Recommended: keep the v1 reader for one release, gated on golden fixtures.
3. **`totalTokens` when both halves are unknown.** It stays a required number (0). Recommended: accept this for now and revisit with the provider consumers.
4. **Provider honesty scope.** Provider-warden applied the "unknown, not 0" rule to openai, litellm and gemini as well as Ollama. Recommended: keep, and say so in the changeset.
5. **Eval "Score run" (P7).** Judge calls cost money. Recommended: an explicit per-run button with the cost estimate shown first; no automatic scoring.

## Verification per phase

- `bun run repo verify <pkg>` for every touched package; `bun run repo check --all`; `bun run build`.
- Cortex: server tests, UI lib tests, `svelte-check`, and a live browser pass on a separate port and DB.
- Moves: tests travel with the code unchanged. A test may change only when the change is a deliberate, changeset-documented behavior shift.
