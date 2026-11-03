---
type: audit-report
status: draft
created: 2026-11-03
tags: [harness, oss-survey, termination, recovery, tool-surface, compaction, long-horizon, convergence]
plan: "[[../../Planning/Implementation-Plans/2026-11-02-harness-convergence]]"
inputs: "[[../Audit-Reports-2026-11-02/harness-leverage-diagnosis]], [[../Audit-Reports-2026-11-02/long-horizon-and-termination-authority]]"
---

# OSS harness landscape vs Reactive Agents (2026-11-03)

Read-only survey. Shallow clones (read only, nothing executed) in `$CLAUDE_JOB_DIR/tmp/oss/`. Evidence tags: **[V]** read in source at the cited path:line, **[W]** web doc, **[U]** not verified. This is a code-reading survey, not a performance comparison: it says what each harness *does*, never that it *works better*. No lift claim is made; every proposed change still goes through the Plan 8 lift rule.

## 0. Repos and SHAs

| Harness | Repo @ SHA | Read |
|---|---|---|
| Codex CLI | openai/codex @ f05aa41 | `codex-rs/core/src/session/turn.rs`, `context_window.rs`, `responses_retry.rs`, `tools/spec_plan.rs`, `compact*.rs`, `rollout-trace/` |
| OpenCode | sst/opencode @ 3ba597f | `packages/core/src/session/runner/{llm,max-steps}.ts`, `session/compaction.ts`, `model-retry.ts` |
| Aider | Aider-AI/aider @ 5dc9490 | `aider/coders/base_coder.py`, `history.py` |
| OpenHands | OpenHands/software-agent-sdk @ 77e7ce7 (the `OpenHands/OpenHands` repo @ 952e45c is GUI-only now) | `conversation/{stuck_detector.py,impl/local_conversation.py}`, `context/condenser/`, `critic/` |
| mini-swe-agent | SWE-agent/mini-swe-agent @ 04d809c | `agents/default.py`, `environments/local.py` |
| Goose | block/goose @ cfb67d7 | `crates/goose/src/agents/{state_machine/*,retry.rs,moim.rs,final_output_tool.rs}`, `tool_monitor.rs`, `context_mgmt/mod.rs` |
| smolagents | huggingface/smolagents @ 96f33fa | `src/smolagents/agents.py` |
| LangGraph | langchain-ai/langgraph @ 3c916d7 | `libs/prebuilt/.../chat_agent_executor.py`, `tool_node.py`, `pregel/main.py` |
| Hermes Agent | NousResearch/hermes-agent @ c314285f (verified: the agent harness - `run_agent.py`, `agent/conversation_loop.py`, `tools/`, `skills/`, gateway - not the Hermes model family) | `agent/AGENTS.md`, `agent/{iteration_budget,turn_stop_gates,verification_stop,turn_recovery_autorecover,turn_overflow,turn_iteration_prep,background_review,curator,context_compressor*}.py`, `tools/{todo_tool,tool_search,delegate_tool}.py`, `toolsets.py` |
| Anthropic guidance | [W] anthropic.com/engineering/effective-harnesses-for-long-running-agents | fetched summary only |

Not covered: SWE-agent (full, only its successor mini), Cline/Roo, pi-mono, Claude Agent SDK loop semantics. [U]. No claim below depends on them.

## 1. Per-harness findings (answers to the 8 questions)

### 1.1 Codex CLI (Rust)
1. **Done/stop.** Model-driven: the turn ends when a sampling request yields no tool call and no queued input (`needs_follow_up = model_needs_follow_up || has_pending_input`, `core/src/session/turn.rs:637`; exit branch `:751`). The only deterministic gate is a **Stop hook** that can *block* the stop and inject a continuation prompt (`turn.rs:751-790`, `hook_runtime.rs:375`). No iteration cap grep hit in `turn.rs` [V: grep `max_turns|max_steps` empty]. Cost bound is token budget + user interrupt.
2. **Recovery.** Layered and *transport-first*: stream retry with backoff and `Retry-After` (`responses_retry.rs:121-160`), separate connection-retry counter with doubling delay (`:100-118`), websocket->HTTPS fallback after retries exhaust (`:121-139`). Context overflow: pre-emptive compaction when `token_limit_reached` (`session/context_window.rs:102-118`) and mid-turn roll-over `if should_roll_over { run_auto_compact(...ContextLimit, MidTurn) ; continue }` (`turn.rs:687-745`), with an explicit comment that loop safety rests on compaction landing well below the limit (`:700`). Background pre-computed compaction (`async_compaction.rs`, `maybe_start` at `turn.rs:640`).
3. **Tool surface.** Per-tool `ToolExposure` enum: Direct / Deferred / CodeMode / Hidden; when the model supports a search tool, deferrable (MCP/app) tools are removed from the direct prompt and reached via `tool_search` (`tools/spec_plan.rs:262-320`, search tool at `:424-452`). MCP spec bytes capped per tool and in total (`mcp_tool_exposure.rs:19-20`: 8k/tool, 64k total for agent-plugin MCP) [V].
4. **Plan/todo.** `update_plan` tool behind a config flag (`spec_plan.rs:1332`); model-owned, informational; I did not find harness enforcement [U beyond the flag].
5. **Context.** LLM summarization with a fixed `SUMMARY_PREFIX` template (`compact.rs:62,408`, `prompts/templates/compact/prompt.md`), user messages retained up to 20k tokens (`compact.rs:63`), remote compaction v2 with image budget, retained client-authored tool outputs (`compact_retained_tool_outputs.rs`).
6. **Long-horizon.** Rollouts persisted and reconstructed (`session/rollout_reconstruction.rs`), thread store, subagents (`multi_agents.rs`), guardian reviewer sub-session (`guardian/`), worktrees.
7. **Observability.** Dedicated `rollout-trace` crate: raw bundle + reducer to a replayable model with inference attempt, compaction checkpoint, tool-dispatch and code-cell spans (`rollout-trace/src/lib.rs:1-40`); `post sampling token usage` trace carries the exact decision inputs (`turn.rs:652-668`).
8. **Knobs.** Config/TOML: auto-compact limit and *scope*, post-turn compact percent, per-tool exposure, hooks (Stop, interrupt, session-start), exec policy, sandbox.

### 1.2 OpenCode (TS/Effect, closest cousin to us)
1. **Done/stop.** Model decides, bounded by per-agent `steps`. At the step limit it does **not** error: it appends a `MAX_STEPS_PROMPT` ("tools are disabled... MUST provide a text response summarizing work done, remaining tasks, next steps") and sets `toolChoice: "none"` while keeping tool defs for the cached prefix (`session/runner/llm.ts:238-262`, `runner/max-steps.ts`). Terminal state is therefore always a model-authored handoff, never a bare cap error.
2. **Recovery.** Typed step outcomes `Completed | Retry | Continue | OutputLimit | Compacted | RecoverFull` pattern-matched in one place (`llm.ts:316-375`). Overflow: provider rejects -> `compaction.compact({reason:"overflow"})` with a *tighter* budget (`SHRINK_STEPS[0]` of the failed estimate, `compaction.ts:313-318`) -> retry once (`recoverOverflow` latch, `llm.ts:238,308-317,363`). Truncated stream/output-limit -> inject a synthetic "continue" message; three consecutive `finish:"length"` assistants -> fail (`llm.ts:337-365`). Retry schedule with capped provider `retry-after` (`model-retry.ts:11-35`); one-shot calls retry only if the provider provably never ran them (`:75-101`).
3. **Tool surface.** Per-agent tool allow-lists via `loaded.tools`; plugin tool system; no deferred search found in the paths I read [U].
4. **Plan/todo.** `todowrite` is an ordinary model-owned tool (`tool/todowrite.txt`, `tool/plugin/todo.ts`); harness does not gate on it [V by absence in runner].
5. **Context.** Auto compaction when estimate exceeds ceiling (`compaction.ts:300-306`), native provider compaction when the model supports it, background `precompute` while idle (`llm.ts:247,318-323`), crash-safe settle of half-finished compactions (`llm.ts:386-410`).
6. **Long-horizon.** Sessions in SQLite, event-sourced message projector, subagent jobs (`session/subagent-job.ts`), revert/snapshot (`session/revert.ts`, `snapshot.ts`).
7. **Observability.** Every state change is a published event (`SessionEvent.Compaction.Started`, `Synthetic`, ...), persisted; compaction itself is a first-class message row.
8. **Knobs.** `permission.doom_loop` is a permission *action* (ask/allow/deny) (`v1/config/permission.ts:27`) - loop detection is escalated to the user, not auto-terminated. `compaction` config plugin, `agent.steps`.

### 1.3 Aider
1. **Done/stop.** Model ends a turn by not editing. Deterministic *reflection* loop: after edits, lint and test run, and failures become the next user message; hard cap `max_reflections = 3` (`coders/base_coder.py:100-101,924-944,1596-1625`). Completion truth = lint/test pass (user confirms "attempt to fix").
2. **Recovery.** Reflection is the recovery primitive: bad edit-format, missing file, lint error, test error all route to `reflected_message` (`:1563,2315,2327`). Context overflow: `ContextWindowExceededError` caught, counted, message to user (`:1464,1546,1815`) - no auto-heal [V: no retry].
3. **Tool surface.** No tools: edit-format text protocol; repo-map (tree-sitter + PageRank-style ranking) sized by `map_tokens` (`repomap.py:49,70`). The "surface" is a token-budgeted code index, not schemas.
4. **Plan/todo.** None.
5. **Context.** Recursive LLM summarization of old history in a background thread (`history.py:27-96`, `base_coder.py:1002-1024`).
6. **Long-horizon.** Git auto-commit per edit = rollback (`auto_commit`).
7. **Observability.** Chat history file, analytics; weak trace [U].
8. **Knobs.** `--auto-lint/--auto-test/--test-cmd`, `--map-tokens`, edit format.

### 1.4 OpenHands SDK (Python)
1. **Done/stop.** Model calls `finish` -> status FINISHED; then **Stop hook** may deny and inject feedback, loop continues (`conversation/impl/local_conversation.py:2038-2068`). Optional **critic** (`critic/impl/{agent_finished,empty_patch}.py`, `critic/base.py:20-78`) scores the result; `IterativeRefinementConfig(success_threshold, max_iterations)` re-runs the agent when the score is under threshold. Hard cap `max_iteration_per_run=500` -> ERROR (`:238,2112-2126`).
2. **Recovery.** `StuckDetector` (repeat action/observation, action->error streak, monologue, alternating pattern; `stuck_detector.py:109-157,385-412`). Key design: on an action-error streak it **nudges once per streak** with the exact error and "try a different approach" (`:343-382`, `_last_nudged_error_event_id`), and only then falls to `is_stuck()` -> STUCK status (`local_conversation.py:788-807`). Validation errors are distinguished from execution errors in the nudge text.
3. **Tool surface.** Static + MCP; summary-param feature [U beyond that].
4. **Plan/todo.** Task-tracker tool, model-owned [U].
5. **Context.** `LLMSummarizingCondenser(max_size=240 events, keep_first=2)` rolling, `PipelineCondenser` composition, no-op condenser (`condenser/llm_summarizing_condenser.py:64-90`); a `Condensation` is an event in the log.
6. **Long-horizon.** Persisted event log/conversation, subagents (`sdk/subagent`), confirmation/pause states.
7. **Observability.** Everything is an event; `sdk/observability`.
8. **Knobs.** `stuck_detection` on/off + thresholds mapping (`:239-241,529-536`), condenser choice, critic, hooks.

### 1.5 mini-swe-agent (the minimal control)
1. **Done/stop.** Model prints `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT` as the first output line with return code 0; env raises `Submitted` (`environments/local.py:46-54`). Limits: `step_limit`, `cost_limit=3.0`, `wall_time_limit_seconds` (`agents/default.py:31-37,125-139`). No other stop logic.
2. **Recovery.** Format error -> error text becomes the next observation; `max_consecutive_format_errors=3` then exit `RepeatedFormatError` (`default.py:97-117`). Counter resets on any clean step. Trajectory saved in `finally` every step (`:119`).
3-5. Bash only; no todo; no compaction (messages list grows; limits are the guard). The whole agent is 190 lines. It is the proof that structure outside the loop (format retry + 3 budgets + persisted trajectory) is the irreducible core.
8. Everything in one Jinja/YAML config; `query`/`step`/`execute_actions` are override points.

### 1.6 Goose (Rust) - the most explicit composition model
1. **Done/stop.** The turn is an ordered list of **Operations** (`agents/state_machine/ops_*.rs`): `retry`, `stop_hook`, `maxturns`, `empty_response`, `compaction`, `tool_pair_compaction`, `steer`, `exit_on_error`, `remaining_tool_calls`... each `Operation::run -> applied | not_applicable | yielded`. Recipe `retry` has **deterministic `SuccessCheck::Shell` commands**: model finishing is not accepted until the checks exit 0; otherwise error is fed back; `max_retries` then fail with `retry_max_exceeded` (`agents/retry.rs:14-40`, `ops_retry.rs:223-256`; `types.rs:11-31`). `final_output` tool must be called alone and its output is schema-validated (`final_output_tool.rs:11-16`).
2. **Recovery.** Retry-with-checks above, plus optional `on_failure` shell command (reset/rollback hook, `retry.rs:134`). `max_turns` ends the turn with a *question to the user*, not a failure (`ops_maxturns.rs:10`). `RepetitionInspector` blocks N identical consecutive calls (name+args) at the tool-inspection layer (`tool_monitor.rs:35-80`), i.e. as a tool *denial*, not a run terminator. `/grind` makes max_turns the only stop (`execute_commands.rs:47-49`).
3. **Tool surface.** Extension-managed MCP; large tool responses redirected to files (`agents/large_response_handler.rs`); schema normalization (`tool_schema_normalize.rs`). No deferred search found [U].
4. **Plan/todo.** `todo` platform extension (model-owned) [U detail]. **MOIM** ("model-owned... in-message" per-turn tagged context) injects harness facts each turn, e.g. `<turn-budget>N/M used</turn-budget>` once half the budget is spent (`moim.rs:155-165`, `ops_maxturns.rs:35-45`). Operations contribute `moim_parts`: a uniform channel for guidance.
5. **Context.** Threshold compaction (`context_mgmt/mod.rs:29-52,271-320`), threshold capped by a token limit, tool-pair summarization (summarize only old tool call/result pairs, `:414-430`).
6. **Long-horizon.** Sessions, scheduler (`scheduler.rs`), subagents (`subagent_handler.rs`), recipes.
7. **Observability.** otel + tracing modules; `yielded_with` reasons [U depth].
8. **Knobs.** Recipe `retry{max_retries,checks,on_failure}`, `settings.max_turns`, hooks, mode.

### 1.7 smolagents
1. **Done/stop.** `final_answer` tool; user-supplied `final_answer_checks: list[Callable]` run on the candidate answer; a failing check raises an AgentError which becomes the next step's error and the loop continues (`agents.py:587-590,612-621`). So termination acceptance is a typed, user-composable predicate list.
2. **Recovery.** Model-caused `AgentError` is stored on the step and the loop iterates (`:597-598`); generation (implementation) errors re-raise (`:595-596`). At `max_steps` it runs `provide_final_answer` over a summary-mode memory: an extra LLM call that writes the best answer instead of returning nothing (`:606-607,625-640,810-886`); state `max_steps_error` is reported.
3. Tool surface static. 4. **Plan:** `planning_interval=N` runs a *harness-scheduled* planning step every N steps, given `remaining_steps` (`:550-552,639-707`) - plan ownership is the harness's cadence, content is the model's.
5. No compaction beyond `summary_mode`. 6. Memory steps list. 7. Step callbacks (`step_callbacks`, `_finalize_step`). 8. `max_steps`, `planning_interval`, `final_answer_checks`, `step_callbacks`.

### 1.8 LangGraph prebuilt ReAct
1. **Done/stop.** Conditional edge: no tool calls -> END. Step budget as *data in state*: `remaining_steps` (`chat_agent_executor.py:62,74`); when `remaining_steps < 2` and the model still wants tools the agent returns a canned "need more steps" message instead of raising (`:627-632`). Graph-level `recursion_limit` -> `GraphRecursionError` (`pregel/main.py:3098-3104`).
2. **Recovery.** `ToolNode(handle_tool_errors=...)` default converts tool exceptions into a ToolMessage with the error text so the model sees it (`tool_node.py:126,391`); type-filtered or custom handler. Durable execution: **checkpointer** (`libs/checkpoint*`) saves state per super-step, enabling resume/time-travel/interrupt-for-human (`prebuilt/interrupt.py`).
3-5. Static tool list; no compaction in the prebuilt; `pre_model_hook` for trimming (`chat_agent_executor.py:636`).
8. Everything is a graph node/edge; hooks `pre_model_hook`, `post_model_hook`.

### 1.9 Anthropic long-running harness guidance [W]
Initializer session writes `init.sh`, `claude-progress.txt`, a JSON **feature list with `passes:false`** that later sessions may flip only after end-to-end testing and may *not* edit or delete ("unacceptable to remove or edit tests"). JSON chosen because the model is less likely to overwrite it than Markdown. Each session: read git log + progress file, run a smoke test, do one feature, commit. "Done" = every feature verified passing, not the agent's declaration.

## 1.10 Hermes Agent (Nous Research) - own section

Scale note: the repo is very large (agent/ alone ~359 files; `context_compressor.py` 5.7k lines, `turn_recovery.py` 2.0k). It is a product (CLI, TUI, gateway to 20+ chat platforms, cron, kanban, plugins), not a minimal harness. Popularity figures in web listings vary 44k-212k stars and are marketing-grade [W, unverified]. **Success evidence is adoption, not a benchmark I could check [U]; the claims below about *why* it succeeds are my reading of design, not measured.**

1. **Done/stop.** Plain loop: `while (calls < max_iterations and budget.remaining > 0) or _budget_grace_call` (`agent/AGENTS.md` loop block; real condition `conversation_loop.py:1746`). Model text answer ends it **unless a stop gate vetoes**: `turn_stop_gates.py:1-12` - four gates (late LSP verdicts on this turn's edits, verify-on-stop, `pre_verify` plugin hook, kanban terminal-tool guard) append the candidate answer as an interim row plus a user nudge and continue; the candidate is kept as a fallback if budget runs out (`pending_verification_response`). `verification_stop.py:1-3`: policy-only guard that turns a *passive verification ledger* into a bounded follow-up when the model tries to finish right after editing code without fresh evidence; prose-only edits suppress it (`:28-34`); an unattributed check run "did not count" (`:20-26`). This is deterministic evidence-gated acceptance, bounded by `max_verify_nudges`.
2. **Recovery.** Most developed in the survey. (a) Error classifier -> `FailoverReason` (`agent/error_classifier`), fallback model chain, credential pool rotation. (b) Post-exhaustion **auto-recover ladder** (`turn_recovery_autorecover.py:1-14`): after retries and fallbacks are spent, for overloaded/5xx/timeout only, no answer text delivered yet, the turn *parks with a visible countdown* and re-enters the retry loop; 5 cycles, jittered 15/30/60/60/60s, `Retry-After` honoured to 120s; non-retryable classes (auth, format, billing, overflow) excluded. (c) Overflow: 413/context-length -> compress -> restart turn, with soft deferral on compression lock and typed exits (`turn_overflow.py:1-9`); a provider "context exceeded" under 50% of the known window is treated as *unexplained*, not as overflow (`:35-37`) - an instrument-doubt check. (d) Truncation handling and one toolless **grace call** at budget exhaustion (`turn_iteration_prep.py:408-411`, `turn_truncation.py:581,641`). (e) Empty-response handling as its own phase (`turn_empty_response.py`). (f) Optional budget warning injected at a configurable ratio (`turn_iteration_prep.py:48-98`, `budget_warning_ratio`).
3. **Tool surface.** Named toolsets (`toolsets.py:1-30`, `_HERMES_CORE_TOOLS`, `enabled_toolsets/disabled_toolsets`) gated per platform/session. **Progressive disclosure** (`tools/tool_search.py:1-9`): MCP/plugin tools and a curated set of event-triggered core tools are replaced in the model-visible array by three bridge tools `tool_search / tool_describe / tool_call`; core tools never defer unless named in `tools.tool_search.defer`; catalog is stateless, rebuilt each assembly (a session-keyed one "drifts and silently drops tools"). Like Codex, deferral is model-driven search.
4. **Plan/todo.** `todo_list` is model-owned but **harness-hardened state**: revisioned (monotonic revision rejects stale UI writes), capped (256 items, 4000 chars), validated/deduped/ordered, and **re-injected after every compression** under a stable header the compressor recognizes (`tools/todo_tool.py:1-30`). Not a guard input. Agent-level tools are intercepted via an `INLINE_TOOL_EXECUTORS` table (no `if name ==` chains, `agent/AGENTS.md`).
5. **Context.** Hard invariant: **system prompt byte-stable for the whole conversation to protect the prefix cache; compression is the only sanctioned cache break**; all mid-run injection rides a user message or tool result; strict role alternation (`agent/AGENTS.md` "Message-flow invariants"). Compression: prune old tool results first with no LLM call, choose boundaries, then a structured summary by a separate cheap *auxiliary* model; per-model thresholds (default 50%), failure cooldown after provider-proven overflow, deterministic fallback summary on repeated summarizer stall (`agent/AGENTS.md` "Compression"; `context_compressor.py:2025-2049`). `SUMMARY_PREFIX` history (`:258-270`) records a real regression: "REFERENCE ONLY" framing bled into suppressing tool use (7 narration-only turns after compaction), fixed by an explicit "tools remain fully active" clause.
6. **Long-horizon / learning loop.** SQLite session store (`hermes_state_*.py`, ~70 files), cron, kanban workers, `/steer`. **Learning loop**: after turns, `background_review.py:1-8` forks the agent (same provider/prefix cache, dispatch-side tool whitelist) to ask "should any skill/memory be saved or updated?" and writes straight to skill/memory stores. `curator.py:1-8`: inactivity-triggered (no cron) skill maintenance; *deterministic* lifecycle transitions always on (stale 14d, archive 30d, `:34`), LLM consolidation fork **opt-in** (`DEFAULT_CONSOLIDATE = False`), never delete (archive, recoverable), pinned skills exempt. Skills have provenance, lint, ledger, hub install, AST audit (`tools/skill_*`, `skills_guard.py`).
7. **Subagents.** `delegate_tool.py:1-12`: child AIAgent with fresh conversation, own task_id, parent's toolsets minus child-blocked tools; parent sees only the call and the summary result; per-child `delegation.max_iterations` (default 50) with own `IterationBudget`, so total can exceed parent's 500 (`iteration_budget.py:1-7`); `execute_code` iterations refunded (`:25-35`).
8. **Observability/knobs.** Hooks: `pre/post_api_request`, `pre/post_auxiliary_call` (observer-only, fail-open, aux calls deliberately excluded from main-loop events, `agent/AGENTS.md`), lifecycle hooks, trajectory saving (`save_trajectories`, `trajectory_compressor.py`), `evals/` directory of regression probes. Config: `config.yaml` with `auxiliary:` per-task model routing, `compression.*` thresholds, `delegation.*`, `tools.tool_search.defer`, `agent.auto_recovery_cycles`, toolsets, plugin points (memory provider, context engine, model provider).

### Which Hermes ideas plausibly explain adoption (hypotheses, not measurements)
| Idea | Likely contribution | Basis |
|---|---|---|
| Learn-from-use loop (review fork writes skills/memory; curator prunes deterministically) | **Probably the headline differentiator**: users feel it getting better with use | Design; adoption claims in listings [W] |
| Reach: gateway to many chat platforms, cron, persistent daemon | Large, independent of loop quality | Repo layout |
| Reliability engineering of the unglamorous paths (recovery ladder, overflow, truncation, empty response, grace call, cache invariants) | Plausible driver of "it keeps going and doesn't die" feel; thousands of lines devoted | `turn_*.py` file list |
| Prefix-cache discipline (byte-stable system prompt, only compression breaks it) | Cost/latency win, testable | `agent/AGENTS.md` |
| Verify-on-stop with a passive evidence ledger | Directly reduces premature "done" in coding; the evidence ledger is the same idea as our RunLedger | `verification_stop.py` |
| Todo as hardened, compression-surviving state | Plausible; no guard coupling | `todo_tool.py:1-30` |

### Adopt / adapt / skip for Reactive Agents
- **Adopt: cache-invariant discipline (no mid-run system-prompt mutation).** Our `pendingGuidance` is rendered into the system prompt `Guidance:` section every turn (AGENTS.md pitfall 9), which changes the prefix each turn. Hermes forbids exactly this. Needs a measurement first (cached-token share by provider), then move guidance to a trailing tool-result/user-role slot if the prefix is being broken. High leverage on cost for cloud tiers; tie to H4 billed-token accounting.
- **Adopt: post-exhaustion recovery ladder in the provider layer** (transient classes only, bounded cycles, visible, interruptible) instead of surfacing `kernel_error`. Matches G10; provider-warden task.
- **Adopt: "unexplained overflow" check** (reject-under-50%-of-window means the instrument/estimate is wrong, not the transcript). Direct application of our instrument-before-conclusion rule to the T2 numCtx problem.
- **Adapt: verify-on-stop.** We already have the terminal gate + ledger (stronger: typed contract). Take only the behavior: finishing after file mutation with no fresh evidence run converts the stop into one bounded nudge, answer kept as fallback. Fold into G2's accept list as a built-in `freshEvidenceAfterMutation` check; cap nudges.
- **Adapt: compression-surviving todo/checklist re-injection with a stable header** (we have ledger render; confirm the checklist survives `compaction.ts` protected classes).
- **Adapt: curator-style deterministic prune over our skills/experience store** (`withSkillPersistence`, `withExperienceLearning`, `withSelfImprovement`): deterministic lifecycle (stale/archive, never delete, pin) on, LLM consolidation off by default. Fits "deterministic over LLM".
- **Adapt (carefully): background review fork** -> we have `withLearning`/ExperienceStore; the Hermes version is an LLM judgment writing skills with no accuracy evidence I could find. Per our lift rule it must be opt-in until ablated on a repeated-task suite (does run N+1 beat run N?). Do not copy the 1.4k-line implementation.
- **Adapt: per-subagent iteration budget with explicit parent/child accounting** (our recursion cap is live; check child budget visibility in receipts).
- **Adapt: separate cheap auxiliary model for compression/summaries** as `withModelRouting` task slot, only if G4's LLM-summary experiment is run.
- **Skip: three-bridge-tool deferral** (`tool_search/describe/call`) - same model-driven cost we measured for `discover-tools`; use harness-side ranking (G5).
- **Skip: scale of the turn machinery** (20+ `turn_*.py` phases, 70 state files, `*_scratch_stuck.py` leftovers at repo root). The phase-per-file split is a good idea; the volume is a maintenance warning, and nothing here shows the volume is what makes it succeed. Our AGENTS.md rules (simplicity, delete over add) apply.
- **Skip: gateway breadth** as a framework goal; our `channels`/`gateway` packages already cover the architecture.

## 2. Cross-cutting synthesis

| Question | Pattern across the field |
|---|---|
| Who decides done | **Model proposes, a deterministic party disposes** in 5 of 8 (Codex Stop hook, Hermes verify-on-stop/pre_verify gates, OpenHands stop-hook+critic, Goose SuccessCheck shell, smolagents `final_answer_checks`, Aider lint/test, Anthropic `passes` list). Nobody lets heuristics (entropy, content-stable, regex) *declare* done. |
| Cap behaviour | Never a bare error. OpenCode (tools off + forced summary), smolagents (`provide_final_answer`), LangGraph (canned message), Goose (ask the user). Only mini-swe and OpenHands hard-error. |
| Stall handling | Detection is *advisory first*: OpenHands nudges once per streak, Goose denies the repeated call, OpenCode asks via permission. Only after that, terminate. Arg+name equality (Goose) is the cheapest guard; they do not count meta-tool churn because they have no harness-visible progress notion at all. |
| Overflow | Hermes: classify->compress->restart, plus unexplained-overflow check. Reactive (provider rejects) + proactive (threshold) with a *tighter* second attempt (OpenCode), mid-turn roll-over (Codex), background precompute (Codex, OpenCode, Aider). LLM summarization is the universal choice. |
| Tool surface | Only Codex and Hermes do real deferral (both model-driven search; Codex adds an exposure enum). Nobody else manages the schema budget; mini/Aider/smolagents avoid the problem via bash/text protocols. |
| Todo | Always a plain model tool, never a guard input. Only Anthropic's guidance makes the list *harness-protected state* (edit-restricted JSON). |
| Reliability tail | Hermes alone invests heavily: post-exhaustion wait-and-retry ladder, grace call, empty-response and truncation phases, cache-stability invariant. |
| Learning | Hermes alone has a post-turn review fork + deterministic curator; no one else learns across runs by default. |
| Observability | Codex `rollout-trace` + OpenHands/OpenCode event logs: trace == state. |
| Composition | Goose Operations list, OpenHands condenser pipeline + stop hooks, smolagents callbacks, LangGraph nodes. Pattern: ordered, individually removable units with a uniform result type. |

## 3. Reactive Agents baseline (what we do) [V unless noted]

- Terminal reasons: 26+ in `kernel/loop/terminate-reason.ts:24-93` including `end_turn`, `final_answer_regex`, `entropy_converged`, `content_stable`, `low_delta_guard`, `loop_graceful`, `oracle_forced`, `max_iterations`, `kernel_error`, `abstained`, `budget_terminal`. Deciders: `decide/{terminal-gate,termination-resolver,arbitrator(850),authority}.ts`, `runner-terminal-verify-gate.ts`, `terminate.ts` (196, single funnel for the label). Plan 8 K1/L4 already target "guards propose, gate disposes".
- Progress: pure `progress-arbiter.ts` (design law #5; classifies meta/pseudo/no-op/give-up), `assess.ts` (535) with `evidenceDelta`, `guard-adapters.ts`, `pace-actions.ts`. Rich; the weak spot per the 11-02 reports is that the stall counter still accrues on meta calls and low-delta/stall are horizon-gated.
- Compaction: pure re-projection with protected classes, honest stubs enumerating recall refs, no-shrink self-check (`assembly/compaction.ts:1-30`); **no LLM summarization** in this path.
- Recovery: M3 "retry loop removed per ablation verdict" (`runner.ts:576`); provider layer has circuit breaker + `withRetryPolicy`/`withFallbacks`. I found no overflow->compact->retry-once path in kernel/runner (grep `ContextOverflow|context_length` hit only `llm-provider/src/errors.ts`) [partly U: may live in the Ollama/provider adapters].
- Surface: `resolve-think-surface.ts`, `discover-tools` meta-tool (model-driven), static 24-tool schemas per diagnosis; Plan 8 T1 proposes harness-side top-k.
- Knobs: ~95 builder withers (`withHarness`, `withStallPolicy`, `withLongHorizon`, `withCustomTermination`, `withRequiredTools`, `withContract`, `withBudget`...), `withHarness({...})` typed control.
- Observability: fact-level traces, `assessment` per iteration, `guard-fired`, ledger signals, rax-diagnose, replay package. This is the strongest in the field except Codex's reducer model.

## 4. Where we are already as good or better (do not "fix")

1. **Trace/replay/diagnose stack** (`packages/trace`, `replay`, `diagnose`, per-iteration assessment): equal to Codex rollout-trace, ahead of everyone else's logs. Keep; do not add a second event system.
2. **Progress predicate**: no surveyed harness classifies meta/no-op/give-up as non-progress. `progress-arbiter.ts` is ahead (the gap is its *consumers*, not the predicate).
3. **Honest compaction** with enumerated recall refs and protected classes is more careful than any "summarize and hope" implementation surveyed. Its weakness is information loss (no LLM summary) - see G6.
4. **Typed terminal outcome / receipt** (`terminal-outcome.ts`, `result.receipt`): ahead of the field (no one signs provenance). 
5. **Deterministic over LLM**: `final_answer_checks`/SuccessCheck show the field converging on what AGENTS.md rule 5 already says.
6. **Sub-agent fiber forking with cancellation**: on par with Codex/OpenHands.
7. Our abstention path is a real feature; no surveyed harness has an honest "cannot do this" terminal.

## 5. Ranked gap list

Ranking = (frequency across harnesses) x (match to our diagnosed failure) x (convergence potential: deletes/merges more than it adds). Each row states what they do, what we do, the change, the surface, the ablation.

### G1. A cap or guard exit must hand off, never bare-fail. (HIGH; converge)
- **They:** OpenCode `MAX_STEPS_PROMPT` + `toolChoice:"none"` final turn (`llm.ts:238-262`); smolagents `provide_final_answer` (`agents.py:625-640`); LangGraph canned message; Goose asks the user.
- **We:** `max_iterations`, `low_delta_guard`, `loop_graceful`, stall, `oracle_forced` are distinct terminals; the 11-02 report shows runs ending at cap with `evidenceDelta>0`. We have `budget_terminal` synthesis already.
- **Change:** route *every* non-model terminal (max_iterations, stall, low_delta, loop) through the existing `budget_terminal` synthesis turn (tools disabled, ledger-grounded "done / remaining / next" handoff) and let the terminal gate label it `partial`. Delete the per-guard bespoke exit text. This is L4+L6 collapsed into one rule: guards are proposals; the one exit is "synthesize handoff". Keeps tool defs in the request for prefix-cache stability (OpenCode detail).
- **Surface:** none new; existing `withBudget`/`withStallPolicy`; one enum `onExhaustion: "handoff" | "fail"` on `withHarness` only if ablation needs a flag-off arm.
- **Ablate:** H3/L1 suite, arm A0 HEAD vs A1 "all caps -> handoff"; metric = deliverable rate + honest-label rate (not accuracy alone); tokens +1 call/run expected.

### G2. "Propose / dispose" with user-composable acceptance checks. (HIGH; converge + one small API)
- **They:** Goose `SuccessCheck::Shell` (`retry.rs:14`, retry loop with `max_retries`), smolagents `final_answer_checks` (`agents.py:587,612`), OpenHands stop-hook/critic (`local_conversation.py:2038`), Codex Stop hook (`turn.rs:751`).
- **We:** terminal gate + RunContract + `withCustomTermination` + `withVerification` + `withOutputValidator` + `withBehavioralContracts` - at least five overlapping acceptance mechanisms.
- **Change:** one `AcceptanceCheck[]` list (pure predicate or effectful) consumed only by the terminal gate; a failing check becomes the next-turn feedback and counts against one `maxRejections` (Goose `max_retries`). Re-express `withOutputValidator`, `withCustomTermination`, contract-deliverable gate as entries in that list (deprecate, do not add a sixth). Shell/command check is the highest-value built-in because it is deterministic and model-agnostic.
- **Surface:** `.withHarness({ accept: [...] , maxRejections })` (no new opener per developer-first rule).
- **Ablate:** presence of a failing-then-passing check on debug-to-green tasks (L1); metric = false-accept rate.

### G3. Stall/loop: nudge-once-then-deny, keyed on (name,args,error), never terminate on meta churn. (HIGH; delete/merge)
- **They:** OpenHands one nudge per streak with the exact error, distinguishing validation from execution failure (`stuck_detector.py:343-382`); Goose denies the repeated identical call (`tool_monitor.rs:35-80`); OpenCode escalates via permission. None of them counts model bookkeeping.
- **We:** `consecutiveStalled` accrues on meta calls (diagnosis K2), `stall_deliverable`/`low_delta_guard` terminate; guards horizon-gated.
- **Change:** (a) K2 as planned. (b) Replace the *terminate* action of stall/loop with: first firing -> one targeted `pendingGuidance` entry citing the repeated call and error; repeat identical call -> harness denies it with a tool result ("already returned X; call blocked"); only if no substantive progress for N further iterations does it propose a terminal (G1 handoff). (c) delete one of `loop_detected_with_veto` / `loop_graceful` / `low_delta_guard` after the replay invariant shows overlap.
- **Surface:** existing `withStallPolicy` gains `{nudge:1, deny:true}`; thresholds already there.
- **Ablate:** L2 zero-token replay invariant "ended by stall while evidenceDelta>0" before/after; then L1.

### G4. Context-overflow recovery: reactive compact-and-retry with a tighter budget, plus optional LLM-summary compaction. (HIGH for small local windows; add one path, remove a heuristic)
- **They:** OpenCode overflow -> compact at `SHRINK_STEPS[0] x failed estimate` -> retry once (`compaction.ts:313-318`, `llm.ts:308-317`); Codex mid-turn roll-over (`turn.rs:687-745`); OpenHands/Aider/Goose LLM-summarize.
- **We:** proactive re-projection; no verified reactive overflow retry [partly U]. Our compaction drops with stubs; recall refs let the model re-fetch, which is cheaper than summaries but costs iterations on 8k windows.
- **Change:** one overflow handler in `think` (provider error classified `context_overflow` -> `compactHistoryStage` with budget 0.7x of failed estimate -> single retry, latched like `recoverOverflow`), emitting a `context-overflow-recovered` trace fact. LLM summarization stays an *experiment*: it contradicts "deterministic over LLM" and "honest stubs"; only test as a stub-enrichment (one-line gist per dropped exchange) on the 8k tier.
- **Surface:** `withContextProfile` already exists; add `overflow: "compact-retry"|"fail"` there only if the ablation needs it.
- **Ablate:** small-window tier (gemma 8k) on MCP-wide tasks: kernel_error/overflow termination rate, tokens.

### G5. Tool-surface deferral as a first-class exposure level. (HIGH; matches 83-88% prompt share)
- **They:** Codex only: `ToolExposure` Direct/Deferred/Hidden and a `tool_search` builtin, MCP schema byte caps (8k/tool, 64k total) (`spec_plan.rs:262-320,424-452`, `mcp_tool_exposure.rs:19-20`). Everyone else avoids schema bulk via bash/text protocols (mini-swe, Aider, smolagents CodeAgent).
- **We:** static ~24 schemas; `discover-tools` flagged "pure cost, REMOVE" (memory 08-12); Plan 8 T1 proposes harness top-k.
- **Caution:** Codex's deferral is *model-driven search*, which we measured as cost; do not copy it. Copy only (1) the per-tool exposure enum as the config shape, (2) the hard byte cap per schema and total, (3) gating on provider capability.
- **Change:** T1 as written, expressed as `exposure: "direct"|"deferred"|"hidden"` per tool on `defineTool`/MCP config, with harness-side ranking (task + ledger match) and a one-line index. Add a byte cap with truncation of schema *descriptions* (not params) to the existing `wire-request` trace fact.
- **Ablate:** T1's gate; add the schema-byte-cap-only arm (cheapest, no relevance model) first.

### G6. Plan/todo: harness-protected state, model-limited writes. (MEDIUM; converge)
- **They:** every harness keeps todo model-owned and *unguarded* (consistent with our REWORK verdict). Anthropic guidance protects the list: model may flip `passes`, not edit/delete items. smolagents schedules planning by cadence not by model choice.
- **We:** model-owned `todo` feeds stall guard and checklist churn (diagnosis).
- **Change:** S3 as planned (ledger-derived read-only checklist) plus one rule from Anthropic's guidance: when a checklist/contract exists, the model can only transition status, never add/remove (the failing hash churn). Do not add a planning-interval step; our ledger already supplies evidence for the plan.
- **Ablate:** A1/A3-style on todo-heavy tasks; metric = stall-fires-in-todo-runs and tokens.

### G7. Cross-session / long-horizon handoff artifact. (MEDIUM; mostly exists)
- **They:** Anthropic progress file + feature JSON + git; OpenCode/Codex persisted sessions; LangGraph checkpointer; Aider git commits; Goose recipes.
- **We:** durable runs (`withDurableRuns`), ledger rides crash-resume, auto-checkpoint, receipts.
- **Gap:** no harness-authored *handoff note* at boundaries (cap, checkpoint, abstain). G1's synthesis turn can emit it into the ledger so resume starts with "done/remaining/next". No new subsystem.
- **Ablate:** L1 resumed-run arms.

### G8. Operation-list composition for the iterate pass. (MEDIUM-LOW; large refactor, do not start before G1-G3 land)
- **They:** Goose `Operation::run -> applied|not_applicable|yielded` with a per-op `moim_parts` for guidance (`state_machine/*`, `moim.rs`); OpenHands condenser `PipelineCondenser`.
- **We:** `iterate-pass.ts` 1,315 LOC with ~20 `iterate-*-seam.ts` files and ~20 steer/terminate deciders.
- **Insight:** our seams already are the Operations; what Goose has and we lack is (a) a single uniform result type, (b) each op owning its guidance contribution (we have `pendingGuidance` - same idea), (c) ordering visible as data. Converge by making the seam list an explicit ordered array with the uniform result, so S1 ablations become "remove entry from list" not code edits. Do not rewrite.
- **Ablate:** behavior-preserving; replay-equivalence only.

### G9. Deterministic per-turn budget awareness to the model. (LOW, cheap)
- **They:** Goose `<turn-budget>N/M used</turn-budget>` after half budget (`moim.rs:155`); smolagents passes `remaining_steps` to planning.
- **We:** pace actions exist (`pace-actions.ts`), unclear whether the model is told the budget [U].
- **Change:** if absent, render one line in `Guidance:` from the same meter that G1 uses; costs ~15 tokens. Ablate only inside G1's arm.

### G11. Prefix-cache invariant (from Hermes). (MEDIUM, cost; measure first)
- **They:** Hermes keeps the system prompt byte-stable; mid-run guidance rides user/tool messages (`agent/AGENTS.md`). OpenCode also keeps tool defs on the final step to preserve cached prefix (`llm.ts:~250`).
- **We:** `pendingGuidance` renders into the system prompt each turn (AGENTS.md pitfall 9), which likely changes the prefix every iteration [U: provider cache hit rates not measured].
- **Change:** measure cached-input share on Anthropic/OpenAI runs from existing usage fields; if low, render guidance as a trailing tool-result/user slot. Keep the one-line-guidance T4 arm as the natural pairing.
- **Ablate:** billed-token delta (H4) on identical tasks; correctness no-regression.

### G10. Transport-level retry belongs below the kernel. (LOW; verify then delete)
- **They:** Codex/OpenCode retry/backoff/`Retry-After` in the transport layer; kernel never sees it. Hermes adds a bounded post-exhaustion wait ladder for transient classes only (`turn_recovery_autorecover.py:1-14`).
- **We:** M3 REWORK removed a verify-retry loop; provider has `withRetryPolicy`, `withFallbacks`, circuit breaker; `kernel_error` exists.
- **Action:** audit that transient provider errors (429/5xx/stream drop) never surface as `kernel_error`; if any path does, move it into the provider layer. Pure verification task for provider-warden; no kernel change.

## 6. Convergence summary (what to delete or merge)

| Merge into | Absorbs |
|---|---|
| One exit: "guards propose -> gate disposes -> handoff synthesis" (G1+G2) | `low_delta_guard`, `loop_graceful`, `oracle_forced`, stall, bare `max_iterations`, per-guard exit text |
| One `accept[]` list in the terminal gate (G2) | `withOutputValidator`, `withCustomTermination`, parts of `withVerification`/contract gate API surface |
| Stall = nudge-once, deny-repeat, then propose (G3) | `loop_detected_with_veto` or `loop_graceful` (one of them), meta-churn counting |
| Exposure enum + byte cap (G5) | `discover-tools` (pending S1 verdict) |

Net: 4-5 deciders removed, 1 list added. No new default-on mechanism without the Plan 8 lift rule; all of G1/G2/G3/G4 are correctness-boundary changes that can be pinned by invariants first (Plan 8 L2) and ablated second.

## 7. Caveats and what I did not verify

- Survey of source, not of results. No harness here was run, and published benchmark numbers were not consulted; "they do X" is never evidence X helps. OpenCode/Codex are large products with features irrelevant to benchmark accuracy.
- Codex `update_plan` enforcement and OpenCode deferred tools were not exhaustively searched [U]. Goose todo extension and OpenHands task tracker internals not read [U]. SWE-agent proper, Cline/Roo, pi-mono, Claude Agent SDK not covered [U].
- Our overflow-retry absence (G4) is a negative grep over `reasoning/src` and `llm-provider/src`; Ollama/provider adapters may handle it. Check before building.
- Line numbers are from the SHAs in section 0 and will drift.
- Single-reader risk: I did not run the diagnose/replay tools on our corpus; the "what we do" column relies on the 11-02 reports plus source reading of the entry points named in section 3.
