## [0.19.0] — 2026-11-20

Gateway and deploy hardening. **Breaking:** `allowedSenders` / `blockedSenders` entries must now carry a platform prefix (`signal:+1555…`, `telegram:123…`); bare entries no longer match, so existing allowlists fail closed until migrated. Cloud Run deploys are authenticated by default (`--allow-unauthenticated` to opt out).

- Gateway: the hourly action cap (`maxActionsPerHour`) and daily token budget now reset when their window elapses. Before, a long-running gateway stopped acting after 30 runs until restarted.
- Channel access control is now keyed by `platform:userId` (for example `signal:+15551234567`), so ids on different platforms cannot collide, and a channel event with an empty sender is denied. **Migration:** prefix existing `allowedSenders` / `blockedSenders` entries with the platform; bare entries no longer match platform-tagged senders. `replyToUnknown` is now sent by `ChannelService` (`replyToUnknown` dep) to allowlist-denied senders; the MCP-push Signal/Telegram path still does not send it.
- `rax deploy`: `--name` is validated (`/^[a-z0-9][a-z0-9-]{0,40}$/`) and every provider command runs as an argument array instead of a `sh -c` string, closing a shell-injection path. Cloud Run now deploys authenticated by default (`--allow-unauthenticated` is an opt-in flag) and, in daemon mode, with `--min-instances=1 --no-cpu-throttling`. The Fly scaffold no longer auto-stops machines in daemon mode and defines one health check. Render no longer calls the non-existent `render blueprint launch` (it runs `render blueprints validate` and prints the Git-connect steps); empty `dockerCommand` / `startCommand` strings are gone from the Render and Railway scaffolds.

First-run fixes for scaffolded projects and `rax`:

- Scaffolded templates print a failed `build()` or `run()` (a rejected API key, Ollama not running) as one `Error: ...` line and exit 1, instead of a source frame and stack trace. The `streaming` template now exits 1 when the run fails (it printed `[done]` and exited 0), and the `cloudflare-worker` template answers a provider failure with a JSON `{ error }` and status 502.
- `with-approval-gates`: off a TTY (CI, a pipe) the run stops at the first gated call and prints that it is paused, rather than denying and resuming over and over. It prints the real outcome (`result.outcome`, or `result.status` while paused) instead of `Status: undefined`.
- `create-reactive-agent` exits 1 with the list of valid values on an unknown `--template`, `--provider` or `--pm`, instead of falling back to a default.
- The default Ollama model is `qwen3:4b`, the model the docs quickstart pulls, and the next steps and README name `ollama pull qwen3:4b`.
- `rax --help` lists every `rax diagnose` subcommand, including `signals`, `cause` and `attribute`. The banner and `rax --version` print no color when `NO_COLOR` is set or stdout is not a TTY, and `NO_COLOR` now also turns off every other colored `rax` output.
- `rax demo` finds Ollama through the same variables the provider reads (`OLLAMA_ENDPOINT`, then `OLLAMA_HOST`, then `OLLAMA_BASE`), and its Gemini model matches the scaffolder (`gemini-2.5-flash`).

`todo` add accepts a structured per-step tool: a `tools` array parallel to `items`, or `{text, tool}` items. The hint lands on the checklist row's `tool` field, so plan cards show the tool without it being written into the step text. `todo` add also skips rephrased duplicates (80% word overlap, or wholly inside an existing title of 3 or more words) instead of only exact repeats.

Cortex Chat in the "Bench" design (step 3 of the modernization plan).

- A chat opens at its latest turn. Before, it could land mid-thread with "Jump to latest" showing, because the answers finished rendering after the first scroll.
- Answers read as 15px prose at a comfortable line length instead of 12px monospace. Your messages are quiet bubbles on the right. The agent's turns sit on the canvas with a thin rail on the left: it moves while the turn runs and turns red when the turn did not finish.
- Turn headers show the model, the strategy chip and token usage (`2.8k in · 560 out`). A finished turn's estimated token split no longer says "estimated while streaming".
- Sub-agent cards use a wider grid, and names keep a minimum width, so a failed agent's name no longer collapses to "s". The sub-agent drawer has a scrim and traps focus, and Escape or a click outside closes it.
- Turns that did not finish (failed, stopped, interrupted, abstained, or older turns saved with no outcome) end with a note that gives the cause and a Retry button.
- The chats rail has search, Today and Earlier groups, the model and the time of last use, a running dot, and a "More actions" menu. Rows no longer nest buttons inside a button.
- The composer is one panel: quick-bar chips, the message box, and a hint row. A queued message shows as a strip above it. An empty chat shows the neural mark, starter prompts and the ambient orbs.
- Chat icons are bundled SVGs, so no icon name ends up in screen-reader labels or copied text. Markdown in chat and in run deliverables follows the theme tokens, including tables and code.
- Fixed: the chat settings dialog from the rail now opens centred as a modal (a missing space in its class list had dropped its layer and layout).

Ollama capability rows and calibrations are now tied to the model's content digest. A re-pulled tag whose digest changed is detected: a stale probed capability row is re-probed (and rewritten), a stale digest-bearing calibration falls back to tier defaults, and a typed `recalibrate` signal is published via `onModelDigestStale`. Records without a digest (static table, shipped calibrations, older cache files) behave exactly as before. New optional `digest` field on `ModelCalibration` and `Capability`.

The test provider now reports `provider: "test"` from `getModelConfig()` instead of `"anthropic"`, so LLM telemetry (`LLMRequestCompleted`, cost, model pages) no longer attributes test-provider calls to Anthropic. `ModelConfig.provider` accepts `"test"` alongside the `LLMProviderType` names.

Reflexion: the final pass decides the run's status. An improve pass that continues the run (it judges the run contract over the run ledger so far) now supersedes the passes before it, so earlier capped passes no longer veto a verified final answer (`terminal_status_override` with authority `envelope-outstanding`). A final answer the critique never judged is `completed` when its pass passed the shared verify gate; an answer the critique judged UNSATISFIED stays `partial`. An empty generate pass is now seeded by the kernel's shared terminal synthesis over the pass's tool results, with meta-tool results (e.g. `todo` call instructions) excluded, so the tool-less call no longer shows tool instructions (Gemini answered those with `UNEXPECTED_TOOL_CALL` and the run failed).

Planners now see which commands the shell tool may run. A tool's `commandPolicy` is rendered in the shared plan catalog (blueprint, plan-execute-reflect, patch and augment) and in plan posture's `Execute-phase tools:` line: allowed commands already on PATH, allowed but not installed, and not enabled (the PATH split is skipped for a Docker sandbox), with a rule not to plan a step only to check that a tool or command exists. This ends plans like `gh --version` / `gh auth status` made only to confirm shell access. A turn where every tool call has empty arguments although the tools require some is now one model fault: the calls are refused and answered, and one corrective line names each tool, its required parameters and an example call, instead of a failed call and a turn per repeat. The generic "Check argument format" hint is no longer appended to an error that already shows `Valid call:`.

Scaffolded xAI projects use `grok-4.7`, and generated projects and `rax` no longer print a partial cost as an exact total.

- `--provider=xai` now writes `.withModel("grok-4.7")`. It wrote `grok-4`, which is no longer on xAI's price list, so every run of a scaffolded xAI project reported its cost as unknown.
- The `minimal` and `with-tools` templates print the billed total from `await result.totalCost?.()` (background debrief included). The `streaming` template prints the `StreamCompleted` cost. When a model had no known price, all three print `>= $x (some prices unknown)` instead of an exact-looking `$x`. The `cloudflare-worker` template's JSON response adds `costComplete`.
- `rax run` prints the billed total from `result.totalCost()`, and `rax run` and `rax eval` mark a partial cost the same way.

`code-execute` now tells the model up front that it runs JavaScript/TypeScript only (no shell, no Python), that data must be inline or read by absolute path, and shows a short compute example. A non-JS `language` value returns an explicit "JavaScript/TypeScript only" message instead of an opaque enum rejection, and the "missing sentinel" failure now reports the exit code, likely cause (`process.exit()`) and a hint.

`toConfig()` followed by `agentConfigToBuilder()` now rebuilds the same agent, `features` included:

- A builder without `.withObservability()` no longer writes an `observability` block. Before, `toConfig()` wrote the default `{ verbosity: "minimal" }`, and reloading the config turned observability on.
- `.withReactiveIntelligence(false)` survives the round trip. Before, the reloaded agent had reactive intelligence back on.
- `reasoning` in `AgentConfig` now also carries `strategies`, `adaptive`, `parallelToolCalls` and `observationSummary`, the same shapes `.withReasoning()` takes.

The A2A client no longer follows redirects on JSON-RPC calls, so a configured `X-API-Key` or bearer token cannot be forwarded to a host you did not configure. The Signal MCP container now requires `@modelcontextprotocol/sdk` ^1.27.1.

Channel hub routes with `ack.source: "model"` now send model-written acknowledgements: the hub resolver forwards the agent's pre-tool narration and offers the tool-less `acknowledge` side completion, falling back to the canned text on failure. New Telegram routes (API create, import from agent config, the editor's new draft) default to a model ack unless the owner set `ack`. The activity feed shows `ChannelTurnAcknowledged` with its source.

`ReasoningService.execute` takes `planOnly: true`: `blueprint` and `plan-execute-reflect` stop after the plan (the planner call or a supplied plan, plan repair, plan-time argument grounding and, for `blueprint`, VERIFY). No tool runs and no solve or synthesis call is made. The result is `partial` with no output, `metadata.planOnly: true`, `metadata.rawTerminatedBy: "plan-only"` and the plan, every step pending, in `metadata.extensions.plan`. `adaptive` routes a plan-only run to one of the two and does not fall back to reactive; any other strategy fails with an `ExecutionError` instead of running the task.

`Plan` gains optional `findings` (`PlanFinding`: `id`, `tool`, `summary`, optional `at`): facts learned by plan recon that travel with the plan. `planFromChecklist` accepts `meta.findings`, `PlanRecorded` carries them, and the portable formats round trip them (Markdown `## Findings` section, JSON envelope, escaped HTML section). Plan format version stays 1; plans without findings are unchanged.

`.withApprovalPolicy({ commands: ["git push"] })` gates shell calls by command. The agent's approval gate and every shell it registers (the read-only `git` preset, the terminal) get the same rule list, so in the git preset a matched write such as `git push origin main` now asks for approval instead of being refused: block mode with no `onApprove` refuses it, an approving `onApprove` lets it run, detach mode pauses on it. A shell gets rules only from the approval policy; a hand-set `terminal.approvalCommands` is ignored. Sub-agents inherit the rules with the rest of the policy. The data half of the policy (`mode`, `tools`, `commands`) is now in the declarative `AgentConfig` as `approvalPolicy` and round-trips through `toConfig()` / `fromConfig()`; `onApprove` and `requireFor` stay code-only. An approved push still needs credentials the sandboxed shell does not pass (no credential helper, no SSH keys or agent).

Structured output can now be saved with an agent, reported, and asked for on a single turn.

- `.withOutputSchema()` also accepts a plain JSON Schema object, validated deterministically without a model call. Unsupported keywords throw `OutputSchemaError` naming the keyword and its path.
- `AgentConfig.outputSchema` holds the schema as JSON Schema. `toConfig()` writes it for any schema with a JSON Schema form (Effect, Zod, Valibot, ArkType, JSON Schema), and `agentConfigToBuilder()` / `agentConfigToSource()` apply it again with `outputSchemaOptions`.
- `result.objectReport` says how `result.object` was obtained, or why it failed (layer, attempts, repairs, coercion, field errors). `StructuredOutputError.report` carries it in throw mode.
- `runStream(task, { outputSchema })` applies a schema to one turn: `StreamCompleted` carries `object`, `objectError` and `objectReport`, and `AgentStream.collect()` copies them onto the result.
- At density `"full"`, `ToolCallStarted` stream events carry the call's `args`, and `StructuredOutputReported` bus events are forwarded as stream events.

Export `extractCurrentTurn`, the `CurrentTurn` type and the history marker constants (`HISTORY_BLOCK_MARKER`, `CURRENT_MESSAGE_MARKER`, `NEW_REQUEST_MARKER`) so consumers can read the current turn instead of the whole inlined conversation transcript.

Sub-agent tool names are now resolved against the tools the child really has. A parent that passes `umami_get_website_stats` to `spawn-agent` / `spawn-agents` (or in a `.withAgentTool` call's `tools` arg) gives the child `umami/get_website_stats`, both as an allowed and a required tool, instead of an allowlist that matches nothing. Names that match no tool, or more than one, are dropped and the parent's tool result says so. When none of the requested tools exist, the child is not started; the result names the unknown tools and lists the available ones.

A repeated identical tool call now runs again when a successful file-write, file-edit, shell-execute or code-execute landed since its last result, instead of replaying the stale result. Re-running tests after editing now sees the edit.

The final answer's toolbar is now one slim row that stays flush at the top of the chat thread or run pane while you read that answer (it used to hang about 24px below the top and let text show above it) and lets go at the answer's end. Copy as Markdown and the save options moved into one "Copy or save" menu, buttons show icons only in a narrow pane, and Outline jumps land below the bar.

The chat Config popover now opens next to its button (flipping and shifting to stay on screen) on a menu of the five setting groups. A group shows its rows under a header with Back and the group name; a row's picker has its own Back row. Back or Escape goes up one level before closing, and closing a picker returns to its group.

Security hardening: the Cortex server now answers 403 to any `/api/*` or `/ws/*` request (WebSocket upgrades included) whose `Host` is not localhost, 127.0.0.1, [::1], an IP literal, the `CORTEX_URL` host or a name in the new `CORTEX_ALLOWED_HOSTS`, or whose `Origin` is a foreign site, which stops DNS-rebinding pages from reaching the unauthenticated API. Voice endpoints can no longer point at link-local or cloud-metadata addresses (169.254.0.0/16, fe80::/10, `metadata.google.internal`); loopback and LAN servers still work. `POST /api/voice/transcribe` now caps the recording while streaming the body (chunked uploads included), and chat attachments are limited in the request schema (item count and string lengths). Server tests can no longer spend money: `bun run --cwd apps/cortex test` strips provider keys, and a gateway trigger test that called Anthropic now uses the test provider.

Budget-stopped plan-execute and blueprint runs keep their completed step results. When a strategy stopped at the run budget, or shipped its joined step results because the final answer call failed, `result.output` was `""` and the work was lost. The output is now the joined step results, reported as a partial (`success: false`, `outcome.status: "partial"`) with the verification warning. Text the harness writes itself (the `harness_deliverable` terminal, such as "✓ Written to x.txt") is still never shipped as output.

`SkillActivated` events for skills the model loads with `activate-skill` now carry the run's `taskId` and the `sha256` of the activated SKILL.md body, matching bootstrap activations. Observers can tie an agent-loaded skill to its run and its exact version.

The npm README now states that Bun is recommended and Node.js 22.5+ is supported (it previously said Bun was required), links the working Discord invite, and drops an absolute type-safety claim and the downloads badge. It also says "adaptive strategy selection" (switching is opt-in) and describes the 18 bundled packages accurately (16 re-exported from the root, `observe` via sub-path, `cli` as the `rax` binary).

The README was also rewritten to the shared package template: shorter, with the unsourced healing and token-savings percentages and hand-typed counts removed, and strategy, tools and environment detail replaced by docs links.

The quickstart snippets now opt in with `.withTools({ builtins: "research" })` instead of an empty `.withTools()`, and the pitch no longer claims signed receipts by default (they are unsigned unless `.withReceiptSigning()` or `RA_RECEIPT_KEY` is set).

The README also shows four Cortex screenshots (absolute docs-site URLs, since npm does not resolve relative paths) with the `bun add @reactive-agents/cortex` then `rax cortex` start line.

The A2A client now bounds `sendMessage`, `getTask` and `cancelTask`: a per-request timeout (`timeoutMs`, default 30s), a streamed response size cap (`maxResponseBytes`, default 5 MiB) and the shared egress policy through the SSRF-safe pinned fetch (`allowPrivateNetwork` to opt in or out; metadata and link-local always refused; redirects refused). New typed errors `RequestTimeoutError`, `ResponseTooLargeError` and `EgressDeniedError` join the client error union (`ClientRequestError`).

Durable runs now bound their own growth. `.withDurableRuns({ retention: { keepCompleted?, maxAgeDays?, compactCheckpoints? } })` prunes FINISHED runs at the start of each run: completed runs keep only their final checkpoint (and drop tool-effect rows), and completed runs beyond the newest 50 or older than 30 days are deleted (`0` disables a bound; `compactCheckpoints: false` keeps every iteration for `agent.fork()`). Resumable runs (stopped, paused, failed, awaiting approval or input, or running with a checkpoint) are never touched. Pruning is fail-soft: a failure never fails a run. `defaultDurableRunsDir` also honors `REACTIVE_AGENTS_RUNS_DIR`, a base directory that replaces `~/.reactive-agents` (explicit `durableRuns.dir` still wins), so tests and hosts can isolate durable stores.

Long multi-query runs no longer lose evidence to compaction.

- `recall(key, full: true)` now returns the stored result in full. Before, the recall output was compressed again like any tool result, so it came back as a "compressed preview" and was stored under a new key. A recall read now gets a budget of a quarter of the context window (`toolResultBudget`).
- An exact repeat of a call that already succeeded is now a cached replay, not a failure. This includes a repeat with the arguments in a different key order or with only whitespace changes. Before, these repeats got a bare "You have already called ... N times" refusal and were recorded as failed calls. Now the reply is the earlier result, marked "Already fetched at step N; this is that result." When that result was compacted, the reply carries its full stored copy (bounded by the context window; past that bound it names the `recall` key). The call is recorded as a success, and the `duplicate_guard` event fires as `redirect` instead of `block`.
- The repetition backstop's default now counts iterations, not calls. A parallel-safe tool may batch `maxBatchSize` calls per iteration, so its default cap is `ceil(maxIterations * 0.75) * maxBatchSize` calls. Other tools keep `ceil(maxIterations * 0.75)`. A configured `maxCalls` is still a plain call count. Before, a model that batched 3-4 distinct queries per turn hit the cap after 2-3 turns. `repetitionBackstopCalls` takes an optional third argument, `callsPerIteration`.

Resumed runs honor the `extraIterations` bound over an explicit `maxIterations`. Compose `timeoutAfter`, `watchdog` and `requireApprovalFor` stops report `terminatedBy: "guard_stop"` and name the killswitch in the failure cause instead of the budget sentence.

A run that was asked to perform an external action (send a message, open a ticket, schedule an event) no longer finishes as `success` just because a read-only tool succeeded. Web search, HTTP GET and file reads are retrieval, so their success is never counted as the requested side effect landing. When nothing that can change the world succeeded, the exit gate keeps the action outstanding and the run ends as a failure that names it ("actually complete the requested action"), instead of `end_turn` with a passing verdict.

Webhook routes are no longer throttled as one sender. Most webhook callers send no `senderId`, so every request shared one `unknown` bucket and the default cap of 6 turns per sender per hour throttled all webhook traffic on the route. Routes on the `webhook` platform now have no default per-sender cap; the route-level caps (`maxCostPerDayUsd`, `maxTurnsPerHour`) still apply, and an explicit `maxTurnsPerSenderPerHour` is enforced per `senderId`. Messaging channels keep the default.

Rewrite the react, vue, svelte and ui-core READMEs to the shared package README standard (pitch, stability, install, usage, API table, docs links, runtime, license). The ui-core README drops its long turn-step and transcript walkthroughs in favor of an API table and a docs link. Every ui-core README code block is self-contained and type-checks against the real exports.

Reflexion no longer fails a run when its generate pass runs out of iterations mid-tool-work. The generate pass now gets half of the run's iteration budget (8 of 16 with `maxIterations: 16`, `maxRetries: 3`; it got 4 before), and the improve passes split the rest. An explicit `kernelMaxIterations` still sets every pass's cap. When the generate pass still hits its cap, reflexion writes the answer from the pass's tool results and critiques it as before. If the critique accepts that answer, the run's `answer` requirement is now met, so the run ships it as `partial` instead of being reported as failed with "unmet requirements: answer".

code-action: refuse an approval policy only when it can gate a tool the sandbox can call. Before, any non-empty `tools` list refused the run, and the runtime fills that list with every registered `requiresApproval` tool, so code-action refused even when every tool it could call was read-only. It now refuses when a callable tool is in the policy's `tools`, when `commands` rules are set and a shell tool (`shell-execute`, `git-cli`, `gh-cli`) is callable, or when a `requireFor` predicate is set. The refusal still starts with `code-action cannot honor .withApprovalPolicy(` and now names the gated callable tools. New export `codeActionApprovalConflict({ callableTools, policy })` applies the same rule, so a UI can warn before the run.

Channel hub: a routed chat turn now takes the tool loop whenever the built agent has tools. Before, `session.chat` guessed from the message wording, so an owner asking "what is bitcoin worth?" got an answer from the model alone ("I have no tools") although the saved agent had `crypto-price`.

A run no longer ends with its answer written and the `todo` list half open and unexplained. When the model gives its final answer while `todo` items are still open, the harness holds the answer for one extra turn that names the open items: mark them done, remove them, or finish them. It never checks an item for the model, asks only once per run, and skips the turn when the list is empty or closed, or when no iteration is left. A soft guard (low token delta, stall) that fires during that turn waits for the model's reply instead of handing off the answer it already wrote.

`assertPublicUrl` egress guard closes SSRF bypasses: IPv6 literals are now parsed to bytes and the embedded IPv4 in IPv4-mapped (`::ffff:a.b.c.d`, including hex-normalised `[::ffff:a9fe:a9fe]`), IPv4-compatible (`::a.b.c.d`), NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) forms gets the same private/loopback/link-local/metadata rules as plain IPv4. Trailing-dot hostnames (`localhost.`) and `*.localhost` are blocked, and metadata addresses (169.254.0.0/16, fe80::/10, `fd00:ec2::254`, `100.100.100.200`) stay blocked under `allowPrivate`.

A kernel pass that stops on its own iteration cap now runs the tool calls of its last think when the run still has iteration budget, instead of silently dropping them. Multi-pass strategies (reflexion's generate and improve passes, direct) used to lose their final, often most useful, batch: the cap counts think calls, so the act after the last think never ran (a reflexion improve pass dropped 4 web searches with 3 of the run's 10 iterations left). The batch runs once through the normal act path (guards, approval, repetition, result recording) and adds no LLM call. When the run's own budget is spent the batch is still dropped, and the `pending_batch` record now says why (`cause: "run-budget-exhausted"`).

A run that ends on a harness-assembled deliverable and is then rewritten by the output gate's synthesis call now returns that synthesized answer. Before, the kernel kept the `harnessAuthoredOutput` label on the result after the synthesis replaced the text, so the runtime treated the model-written answer as harness text and returned `output: ""`. The synthesis now clears the label. `verificationWarning` still records that the model's own turn never answered. When the synthesis comes back empty, the de-scaffolded fallback text keeps the label as before.

Add `SignalChannelAdapter`, a native Signal adapter on the canonical `ChannelAdapter` contract. It speaks `signal-cli` JSON-RPC over a spawned process (`makeSignalProcessTransport`) or a daemon socket (`makeSignalSocketTransport`), or any injected `SignalTransport`. Inbound messages carry a `signal:<number-or-uuid>` identity with the group as conversation and the individual sender preserved. Echoes are recognised by message id, not text. `send` returns the message timestamp as a real receipt or a typed `ChannelError` (`not_found`, `auth`, `rate_limited` with `retryAfterMs`, `forbidden`, `too_large`, `network`), and delivery and read receipts stream on the new optional `ChannelAdapter.deliveryUpdates`. The account number is `Redacted` and never appears in errors, receipts or logs. The Docker MCP path (`docker/signal-mcp`) still works and is documented as legacy. The shared conformance suite now lets an adapter declare structured message ids, parseable reply references and attachment kinds, and checks thread handling against `capabilities.threads`.

Cortex chat now uses the skills in the session's workspace. Every chat agent gets `.withSkills()`, so it finds `.agents/skills`, `.claude/skills` and `.<agentId>/skills` in its workspace the same way a run does and can load one with `activate-skill`; the chat lists exactly those skills (a quick-bar chip, `/skill` and `/` rows with the folder each came from). `/skill <name>` uses a skill for the next message only and leaves the session config alone; `/skills <name>` pins it for every turn. Pins are stored as skill names: older chat pins that saved a path relative to the server's folder are rewritten when the chat is built, so they keep working when the workspace differs. Each finished reply, and the run view, shows which skills the run had loaded and why (pinned, matched the task, loaded by the agent), read from the run's `SkillActivated` events and `AgentStarted.config.skills`. The Lab Skills tab lists the skills an agent built from the Builder would find (its workspace, extra folders, home-folder skills when turned on) next to the Cortex library, which it marks as not sent to agents. Desk runs now keep a skills config that only pins names or sets `global` (it used to be dropped without any `paths`), and the Builder can turn on home-folder skills (`withSkills({ global })`).

`@reactive-agents/ui-core` adds `foldRunSkills`, `runSkillsOf`, `skillActivationVia` and `skillViaLabel`: fold a run's `SkillActivated` events and its `AgentStarted.config.skills` record into which skills were active and why, for any chat or run UI.

Cortex now builds every agent from one serializable AgentConfig: meta tools (including Cortex's default-on suite), skills, agent tools, dynamic sub-agents, host shell options, context synthesis, harness switches, documents, model routing, budget, grounding, fabrication guard, durable runs, verification, task context, minimum iterations, streaming, the kill switch and the default memory layer all ride the config instead of extra builder calls. Saved agents, "Export as code" and the CLI therefore describe the exact agent Cortex runs, and the export's **Not in this code** list shrinks to what has no config form (test scenario, host tools, trace folder, output schema object, saved API key, user-question rail). Two side fixes from the single path: turning traces off no longer drops the observability verbosity, and context synthesis no longer drops harness switches set under All framework options.

`runStream(task, { skills: { activate } })` pins skills for that turn, the same as `run()`.

Skills injected at bootstrap (builder pins, run pins and task-relevant picks) now publish one `SkillActivated` event each per run, with `trigger: "bootstrap"`, the run's `taskId` and the skill body's `sha256` (the same hash `run-started.config.skills` records). `onSkillActivated` from `.withReactiveIntelligence()` fires for them. Before, only skills the model loaded with `activate-skill` produced the event.

Cortex renders what the framework now reports, and a chat turn waiting on you survives a reload.

A run a guardrail ended (`AgentAborted` with reason `guardrail`) is stored and shown as **Blocked by guardrail** instead of Failed, in Runs, the run header and Beacon, and the "Why it ended" card names the guardrail. The run and chat Context tabs list the memories a run recalled into its context from its `MemoryRecalled` events (tier, summary, relevance, importance, the query, a link to the Memory studio entry); the "not reported" note stays only when a run reported none.

Pending approvals show which sub-agent is asking and are answered by gate id, so parallel sub-agents are approved or denied one at a time (`POST /api/runs/:runId/approve|deny` take `{ gateId }`; the toast, chat card, Runs strip, run header and Beacon all name who asks). ui-core mirrors `subAgent` on `ApprovalRequested` and `pendingApproval` (additive), adds `foldRecalledMemories` / `memoryRecalledOf`, and `statusOfRun("blocked")`.

A streamed chat turn is now detached from its SSE connection: closing or reloading the page no longer interrupts it. `GET /api/chat/sessions/:id/chat/active` reports a running turn and `GET /api/chat/sessions/:id/chat/stream/active?cursor=` re-attaches to its replayable event stream, so the page comes back with the pending approval or question card and the same run finishes after you answer. Stop stays explicit.

The chat titler, compactor and goal checker (with `/btw`) are built memory-off, so they no longer create memory folders or recall into their prompts.

Failure causes and loop counts now match what the run did.

- A run that wrote `run-aborted` without a `reason` is `aborted`, not `incomplete-trace`. A guardrail block shows as `aborted/guardrail-block`; other aborts show as `aborted/<causeClass>`, rated `probable`, with `run-aborted.reason` listed as missing. `incomplete-trace` now means only that the trace has neither `run-completed` nor `run-aborted`.
- A token or cost budget stop (`budget_exceeded`, `budget-limit:*`) is `budget-cap/token-budget`, `cost-budget` or `spend-budget`. Its next step no longer says to raise the iteration budget. `causeDescription(cause, subCause?)` takes an optional sub-cause and returns the more specific wording; `rax-diagnose cause` passes it.
- `traceStats().iterations` (and `analyzeRun().iterations`, replay `TraceSnapshot.iterations`) counts loops the way the event stream does. It counts `iteration-exit` records, which `ReasoningIterationProgress` now writes to the trace. Older traces use their kernel snapshots, which fixes a count that was one too high on every kernel run. plan-execute-reflect runs no longer show 0 loops.
- The trace now records `StructuredOutputReported` as a `structured-output-reported` event, and `ToolCallStarted.args` as `args` on `tool-call-start`.

Tool-result previews of objects that wrap a list of records (`find`, web search, `gh --json`, HTTP APIs) now show each record's salient text and fields instead of `Array(n)`. Previously a small model saw `results: Array(3)` from `find` and concluded nothing was found.

Flat object previews (for example `gh api repos/<owner>/<repo>`) that cannot show every key now drop navigation keys (`*_url`, `url`, `node_id`, `gravatar_id`, `avatar`) and list salient keys first (`name`, `title`, `description`, ...), followed by other scalar fields, with a `(N url/id fields omitted)` note. Previously `description` and `stargazers_count` sat behind ~40 `*_url` keys and the model reported the wrong description. Objects whose keys all fit, or that have no such keys, preview as before.

Guidance strings in a tool result (`hint`, `note`, `warning`, `error`, `message`) are no longer cut at about 80 characters: they get at least 300 characters when the preview budget allows, and in a record-list preview they come first. Small nested values in a record-list preview now show their items: a string list renders as `[a, b, …+N]`, and an object of string lists (such as `find`'s `outline`) renders as `README.md: # Cortex · ## Prerequisites · ## Environment …+N`, up to the preview budget. Previously `find` showed `outline={README.md}` and a cut hint, and the model answered that no document was loaded.

Gateway channel turns that deliver their reply through an MCP send tool now declare that tool as a required tool, so a run that finishes without a successful send is no longer reported as success. Router and native-adapter turns (the adapter delivers the reply) are unchanged.

Gemini 3-family models (for example `gemini-flash-latest`) no longer fail with `400 Function call is missing a thought_signature in functionCall parts` when a request replays earlier tool calls with no user text after them, such as a reflexion improve pass. The Gemini provider now keeps the `thoughtSignature` Gemini returns on each function call, on both `complete()` and `stream()`, and sends it back with that call. A call whose signature is unknown (history from another provider or another process) gets Google's documented placeholder signature. Gemini tool-call ids are now unique per call (`gemini-tc-…`); `complete()` used to return `call_0`, `call_1`, ….

Lab builder settings each have one home a builder would look in. Approvals moved from Reasoning to Tools (they gate tool calls), with a link to the durable-runs switch. Dynamic sub-agents moved from Tools to Sub-agents and gained a **Nested spawning depth** field (`dynamicSubAgents.maxRecursionDepth`; empty keeps the framework default, where spawned agents cannot spawn their own). Durable execution, token and cost caps, structured output and lifecycle webhooks moved from Reasoning to Execution; documents moved to Memory and cost-aware model routing to Model. Reasoning now holds only the strategy, iterations and how the agent checks its work. Variables is its own nav entry instead of sitting under Persona. **Find a setting** follows: `approval` finds Tools, `spawn` finds Sub-agents, `durable` and `webhook` find Execution, `variable` and `template` find Variables. Every control works as before.

Executing a seeded plan no longer spends the iteration budget on todo bookkeeping. A step whose tool hint names a tool that just succeeded (and that no other unchecked step names) is marked done by the harness, so the model does not spend a turn on it. A round that only called `todo` does not count against `maxIterations` (at most half the budget is refunded, and each refund is recorded as a `bookkeeping_refund` guard event and an intervention step). The follow-the-plan guidance now also says to issue independent tool calls together, update `todo` alongside real work, and never re-add steps already on the list. Plan-turn checklists are derived from one list in the reply (the one whose steps name tools) instead of a union of restated lists. New opt-in `RA_WRAPUP_RESERVE=1`: on a seeded plan run the last think call ships without tools and asks for an answer from the evidence gathered, naming what is unfinished.

**Direct and reflexion no longer refuse the 4th distinct tool call. Reflexion no longer reports success after its last model call failed, and it no longer lists refused calls as done.**

- **Repetition backstop uses the run's iteration budget.** The cap on distinct-argument calls of one tool was computed from a single kernel pass's iteration cap. Direct runs a 3-iteration pass, and a reflexion pass gets a share of the run budget, so `ceil(3 * 0.75) = 3` refused the 4th, 5th and 6th distinct, informative calls (for example, six `city-population` lookups in one turn). Every strategy pass now carries the run's budget (`maxIterations`), and the backstop uses it. Reactive was not affected. `.withHarness({ repetitionBackstop })` and the review-point floor work as before.
- **A failed final model call no longer ships a rejected draft.** When reflexion's improve pass ended on a provider error after the critique judged the draft UNSATISFIED, the run returned that draft as `partial`, and the runtime counted it as success. The shared strategy terminal now fails such a run with output `""` and the cause on `error`. `terminatedBy` is `llm_error`, which matches the trace. A draft the critique accepted still ships.
- **Reflexion's ALREADY COMPLETED ACTIONS list is accurate.** Each tool call is now matched to its own result by call id, not by position. A call a guard or the tool gate refused is shown as `⛔ ... NOT run`, not `✅`. The list covers every pass so far, not just the last pass that called tools. The critique's execution evidence uses the same pairing, and a refused side-effect call no longer blocks its tool in later passes.

Channel hub route editor: the model-ack wait default shows 12000 ms and accepts up to 30000 ms, matching the framework's new bounds.

Three honesty and reliability fixes at the shared verify/exit boundary:

- **Claimed actions are checked.** When the final answer says an action was done ("I've filed a report", "the issue has been created") and a tool on the run's surface does that action but never ran successfully, the answer is no longer accepted as success. The exit gate denies the model's exit and names the unmet action (tools stay available, so the model can call it or retract the claim); the terminal verifier rejects it with the new `output-not-unbacked-action-claim` check. The match comes from tool names (verb plus another name word in the sentence), not a tool list. `.withFabricationGuard("off")` disables it; `"warn"` makes it advisory.
- **Correct unit conversions are not fabrications.** `output-not-fabricated-measurement` now accepts a number that is a correct conversion of an observed tool value, within the rounding the answer prints: time units (611,400 s as "10,190 minutes" or "169.8 hours"), a fraction as a percent, size and per-minute rates, and a rate, ratio or percent change of two values the answer itself reports. Wrong conversions ("167 hours" for 611,400 s) are still rejected. The check also reads short units (`s`, `h`, `hr`, `hrs`, `min`, `d`, and days), reads a `totaltime` field or an average as measurement context, and no longer cuts a sentence at a decimal point. A time rate must divide a value the answer prints with a time unit; before, any two reported numbers could match by chance ("~172 hours" passed as 690 / 4). A hedged rate ("~118 seconds per visit" for 117.4) may differ by one unit of its last digit.
- **No tool runs on a tool-less turn.** A tool call the model returns on a turn made without tools (the exit gate's answer turn, or the withhold after two unresolved tool-call replies) is refused and never executed. The reply counts as no answer and a "Tools are not available on this turn; write the answer." observation is recorded. On the strike withhold, a second refusal ends the run as `tool_call_unresolved`.

`.withChannels({ adapters, routes, agents })` now starts the channel router. Routes match inbound conversations to a target agent, with per-route owners, allow and deny lists, and a `senderTools` surface that defaults to `ReadOnly` for non-owners. The runtime builds one agent per (route, role) from your `agents` factories and removes mutating, MCP and unclassified tools from a sender's agent before it is built, so the restriction is a tool list, not a prompt. The router starts and stops with `agent.start()` and its handle; `agent.channelRouterStatus()` reports channels, routes, drops, sessions and whether the store is durable. Routes also serialize as `channelRoutes` in `AgentConfig`. Router state is in memory unless you pass a `store`, and startup logs a warning when it is. The existing `triggers` path is unchanged.

Planning strategies no longer leave zombie or duplicate checklist rows: rows of replaced non-completed plan steps are removed, patch and augment steps are deduped against existing titles (augment capped at 3), and a step's tool hint is written to its row.

`code-execute` failures where the code never ran (non-JS language, shell input, syntax error) now say how to retry: JavaScript/TypeScript only, a runnable example, and that data must be inlined (each call starts clean in /tmp). The tool description states the stateless/cwd constraint up front.

Session turns accept per-turn skill pins. `session.chat(message, { skills: { activate } })` and `session.runStream(message, { skills: { activate } })` now forward the pins to the turn's run, the same way `run()` and `runStream()` already did, so a host can load a skill for one chat turn without rebuilding the agent. `ChatOptions` gains the `skills` field.

Two new `.withHarness()` fields.

- `.withHarness({ compactCallConstraints: true })` turns on compact call constraints (same as `RA_COMPACT_CALL_CONSTRAINTS=1`). Compact tool profiles then keep the sentences that limit a parameter's values, and the compact tool reference lists enum values as `a|b|c`. Default off. The `run-started` trace event records it under `config.mechanisms.compactCallConstraints`.
- `.withHarness({ llmRecoveryBudget: n })` sets how many recoverable provider failures on think turns one run may retry instead of ending with `llm_error`. Default 2; `0` turns recovery off. Config only, no env var.

Both fields survive `toConfig()` / `fromConfig()` JSON.

Cortex can connect a saved Gateway process agent to messaging and shows how the gateway is doing. A new **Channels** section in the Lab builder adds Telegram, Signal and signed-webhook channels. Each channel's credential (bot token, Signal account, webhook secret) is saved encrypted on the server, is never returned or logged (only a mask like `••••Rq6p`), and can be checked with a **Test connection** button (Telegram `getMe`, a reachability check for the `signal-cli` daemon, and the secret/port/reply-URL checks for a webhook; the reply URL goes through the same outbound-URL guard as other fetches). Who may message the agent is the framework's own `gateway.accessControl`: an empty allowlist denies everyone and the editor says so, and **Allow everyone** (`accessPolicy: "open"`) is an explicit switch with a warning. The section also edits the agent's schedules (`gateway.crons`) and inbound queue bounds (`gateway.queue`). A new **Gateway** tab in the Lab lists every gateway agent with its live per-channel connection state, messages in, replies sent and send failures, schedules with next fire and recent runs, queue activity (queued, deferred, dropped) and recent activity. Behind it, `GET /api/gateway/status` and `/api/gateway/channels/*` (credentials, test) serve it, and a gateway agent with enabled channels now runs a long-lived agent built through `buildCortexAgent` (`.withGateway` and `.withChannels`) that stays connected without a browser. Channels apply to the gateway path only; desk runs and chat turns build exactly as before.

Runs no longer finish with todo rows silently left open. The harness now keeps the model's own todo list in step with recorded evidence, with no prompt change:

- A successful tool call ticks the earliest open row whose tool hint names that tool (the `in_progress` row first). Hints match across separators, case and the provider's `functions.` prefix, so `functions.umami_list_websites` names `umami/list_websites`. Before, only seeded plans were auto-ticked, and only on an exact name.
- At the end of every strategy run, rows the ledger evidences are closed, and so are hint-less "compile / summarize / write the report" rows when the final answer was accepted. Each harness tick is a `checklist-item` status fact with `provenance` (`harness:evidence` or `harness:answer`) and the evidence call's `toolCallId`.
- Rows with no evidence stay open. They are listed as `unresolved` (reason `no evidence`) on `metadata.extensions.checklist`, along with `done`, `total` and `closedByHarness`, and traced as one `checklist-unresolved` guard event. Open rows do not change the run status: todo rows are advisory.
- Bookkeeping refund now also covers todo-only rounds on a list the model wrote itself, capped at 2 per pass and 4 per run. Seeded plans keep their half-budget cap.

`harness.autoTick: false` / `RA_AUTO_TICK=0` turns off the ticking. `harness.bookkeepingRefund: false` / `RA_BOOKKEEPING_REFUND=0` turns off the refund.

Cortex no longer blocks or warns about Code Action runs the framework allows. The up-front 409 and the strategy note now ask the framework's own `codeActionApprovalConflict` with the agent's real callable tools and approval policy, so the default approval gate only conflicts when a gated tool (for example `file-write`) is callable, and the message names the gated tools. `strategyApprovalConflictOf` in ui-core now words the framework's verdict (`refuse`, `gatedCallable`) instead of deciding it, and `StrategyApprovalConflict` gains `gatedTools`.

A chat can turn Durable runs on or off with the new `/durable` command (also a row under Limits in the Config list), so Stop, Pause and Continue work in a chat without a saved Lab agent. It sets the same `durableRuns` option as the Lab's Execution switch and applies from the next message. The "no saved run to continue from" hints in a chat now say "Turn on Durable runs with /durable".

**Breaking (types):** `TokenUsage.estimatedCost` is now optional (absent = price unknown), and `calculateCost` is deprecated, drops its pricing argument and returns `number | undefined`. Migration: handle `undefined` where you read `usage.estimatedCost`; replace `calculateCost(...)` with `priceFor(provider, model)` plus `priceUsage(...)`, or pass custom rates through `withModelPricing`.

Per-call cost now matches the provider's bill, from a bundled price source, and an unknown price is reported as unknown instead of guessed.

**Why your cost numbers change.** The old price table was hand-typed and fell back to a keyword guess for any model it did not list ("mini"/"flash" = cheap, "opus"/"gpt-4" = premium, everything else $3/$15). Every Gemini id matched "mini", so Gemini 3.x/4 were priced up to 25x too low; Claude Opus 4.5+/5.5, gpt-6, gpt-4.1, Groq and xAI models were priced up to 30x too high. Cache discounts were one fixed multiplier per provider (OpenAI 0.5x, Gemini 0.25x, Anthropic read 0.1x) although providers bill per model (gpt-5.x caches at 0.1x, Opus 5.5 reads at 0.05x). Long-context tiers were not modeled. Expect lower numbers for most OpenAI/Anthropic runs with caching, higher numbers for Gemini, and exact numbers for the audit's worked examples (e.g. claude-opus-5-5: $0.27375 before, $0.063 billed and reported now).

- **PriceBook.** Prices come from a committed snapshot of LiteLLM's `model_prices_and_context_window.json` (2026-11-19), filtered to Anthropic, OpenAI, Gemini, Groq, xAI and Mistral, cross-checked against the official price pages. Rates are stored in dollars per 1M tokens per model: input, output, cache read, cache write (5m and 1h), audio, long-context tiers and per-request web search. `priceFor(provider, model)` returns a model's price (`Option`) for UIs; `PriceBook` / `PriceBookLive` expose it as a service.
- **Full usage is priced.** Each adapter normalizes its usage (Anthropic 5m/1h cache writes and web searches; OpenAI-compatible cached and audio tokens; Gemini thoughts, cached content, tool-use prompt and audio tokens) and one pure `priceUsage` applies the model's rates.
- **Honest unknowns.** A model with no price has no `usage.estimatedCost` and `usage.priceSource: "unknown"`. `TokenUsage.estimatedCost` is now optional and `TokenUsage.priceSource` (`"provider-reported" | "price-book" | "user" | "unknown"`) says where a cost came from. Readers that sum `estimatedCost` must handle `undefined`.
- **LiteLLM.** Provider-prefixed ids (`openai/gpt-4o`, `gemini/...`, `groq/...`) price as the native model; cached tokens bill at the cache rate; the proxy's `x-litellm-response-cost` header is used as the call's cost (`"provider-reported"`); rates stated in `/model/info` are used for that proxy model name. The undocumented `usage.input_cost`/`usage.output_cost` fields are no longer read.
- **User pricing always wins** (`withModelPricing` / `pricingRegistry`), and now accepts optional `cacheRead`, `cacheWrite5m`, `cacheWrite1h`; omitted cache rates bill at your `input` rate. Anthropic structured output now applies it too (it was ignored).
- `openRouterPricingProvider` keeps OpenRouter's cache rates and adds Anthropic API ids (`claude-sonnet-4-6` for `anthropic/claude-sonnet-4.6`).
- `calculateCost` is deprecated and returns `number | undefined` (no guess for unknown models); its injected-pricing argument is removed.

Gateway lifecycle fixes. `handle.stop()` called while the gateway is still starting up now tears down everything startup acquires (heartbeat interval, channel subscription, router host, ingress port); before, startup finished after `stop()` and left the interval running and the port bound. A gateway configured with `withChannels({ routes })` whose router fails to start now stops and resolves `done` with a summary `error` (previously it logged once and kept running with no inbound channels). A rejecting route session `end()` no longer aborts router shutdown. The router host rejects with the tagged `RoutingError` rather than a `FiberFailure`. The legacy channel subscriber no longer drops a user's identical repeat message (dedup now keys on sender, platform timestamp and text, expires by clock, and schedules no per-message timer). A non-string webhook `metadata.instruction` is ignored instead of cast.

Memory studio: a Lab **Memory** tab to search, browse, edit and delete an agent's stored memory (facts, workflows, log), each entry linked to the run that wrote it. The run view's Memory tab now lists the memories that run wrote. All reads and writes go through the framework's `agent.memory()`; Cortex no longer opens a cwd-relative `.reactive-agents/memory/<agentId>/memory.db` (it found nothing for agents using the framework's `~/.reactive-agents` default).

A declared context window can now be applied to one resolution instead of the whole process: `resolveCapability(provider, model, { userNumCtx })` and `resolveCanonical(provider, model, { userNumCtx })` lift a fallback or inferred row to a `source: "user"` row for that call only, and `applyUserNumCtx(capability, numCtx)` is the same rule as a pure function. Probe, cache and static-table rows still win. `registerUserSuppliedCapability` (now exported from the resolver module, same public name) is deprecated: it writes a process-wide row, so one agent's `.withModel({ numCtx })` changed the window of every other agent on the same model id, and the first declared value won for good.

The Ctrl/Cmd+K command palette now matches the rest of Cortex. Commands are grouped into Navigate, Lab, Runs and Actions, each with an icon. The text that matches your search is marked, global shortcuts show as key hints, and an empty search says what to try. The best match is selected first, arrows wrap, Enter runs and Esc closes, and focus goes back to where it was. Screen readers get a combobox over a grouped listbox. Every Lab tab, Memory included, is now one command, and the palette no longer lists Beacon, Chat, Runs, Lab and Settings twice.

The kernel now honors a calibration mode. `KernelInput.calibrationMode` (`"auto"` default, or `"skip"`) reaches `selectAdapter` at the run-start profile merge and in the act and think phases, so a `"skip"` run applies no shipped model calibration (no `optimalToolResultChars` override, no calibrated adapter hooks). Runs that do not set it are unchanged. Each run with a provider also records one `capability-resolved` guard event (provider, model, source, tier, `recommendedNumCtx`, `supportsThinkingMode`).

`todo add`: a near-duplicate step that names a tool (structured or `(tool: x)` hint) now attaches that tool to the existing row when the row has none, instead of dropping it; the result says "set its tool to X". The local checklist fold handles the new core `tool` op.

Observer events now tell the truth about paused runs and iteration progress. A run paused for human approval or input no longer publishes `FinalAnswerProduced` with the pause notice as its "answer"; the pause is still reported through `awaitingApprovalFor` / `awaitingInteractionFor` and the stream's `RunPaused`. `ReasoningIterationProgress` now fires once per kernel iteration, 1-based, as documented. Before, a tool turn (think pass, then act pass) reported each iteration twice, the first time at the previous number (starting at 0). `LLMRequestStarted.provider` now names the real provider for string-model requests (it read `"unknown"`), using the same resolution as the completed event.

`SkillPromoted` and `SkillRolledBack` events published at the end of a run now carry that run's `taskId`, so observers can link a skill's lifecycle change to the run that caused it. `SkillRefined` from a manual `agent.refineSkills()` call has no `taskId`. Run-end rollback now waits for at least 3 uses since refinement, so one failure right after a refine no longer reverts it.

Anthropic `completeStructured()` now enforces the output schema. It forces one call to a tool whose `input_schema` is your schema (`tool_choice: { type: "tool" }`) and returns the tool input, instead of asking for JSON in the prompt and prefilling `{`. A non-object schema (an array, a union) travels as a `value` property and is unwrapped. When extended thinking is on for the call, Anthropic does not allow a forced tool, so that call keeps the prompt-and-prefill path. Anthropic now reports `nativeJsonMode: true` and `jsonSchemaEnforcement: true` from `getStructuredOutputCapabilities()`, so the structured-output pipeline uses its native layer for Anthropic before any prompt-mode fallback. Usage reporting and `LLMParseError` on repeated schema failures are unchanged.

Fix a CPU spin on long unbroken tokens: the deliverable-path matcher (`PATH_TOKEN`) was cubic on dot-free runs, so a message or tool result with a long run of one token (a minified one-line file, 65 KB+) pinned a core and the turn never reached the provider. It is now linear with identical matches.

Checklist items can now be marked `origin: "harness-derived"` (a checklist the harness derived from model output; such rows stay explicit or inferrable, unlike `"plan"` rows) and can carry an optional `tool` hint that survives the ledger fold into `ChecklistRow` and `planFromChecklist` / `planToChecklistSeed`. `PlanRecorded` and `PlanStepStatusChanged` events gain an optional `sessionId`. All additions are optional; existing data decodes unchanged.

`calibration-runner.ts --commit` now merges probe results into the existing calibration JSON instead of overwriting it. Probe-measured fields are replaced. Fields the probes do not measure (`actOrAnswer`, `classifierReliability`, alias maps) are kept; before this change they were silently deleted. New flags: `--probes <field,...>` runs a subset, and `--probe-timeout <seconds>` cancels a probe that runs too long and leaves its field unmeasured. Per-probe progress is printed to stderr. Together these let a large model be calibrated across several invocations. A partial measurement keeps the file's `probeVersion`/`calibratedAt`/`runsAveraged`, so a file is never stamped with a probe version that some of its fields were not measured at. New exports from the runner module: `measureCalibration` and `commitCalibration`.

Durable run stores no longer leak SQLite handles: `RunStoreLive` is now a scoped layer that closes its database when the providing effect ends, so `listDurableRuns`, `agent.listRuns()`, the run journal and checkpoint writes no longer leave one open file per call in a long-running host. New `defaultDurableRunsDir(agentId)` export is the one resolver for the default durable directory (`~/.reactive-agents/<agentId>`); the framework's write and resume paths use it.

Calibration: new `resolveModelCalibrationWithProvenance(modelId)` returns the calibration plus the source of each field (`"shipped"`, `"community"`, `"learned"`, `"default"`). Models with no shipped calibration now learn too: once 5 local runs are recorded they resolve to the framework defaults plus the learned fields, where before they resolved to no calibration. Values for calibrated models are unchanged.

`AgentConfig.reactiveIntelligence` now carries the data options of `.withReactiveIntelligence({...})` (entropy, controller, learning, telemetry, notice, models, calibrationDbPath), so `toConfig()` and `agentConfigToBuilder()` round-trip them instead of keeping only `enabled`.

Semantic and procedural memory rows now record which task and run wrote them. `SemanticEntry` and `ProceduralEntry` gain optional `taskId` and `runId` fields, stored in new nullable `task_id` / `run_id` columns. Existing databases migrate on open: the columns are added in place, old rows are kept and read back with no provenance, and full-text search keeps working. `MemorySource` gains an optional `runId`, and `provenanceFromSource(source)` turns a source into the fields to spread into an entry.

`ProceduralMemoryService.delete(id)` removes a learned workflow. `SemanticMemoryService.search(options)` runs a full-text search (LIKE fallback on Node's built-in sqlite) whose results carry provenance. `SearchOptions` accepts `taskId` / `runId` to narrow results to what one task or run wrote, and `MemorySearchService.searchSemantic` honors them too.

Unknown token halves are reported absent, never 0. When a provider reports only a total for some call, the run result omits `inputTokens` / `outputTokens` (a one-sided split is never published), and the debrief's `metrics.synthesisTokens` omits `input` / `output` the provider did not report. `tokensUsed`, cost and call counts are unchanged.

Local-tier tool-error recovery guidance now classifies errors by class, not substring. A policy refusal such as shell-execute's "background operator '&' is not supported (escapes the timeout)" no longer gets "timed out, try again" guidance; it is told the call was refused and must change. Real timeouts ("timed out after 120000ms", `ETIMEDOUT`) are recognized, 404 guidance needs an HTTP-status context instead of any "404" digits, and errors that already name the fix ("Allowed commands:", "Closest valid call", "Did you mean", "Valid:") get no extra recovery line.

The complexity router's tier classification and the preference learner's autonomy-confidence check are observation-only judgments. They now pass `priority: "shadow"` so the judgment service's concurrency gate bounds them. Routing and approval decisions are unchanged.

`.withCalibration("skip")` now reaches the reasoning request as `calibrationMode: "skip"` with no resolved calibration object (it was previously collapsed to unset). Other settings send `calibrationMode: "auto"` with the resolved value, so default runs are unchanged. `run-started.config.mechanisms.actOrAnswerSource` now reports `"default-off"` when act-or-answer was never configured, and `builder.calibration` records `"skip"`.

Rewrite the trace, diagnose and replay package READMEs to the package README standard: pitch, stability tier, install, verified usage, API table, docs links, runtime and license. The diagnose README now leads with `rax-diagnose cause` and `attribute` examples. The replay README example now type-checks standalone under the README example checker.

Cortex tooltips are back: icon buttons, chips and truncated labels show Cortex's tooltip on hover and keyboard focus instead of the browser's title. The Inspector Run trace tab reflows at narrow widths: loop label and stats on one line, the summary at full width, no nested card.

Stored skills now evolve. After each run, a used SkillStore skill is promoted (tentative to trusted, trusted to expert) when it crosses the confidence thresholds, publishing `SkillPromoted`; a refined version whose success rate falls below its rate at refinement rolls back to the previous version, publishing `SkillRolledBack`. `agent.refineSkills()` now actually refines: with memory on it rewrites each eligible skill's instructions through the agent's own LLM, saves a new candidate version, publishes `SkillRefined`, and resolves `{ refined, unchanged, skipped, failed }` (exported as `SkillRefinementResult`) instead of `{ refined: 0 }`. Everything stays opt-in: it needs memory on and `skillPersistence` not `false`, and refinement only runs when you call `refineSkills()`.

`.withReasoning().withMaxIterations(5)` now keeps the cap of 5. A bare `.withReasoning()` (no options) used to hand the strategy an unmarked default of 10, so the explicit cap was lost and the `max_iterations_clamped` warning printed the wrong value.

`SkillPromoted`, `SkillRolledBack` and `SkillRefined` gain an optional `taskId` field: the run whose outcome triggered the lifecycle change. It is absent for manual `refineSkills` passes. Observers can now tie a promotion, rollback or refinement to the run that caused it. Existing producers and subscribers compile unchanged.

`request_user_input` no longer tells the model the run "suspends durably". A live answer continues the same run, so the description now says the run waits until the user responds. The new wording is true on both the live and the durable path.

code-execute: module-style code now runs (single-line `import` is hoisted, `export` is dropped from declarations) instead of failing with "Unexpected export". Failure messages are always non-empty and cleaner: no temp-file path or Bun banner, a stated reason for silent exits and empty throws, a Docker-failure message that says nothing ran, and a hint that the working directory is `/tmp` when a relative file is missing.

Every strategy's kernel passes now run on the run's model settings, and a failed strategy body now ends like any other run.

- **Model facet.** `ReasoningService.execute` puts `providerName`, `contextProfile` and the new `calibrationMode` param on `RunEnvelope.rails`, and `runKernel` merges them onto every kernel pass. Before this, reflexion passes, tree-of-thought branches and plan-execute step kernels left them out. Those passes ran as provider `unknown` on the mid profile: a 2,000-token think budget instead of the frontier 4,000 plus thinking allowance, and a 32,768-token window instead of the model's real one. A `.withCalibration("skip")` run now skips the shipped calibration on every pass of every strategy. `providerName` and `contextProfile` are no longer fields of `CrossCuttingInput` / `PerPassInput`, so a strategy cannot drop them. Code that calls a strategy function directly (not through `ReasoningService`) must put these fields on the `RunEnvelope` it provides.
- **Strategy-body errors.** When a strategy body fails with an `ExecutionError` (a failed direct model call, an unparseable plan, a refused config), `runStrategy` no longer lets it escape. It mints a `failed` result through the shared terminal. The result keeps the run's steps, spend and run ledger, puts the cause on `error` as `Strategy execution failed (<strategy>): <message>`, and emits a `terminal_decision` with authority `strategy-error` (`rawTerminatedBy: "strategy_error"`). code-action's approval-policy refusal goes through the same path, before any model call. The refusal text (`code-action cannot honor .withApprovalPolicy(...)`) is unchanged, and so is the refusal policy.

`gh-cli`, `git-cli` and `gws-cli` are removed. A shell scoped to the named programs replaces them.

- New `scopedShellTool(programs, config?)` returns `shell-execute` that runs only those programs, e.g. `scopedShellTool(["git", "gh"])`. The model writes the full command (`gh repo view owner/name`). This removes the `gh gh ...` / `git git ...` failures the wrappers had (29% and 38% of their calls in 3,090 traces). The guard, sandbox, timeout and output cap are shell-execute's own. Anything outside the list, `;`/`&&` chaining into another program, `$(...)` and backticks are refused.
- The toolset alias `git` now expands to `shell-execute`. `BUILTIN_SHELL_PRESETS` lists its programs: `git` and `gh`.
- New `resolveBuiltinSelection(names)` returns the tool names, the programs the scoped shell needs, and a deprecation notice for each removed name. `"gh-cli"` and `"git-cli"` resolve to `shell-execute` scoped to their program. `"gws-cli"` selects no tool (see `tools-trap-heals`). `"all"` no longer grants git or gh: no shell is granted implicitly.
- The scoped shell keeps the old wrappers' posture: `requiresApproval: false`, `riskLevel: "medium"`. Plain `shell-execute` (`terminal: true`) is unchanged.
- When `git` is in the list, git reads a per-call copy of your global git config (`~/.gitconfig` or `$XDG_CONFIG_HOME/git/config`), so commits carry your name and credential helpers work. `GIT_AUTHOR_*` and `GIT_COMMITTER_*` are forwarded when set. Because it is a copy, `git config --global` in the shell never changes your real file. New `ShellExecuteConfig.inheritGitConfig` controls this; plain `shell-execute` does not inherit.
- The shell's host environment now forwards the Google Workspace CLI credential store (`GOOGLE_WORKSPACE_CLI_CONFIG_DIR`, default `~/.config/gws`) and its token variables, the same way it already forwarded `gh`'s. Before this, `gws` calls failed with 401 under the confined HOME.
- `git -C <dir> ...` is no longer refused as "git -c is blocked". The config-injection guard was case-insensitive, so the change-directory flag `-C` matched it. The guard is now case-sensitive and still refuses `-c key=value`, glued `-ckey=value`, quoted `'-c'`, `--config` and `--config-env`.
- The shell now refuses git options that run a program you name. These are `--upload-pack`, `--receive-pack` and their alias `--exec`, in any subcommand, with `=` or a space, quoted or abbreviated (`--up`). It also refuses `clone -u <cmd>`, and `--exec-path=<dir>`. The same applies to flags passed through `gh repo clone ... --`. `git push -u`, `git fetch -u` and the bare `git --exec-path` stay allowed. Side effect: `git rebase --exec` is refused too, because it shares the `--exec` spelling.

Cortex Settings and model page in the "Bench" design (steps 7 and 8 of the modernization plan), and the old visual layer removed.

- **Settings** has a section nav (Defaults, Providers, Notifications, Appearance, Storage, Developer, About) and one row per setting. API keys show as badges ("OpenAI", "Anthropic missing"), the copy says keys come from the server's environment and that Cortex needs a restart after editing `.env`, and a provider without its key reads "(key missing)" in the Defaults picker. The model hint no longer tells you to add a key "in Settings".
- **Appearance · Theme** can follow the system setting (and tracks it live), or pin dark or light. Theme and Motion apply at once; **Save settings** no longer writes them, so saving the form can't undo the top-bar theme switch.
- **About** shows the neural mark and the Cortex version. `GET /api/health` now reports the Cortex package version instead of a fixed `0.1.0`.
- The **model page** uses the same rows: a capability grid (context window, max output, tool calls, thinking), the remaining values, a note when the values are fallback defaults that also says how many recorded runs used the model and the largest run's tokens, and recent runs by name with their status.
- **Fill run variables** (Lab Run with `{{name}}` variables) uses the kit dialog and fields: sentence-case labels, "(optional)" instead of an asterisk, and no crash when the dialog opens.
- Material Symbols is gone: no icon font loads from Google Fonts, and every icon is inline SVG. The MD3 colour aliases, the legacy `--cortex-*` names, `gradient-border`, the gel progress bars, `hover-lift`, the old sonar rings, the grid behind every page, the neon `kbd` chips and the old gradient text class are removed, along with eight unused components.
- Runs fits narrow windows (Strategy, Steps and Time hide under 960px instead of clipping the table), and an empty chat no longer clips the top of its hero on short windows.

Asking the user no longer needs durable runs. `RunEnvelope.rails.askUser` is a new optional rail. When a host sets it, a `request_user_input` call is answered inline: the kernel calls the rail and puts the answer in the call's tool result (`The user responded: ...`), and the run keeps going. When nobody answers, the tool result says so (`The user did not answer: <reason>`). Without the rail, the run still pauses with `awaiting-interaction` as before. New exported types: `AskUserRail`, `AskUserRequest`, `AskUserOutcome`, `UserInteractionKind`.

Also in this release:

- `.withApprovalPolicy()` accepts `timeoutMs`. The in-process approval decider receives it as `timeoutMs` (new `PendingApproval` type). Unset means no change in behaviour.
- `ToolCallStarted` events now carry `args`, the call's arguments after healing, so a UI can show a running call before it completes.
- Every `extractStructuredOutput()` call publishes one `StructuredOutputReported` event with its provenance report, on success and on extraction failure. The report types now come from `@reactive-agents/core` and are re-exported unchanged.

`shell-execute` now refuses `find -fprint`, `-fprint0`, `-fprintf` and `-fls` (they write files), and refuses `find -exec`, `-execdir`, `-ok` and `-okdir` when the program they run is not on the allow-list, is a wrapper such as `env` or `xargs`, or is a `sed` / `awk` program that could run commands. The PII email pattern is now linear-time: an 80 KB adversarial input no longer blocks the event loop for seconds. Detection of ordinary addresses is unchanged.

Cortex Bench polish from a live QA pass (Beacon, Chat, Runs, run view, Lab, Settings, Model page at 1280, 768 and 1920, dark and light, reduced motion).

- Beacon Field: nodes no longer overlap. Each node takes its own slot sized to the Field, sub-agents sit in the row under their parent, and the Field scrolls when there are more agents than one screen holds. Only positions you drag are remembered; Arrange forgets them and re-groups delegation trees, then state lanes. The legend stays readable over scrolled nodes.
- Chat: below 1024px the session list is a drawer (at 768px it took a third of the width); the top-bar sessions button shows only when it does something.
- Chat `/tools` and the Tools settings list a selected tool Cortex does not offer (for example `calculator` from an older config) so it can be removed; before, it showed in the chip but could not be unticked.
- An abstained reply that already explains why no longer repeats the reason in the note under it.
- Run view: a chat run is titled by the message, not `--- Conversation history ---`; the trace shows one row per loop when the framework reports an iteration twice, and replay counts loops the same way; a run stopped or terminated before it reported completion shows its real duration; while the run loads, the trace, entropy and debrief say "Loading the run…" instead of "no loops recorded".
- The Answer preview drops markdown rules, list and quote markers and table rules, and keeps inline code text.
- The approval toast names the call and whether it came from a chat or a desk run, not the agent's id.
- The chat busy bar no longer animates while hidden.

A debrief is now its own setting, and sub-agent tools take typed input as a JSON Schema.

- `.withDebrief(enabled?)` (`AgentConfig.debrief`). A debrief used to exist only when memory was on. Unset, it still follows `.withMemory()`; `.withDebrief()` produces and stores one with memory off, and `.withDebrief(false)` turns it off with memory on. With memory off, only the debrief table is opened, in the memory database path (an in-process database for the test provider). The runtime also never provided the debrief store before, so a debrief reached `result.debrief` and the `DebriefCompleted` event but was not saved. It is saved now whenever a debrief is on.
- `.withAgentTool(name, { parameters })` accepts a JSON Schema object as well as a `ToolParameter` list. A schema is stored in `AgentConfig` (`agentTools[].agent.parameters`; a `ToolParameter` list is stored as the equivalent object schema, so `parameters` no longer drops out of `toConfig()`). The parent model sees the schema's top-level properties as the tool's parameters, and every call is checked against the schema: a violation fails the tool call with a `SubAgentInputError` and no sub-agent runs. A schema the validator cannot check throws `SubAgentParametersError` when declared.
- A sub-agent that calls a gated tool now asks the parent's live approval gate. A parent `.withApprovalPolicy({ mode: "detach" })` was coerced to `block` in the child, which denied every gated call when no `onApprove` was set, so a person was never asked. The child now waits on the same gate under the root run's id: `approveRun(rootRunId)` / `denyRun` answer it, the root stream's `ApprovalRequested` event and `listPendingApprovals()` carry a new optional `subAgent` (its name), and stopping or terminating the root run denies the child's wait. Dynamic sub-agents (`spawn-agent`) are covered.
- A sub-agent with memory off no longer opens the user memory database. Every sub-agent run used to create a `~/.reactive-agents/memory/sub-<name>-<timestamp>` folder; it now uses an in-process database.

Chat turns on one session are now serialized. Concurrent `session.chat()` / `agent.chat()` calls (and streamed turns) on the same conversation used to read the same history and each append their own user/assistant pair, corrupting the thread. They now queue first-in-first-out; a failed turn releases the queue, and a streaming turn holds its place until the stream ends or the consumer stops iterating. Error messages in the gateway, journal, finalize and error-suggestion paths now come from the shared `errorMessage` helper, so non-Error rejections with a `message` render it instead of `[object Object]`.

The approval gate asks the tool's `preflight` first. A gated call the tool is certain to refuse (for example a shell command outside the allowlist) no longer opens an approval request: the refusal returns to the model at once as a failed tool call, in block mode and in the kernel's detach pause. A tool without `preflight` behaves as before.

The gateway `generic` webhook adapter now has replay protection on by default. Senders sign `<timestamp>.<body>` and send `x-webhook-timestamp`; timestamps outside `replayWindowMs` (default 5 minutes) are rejected, and a signature already accepted inside the window is rejected as `replayed_delivery`. Failures are typed `WebhookValidationError`s with a new `reason` field. Breaking for senders that sign the body alone: update them, or set `replayProtection: false` on the webhook config entry (logs a warning per request). The GitHub adapter's delivery-id dedupe and the channels `WebhookChannelAdapter` replay window are now pinned by tests.

The reactive (and react) strategy card now shows the ReAct loop: one block per iteration with the model's thought, each tool action with compact arguments, and a one-line observation (failures marked), live while the turn runs with the current iteration highlighted, collapsing to "N iterations, M tools" when it ends. ui-core adds `reactLoopOf`, `reactLoopChip` and `compactArgs`, pure and derived from a turn's per-iteration text and tool calls, so a builder's own chat UI can draw the same view.

`web-search` accepts explicit per-agent API keys and an ordered provider list. New exports: `makeWebSearchHandler({ apiKeys?, providers? })`, `WEB_SEARCH_PROVIDERS` (ordered ids with the env vars each reads), `WebSearchConfig`. Explicit keys win over environment variables; providers without one fall back to env. Keys are scrubbed from error text. Default behavior is unchanged.

Cortex shows opt-in calibration truthfully. The model page labels learned values as applied only when learned calibration is on, and no longer claims a community profile is on by default. The Builder (and the chat quick config) has Learned calibration and Community calibration switches under Reliability, off by default, which write `.withCalibration("auto", { learned, community })`.

The kernel's `todo` handler now passes the run's checklist op history (this run's committed changes plus the changes staged earlier in the same turn) to `applyTodoChecklistAction`. New todo ids therefore come after the highest id ever issued in the run: after a `remove` or `clear`, an `add` never reuses a removed id, so the model cannot mistake a new item for the deleted one. Merged sub-agent changes are not part of the history, the same as for the list itself.

`Database` now loads its SQLite backend (`node:sqlite` / `bun:sqlite`) on the first `new Database(...)` instead of at import. Under Node, importing `reactive-agents` or running `rax-diagnose` no longer prints `ExperimentalWarning: SQLite is an experimental feature` unless a database is actually opened. `instanceof Database` is not supported; type against `DatabaseLike`.

`todo add` duplicate detection now uses core's shared `isNearDuplicateTitle` rule. Titles dedupe at 80% overlap of the larger title (was Jaccard), any 2+ token title contained in a larger one dedupes (was 3+ existing tokens), and `of`, `to`, `and` join `the`/`a`/`an` as ignored words.

Channel health is readable without reaching into adapters. `ChannelService.status()` adapters now report `platform`, `messagesReceived`, `messagesSent`, `lastInboundAt` and `lastSentAt` next to connection state, delivery failures and the last error. `WebhookChannelAdapter.handleWebhook` verifies and enqueues like `handleRequest` but fails with a typed `ChannelError`, so it fits the gateway's `IngressChannelRoute.handle` directly. `GatewayStatus` gains an optional `inboundQueue` (`ready`, `deferred`, `capacity`, `overflow`, `dropped`) and a `withInboundQueue` helper; the runtime fills it.

Add typed `ChannelDeliveryFailed` event (adapterId, kind, retryable, retryAfterMs?, conversationId?, taskId?) and optional `adapterId` / `conversation` fields on `ChannelMessageReceived`. Additive.

Channel router: an opt-in SQLite `RouterStore` (`openSqliteRouterStore` / `makeSqliteRouterStore`) keeps every accepted message in a durable inbox (`received`, `running`, `done`, `failed`, `dropped`). Dedupe and turn caps survive a restart, turns a crash left running retry up to `maxAttempts` then fail with a `channel.inbox.failed` event, and finished rows are pruned by age and count. Router status gains `inbox` counts. Routes gain `batchWindowMs` (join one sender's burst into one turn) and `midRun` (`queue` default, `fold`, `interrupt`); `RoutedTurn.takeFolded` lets a resolver drain folded text. Defaults are unchanged. `@reactive-agents/channels` now depends on `@reactive-agents/runtime-shim`.

A round in which every tool call was refused as a duplicate no longer spends an iteration of the budget. The loop bound is raised by one for it, the same bounded refund the todo-only round gets (one shared cap of half the original budget), and at most 3 such rounds in a row: only a call that ran resets the count, so an endless re-read loop still spends the budget after 3 free turns. Switch: `harness.bookkeepingRefund: false`.

`approveRun(runId, { gateId })` and `denyRun(runId, reason, { gateId })` answer exactly one waiting request. Parallel sub-agents ask under the root run id, so a person could not choose which one to approve; the oldest wait always took the decision. Without `gateId` behavior is unchanged, and the approval endpoint accepts `gateId` in its body. Sub-agent memory ids are now stable and parent-scoped (`sub-<parentAgentId>-<name>`) instead of embedding a timestamp, so repeat spawns reuse one memory store instead of creating a new folder each time; event and trace correlation ids stay unique.

Owner `/new` (and `/reset`) in a Telegram route served by the channel hub now clears that conversation's saved history, so the next message starts fresh. Routes gain a `resetCommands` setting (route editor: "Start a new conversation"; empty keeps `/new` and `/reset`, turning it off disables them), and the hub activity feed shows each reset as ok or failed without any message text. If the history cannot be cleared the owner is told instead of getting a false fresh start.

Rewrote the npm READMEs to the shared package README standard: pitch, stability tier, install, a working example, API table, docs link, runtime support and license. Fixed code examples that no longer matched the API, and the runtime-shim Node floor (22.5, not 20). The core, observability and testing examples now type-check against the real APIs.

Unknown hosted models no longer run on a 2048-token window. A model id with no static capability row on a hosted provider (Anthropic, OpenAI, Gemini, Groq, xAI) now resolves to a provisional 128,000-token window with native tool calling, instead of the local 2048-token fallback that dropped tools. The row keeps `source: "fallback"` (strict validation still flags it) and carries a new `provisional: true` field, which also appears in `describeCapabilityResolution` and the `capability-resolved` trace metadata. Groq and xAI keep their existing 131,072 window and are now flagged provisional too. LiteLLM gets no provisional window: a proxy often fronts a local model that truncates silently, so an unknown LiteLLM model keeps the conservative 2048-token fallback and its warning until `/model/info` reports its limits.

Capability discovery now covers Anthropic (`GET /v1/models/{id}`: input limit, output limit, vision, thinking) and LiteLLM (`/model/info`: input and output limits, vision, reasoning; the smallest limit wins when a model name has several deployments). OpenAI states no limits anywhere, so it relies on the provisional window.

When a provider rejects a request with a context-length or output-limit error that states the real limit (for example "maximum context length is 64000 tokens"), that limit is written to the model's capability, so the next resolve uses it. The mapped error carries it as `learnedLimit`, and `learnedCapabilityLimitFor(provider, model)` lists what was learned. Nothing is retried automatically. Static rows still win over discovered and learned values.

Concurrent discoveries of the same model now share one request.

Cortex chat renders the framework's plan. In Plan mode the reply is an editable checklist card (reword, reorder, remove, add steps, with each step's status and tool hint); Execute records the edited plan through `session.setPlan`, switches to Execute and sends the follow-up turn, and the plan is stored with the chat session (`GET`/`PUT /api/chat/sessions/:id/plan`). The executed plan keeps a read-only card with live step status. Plan mode turns the `todo` meta-tool on for the chat so the model records its plan itself. The run view's Events tab shows `PlanRecorded`, `PlanStepStatusChanged` and `ChatModeChanged`. `@reactive-agents/ui-core` exports the wire types `PlanWire`, `PlanStepWire`, `PlanRecordedWire`, `PlanStepStatusChangedWire` and `ChatModeChangedWire`.

Gemini model ids that are not in the built-in capability table, such as `gemini-flash-latest`, `gemini-pro-latest`, dated `-preview` ids and new versions, now get the capabilities of the nearest listed model of the same variant (pro, flash or flash-lite): the real 1M-token context window, thinking support and output limit. They used to fall back to a 2048-token window with thinking off. These rows have `source: "inferred"`. Listed models are unchanged. Non-text models (embedding, TTS, image, live) and ids with no recognizable variant still use the fallback.

The plan-sized iteration budget is now staged. A plan-seeded run starts with half of the raise (for example 17 of a 23-iteration target at `maxIterations` 10) and gets the rest only when it made progress since the raise: a checklist row completed or a tool step succeeded. A run that stalls ends at the first stage instead of spending the full extra budget. The `plan_budget_raised` guard event now carries `stage`, and the second stage records its own `plan-budget` signal. The plan budget is opt-in (off by default): enable it with `.withHarness({ planBudget: true })` or `RA_PLAN_BUDGET=1`.

**Security:** a `before act` hook can now stop a parallel tool batch. With parallel batching on (`nextMovesPlanning.allowParallelBatching`), the kernel used to fire `before act` hooks only after the batch's tools had already run, so a killswitch such as `requireApprovalFor` could not block them. Block-mode approval was not affected.

`before act` hooks now fire once per tool call, before any call of the turn executes, on every path (serial, parallel batch, meta-tools). During each fire, `state.meta.pendingToolCalls` holds exactly that one call, with its healed name, so a misspelled tool name cannot get past a deny list. A hook that aborts stops the whole turn: no call of that turn runs, including calls listed before the denied one. Before this change each serial call fired the hook twice, once before it ran and once more after the turn.

Strategy results now carry `metadata.kernelIterations`: the kernel turns the run took, summed over its kernel passes and relayed through delegating strategies. `stepsCount` is unchanged.

The observability file exporter now redacts secrets before writing JSONL. Log messages, log metadata, span attributes, span event attributes and metric labels pass through `defaultRedactors`; previously a secret in a logged message landed on disk unredacted. Pass `redactors` to `makeFileExporter` to use your own list, or `[]` to disable.

Cortex can listen and speak. The chat composer has a mic button (click to start and stop, or push to talk) that puts what you say into the box at the cursor without touching what you typed, with an optional send after a quiet moment. Every agent reply, the run view's Answer and the whole conversation can be read aloud, a sentence at a time, with play/pause, speed, voice and the sentence highlighted; code blocks and tables are announced, not read. A hands-free voice mode listens, sends on silence, reads the reply and listens again, with barge-in, an always-visible Stop and Interrupt, and approvals and questions left to a click. Settings · Voice picks an engine per direction: the browser's own (default, nothing to install) or any OpenAI-compatible `/audio/transcriptions` and `/audio/speech` endpoint (local faster-whisper-server, whisper.cpp, Kokoro, Piper wrappers, or a cloud), with presets, a Test button each and honest status lines. Endpoint keys are saved in the encrypted key store and never reach the browser; Cortex relays audio and stores none.

`@reactive-agents/ui-core` adds the framework-agnostic voice layer (additive): `SttEngine` / `TtsEngine`, browser and remote engines, `createDictation` / `applyDictation`, `createReadAloud`, `speakableOf` / `chunkSpeech` / `isEcho` / `locateInText`, and the pure voice-mode reducer `voiceModeReduce` with `IDLE_VOICE_MODE`.

Cortex also drops two bridges the framework no longer needs: `AgentSession.chat` / `runStream` take text plus content parts directly, and `listPendingApprovals` rows carry `subAgent`.

New harness mechanism: the budget answer turn (`harness.budgetAnswerTurn`). It is on by default; turn it off with `harness: { budgetAnswerTurn: false }` or `RA_BUDGET_ANSWER_TURN=0` (the default change itself is described with the recall changes). A run that holds tool evidence and has only the answer left makes its last think call with no tools, so the model writes the answer from what it gathered. Without it, that last call can go to a tool whose result arrives after the run ends ("The run stopped (max_iterations) before the model wrote a final answer"). The harness never writes the answer. A run with no evidence still fails honestly. An ablation over 3 model tiers measured +1.9pp, which is within noise.

With the answer turn on:
- A reply that passes the checks ends the run `completed`, with `terminatedBy: "final_answer"`. Before this change it ended `partial` / `max_iterations`.
- The answer turn is not taken while the task still asks for an action that has not been done ("file a report using the report tool"), even when the compiled contract lists only the answer.
- A tool call on the no-tools turn is never run.
- A soft guard (stall, early stop) that fires on the second-to-last iteration also gets one answer turn with no tools. With it off, that guard gets no extra turn: the run ends as the gate decides (handoff of the draft, or an honest failure).
- A run that spent its cap on the answer turn and is resumed with `resumeRun` gets its tools back on the first resumed call, and its own answer turn under the raised cap. The resumed run also starts its low-delta streak at 0, so the stopped run's stalled passes no longer end the resume on its first pass.

When the last call is the answer turn it carries no tools, so a run stopped at its cap leaves no tool call pending for `resumeRun` to run. A run whose last call kept its tools (the answer turn off, or not taken) still resumes its pending call.

Reflexion kernel passes now draw on the run's configured `maxIterations` instead of a fixed 3: each pass gets an even share of the budget still left (at least 2 iterations). `reflexion.kernelMaxIterations` still overrides it. Plan-execute step kernels use the same shared helper (`strategies/budget/iteration-budget.ts`) with the same budget as before.

Learned and community calibration are now opt-in. With `calibration: "auto"` (the default when reasoning is on), a run resolves only the calibration shipped for its model. Opt in with `.withCalibration("auto", { learned: true, community: true })`:

- `learned`: once a model has 5 recorded runs on this machine, the observed behavior (parallel tool calls, tool-classifier reliability, act-or-answer forcing) overrides the shipped assumptions. This helps most for models with no shipped calibration. Runs are still recorded locally under `~/.reactive-agents/observations` when this is off, so turning it on later uses the history you already have. Nothing is uploaded.
- `community`: one GET request per model to the community profile endpoint (the model id is in the URL), cached on disk for 24 hours. `DO_NOT_TRACK=1` and `REACTIVE_AGENTS_TELEMETRY=0` still block the request.

**Breaking default:** before this change, both tiers were on with no option set. An agent that relied on learned values or the community profile now runs on the shipped calibration (or the generic defaults) until you opt in. The undocumented `reactiveIntelligenceOptions.communityCalibration: true` key still turns the community tier on. `resolveModelCalibration*` called directly still applies local observations unless `localObservations: false`.

`.withHarness({ budgetAnswerTurn })` is now accepted, serialized by `toConfig()`/`fromConfig()`, and recorded in the `run-started` config as `mechanisms.budgetAnswerTurn`. Default on: when the run holds validated tool evidence and only the answer is missing, the last think call the iteration budget allows ships with no tools so the model writes its answer. Opt out with `.withHarness({ budgetAnswerTurn: false })` or `RA_BUDGET_ANSWER_TURN=0`.

Security: closes four ways a tool call could act outside its sandbox.

- `shell-execute` no longer lets `sed` or `awk` run commands or write files. `echo id | sed e`, `sed '1e id'`, `sed 's/a/b/w/tmp/f'` and `awk '{print $0 |("id")}'` ran host commands or wrote outside the sandbox with the default allow-list. The `sed` and `awk` programs are now parsed and refused unless every construct is known safe (`e`, `w`, `r` commands and flags, `-f` script files, `system()`, `getline`, pipes, `print > file` and `ARGV` are refused; comparisons like `awk '$3 > 5'` still work). `sort --compress-program` is refused too.
- `shell-execute` now path-checks option values, so `sort --output=/tmp/x` and `sort -o/tmp/x` can no longer write outside the sandbox.
- `recall` can no longer read arbitrary files. A model-written `[SPILLED_TO_DISK:/path]` value is no longer dereferenced: spill markers resolve only to files inside the spill directory (symlinks resolved), and `recall` refuses to store content that starts with the marker.
- `grep` can no longer escape the file root through a `glob` such as `../other/*` or an absolute glob, or through a sibling directory sharing the root's name prefix (`/work-secret` vs `/work`).
- `file-read`, `file-write`, `file-edit` and `file-list` now resolve symlinks before confining a path, so a link inside the working root that points outside it is refused. Writes to paths that do not exist yet behave as before.

Strategy cards on every chat path and every strategy. A turn resumed by an approval decision or by Continue now streams its strategy steps and stores the settled card, as a normal turn does (before, a paused then resumed code-action turn showed no card). The card now says something useful for each registered strategy: adaptive names the strategy it chose and why ("Adaptive → Reflexion", "chose Blueprint (by task shape)"), direct reads "answered in one pass", and plan-execute, blueprint and rewoo summarise steps, failures and plan revisions. ui-core adds `adaptiveChoiceOf`, `adaptiveChoiceLine`, `planProgressOf`, `planSummaryOf`, and an optional `note` on a strategy step and row; a registry-level conformance test fails when a registered strategy has no meaningful card.

Plan strategies (plan-execute-reflect, blueprint, rewoo) now keep each step's history: started, retry, patched, failed (with the reason), done, reflected. The card shows per-step badges ("retried 2 times", "patched", "failed") with the history one click away, the chip counts retries and patches ("3 steps, 1 failed, 2 retries, 1 patched"), and all of it persists after the turn and on reload. The card also shows beside the plan card when a step retried, was patched or failed. Adaptive's pick is read from the framework's structured `strategy-choice` payload first, with the narration parse only as a fallback; plan steps read the structured `plan-step` payload first, with the `kernelPass` labels as fallback. ui-core adds `planStepsOf`, `planStepBadgesOf`, `planStepEventLine`, `planStepPayloadOf`, `strategyChoicePayloadOf`, and a per-row `history` and `choice` on `StrategyRow` (stored runs carry them, bounded by the new `maxHistory` and `historyChars` caps).

Compare two runs. Select two runs in Runs and press **Compare**, or choose **Compare with…** in a run's More menu, to open `/runs/compare`: outcome, tokens, cost, duration and output speed side by side, the resolved config settings that differ, and, when both runs recorded a trace, the framework replay diff (`diffTraces`) laid out by loop with the first divergence marked and a line diff of the two answers. Runs without a trace are compared on their summary and config. API: `GET /api/runs/compare?a=&b=`.

`shell-execute` now allows a redirect whose target is exactly `/dev/null`: `2>/dev/null`, `>/dev/null`, `1>/dev/null`, `&>/dev/null`, `>>/dev/null`, `2>>/dev/null`, `>&/dev/null` and `</dev/null`, with the target quoted or not. Before, the "writes to /dev/ are blocked" rule and the sandbox path check refused them, and models lost turns retrying. Every other `/dev/` target is still refused (`>/dev/sda`, `>/dev/tcp/host/1`, `>/dev/null2`, `>/dev/null/x`, `>/dev/./sda`). The target word ends at the next operator, so `2>/dev/null>/etc/x` is still refused. A custom `blockedPatterns` list still sees the command as written. The read-only git/gh shell is unchanged: it still refuses every output redirect except a descriptor dup.

Add the `InteractionQuestion` and `InteractionQuestionOption` types: the structural shape of one question in a structured `request_user_input` interaction. Additive; the `InteractionResponse` shape is unchanged.

PII detector precision and recall fixes:

- An undashed 9-digit number is flagged as an SSN only when SSN wording ("SSN", "social security number") is nearby. Order ids and counts no longer trip it. Dashed SSNs are still always flagged.
- A credit-card match must now pass the Luhn check, so arbitrary 16-digit ids are not flagged. Amex numbers (34/37, 4-6-5 grouping) are now detected.
- International phone numbers (`+44 20 7946 0958`) are now detected.
- UK postcodes whose outward code ends in a letter (`SW1A 1AA`, `EC1A 1BB`, `W1A 0AX`) are now detected.

Run telemetry `strategySwitched` now reads the run's recorded `StrategySwitched` history instead of the `strategyFallback` flag. A strategy body error is no longer reported as a strategy switch, and a real mid-run switch is now reported as one.

Anonymous run telemetry is now opt-in. An agent with no telemetry setting sends no run report to api.reactiveagents.dev, creates no install id, and prints no "Reactive Intelligence" telemetry notice. To opt in, use `.withReactiveIntelligence({ telemetry: true })` (or `{ telemetry: { enabled: true, endpoint } }`), or set `REACTIVE_AGENTS_TELEMETRY=1` (or `true`) in the environment. An explicit `telemetry: false` beats the env opt-in. `DO_NOT_TRACK=1` and `REACTIVE_AGENTS_TELEMETRY=0` still turn telemetry off, even over an explicit `true`. The local run observation on disk (`~/.reactive-agents/observations`, used by local calibration) is still written when telemetry is off. When you opt in, the once-per-process notice still prints, and a run with telemetry off no longer uses up that notice.

The todo wrap-up turn is now opt-in. Before, when the model's final answer would be accepted while todo rows it had opened were still open, the harness always held the answer for one extra model turn to reconcile them. That turn costs a model call and has not been measured by an ablation, so it is now off by default. Set `RA_TODO_WRAPUP=1` to turn it on.

`@reactive-agents/trace` now describes every failure cause in plain words and lists the next steps the diagnosis can justify. `causeDescription(cause)` (table `CAUSE_DESCRIPTIONS`) and `causeNextActions({ cause, subCause })` are typed over the closed `FailureCause` union, so a new cause fails typecheck until it has words. Next steps follow from the cause and its sub-cause only (for example `provider-error` / `model-not-found`: "Check the model name; for Ollama, pull the model first."); a user stop or a healthy run has none. `loadTrace` also accepts JSONL text as `loadTrace({ text })`, and `parseTrace(text)` parses it synchronously.

`rax-diagnose cause` prints the cause's meaning and its next steps under the evidence; `--json` adds `description` and `nextActions`.

`ToolService.execute` now treats missing or null `arguments` as `{}`, so a zero-argument call such as `list_websites()` from a code-action sandbox runs instead of failing with `Object.keys` on undefined. A non-object `arguments` (array, string, number) returns a `ToolValidationError` that names the tool and shows the expected object shape. New export `normalizeToolArguments`; `validateToolInput` now accepts `unknown` arguments.

README rewrite for eval and verification, and a first README for judgment, following the package README standard: pitch, stability tier, install, a runnable example, API table, docs link, runtime and license. Fixes the dead eval docs link and removes a verification config example that did not match the real builder options. README code examples now type-check (eval cases carry the required `name`, verification sets the model with `.withModel`).

Route acks can be written by the agent instead of fixed text. Set `ack: { source: "model" }` on a route and the router sends, when the ack delay passes, the agent's own pre-tool narration if the turn already produced any (pushed through the new optional `RoutedTurn.onProgress`), else a one-line text from the new optional `RoutedSession.acknowledge(turn)` (bounded by `ack.modelTimeoutMs`, default 3000, 1 to 10 000), else the canned text. Still one ack per turn, never agent history, never after the final reply, and a failing or slow port never fails the turn. Model text is sanitized (markdown stripped, one line, 300 characters). The default stays `source: "canned"`. `ChannelTurnAcknowledged` gains an optional `source` (`"canned" | "narration" | "model"`).

Under plan posture the `todo` checklist is the durable plan. Its result now closes with `Plan recorded (N steps). Present it to the user; execution starts from this list.` instead of telling the model to stop and not start work. Execute posture output is unchanged.

Channels now emits the typed core events `ChannelSendFailed` and `ChannelFollowUpScheduled` / `ChannelFollowUpFired` / `ChannelFollowUpCancelled` instead of `Custom` events. Event names and fields are unchanged; consumers that matched `Custom` with `type` and `payload` now match on `_tag` directly.

Rewrote the tools, guardrails and identity READMEs to the shared package README standard: pitch, stability tier, install, a verified usage example, API table, working docs links and runtime note. Removed an unsourced healing-recovery percentage, relative links and a broken MCP docs link. The identity README now declares the experimental tier (no builder wither, services used directly).

Built-in tools now absorb three recurring call faults found in recorded runs. A lone string sent under the wrong key heals to the required parameter, including an array one (`crypto-price({symbol:"BTC"})` becomes `{coins:["BTC"]}`), and the missing-parameter example for an array parameter shows real items instead of `[]`. `file-read` and `list-directory` read the file under the working root when the model names a doubled or foreign root that does not exist (`/workspace/a.txt`), report the path used in a `note`, and still refuse real outside paths, `..` segments, credential paths and symlink escapes. `file-write` is unchanged. `todo` with a sentence in `action` and an `items` list is treated as `add`.

The strategy bandit now rewards a strategy only when its run succeeds. The reward used to be low mean entropy, so a strategy that failed confidently counted as a win and "best strategy" meant "most confident". `partial` and `failure` runs now count as losses; entropy still feeds calibration. Arm stats persisted under the old rule load unchanged and keep accumulating. New export: `banditReward(outcome)`.

`readBanditArmStats(dbPath)` now opens the DB read-only. It no longer creates the file, the `bandit_arms` table or the WAL pragma, and returns an empty list when the file or table is absent.

Three outcome fixes found by the deterministic shape zoo. (1) `actOrAnswer` (`true` and `"proactive"`) no longer forces another call of a required tool the model has honestly declined over after it only ever failed (2+ failed calls, no success): the abstention now stands instead of turning into repeated failing reads. (2) The always-on fabricated-measurement check no longer fails a run for a bare time projection ("100000 items takes 650 ms") when a tool printed timings and the answer makes no comparison claim; the answer ships with an advisory verification warning. Invented before/after or improvement claims, and runs with no timing evidence, still reject. This is default-path: runs ending `failed` on such a projection now end `done` with a warning. (3) `leanFinalTurn` (opt-in) waits until each prose-named read object ("read the first report and the second report") has a tool call, so a tool-less partial reply can no longer end the run.

A routed turn that fails after the route accepted it (`turn_timeout` or any other turn error) now sends the sender one short fixed notice instead of staying silent after the ack. The timeout notice names the route's `turnTimeoutMs` in seconds. Not sent for simulations, missing adapters or denied messages; a failed send is swallowed. New optional route field `failureNotice` (default `true`; `false` opts out). `ChannelTurnCompleted` is unchanged.

Cortex Lab in the "Bench" design (step 6 of the modernization plan), plus fixes found while checking Beacon.

- The **Builder** has three columns: a section nav (Model, Persona, Reasoning, Tools, Shell and workspace, Sub-agents, Skills, Memory, Guardrails, Execution, Reliability, Observability, All framework options) with **Find a setting**, the chosen section's settings, and **Run this agent**: On demand or Gateway process, name, task, a summary of what will run (model, strategy, tools, workspace) and **Save and run**, **Save** or **Run without saving**. Shell and workspace and All framework options are now sections of their own.
- The Lab header has **Import**, **Export** and **Load example**; the stat cards are gone. Tabs show counts: Builder, **Saved agents** (now `/lab#agents`; old `#gateway` links still open it), Skills, Tools, Prompts.
- Saved agents, Skills, Tools (catalog, inspector, test runner, custom tool and MCP server forms) and Prompts use Cortex's own components and icons: readable sizes, sentence-case labels, both themes.
- Desk **Stop** now ends a run that is busy inside a long model call: if it has not stopped a few seconds after Stop, Cortex ends it like Terminate. **Terminate** no longer leaves the run **Failed** with "ManagedRuntime disposed"; both end the run as **Stopped**.
- A desk run paused at an approval gate (or on a question) reads **Waiting on you** in Runs, the run view and Beacon instead of Running.
- Toasts no longer cover the Run button on Beacon's prompt bar; they sit above it.
- The run view title no longer shows an agent id used as the run's label; it falls back to the chat or the task, as Runs does.
- Fixed: confirm dialogs (Terminate, delete), the workspace picker, the export dialog and the command palette lost their layer and layout after the token update and could open under the page.

code-action: generated code may call a tool with no argument (`tool()`) or `tool(null)`; the call reaches the tool as `{}` instead of failing with `undefined is not an object (evaluating 'Object.keys(args)')`. A non-object argument throws an error into the generated code that names the call shape, e.g. `search takes one object argument, e.g. search({ query: value })`, and the tool does not run. The prompt and tool declarations now show that zero-argument calls are allowed. When the same sandbox error repeats on two iterations in a row, the run stops early as failed and names the error, instead of retrying until the iteration cap.

Export as code now prints the framework's own `agentConfigToSource` output (new `POST /api/agent-config/source`) for the Lab Builder and saved agents, instead of a Cortex-written exporter that covered about 15 fields and mapped memory wrong. The export lists the settings Cortex applies that the code does not contain, and never prints a secret: a saved API key is left out and MCP `env` / `headers` values print as `process.env` references.

Cortex chat: the Tools chip counts the tools of the MCP servers turned on again (label "web-search +5", tooltip "web-search; umami: 3 tools (...)"). Regression since attaching a server stopped writing its tools into the chat tool list. A server with no cached tools is listed on demand and shows "listing tools" or why it could not connect.

Cortex can keep a local Speaches speech server running. Settings > Voice has a new opt-in, "Keep the local speech server running" (off by default; it lets Cortex run `docker` on this machine). When on, Cortex checks the loopback endpoint at startup, when voice is used and every minute; if it is down it starts the `cortex-speaches` container or creates it (CPU image, or the CUDA image with `--gpus all` when Docker reports an NVIDIA runtime; `--restart unless-stopped`, port published on `127.0.0.1` only), then downloads the configured speech-to-text and text-to-speech models through the server's model API. Settings shows Checking, Starting, Downloading models, Ready or Failed with the last error and a Retry button; three failed attempts stop until Retry. A reading or transcription that finds the server down brings it back and retries once. New routes: `GET /api/voice/local/status`, `POST /api/voice/local/ensure`, `POST /api/voice/local/keep-running`. Docker runs only for loopback endpoints, from a fixed container name and a two-image allowlist, as argv (no shell), and only when Cortex listens on loopback or has `CORTEX_TOKEN`.

Any durable run that did not complete can be continued where it left off with `agent.resumeRun(runId, { note?, extraIterations? })`: a user stop or pause, an error, a spent iteration budget, a timeout, a loop stop or a crash. The run row and `result` carry a typed `stop` record (`kind`: `user-paused`, `user-stopped`, `error`, `crash`, `loop`, `budget`, `timeout`), `RunStatus` gains `stopped`, and `resumable` is true for every non-completed run that has a checkpoint. New `agent.pauseRun(runId)`, `agent.stopRun(runId)` (take effect at the next iteration boundary; a running tool finishes and is journaled) and `agent.activeRunIds()`. An interrupted run's final checkpoint is the state after its last finished iteration, so resume repeats no completed step; a failed tool call is not recorded as done. A resumed run is a durable run again (checkpointed, live, pausable). A run that ends with a failed result is now marked `failed` (it was `completed`). `resumeRun` options are refused only for a run that already completed.

Also: `agent.plan({ strategy: "blueprint" | "plan-execute-reflect" })` plans with that strategy's own planner (no tool runs) and returns its plan; `commandPolicy` of a command-running tool now reaches the kernel tool schema so plan prompts can show the allowed executables.

Cortex UI polish. A run that hit its step limit while the model's last tool call was still waiting now reads "The run reached its step limit before the model's last tool call could run. Raise the step limit or Continue." in Why it ended, not "At fault: Harness: tool call dropped". Chat shows one card for a stop: when Continue is offered for a step-limit, loop or timeout stop, the generic "Run error" note is dropped, and so is the inline "Stopped by you" note when Continue is offered for your own Stop or Pause. The approval card shows a tool call's parameters once (summary rows, or the full text after Show full parameters, never both). The Beacon hero's idle sonar rings are a little stronger so they read on the dark background.

A run is no longer marked failed when its only unmet item is the generic "answer" requirement and every declared deliverable (for example a file the task named) verifiably landed. The artifacts are the answer, the same rule the empty-output check already uses. A rejected verdict, a failed verifier check or any outstanding requirement still fails the run.

Telemetry and local learning now record the same outcome as the run's result and debrief. Before this fix, a run the runtime failed after the kernel finished (for example, no call to a required tool succeeded, or a declared deliverable was not produced) was sent in the telemetry `RunReport` as `outcome: "success"`, and its applied procedural skill was credited with a success. Both lanes now read the debrief's outcome, which includes runtime vetoes and the verifier gate. A run paused at an approval gate or a pending interaction now gets no debrief, no telemetry record and no learning update. The resumed run records its outcome when it ends.

The repetition guard now blocks a repeated tool only when it stops producing new information, not when its name has been seen a set number of times. Read-only query tools (for example `get_*`, `search`, `list_*` and MCP query tools) with distinct arguments keep running while their results keep changing; an agent analysing site metrics can query `umami/get_website_metrics` by url, referrer, country and browser without hitting "You have already called ... 4 times". The guard steps in when the tool's last 2 results were empty, failed or repeated earlier results (the nudge then says so), and a hard backstop stops distinct calls of one tool after `max(review point, ceil(maxIterations * 0.75))` calls (8 at the default 10 iterations; the review point is 4 for parallel-safe tools and 2 for others). A stalled requirement now only adds its "evidence is exhausted" note for the tool whose results it tracks.

The channel hub now runs the framework's durable SQLite inbox, outbox and follow-up timers on the Cortex database. After a restart or crash an orphaned turn is retried once, a redelivered message does not run twice, and a reply left pending is sent. The hub header shows inbox, outbox and timer counts instead of the in-memory note. `CORTEX_CHANNEL_INBOX=memory` restores the in-memory behavior.

Desktop notifications now fire. Settings · Notifications only saved a preference and sent a test; nothing listened to runs, approvals or questions, so no real event ever notified. A finished or failed run, an approval waiting on you and a question from an agent now notify (per the chosen level) when Cortex is in the background, whichever page or server-side trigger started the work. The level applies at once, browser permission is what enables notifications, and the Send a test button uses the same path as real events.

`planBudget` is a first-class harness key and is **off by default**. Turn it on with `.withHarness({ planBudget: true })` or `RA_PLAN_BUDGET=1`; explicit config beats the env. It ships opt-in because the 2026-11-16 plan-posture ablation measured +15-36% tokens with no accuracy lift. `planBudget` and `wrapUpReserve` are recorded in the run-started mechanism config so runs replay and diagnose with the budget they ran under.

Tool approval no longer needs durable runs. `.withApprovalPolicy({ mode: "detach" })` used to fail `build()` without `.withDurableRuns()`. Now, on an agent without durable runs, a gated tool call waits in process until a person answers:

- `runStream()` emits `ApprovalRequested` (`runId`, `gateId`, `toolName`, `args`) at both densities and stays open; after `agent.approveRun(runId)` or `agent.denyRun(runId, reason)` the same run continues on the same stream.
- `approveRun` / `denyRun` answer a run waiting in this process first and resolve with that run's final result; otherwise they resume a durable pause as before.
- `listPendingApprovals()` lists live waits too, and works without durable runs.
- `run(task, { onApproval })` answers live waits as well (before, it only drove durable pauses).
- `stop()` while waiting denies the call; `terminate()` cancels the run.

Durable runs stay the backend for answers from another process or after a restart; agents that pair `detach` with `.withDurableRuns()` behave as before. `.withUserInteraction()` still requires durable runs. It now round-trips through `toConfig()` / `fromConfig()` as `userInteraction: true`.

Also: an abstained run no longer trains the reactive-intelligence strategy bandit. The bandit rewards the run outcome, and abstention counted as a failure, so an honest abstention scored as a loss for its strategy. Abstained runs now skip the learning-engine update (no bandit or calibration sample).

`rax-diagnose cause` reads a run aborted with the stamped reason `guardrail` as `aborted/guardrail-block`, the same cause a guardrail block already gets from its error tag. `RunAbortedEvent.reason` now uses core's `RunAbortReason` instead of a copied union.

code-action no longer reports a run as a success when its code returned an error instead of an answer. When the value the code returns is only an `{ error }` object, or every tool call the code made failed, the strategy treats the result as a failed check. It retries while iterations remain and, at the cap, ends the run `failed` with the reason as its error. A tool output with `success: false` now throws into the generated code instead of resolving as a value. Tool results that are JSON text (how MCP tools return data) reach the code decoded, so code can read their fields. Before this change, an MCP result arrived as a string and code that read `result.websites` found nothing. The code-action prompt now says so: each tool function returns an already-parsed value (objects or arrays for JSON results, strings otherwise), and the model is told not to call `JSON.parse` on it.

`rax deploy --mode sdk`: the generated server now requires `Authorization: Bearer <RAX_API_KEY>` on `/chat` and `/chat/stream` (a random key is generated and printed once at startup when `RAX_API_KEY` is unset), rejects request bodies over 1 MiB, and no longer sends `access-control-allow-origin: *`. `/health`, `/ready` and the agent card stay open. **Behavior change:** existing clients must send the key; browser apps on other origins need a gateway in front.

The strategy card now stays on a chat turn after it ends (finished, stopped or paused) and after a reload, collapsed to a one-line summary ("Reflexion · 2 rounds, accepted", "Tree of Thought · 9 nodes, best 0.80", "Code action · 1 attempt, verified"). Cortex stores the settled strategy run with the turn trace (additive; older turns show no card). ui-core adds `strategyRunForStorage` / `strategyRunFromStorage` to bound and read a stored run (long code, output and critique text is clipped). A Paused reply's Continue card now reads "Paused by you" instead of "Stopped by you". Strategy phases no longer fall back to a raw "Main" label: the reflexion first pass reads "Drafting", the other unmapped kernel phases (plan-execute `schedule`, blueprint `degrade`, tree-of-thought `bfs-skipped`, adaptive `heuristic` / `classifier-skip` / `cost-downgrade` / `fallback`) have labels, and a conformance test scans the reasoning source so a new emitted label fails until mapped.

The thin loading bar at the top of a chat session now sweeps for the whole time a reply runs (it was wired only to history actions such as rewind and compact, so it sat still during runs). It is indeterminate, calmer while a Stop or Pause waits on the server, and shows a steady accent line under reduced motion.

`request_user_input` accepts a `questions` list: several typed questions in one call (text, single-choice, multi-choice, boolean, number) with options, required, default, min/max, maxLength and allowOther. New `parseRequest`, `validateAnswers`, `timeoutAnswer` and `formatAnswerErrors` turn the host's answers into a typed map keyed by question id, with per-question and overall status, and reject invalid answers with per-question errors the agent can fix. The old `kind` / `prompt` / `schema` call still works and is normalized to the same questions. Hosts must call these helpers to use the new shape (the interaction layer wiring is separate).

Plans are portable: `planToMarkdown`/`planFromMarkdown` (lossless GFM checklist with a front-matter block; also reads hand-edited Markdown), `planToJSON`/`planFromJSON` (schema-validated, versioned envelope) and `planToHtml` (self-contained, escaped, print-friendly). Parsers return `Either<Plan, PlanParseError>` and never throw.

`.withModel(model, { numCtx })` now applies only to the agent that declared it. The builder used to write the window into a process-wide capability registry, so in a long-lived process every later agent on the same model id inherited the first agent's window (context budget and ContextPressure events), and the first declared value won for good. The window is now passed per agent to the context profile, build validation, the LLM observability wrapper and the structured-output calibration check, and no registry row is written.

Cortex no longer runs judgment when the Judgment section is unchecked. It sets `REACTIVE_AGENTS_NO_AUTO_SHADOW=1` at startup (unless already set), stopping the framework's auto-shadow judgment backend from flooding the local Ollama with `/v1/systemone` calls alongside chat turns. Checking Judgment in the Lab still enables it.

Agent configs now carry calibration. `toConfig()` emits `calibration: { mode, learned?, community? }` for an agent built with `.withCalibration("auto" | "skip", options)`, and `agentConfigToBuilder()` / `agentConfigToSource()` apply it with `.withCalibration(mode, { learned, community })`. Before, the round trip dropped the call, so an agent reloaded from config ran with learned and community calibration off. A `ModelCalibration` object passed to `.withCalibration()` is still code-only and is not serialized. An agent that never calls `.withCalibration()` produces the same config as before.

Add optional typed `TaskMetadata.currentTurn` (modality-neutral content) so chat producers can state the current turn instead of consumers parsing history markers from the task text.

Coalesce live chat TextDelta store writes to one per animation frame (rAF, with a synchronous fallback in tests/SSR), cutting re-renders at high token rates without changing the rendered output.

Add `fetchPinned` and `resolvePublicUrl` to close the DNS-rebinding gap in the egress guard. `fetchPinned` resolves a hostname once, validates every answer against the `assertPublicUrl` blocklist, connects to that validated address (Host and TLS server name preserved), and re-validates and re-pins each redirect hop. Refusals throw the new tagged `PublicUrlError`. `assertPublicUrl` keeps its behavior.

The webhook channel now describes how to call it. `WebhookChannelAdapter.connectionInfo({ baseUrl })` (and the pure `webhookConnectionInfo`) returns the ingress path and URL, the signature header, algorithm and signed bytes, replay rules, and curl, Node and openssl examples. `signRequest(secret, body)` builds the headers a sender must attach. Both use the same constants signature verification uses; the signature scheme is unchanged.

A plain agent (no `.withObservability()`) no longer narrates phases to stdout when stdout is not a terminal. With no `verbosity` set, a TTY keeps the `"normal"` live log lines as before. A server, pipe, CI job or embedding app now prints only warning and error lines. An explicit `verbosity` always wins, and an explicit `"minimal"` stays fully silent. Only stdout changes: EventBus events, trace data, the run summary buffer and logger subscribers are the same in both cases, so UIs built on events (such as Cortex) see every event.

Community calibration (`calibration: "auto"`) no longer requests a community profile when `DO_NOT_TRACK` is set or `REACTIVE_AGENTS_TELEMETRY=0`. Resolution falls back to the shipped prior and local observations, with no network request.

Cortex chat composer is decluttered, with `/mcp`, `/btw` and a Context view.

- **Composer bar.** The chip row shows the model plus only settings changed from their defaults (at most four); a new **Config** button opens a popover grouping every setting (Model, Reasoning, Tools, Workspace, Limits) with its current value. Each row opens the same slash picker its chip did.
- **Tool disclosure is visible.** The Config popover and the builder's Tools section state the disclosure in force (`all`, `index`, `discover` or tier default) with a short explainer, and a closed Tools section shows a Disclosure badge when a mode is set.
- **`/mcp`** turns a saved MCP server on or off for the chat; `/mcp add <command or URL>` saves a new one, lists its tools and turns it on. Lab Tools has the same one-line add, and the command palette has "Add an MCP server".
- **`/btw <question>`** asks a read-only side question about the run in progress (or the last reply). A separate tool-less call on the chat's provider and model answers from a snapshot of the task, tool calls and draft; it shows as a collapsible aside and never enters the history, the running turn or memory. New route `POST /api/chat/sessions/:id/btw`.
- **Context tab** in the run view and the chat inspector now lists the skills the run had active (with why) and the memories it wrote. The framework publishes no memory-recalled event, so recalled memory is not shown and the tab says so.

Token accounting honesty. Provider-native `reasoningTokens` (OpenAI/LiteLLM `completion_tokens_details.reasoning_tokens`) now ride `TokenUsage` and are marked as a subset of output tokens, never added to the total. The cache-adjusted `billedTokens` figure the runtime already computed is projected onto the public `TokenUsage` stream event and folded into ui-core usage, so callers can show billed alongside raw tokens. Cortex surfaces billed and reasoning per call and in the Inspector Context tab, uses the runtime's 45/75/90 context thresholds in live estimates, and persists cancelled/errored chat turns (partial reply, spent tokens, and cost) marked incomplete instead of dropping their spend from session totals.

A trace can now say what a model calibration changed. Three additive `guard-fired` events: `profile-overrides-applied` (one per context-profile field a calibration overrode, with `field`, `from`, `to`, `source`) and `calibration-effect` (one per calibration-fed branch that fired: recall force-on, blueprint worker concurrency, adaptive classifier skip; with `field`, `value`, `consumer`, `effect`). `ResolvedActOrAnswer.source` gains `"default-off"` for the never-configured OFF state (pass `actOrAnswerIsDefault(config)` as `resolveActOrAnswer`'s new fourth argument), distinct from an explicit `false`. Native function calls the resolver reports as dialect `"none"` are now recorded as `native-fc`, so `metadata.lastDialectObserved` is correct. No behavior change.

A skill loaded with the `activate-skill` tool now publishes one `SkillActivated` bus event (`trigger: "model"`, the skill's version, the iteration it was recorded at), so `onSkillActivated` hooks from `.withReactiveIntelligence()` fire and dashboards can show which skills a run used. A duplicate or refused activation publishes nothing. An abstained run's `abstention.reason` now carries the whole reason; it was cut mid-word at 200 characters.

`LLMRequestCompleted` gains an optional `firstTokenMs` field: milliseconds from request start to the first streamed output token, absent for non-streamed calls. New `outputTokensPerSecond(event)` helper returns output tokens/sec over the generation window (`durationMs - firstTokenMs`), or `undefined` when `tokensOut` is missing or the window is not positive. Additive: existing producers and consumers compile unchanged.

Capability rows added for `openai/gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o4-mini`, `anthropic/claude-opus-4-1` and `gemini/gemini-2.0-flash`. These ids used to resolve to the made-up 4096-token fallback window, so UIs showed no context meter and context logic sized against a wrong window. They now resolve to a static row with the model's real context window and max output.

Always-on channel router, part two. The inbox events are now typed core events (`ChannelInboxRetried`, `ChannelInboxFailed`, `ChannelInboxBatched`, `ChannelInboxFolded`, `ChannelInboxInterrupted`) instead of `Custom` events; `InboxEventPayloads` is replaced by `InboxEvent` and `InboxEventType`. New outbox: every router send (reply, ack, failure notice, `deliver`) goes through an ordered per-conversation dispatcher with optional bounded retry and backoff (`outbox: { maxAttempts, baseBackoffMs, maxBackoffMs, minGapMs }`, route `minGapMs` for pacing), a durable row ledger in the SQLite store with restart recovery of agent replies, and a `ChannelSendFailed` event on permanent failure (a `Custom` event of that type until core adds the member); defaults keep one attempt and no pacing. New follow-up timers: `followUp` router option, `OpenSessionRequest.followUp` port, `makeFollowUpTool` (`{ in | at, note }`, `{ cancel }`, list), a durable timer store beside the inbox, bounded per conversation (pending cap, horizon, minimum delay), and a poller that wakes the conversation as a normal inbound turn. Router status gains `outbox` and `timers` counts.

`AgentConfig.gateway` now accepts and round-trips `ingress: { channels?: false | string[] }`, so config-driven hosts can opt out of the framework channel ingress without re-applying `withGateway`.

`http-get` now reports a failure instead of a success for HTTP 4xx/5xx responses and for 200 responses whose body is a short (under 2 KB) "not found" page. The failure message names the status and URL and suggests another source, so dead links no longer inflate success counts or hide from the broken-tool tracker. Normal pages and JSON are unchanged.

Cortex can continue a run a loop guard stopped. A chat turn that ended on a loop guard shows a "Stopped by a loop guard" card under the thread with the reason in plain words, the tool it kept repeating, the tools already done and the items left; an optional note and a step grant (default 10 more) go with **Continue**, which calls the framework's `agent.resumeRun` and lands the reply as the next exchange. The Runs page lists loop-stopped durable desk runs with the same card. New routes: `GET /api/chat/sessions/:id/resumable`, `POST /api/chat/sessions/:id/resume/:runId`, `GET /api/loop-stopped-runs`, `POST /api/loop-stopped-runs/:runId/resume`. A run that cannot be continued (not loop-stopped, already continued, agent setup changed) answers 409 in plain wording, and a second Continue of a run that is still going is refused.

Continue needs the agent's existing **Durable execution** setting (Lab · Execution); it is off by default and Cortex adds no default or second toggle. With it on, approvals and questions pause the run durably instead of waiting live (a framework limit). A loop-stopped chat turn with it off shows a short hint to turn it on.

Model-written acks (`ack.source: "model"`) now start the session's `acknowledge` port call when the turn starts instead of at `afterMs`. At `afterMs` the router uses the result if ready, else waits up to `modelTimeoutMs` from `afterMs`, else falls back to canned (`timeout`). A cold thinking model no longer times out most turns. The call is interrupted with the turn.

`ChannelTurnAcknowledged` gains an optional `ackLatencyMs`: milliseconds from the model-ack call start to the port result or timeout. Absent when no model ack was attempted.

Cortex: edit which tools and which shell commands need approval. The Lab builder's Reasoning section has an Approvals editor (tools, shell command rules such as `git push`, and the mode), and chat has `/approvals` (`/approvals add git commit`). Cortex stores and sends the framework's `approvalPolicy` (`mode`, `tools`, `commands`) on desk runs, chat sessions and saved agents; configs that kept the gate under `durableRuns` are read as the same policy. Tools the framework always gates once a policy is set (`file-write`, `file-edit`, `code-execute`, the full shell) show locked on. "Pause and ask me" turns durable execution on; "Refuse" says plainly that the call is refused, since Cortex has no in-place approver. The run view header shows Approve / Deny while a run waits on an approval. Abstained and partial runs read Abstained / Partial in Runs and on Beacon instead of Failed: runs now store their ending, and older runs are filled in from their last `AgentCompleted` event.

Cortex pauses, stops and continues any interrupted durable run, not only loop stops. Pause and Stop on a running desk run or chat turn call the framework's `pauseRun` / `stopRun` (the run ends at its next step with a saved place to continue from; the response says whether it was saved), and Continue (`resumeRun`) is offered for every resumable run: paused or stopped by you, loop guard, budget, timeout, error or crash. The continue card and the Runs strip show a chip from the stop's kind, what was done and what is left; the Runs list has a "Can continue" segment; a turn you stopped now offers Continue. Needs the existing Durable runs setting; nothing else to turn on.

A run or chat turn you stop or pause now shows as a partial result with its answer so far, not as a failure. The framework ships a user stop as `success: false` with `stopped_by_request` outstanding; Cortex read that as a failed run (error banner, error toast, "Unfinished: stopped_by_request"). One classifier now covers it: `turnOutcomeOf` returns `{ ending: "partial", interruptedBy: "user", draft }` for a user stop, and the run status is `stopped`. Chat history keeps the answer with a "the user stopped this reply here" marker instead of a failure note.

New additive `@reactive-agents/ui-core` exports: `USER_STOP_CRITERION`, `isUserStopKind`, `isUserStopResult`, and the optional `stop` / `loopStop` fields on `RunCompletionLike`.

A durable run stopped with `agent.stopRun()`, `handle.stop()` or `handle.terminate()` now returns an honest partial (`success: false`, `outcome: "partial"`, outstanding `stopped_by_request`) with the answer so far in `output`, instead of a success. The kernel writes its own checkpoint of the stopped state; the runtime's snapshot is only a fallback written when the kernel wrote none, so a stop leaves one final checkpoint. The stop record's `unfinished` items now come from the stopped kernel state for every stop kind.

Every project scaffolded by `create-reactive-agent` or `rax init` now includes an `AGENTS.md` for coding agents (Claude Code, Cursor, Codex). It points them at the current docs instead of training data: the docs index at `https://docs.reactiveagents.dev/llms.txt`, markdown versions of docs pages, and `npx skills add https://docs.reactiveagents.dev` for the agent skills. It also lists the project's real scripts, a few rules that keep generated code on the current builder API, and `npx rax diagnose cause latest` for explaining a failed run. The post-scaffold output mentions the file in one line.

Run events now tell the truth about resumed runs and loop counts.

- A resumed durable run (`resumeRun`, `approveRun`, `denyRun`, `respondToInteraction`) runs under the task id its checkpoint was captured under. Its `AgentStarted`, `AgentCompleted` and kernel events now carry that one id. Before, the lifecycle events used the durable run id while the kernel events used the original task id, so an observer never saw the original run end. The task id is the canonical id of a run's events; the durable `runId` names the stored run row. A `fork()` is a new run: it runs under its own id, and its kernel events now carry that id too.
- `AgentCompleted.totalIterations` counts kernel loops (the same numbering as `ReasoningIterationProgress.iteration`). Before, it counted reasoning steps, so a run with 8 loops could report 23.

`AgentSession.chat()` and `AgentSession.runStream()` now accept `string | ContentPart[]` like `agent.chat()` and `ChatEngine.turn()`, so a session turn can carry images and audio (a no-vision model fails with `UnsupportedModalityError`). The declared return type of `listPendingApprovals()` now includes the optional `subAgent` field it already returned.

When one round of tool calls holds a write and the read of the input it is paired with (notes-N.txt to out-N.txt, by the task's numbered families), the write is refused with a read-first hint instead of running with content the model wrote before it had seen the value. The read runs; the model resubmits the write next turn. Rounds with no such pairing are unchanged.

`@reactive-agents/diagnose` now ships a real recorded failed run at `examples/failed-run.jsonl`, so you can try `rax-diagnose` without an API key, Ollama or a run of your own: `npx rax-diagnose cause node_modules/@reactive-agents/diagnose/examples/failed-run.jsonl`. The run comes from an experimental opt-in configuration (a local qwen2.5-coder:14b model), not the default harness. `cause` reports that the model never called a tool, and `attribute` traces the failure to contradictory harness guidance.

Security: `allowedTools` no longer widens the shell. Naming the `git` toolset (or the removed `gh-cli` / `git-cli`) in `allowedTools` without `shell-execute` used to allow the agent's whole `shell-execute`, so `.withTools({ terminal: true, allowedTools: ["git", "file-read"] })` granted the full terminal. The one shell now runs only that toolset's programs (`git`, `gh`); the terminal keeps its sandbox settings and approval flags. `builtins: ["git"]` with `allowedTools: ["gh-cli"]` now runs `gh` only. Put `"shell-execute"` in `allowedTools` to allow the full terminal.

`run-started.config.calibration` now records the calibration a run resolved: mode (`auto`, `skip`, `custom`, `unresolved`), the tiers that contributed, the probe version, and each field's value with its source (`shipped`, `community`, `learned`, `default`, `custom`). The `◉ [calibration]` completion line reports the true sources (it used to always say prior, plus local when observations existed) and includes the tool-call dialect. Observability only; no behavior change.

Rewrite the package README to the shared package README standard: stability line, install, a minimal `.withMemory()` example, an export table, runtime note (FTS5 absent on Node, `LIKE` fallback) and a link to the memory guide. Dead and relative links removed.

The between-turn environment notice (`RunEnvelope.rails.environmentUpdate`, e.g. "the to-do list was edited") is now shown to the model at most once per run. Multi-pass strategies (reflexion's improve pass, plan-execute steps, a strategy switch) used to repeat it once per kernel pass, because each pass started with an empty signal ledger. Consumption is now latched in a run slot (`reasoning.environmentUpdateShown`; sub-agents get their own).

Cortex finds a chat's or agent's durable run store through the framework's `defaultDurableRunsDir`, so `REACTIVE_AGENTS_RUNS_DIR` applies to Continue and crash recovery as it does to the writer. A saved `durableRuns.dir` or `checkpointEvery` is kept even when `enabled` is absent (absent still means on).

Model-written channel acknowledgements (`ack.source: "model"`) now run with extended thinking off. On a thinking model (e.g. ollama mimo-v2.6) the ack completion used to reason first and miss the router's 3 s bound, so every ack fell back to the canned text. The ack budget is 80 tokens, and an empty or thinking-only result is never used as ack text.

Plan posture now frames the goal the model sees as plan-only ("Plan how to accomplish this; do not carry it out: <task>"; the typed task and message history are untouched, execute posture is unchanged). Checklists the harness derives from a plan reply are written with `origin: "harness-derived"` (replacing the internal `harnessDerived` flag) and carry a per-step tool hint parsed from `tool: name` in the step text. A seeded execute run whose unchecked step names a tool that just succeeded gets one advisory line proposing to mark it done; it never blocks completion and is inert without hints.

Lab > Tools is now three tabs: Servers, Custom tools, and Catalog and test. The mixed "Create tool" panel is gone.

- **Servers**: a list with a state chip (Connected, Failed, Disabled, Not checked), tool count and last check, and a detail pane with Tools, Options and Credentials tabs. Add through a menu (Quick line, Form, Import JSON). Test shows the tool count or the reason it failed without changing the saved tools; an Enable switch turns a server off; credentials are write-only rows (a stored key shows Set, never its value).
- **Custom tools**: create and edit name, description and parameters with a JSON preview; disable, delete and try a tool in place.
- **Catalog and test**: unchanged catalog and test panel; tools of a disabled server show Disabled but stay testable.
- The Builder and chat Tools section share one MCP attach list with a strip showing read-only MCP tools, tools that ask first, and the shell, linking to Lab > Tools > Servers. A disabled server cannot be newly attached.
- Removed the `POST /api/tools/mcp-import-json` alias (it answered 410); use `POST /api/mcp-servers/import-json`.

ui-core: action-first turn steps. `turnStepsOf` / `buildTurnSteps` / `persistedTurnStepsOf` turn a run into steps titled by the tools called (retries grouped as `get_website_metrics ×4 · 3 failed → ok`), with narration and provider thinking kept apart, repeated narration collapsed to "same as step N", and each failure's reason linked to the call that fixed it. `summarizeTurn` gives a one-line rollup with the context window in use. The turn fold now files thoughts under its own iteration cursor: the runtime's `ThoughtEmitted.iteration` is a step index, which rendered phantom steps repeating earlier ones. Persisted traces add `narration` / `thinking` per iteration and `context`.

Cortex: the chat step list renders the new view with a summary line. A failed turn stays visible as failed with the kernel's cause, but is sent to the model as a failure marker instead of an answer and is never used to title the chat. Cortex no longer forces `num_ctx` 8192 on local models; the framework sizes it per model. The shell command groups now come from `@reactive-agents/tools` `COMMAND_CAPABILITY_MAP`.

Model-written acks wait up to 12 s (was 3 s) after `afterMs` for the `acknowledge` port before falling back to the canned text; a cold model queued behind the turn's own calls no longer loses to the fallback. `ack.modelTimeoutMs` now accepts 1 to 30 000.

Cortex follows the fold of `gh-cli` and `git-cli` into a scoped `shell-execute`. The chat `/tools` picker and the builder's Tools picks offer the `git` (`git · gh via shell`) toolset by name, so selecting it grants a shell limited to those programs, never the full host shell. Chats and saved agents stored with `gh-cli` / `git-cli` open with the `git` toolset; `gws-cli` and the removed `workspace` (gws) toolset are dropped from stored configs with a server warning and never turn on the shell. New `GET /api/tools/shell-presets` lists the programs each shell toolset runs.

While the `git` toolset is picked, the agent always has a shell, so the builder's host-shell checkbox stays checked. Clicking it switches between a shell limited to `git · gh` and the full host shell, and a hint under it says which is on. The chat shell chip and the `/terminal` picker show the same `Shell: git · gh only` state. Unpicking the toolset shows your own shell setting again.

Gateway and Channels keep their numbers across a restart. Channel received, sent and failed counts and the last received and sent times are read from the durable inbox and outbox, and the route counters and the recent activity feed are saved in the Cortex database and loaded when the hub starts. Counts that cannot be recovered are labelled "since restart" instead of showing 0.

Chat polish: compact tool badges, background-agent cards, quieter goal checks, config during a run, and a per-message action row.

- **ui-core:** new chat view models. `toolBadgesOf` (one badge per tool in a group, unfixed failures first and coloured, fixed ones marked, `+N` overflow), `subAgentCardOf` / `subAgentRollup` / `argHint` (a background-agent card: status incl. abstained, tools, duration, cost, one activity line, goal status; never raw tool JSON), `goalSummaryOf` / `isImplicitRequirement` / `findSubAgentGroup` (goal checks without the answer floor every run has), `turnStrategiesOf` and `formatTurnDuration` (`12s`, `2m 05s`), and `shortToolName` is exported. The turn fold records `strategy` (`StreamCompleted.metadata.strategyUsed`) and `durationMs` (`metadata.duration`), and `finishTurnTrace` persists them, so a plain answer now persists a small trace.
- **Cortex chat:** tool groups show badges; sub-agents are compact cards under an `N agents · k running` header that open a side panel with the agent's own transcript; goal checks are a `Goals 3/4` pill, hidden when only the implicit floor exists; quick-bar chips and config commands work during a run (they apply to the next turn, never queue, and the running turn keeps its agent); each message has an action row with status, relative time (absolute on hover), `Ran 2m 05s · finished …` or a live `Running 12s`, the reported strategy (`ReAct + Reflexion` when sub-agents ran others), copy, retry, trace and fork. Also: a jump-to-latest button when scrolled up, wide markdown tables scroll inside the message, the duplicate `N steps` header label is gone, and a turn keeps the provider/model it started with.

Fix the strategy card (code action, reflexion, tree of thought) vanishing when a chat turn ended. The turn's live strategy steps were streamed to the client but never reached the recorder that builds the stored turn, so nothing was persisted. They are now recorded with the turn (`TurnTraceRecorder.recordSteps`), so the card stays, collapsed, after the run and after a reload.

Tools now resolve to a declared effect, `"read" | "write" | "unknown"`, through the new `toolEffect(definition)` helper and `ToolEffect` type. The effect comes from `mutatesExternalState` and `requiresApproval`. An undeclared tool is `unknown` and is never treated as read-only. No tool is added to or removed from any tool surface.

MCP tool annotations are classified in this order:
1. Write hints (`destructiveHint: true` or `readOnlyHint: false`) make the tool `write`, even from an untrusted server and even if the operator listed it read-only. A server that says a tool writes is believed.
2. `openWorldHint: true` makes the tool `unknown`.
3. Otherwise the tool is `read` only through an operator `readOnly` listing or a trusted `readOnlyHint: true`.

Lab builder: the host shell section has one "Allowed commands" control instead of three overlapping ones (extra commands, replace-allowlist, command-group checkboxes). It shows the exact list the agent may run, framework defaults pre-filled from the new `GET /api/tools/shell-commands`, with removable chips, an add input, and quick-add buttons for the opt-in groups (JavaScript, Python, Web, Archives, Environment) carrying a short risk note. The GitHub CLI group is gone from the builder because the `git` toolset already brings `gh`. Saved configs with command groups load into the list without losing a command; an edit saves added commands as `additionalCommands`, or the full list as `allowedCommands` once a default is removed, and no longer sets `commandAccess`.

`agent.memory()` lists, searches, edits and deletes what an agent has stored. `search(query, { limit?, taskId?, runId? })` runs a full-text search over semantic memory; `semantic` and `procedural` each have `list`, `get`, `update` and `delete`; `episodic.list()` reads the event log. Entries come back with the `taskId` and `runId` of the run that wrote them. The agent needs `.withMemory()`; without it every call rejects with the new `MemoryNotEnabledError`.

Memory the runtime writes during a run now records that run: facts extracted at the end of a run, skill fragments learned from it, and tool-driven memory writes all store the run's `taskId` and `runId`.

Cortex shows how fast the model writes. In chat, a live `~tok/s` estimate appears while a reply streams, then the measured speed and time to first token when the model call completes. The run view shows speed and time to first token on each loop's trace row and the run average in its vitals line. The Model page has a Speed section: median tokens/sec and median time to first token over the model's last 20 recorded runs (`GET /api/model-throughput`). Speed is output tokens over generation time, after the first token (core `outputTokensPerSecond`). A call without a first-token time gives a lower bound, marked `~`, and is never mixed into an exact median.

`@reactive-agents/ui-core` adds `throughputOf`, `throughputOfCalls`, `liveTokensPerSecond`, `formatTokensPerSecond`, `formatFirstToken`, `medianOf` and the `Throughput` / `ThroughputSample` types, so any chat UI can show the same figures. `TokenUsage` and `CallUsage` gain an optional `firstTokenMs`.

`withGateway({ ingress: { channels } })` controls which webhook-capable channel adapters the framework ingress serves at `/channels/<id>`. The default is unchanged (serve all); `false` serves none and an id list serves only those, for hosts that mount an adapter on their own listener. A bind failure of the framework ingress is now logged at warn with the port and reason (it was logged as error without the port).

`.withHook()` handlers are now typed with the context each phase actually receives. `LifecycleHook` is a union keyed by `phase` (and `timing` for per-turn phases):

- Engine phases (`bootstrap`, `guardrail`, ..., `complete`) get the full `ExecutionContext`, as before.
- `think`, `act` and `observe` get `KernelTurnHookContext | ExecutionContext`. The kernel fires them once per turn with `{ phase, iteration, state }`; the engine also fires `think` once around each reasoning call, and `act`/`observe` only for a custom (non-kernel) `ReasoningService`. Narrow with `"metadata" in ctx`. `on-error` on these phases gets `KernelTurnErrorHookContext` (`{ phase, iteration }`, no state) or `ExecutionContext`.
- Kernel-fired hooks now receive the kernel `state` they are typed with (they used to get only `phase` and `iteration`).

Possible TypeScript break: code that read `ctx.metadata`, `ctx.toolResults`, `ctx.selectedStrategy` or other engine fields in a `think`/`act`/`observe` hook without narrowing no longer compiles. Those fields were always `undefined` on the per-turn firings. `LifecycleHook` is now a type alias, so `interface X extends LifecycleHook` must become an intersection. Returning the received `ctx` still type-checks. New exported types: `KernelTurnHookContext`, `KernelTurnErrorHookContext`, `KernelTurnPhase`, `EngineLifecyclePhase`, `EngineLifecycleHook`, `KernelTurnLifecycleHook`, `KernelTurnErrorLifecycleHook`. `RawHookResult` takes an optional context type parameter (default `ExecutionContext`).

`.withMinIterations(n)` docs now say what it does: the run continues until it reaches N kernel turns, the unit `metadata.iterations` reports.

The npm READMEs for runtime, cost, health and interaction now follow one template (pitch, stability, install, usage, API, docs, runtime, license) and link to the docs instead of duplicating them. They fix dead docs links, remove relative links, and correct examples that did not match the code: `.withHealthCheck()` takes no arguments, `/ready` returns 503 only when unhealthy, and the interaction examples now use real service methods.

The stability notes in the runtime and reactive-agents READMEs no longer claim exports are tagged `@experimental`; they now say less-settled exports carry an `@unstable` JSDoc tag and the tier is recorded in the stability reference.

`makeAcknowledge` now returns `{ text, fallbackReason? }` instead of a bare string, so the channel router can report why a model-written ack fell back to canned text (`empty`, `thinking_only`, `error`). The `onFallback` callback parameter is removed.

Tools now fix several common call mistakes themselves instead of failing. A census of 501 recorded runs found each of these mistakes. Every fix says in the result what it changed.

- **Tool names with the wrong separator.** `ToolService.execute` already ran the registered tool for a near-miss name such as `umami_get_website_stats` (for `umami/get_website_stats`), but it did not say so. Now the result notes the correction, for example `(called as umami_get_website_stats; ran umami/get_website_stats)`. String results get the note as a last line. Object results get a `toolNameCorrection` field. `ToolOutput.metadata.calledAs` holds the original name. `ToolOutput.toolName`, the approval gate, the cache and the `tools.executed` event now use the name of the tool that ran. The new pure export `resolveToolName(requested, availableNames)` returns the one available name that matches after lowercasing and treating `_` `-` `/` `.` `:` as the same separator. It returns `undefined` when no name matches or when two names match. Callers that check names before calling `execute` can use it. It is now the only name matcher in the package: the registry heal, native function-call names and text-parsed calls all use it. So a name that matches two registered tools (`a_b` with both `a-b` and `a/b`) runs neither and fails as an unknown tool. Before, the heal picked `a-b`. camelCase names (`fileRead` for `file-read`) still resolve.
- **file-read on a directory** returns the directory listing (the same `{ root, path, entries }` shape as list-directory) with a `note`, instead of a raw EISDIR error.
- **file-read with the working root repeated in the path.** With root `.../apps/cortex`, the path `apps/cortex/README.md` reads `README.md` and returns `{ content, path, note }`. Before, it failed with ENOENT.
- **file-read encodings.** `utf-16le` and other spellings with an obvious Buffer meaning now work. An unknown encoding reads as utf-8 and returns a note. A UTF-16 request on a file with no UTF-16 byte-order mark and no NUL bytes also reads as utf-8 with a note.
- **grep patterns.** A pattern that is not a valid regex (`foo(`) is searched as a literal string. A pattern with regex metacharacters that matches nothing is retried once as a literal. The result includes a `note` when this happens.
- **todo actions.** `create_list` and `add_items` now mean `add`, and `view` and `get` now mean `list`. `clear` and `reset` are still errors, and the error lists the valid actions.

**Removed: the `workspace` (gws) shell preset.** `BUILTIN_SHELL_PRESETS` no longer has a `workspace` key, and `workspace` is no longer a toolset alias. In a builtins list, `workspace` and `gws-cli` now select no tool and give a deprecation notice. The notice says to turn on the terminal and allow the program: `.withTools({ terminal: { additionalCommands: ["gws"] } })`. These names never turn on a shell by themselves. The removed names are listed in the new `REMOVED_BUILTIN_NAMES` export.

**New: the shell command catalog is public.** The package index now exports `COMMAND_CAPABILITY_MAP` (capability group to commands, for example `javascript` to `node`, `bun`, `npm`, `npx`), `resolveCommandAccess(config)` and the `ShellCommandAccessConfig` type, next to the existing `DEFAULT_ALLOWED_COMMANDS` and `OPT_IN_COMMANDS`. Apps that build a shell-permission UI can read these lists instead of copying them. The command lists did not change.

Goal segments, schedule fires and loop ticks now stream live into the open chat (tokens, tool chips, to-do updates) like a user turn, and a page reload mid-segment reattaches. Attaching a picked file the browser can no longer read now shows a "Not attached" toast and the rest of the batch still attaches.

New turn transcript projection in `@reactive-agents/ui-core`: `turnTranscriptOf(trace)`, `persistedTurnTranscriptOf(stored, answer)` and `buildTurnTranscript(steps, { answer, pending })` turn an agent turn into the order a modern agent chat reads in. The model's prose between iterations comes first as message text, then the tool work between prose collapses into one group (`Ran 4 tools · 1 failed`, or `Running <tool>` while a call runs) that carries its steps for drill-down, and the answer comes last. Provider thinking never becomes prose. Prose that repeats earlier prose or the answer is dropped. The projection is live-safe: while streaming, the in-flight text is a non-final answer.

Cortex chat renders assistant turns this way. Narration shows as normal text, and each tool group is a one-line row that expands to the step detail (calls, failure reasons, thinking). The answer closes the turn with its copy button. Goal checks and the turn summary move to a quiet footer. Reloaded turns read the same way. Older turns with no stored narration show one tool group and the answer.

**`result.metadata.iterations` now counts the kernel's model turns.** It used to hold the reasoning step count, where every thought, action and observation counts. A run with 2 tool turns and an answer reported about 7 "iterations" instead of 3. The count now adds the turns of every reasoning pass of the run, including continuations and verification retries. A pass that ran no kernel (a custom `ReasoningService`) counts as 1. `stepsCount` is unchanged and still counts steps. It no longer falls back to the iteration count when a pass reported no steps; it is 0. `iterations` is now on the `AgentResultMetadata` type. The engine's trivial-run gates (memory flush, telemetry complexity) and the telemetry iteration count read the same turn count.

**`withMinIterations(n)` counts kernel turns.** The run must use at least `n` turns. Continuation passes run only until the run reaches `n` turns. Before, the floor always ran `n` continuation passes, however many turns the first pass used. A run whose first pass already used `n` turns now runs no continuation. To keep the old number of extra passes, raise `n` by the turns your first pass usually takes.

**A `.withHook()` hook fires once per phase occurrence.** Engine phases (`bootstrap`, `guardrail`, `cost-route`, `strategy-select`, `verify`, `memory-flush`, `cost-track`, `audit`, `complete`) fire once per run. Before, `bootstrap` fired twice, and `complete` `after` fired from the kernel before the engine's `complete` `before`. `act` and `observe` fire once per tool turn from the kernel. Kernel runs no longer get an extra `act` and `observe` fire after the kernel ends. Only a pass that ran no kernel still gets that single post-reasoning pair.

Cortex chat no longer offers Continue for a stopped reply that has no saved run of its own (an older interrupted run of the same agent used to make the card appear while the toast said there was nothing to continue); that case now points at Durable runs. Pause on a chat without Durable runs ends the turn as "stopped", not "paused". "Left to do" in the stop card is a short list. On the webhook channel card, Generate sits in the Signing secret row beside Replace and Remove, the replay rule shows the window as a duration, and the listen port says it has no default.

Memory paths are now contained and private. An agent id such as `../x`, `/etc` or `..` can no longer move the per-agent memory directory or `memory.md` outside the memory base directory; the id is percent-encoded into a single path segment (ordinary ids are unchanged). Memory directories are created `0700` and the SQLite file and `memory.md` `0600`. The LIKE-based search fallback (used when FTS5 is absent) now matches `%` and `_` in the query literally instead of as wildcards.

Deterministic graders for typed results. An `EvalCase` can declare `structured` expectations (a partial expected value plus `equals`, `approx`, `contains`, `matches`, `array-contains`, `length` and `type` checks at JSON Pointer paths) instead of a judge. Such cases are graded field by field with no LLM call, scored under the `structured` dimension, and carry per-field `fieldResults` that persist in `EvalStore`. A grade that cannot be decided (no checks, an invalid check) is `inconclusive` and never passes.

New exports: `gradeFields`, `gradeSchema` (Effect Schema validation with JSON Pointer field errors), `gradeStructured`, `runFieldCheck`, `resolveJsonPointer` and their types. `SuiteAgentRunner` may return `structuredOutput`; without it, structured cases parse `actualOutput` as JSON.

`EvalRunSummary.passed`/`failed` now count each result's `passed` flag. For judged cases this is unchanged (`overallScore >= passThreshold`).

Skill distillation reports what really happened. One skill whose refinement fails (or dies) no longer aborts the whole pass: it is recorded in `failures` and the other skills still refine. A refine that returns the same content (no LLM, LLM fallback, identical output) counts as `unchanged`, not `refined`. `DistillationResult` is now `{ refined, unchanged, skipped, failed, failures }` (the never-populated `errors` field is replaced by `failed`).

Speech settings: voices are listed from Speaches (`GET /models/<model>`, labelled with language and gender) as well as Kokoro-FastAPI `/audio/voices`, re-listed after the endpoint changes and once on load. The Speaches preset sets `af_heart` with its model, a voice the model does not offer is reset or flagged inline, and a 422 voice rejection shows its first sentence instead of a generic failure.

Voices show friendly names (`Heart (American English, female)`) grouped by language in a searchable picker with a "Custom voice id..." entry, replacing the native datalist that only matched the typed value. Only one reading speaks at a time: every browser and server speech engine goes through one shared speech coordinator in `@reactive-agents/ui-core`, so starting a reading cancels the one in flight (its late callbacks are inert) and the controller that was cut off goes idle.

Speech engines settle each utterance exactly once and silence its audio element, so a late `ended`, a stray error or an interrupted `play()` cannot advance the queue twice or leave sound playing, and no `play()` rejection goes unhandled. A `pause()` from outside Cortex (a browser extension or media-key controller) is detected, retried once, and reported once as an `external-pause` error with guidance (Incognito test, Browser speech) instead of silently skipping through the transcript; Settings gains an "Audio diagnostic" button next to Test.

Add `StructuredOutputReport` (with `StructuredOutputLayer`, `JsonRepairStep`, `NativeOutcome`, `StructuredFieldError`, `StructuredOutputFailureKind`) and a `StructuredOutputReported` AgentEvent (`{ taskId, strategy?, report, timestamp }`) so a structured-output extraction's provenance can reach traces, Cortex and calibration. `ToolCallStarted` gains an optional `args` field (post-heal arguments) so UIs can show a long-running tool call before it completes. Both changes are additive.

Adds typed `ChannelInboxRetried`, `ChannelInboxFailed`, `ChannelInboxBatched`, `ChannelInboxFolded` and `ChannelInboxInterrupted` events (additive `AgentEvent` members). Adds `normalizeTitle` and `isNearDuplicateTitle`, the shared near-duplicate rule for plan and checklist step titles.

`agent.chat()` and `session.chat()` now take the tool loop whenever the agent has a capability tool (custom tool, MCP server, sub-agent, terminal, opted-in built-in, or documents), instead of guessing from the message wording. Before, "what is the price of bitcoin?" went to the direct-LLM path on an agent with a price tool, and the model answered that it had no such tool. The model can still answer a plain message in one iteration via `final-answer`; an agent with no capability tools stays on the direct path. Behavior change: tools agents now run a kernel iteration for every chat message. `session.chat()` without `useTools` used to always go direct; it now follows the same rule.

`.withToolIntent()` accepts `"capability"` (the new default), `"message"` (opt back in to the old wording heuristic) or your own `(message) => boolean` classifier. Per-call `{ useTools }` still wins. `requiresTools()` is deprecated; it is kept for compatibility and for `"message"`. `ToolIntent` is exported. Hosts that pass their own `{ useTools }` (such as Cortex) are unaffected.

A chat turn that takes the direct (tools-off) path no longer forces `temperature: 0.7` on the model call. It now uses the agent's configured temperature, the same one `run()` and tool-loop chat turns use. Agents with no configured temperature keep the provider default (0.7), so unconfigured agents behave as before.

`ReasoningService.execute` and `StrategyRegistry` now accept `initialMessages` whose content is `MessageContent` (a string or content parts such as images, audio and files). Parts reach the provider request unchanged; text-only content is unchanged on the wire.

`ReasoningIterationProgress.maxIterations` now reports the effective iteration bound on seeded plan runs: the plan-sized budget raise and each bookkeeping refund update the run's recorded bound, so progress no longer shows a configured limit the run already passed. `HarnessConfig.wrapUpReserve` (config beats `RA_WRAPUP_RESERVE`, default off) is now a typed harness key. Plan-step tool hints are parsed by the shared core `planStepToolHint`. The reasoning execute request declares `builtinFloorTools` and `allowedTools`.

Cortex uses one styled `Select` for every pick list instead of the browser's native select. The list opens under its button (or above near the bottom of the window), searches from nine options on, supports grouped options with descriptions, and works with the keyboard (arrows, Home and End, type-ahead, Enter, Esc). The Beacon agent settings panel now closes when you click outside it or press Esc; the model chip still toggles it.

`.withHarness({ computeOffload: true })` (or `RA_COMPUTE_OFFLOAD=1`, default off) is now wired through the runtime: the harness schema accepts the field, the run-config `mechanisms` record shows it, and for an aggregation task over data the run reads, `code-execute` is added to the permitted tool surface even without a `builtins` opt-in. An explicit `allowedTools` list that omits `code-execute` and the contract's forbidden list still win. Behavior is unchanged with the flag off.

Lab Skills shows an agent's living skills: confidence, usage, success rate, version history with a diff between versions, and the skill events its runs reported, linked to each run. Refine now, Roll back and Export to SKILL.md act on them through the framework's skill API. Cortex library skills are deprecated and can be moved into an agent's skills. A one-message `/skill` in chat now passes the skill to that turn instead of rebuilding the chat agent.

The fabricated-listed-items check no longer flags a correct answer that labels its own steps with single bold words (for example "**Multiplication**", "**Division**", "**Addition**") or with a bold label followed by a colon. It still flags invented multi-word titles that appear nowhere in the tool evidence. A warn-only verifier result is now logged as an advisory note that says the answer was kept, not as "terminal output rejected". "Rejected" now appears only when the verifier actually rejects the answer.

Web-search keys saved in Settings · Web search now reach the agents Cortex builds (chats, desk runs and gateway agents) through `.withTools({ webSearch: { apiKeys } })`, so a saved Tavily, Brave, Serper or Keenable key works without setting an environment variable. Keys stay out of configs, traces and exported code, and a key in the server environment still wins unless "Use saved key" is chosen. The Tools section of the builder and chat config panel gains a Web search providers control (order and choice, saved as `tools.webSearch.providers`), and the provider table is now read from the framework's `WEB_SEARCH_PROVIDERS`.

Add a public full-density `TokenUsage` stream event projected from the existing `LLMRequestCompleted` bus event, carrying the provider's per-call input/output split, cache figures, cost and duration. ui-core folds these into `TurnTraceState.usage` and persists them. Cortex persists real provider splits per turn, shows live input/output counters and a per-call strip, and consolidates usage into the Inspector's Context tab. Live counters roll in place (session wheel, per-turn badge, run chat), each half is marked `~` only while estimated, and provider-reported values win.

SKILL.md front matter now unquotes YAML-quoted scalar values. `name: "my-skill"` and `name: 'my-skill'` both parse to `my-skill` (previously the quotes were kept in the name). Double-quoted values honor backslash escapes; single-quoted values honor `''`. Unquoted values, including ones with colons or inner quotes, are unchanged.

`agent.resumeRun(runId, { newRun: true })` continues a run as a new run. It gets its own run id (`<runId>-cont-<8 hex>`, in `result.runId`) and its own trace file, and `result.continuedFrom`, the run's `listRuns()` row and `run-started.config.continuedFrom` name the parent. Guidance, `note`, `extraIterations`, completed-tool-call recovery and the config-hash guard are unchanged, and the parent run's record is untouched. Without the option, resume behaves as before (same run id).

A tools-off `chat()` / `session.chat()` whose model call fails now rejects with the provider's own error. `err.message` is the cause (for example `Model "x" not found locally. Run: ollama pull x`) with no `LLMError: ` prefix, and `err._tag` names the error class. It used to reject with a wrapper whose message started `LLMError: `. The direct path still rejects; the tool-capable path still resolves with `failed: true`.

`.withChannels({ adapters })` now accepts the canonical `ChannelAdapter` (typed delivery receipts, backpressured inbound stream, no connect/disconnect) as well as the legacy `MessageChannel`. Stopping the gateway calls `ChannelService.shutdown()`, which closes canonical adapters; legacy adapters are still disconnected.

Shell command approval rules. `shellCallMatchesCommandRules(toolName, args, rules)` says whether a shell tool call runs a command a rule names (`"git push"` matches `git push origin main` in any `&&` / `;` / `|` segment). `ShellExecuteConfig.approvalCommands` lets the read-only git/gh shell run a write command that matches one of those rules instead of refusing it; every other write and all output redirects stay refused. The shell does not ask for approval itself: give the same rules to the approval gate so a matched command runs only after a human approves it.

Cortex chat no longer loses or hides how a turn ended.

- A turn that fails before the model answers (a model that is not pulled, a provider without a key, a refused request) keeps your message and ends as a failed turn with the cause and Retry. The cause no longer starts with an error class tag such as `LLMError:`.
- Stop ends the run on the server and the turn reads "stopped". Leaving the page mid-reply stops the run and the turn reads "interrupted" with that cause when you come back. Partial text and spend are kept, and Retry is offered.
- Stopped, left and orphaned chat runs no longer stay live in Trace: they end as `stopped`, desk Stop included, and chat runs a restart left open are closed at startup.
- Before the model's first token the turn reads "Waiting for the model · 12s" ("Waiting for Ollama (loading the model or queued)" on Ollama) instead of "Thinking".

ui-core adds what a builder's chat UI needs for the same states: `turnOutcomeOf` classifies an interrupted turn (`interrupted` input, `TurnEnding` `"interrupted"`, `interruptedBy`, `interruptionCause`), `causeLineOf` drops error class tags, `foldModelWait` / `initialModelWait` / `modelWaitLabel` and `RunState.modelWait` (with `ReduceOptions.now`) track the wait on the model, `statusOfTurn` / `statusOfRun` / `statusOfSubAgent` map every surface onto one `StatusTone` vocabulary, and `formatCost` / `formatTokens` / `formatRelativeTime` / `formatClockTime` are shared formatters. The Svelte, React and Vue bindings re-export the formatters and status helpers.

A failed run's output is now empty. The harness no longer writes "Could not complete the task within the available budget. What was attempted: ..." (or, under `.withFabricationGuard("block")`, the "no grounded answer could be produced" sentence) into `output`, and such results no longer carry `harnessAuthoredOutput: true`. The cause moves to `result.error`: the run's own error first (for example the exit gate's "Outstanding: ..." list), followed by "What was attempted: N tool call(s) attempted (...), M succeeded." A failed run with no recorded error gets the former sentence as its error. Enforced fabrication-guard failures read `<abstention sentence> Failed checks: grounding-on-required.` followed by the same "What was attempted" line, and a run the verifier rejected (for example a reply that ends on "I'll try again:") now gets that line too.

Abstained runs follow the same rule and keep their own terminal (`terminatedBy: "abstained"`, `terminalOutcome.status: "abstained"`). They are no longer forced to `status: "failed"` when their output is empty. The zero-evidence stand-down, the required-tool preflight, forced abstentions, a model-initiated `abstain`, and plan-execute's grounded abstention ("Unable to verify this answer: ...") now ship an empty `output`. Each puts its sentence (plus "What was attempted") on `result.error` and no longer sets `harnessAuthoredOutput`. When the honesty gate drops a fabricated success claim, or a reply that repeats harness-internal handoff text, the output is now empty instead of the abstention sentence. The cause names which of the two it was, and `abstention.reason` no longer quotes the dropped text. A model's own give-up text ("I can't do X because ...") still ships as output. Outstanding items stay on `metadata.extensions.terminalOutcome.outstanding` and gathered evidence on `metadata.extensions.unfinishedEvidence`. Partial runs still return the model's draft plus its `Unfinished:` list, and successful runs are unchanged. Read `error` for why a run failed, not `output`.

`ReasoningStatus` gains `"abstained"`. A run that honestly declined to answer now reports `status: "abstained"` instead of `"partial"`, and the abstained status is never capped by sub-run envelopes (`capStatusToEnvelope`, `capStatusUnderVerdict`). Code that switches on `ReasoningResult.status` should handle the new value. An abstention is not a success. The adaptive strategy still falls back to reactive after an abstained sub-strategy, as it did when abstentions reported `partial`.

The remaining harness sentences are gone from `output` too. A run whose tool calls could never be resolved (`terminatedBy: "tool_call_unresolved"`) now fails with empty output, and "the model could not produce a valid tool call ..." plus "What was attempted" goes on `error`. The same holds for any guard that ends a run with no answer (an oracle-forced exit, a loop with no usable answer, a stall with nothing to deliver): the run fails with that sentence as its cause. The one exception is a run whose declared file deliverable was verified on disk. That run stays done with empty output, because the file is the deliverable. When plan-execute stops at its token budget, it now ships the completed steps' own results joined by blank lines, without the `[EXEC sN] ✓/✗` step-record prefixes. A budget stop before any step completed ships no output instead of the `[BUDGET]` note, and that result carries no `harnessAuthoredOutput`.

Sub-runs and plans follow the same rule. A failed ReAct pass (`executeReActKernel`, and each plan-execute composite step) now returns empty `output` and puts its cause on a new `ReActKernelResult.error` field. Before, the cause was the output. A plan-execute step whose pass failed is now marked failed with that cause, whatever its narrowed `terminatedBy`. Before, it counted as completed and its error text reached the plan's joined output. A completed step with no text keeps an empty result instead of a `[Step N completed]` placeholder. Plan-execute no longer falls back to its last recorded step note (`[EXEC sN] ...`, `[REFLECT N] ...`) when no step produced a result. That run now fails with empty output, and its error reads `The plan produced no result: s1 (Read): <cause>; ...`. Before, the error said the budget ran out, which was wrong. If blueprint's token budget runs out during planning, it no longer writes `Planned steps (not run, ...)` into `output`. That run now fails with empty output. Its error reads `Planned steps not run (<budget reason>): <title>; <title>.`, and `budgetTerminalPartial` stays set. If the budget runs out before SOLVE, or the SOLVE call fails, blueprint joins the steps' own results without `Step N (title):` labels. A run that hits the iteration cap while a required tool is uncalled, and whose only replies were tool-call text that could not run, keeps that cause. Its `missing_required_tool` error now ends with `cause=the model could not produce a valid tool call (...)`.

`CalibrationDrift` is published only for real drift. The kernel used to publish it on every iteration of every run once a model's stored drift flag was set, with `deviationSigma: 0` and `expectedMean === observedMean`, so every observer had to filter it out. Now only the reactive-intelligence calibration subscriber publishes it, once per task. It fires when the model's history flags drift and that run's own scores show it: at least `CALIBRATION_DRIFT_MIN_SAMPLES` (10) scores, with the recent-window mean at least `CALIBRATION_DRIFT_MIN_SIGMA` (1σ) above the run mean. `measureRunDrift` and `isMeaningfulDrift` are exported.

README rewritten to the package README standard: stability tier, install, a minimal example, an API table and a link to the LLM providers docs. The unverified "100+ providers" claim is replaced by the seven verified adapters (Anthropic, OpenAI, Gemini, Groq, xAI, Ollama, LiteLLM) plus the deterministic test provider, and the relative links are replaced by docs links.

Added static capability rows for 11 more Ollama models: llama3.1, llama3.2:3b, gemma4:e4b, gemma4:12b, granite4:tiny-h, granite3.3, qwen2.5:14b, deepseek-r1:14b, mimo-v2.6, ornith and phi4-mini-reasoning. Benchmark preflight no longer marks them inconclusive, and `RA_BENCH_ALLOW_FALLBACK` is not needed for them. Each row sets `toolCallDialect: "native-fc"` from what the Ollama model card advertises. Only llama3.2:3b and gemma4:e4b have a calibration file that confirms it. Tool emission is unmeasured for gemma4:12b, mimo-v2.6 and ornith (stub templates), and deepseek-r1:14b made no tool call in a smoke run.

`.withTools({ builtins: ["git"] })` registers a `shell-execute` scoped to the preset's programs (`git` and `gh`). It runs in the run's workspace, so git sees your repo.

- With no workspace set, the scoped shell runs in the process's current directory (`process.cwd()`), as `git-cli`, `gh-cli` and `gws-cli` did, so `git log` works in the directory the app was started from. It does not fall back to a `/tmp` sandbox. With `terminal` on, the terminal's working-directory rules apply unchanged. The tool description the model reads says the same: the scoped shell's says it runs in the host process's current directory when no workspace is set; the terminal's still says `/tmp`.

- With `terminal` also on, the agent still has one `shell-execute`: the preset's programs are added to the terminal's `additionalCommands`, and the terminal keeps its own approval and risk settings.
- `gh-cli` and `git-cli` still work in `builtins`, `allowedTools` and `requiredTools`. Each one means `shell-execute` scoped to its program, and the build prints one deprecation warning per name. `gws-cli` and `workspace` select no tool; the build prints a deprecation warning that says to allow `gws` in the terminal. `requiredTools: ["git-cli"]` is met by a `shell-execute` call. The scalar form (`builtins: "gh-cli"`, `builtins: "workspace"`) is no longer a `ToolsOptionError` and warns the same way as the array form.
- `allowedTools` and `requiredTools` now resolve toolset names the same way `builtins` does (`allowedTools: ["git"]` allows `shell-execute`). A name that is one of your own tools stays literal: with a custom tool named `web`, `allowedTools: ["web"]` still means that tool.
- A `.withContract()` that requires `gh-cli` (or `git-cli`) passes build validation: the name resolves to the scoped `shell-execute` the build registers.

plan-execute (and blueprint's remainder) step kernels now carry the run's iteration budget, like direct and reflexion passes. A step with a small iteration cap no longer blocks the 4th distinct call of one tool through the repetition backstop, and the tool calls a step proposes on its last allowed turn now run while the run still has budget instead of being dropped.

The kernel input accepts an optional `currentTurnText`. When a producer supplies it (from `TaskMetadata.currentTurn`), the run contract and the derived post-conditions are built from that text instead of parsing history markers out of the task string. Without it, marker parsing runs as before, so behavior is unchanged.

`ReasoningService.execute` accepts an optional `currentTurnText` (the producer-typed current turn, no inlined history). It rides the run envelope, so every strategy's contract compile and `deriveConditions` read the typed turn instead of parsing history markers out of the task. Absent, behavior is unchanged.

`SessionBridge` now honors a trigger's `lifecycle`: `conversation` sessions are torn down after their idle timeout (default 30 minutes), `ttl` sessions after `durationMs`, `single_response` sessions right after the reply with a fresh session id, and `persistent` or unset sessions are kept until evicted. The agent factory may return an optional `close()`, called on teardown, release and eviction. The session id stays stable across teardown, so a rebuilt agent resumes persisted history. New `SessionBridge.sweep()` and `idleTimeoutMs` / `now` options.

New `makeRouteMeter` and the `meter` option of `createChannelRouter`: a per-route message and cost meter. A turn that would pass the route's `maxCostPerDayUsd` is refused before the resolver runs and published as `ChannelTurnDropped` with reason `budget`; a message over `maxMessagesPerDay` drops with reason `rate`. `RouterStatus.dropped` gains a `budget` count.

`agent.execute(plan, { strategy? })` and `agent.run(input, { plan })` can now run a supplied `Plan` in a strategy. An explicit `strategy` (`"blueprint"` or `"plan-execute-reflect"`) wins; an agent already on one of them adopts the plan; a plan with `dependsOn` or `args` runs in `blueprint` as a 0-LLM DAG; a free-step plan keeps the seeded ReAct loop. `result.plan` reports the plan the strategy ended with (from `metadata.extensions.plan`), keeping the plan's id, goal and source. A plan that does not decode, or whose `dependsOn` names an unknown step, itself or a cycle, now rejects `PlanInvalidError` before any run starts. A loop-stopped run with no checkpoint rail (non-durable runs, chat tool turns) now surfaces `result.loopStop` from `metadata.extensions.loopStop`. The harness keys `autoTick` and `bookkeepingRefund` (both default on) are accepted by `.withHarness()` and recorded in the run-started mechanisms. `resumeRun` guidance notes use the shared guidance writer.

`agent.session().setMode()` now publishes a `ChatModeChanged` event (`{ sessionId, from, to, timestamp }`) on the agent's EventBus, once per actual change. Setting the mode the session already has publishes nothing.

The live status line shows the `[t: collapse]` and `[t: collapse thinking]` hints only when the `t` key works. That is when stdin is a terminal and nothing else reads it. Runs with piped stdin (StackBlitz, IDE panes, `rax` with piped input) no longer advertise a key that does nothing.

Added a static capability row for Ollama `gpt-oss:latest` (20.9B MoE, 131K native window, thinking supported). Benchmark preflight no longer marks it inconclusive. The row sets `toolCallDialect: "native-fc"` from what the Ollama model card advertises (`tools`); tool emission is not behaviorally measured and there is no calibration file.

Cortex gets a Channels tab in the Lab for the channel hub. Add Telegram, Signal and webhook channels with live state, counters, last error and account lease (a credential is saved write-only and only a mask is shown), and route each channel to a saved agent. The route editor covers the match, owners, allowed and blocked senders, what non-owners can do (read-only by default), cost and turn caps, and the turn acknowledgement (fixed text or model-written, typing indicator, delay). Widening access (adding an owner, opening a route to anyone, giving senders the agent's full tools) asks through a confirm dialog that names the risk, and is recorded in the audit trail. "Send test message" shows which route takes a message, as which role, with which tools, or why a sender is refused, and can run the real turn without sending anything. Saved agents show "Reachable via" with an "Add route" shortcut. A duplicate account is linked to the channel that holds it. Route patches accept `null` to clear a field.

`http-get` now connects to the address it validated (`fetchPinned`), so a hostname that resolves to a public address at check time and a private or metadata address at connect time (DNS rebinding) can no longer reach internal services; each redirect hop is re-pinned and credentials are still dropped on cross-origin hops. `web-search` requests are now cancelled when the run is interrupted, retry with an Effect schedule instead of timers, cancel the bodies of retried responses, and fail with typed errors. `connectMCPServer` no longer requires `transport` in its type (it is inferred from `command` or `endpoint`, as before).

`rax run --tools` now enables the built-in tools (it enabled none since built-ins became opt-in, and printed a warning). `rax run --verbose` shows phase lines when output is piped, `--quiet` prints only the answer on a terminal too (no live status line), and `--stream` no longer draws the live status line over the streamed tokens. On a terminal, `rax run` no longer runs its own spinner on top of the framework's status line.

Scaffolded projects treat the `.env.example` placeholder `your-key-here` as a missing key: a `.env` copied without editing now prints the "set <KEY>" message instead of failing on a provider 401 with a stack trace. The printed next steps say `cp .env.example .env` instead of an `echo` that wrote the placeholder as the key.

The repetition guard's hard backstop can now be configured with `.withHarness({ repetitionBackstop: { maxCalls?, iterationFraction? } })` (`HarnessConfig.repetitionBackstop`). The default is unchanged.

Past its review point, the repetition guard lets a tool keep running with new arguments while its results still add information. The backstop caps that run:
- `iterationFraction` (default 0.75, clamped to 0..1) allows `ceil(maxIterations * fraction)` iterations' worth of calls. One iteration counts as `maxBatchSize` calls for a parallel-safe tool and 1 call otherwise.
- `maxCalls` is a plain call count. It is floored to a whole number of at least 0 and wins over the fraction.
- Non-finite values are ignored.
- The review point is still the floor, so a lower cap never refuses a call the review point allows.

The field survives `toConfig()`, JSON and `fromConfig()`. Each run records the backstop it used in `run-started.config.mechanisms.repetitionBackstop`, which is `{ iterationFraction: 0.75 }` when unset. `repetitionBackstopCalls()` and `DEFAULT_REPETITION_BACKSTOP_FRACTION` are exported from `@reactive-agents/reasoning`.

`agent.memory().episodic.list({ taskId })` returns only the entries logged during that task, filtered in the store query before `limit`, newest first. Older entries of a task are no longer cut off by the default limit of 50.

Plan recon is wired through the runtime. `planRecon` is a first-class harness key (`.withHarness({ planRecon: true })` or `RA_PLAN_RECON=1`, default off) and the run-started config records it. The kernel tool schema now carries each tool's `effect` (`read`, `write` or `unknown`, from `toolEffect`), so plan recon can find read-only tools; an approval-gated read tool stays `unknown`. Recon results come back as `Plan.findings` from `agent.plan()` and on `PlanRecorded`. `agent.execute(plan)` and `agent.run(input, { plan })` pass the findings to the execute run as context, `result.plan` keeps them, and a user-edited plan keeps them. Sessions hold findings across turns: `session.plan.findings` shows them, `session.setPlan(steps)` keeps them and `session.setPlan(plan)` takes the findings that plan states. With user interaction wired, plan turns can ask the user through `request_user_input`.

Gateway schedules and ingress are safer to run unattended. A schedule fire that was handed out but never settled (the process died mid-run) is now re-offered after restart under the same fire id, following the schedule's catch-up policy, instead of being lost; each fire keeps its own result in a bounded `runs` history (`lastRun` is still the newest). Config-declared schedules re-read `priority` and `enabled` from the config on restart while a runtime pause is kept. Webhook ingress answers 408 to a sender that stalls the body (`bodyTimeoutMs`, default 10 s) and 503 beyond `maxInFlight` concurrent requests (default 64). The Signal transport caps line length (1 MiB) and the unread notification backlog (1000) with a typed `too_large` error, keeps only `{ name, code }` of spawn errors (they carried the account number), and holds a bounded, account-masked stderr tail on `transport.diagnostics()`. `ScheduleDeliveryRecord` now also carries `adapterId`, `receiptStatus`, `errorKind` and `retryable` using the channel vocabulary; existing records stay readable.

`@reactive-agents/channels` now defines one canonical `ChannelAdapter` contract (`InboundEnvelope`, `OutboundMessage`, `DeliveryReceipt`, typed `ChannelError` kinds, `ChannelCapabilities`, `ConnectionState`) with shared `withReconnect`, `makeOutboundRateLimiter` and `makeInboundDedupe` combinators and a conformance suite every adapter must pass. `ChannelService` consumes adapters through it: replies are sent by the service itself, `ChannelMessageSent` carries the platform's real message id and is no longer published when the send fails, failed sends are counted in `status()` and published as a `ChannelDeliveryFailed` event, `deliver()` returns a receipt or a typed error, echoes are dropped, and `status().adapters[].connected` reflects the adapter's real connection state. The legacy `MessageChannel` shape is deprecated but still accepted.

`WebhookChannelAdapter` is now fail-closed: with no `secret` every request is rejected unless you pass `allowUnsigned: true` (local development only). Signed requests need an `x-channels-timestamp` header and the signature is `HMAC-SHA256(secret, "<timestamp>.<body>")`, with a 5 minute replay window; repeated message ids are delivered once; attachments and `replyTo` are normalized; `secret` accepts `Redacted`. A request before the adapter is started now fails with `not_started` instead of being dropped. `Attachment.binary.data` is now a `Uint8Array`.

The channel router's runtime resolver now implements `RoutedSession.reset` for per-conversation sessions. A route owner's `/new` or `/reset` flushes and clears the live session and empties the persisted chat history for that conversation, so the next message starts empty, even after a restart. A store failure maps to `RoutingError` (`turn_failed`) and the session is kept. `ChannelAgentHandle` gains the optional `clearSessionHistory`, supplied by `toChannelHandle`.

`ChannelTurnAcknowledged` now carries an optional `ackFallbackReason` (`timeout`, `empty`, `thinking_only` or `error`) when a route asked for a model-written ack but the canned text was sent. A session's `acknowledge` port may return `{ text, fallbackReason }` as well as a plain string; plain-string resolvers keep working unchanged.

Configured tools are no longer hidden on turn 1 by keyword relevance. When the permitted domain tool set has 15 or fewer tools (and no classifier or required-tools narrowing applies), every tool is visible from the first turn, so a task such as "what is bitcoin worth" can no longer hide a `crypto-price` tool and make the agent answer "I do not have that tool". Lazy disclosure through `discover-tools` now applies only above that budget, and `disclosure: "discover"` stays strict at any size. Tool-heavy agents with 15 or fewer tools send more schema tokens per turn than before; larger sets are unchanged. A call to a registered tool that was not shown still resolves and runs.

Tree-of-thought now honors the `maxIterations` you configure. Its execute phase used a hardcoded tier cap (6 local, 8 mid, 10 large, 12 frontier), so a run configured for 16 iterations stopped after about 7; the tier cap is now only the default when you set none. All strategies resolve the cap through one shared function (`resolveStrategyIterationCap`), a registry test fails for any strategy that ignores it, and plan-execute's per-step floor of 5 no longer lifts a step above a smaller user cap. The `direct` strategy resolves its cap the same way: with tools registered it defaults to 3 iterations (call, observe, answer) instead of 1, so a tool-calling first turn no longer ends as a failed `max_iterations` run; an explicit cap still wins, clamped to Direct's 1 to 3 ceiling.

The Gateway tab reads the framework's own `agent.channelStatus()` and `agent.gatewayStatus().inboundQueue` instead of folding events: it now shows live queue depth (waiting of capacity, drops) and the real per-channel message counts with the last message in and last reply out. Webhook channels route through `WebhookChannelAdapter.handleWebhook`.

Think-turn LLM recovery no longer stacks on the provider's retries. A retryable failure (rate limit, timeout, 5xx, network, malformed output) raised before the stream's first event has already been re-sent 3 times by the provider's retry schedule, so the kernel no longer backs off and re-sends it again: the turn ends with `llm_error` and an `llm-recovery` block signal with reason `provider-retried`. Before, one think turn could make about 12 calls and wait about 40 seconds. Failures after the stream emitted, init failures and request-shrinking recoveries still recover in the kernel as before. A prompt compaction retry now keeps the lower `max_tokens` an earlier output-side (OTPM) retry in the same turn set, so it no longer hits the same limit again.

Cortex shows how a run ended beyond success or failure, from the framework's own run metadata. The to-do outcome (`extensions.checklist`) reads as "To-do 3/5" with each row the harness closed marked by where its done-ness came from (a tool result, or the accepted answer) and an "Unresolved" list with each row's reason, in the to-do dock, under the answer, and in the Run view; the `checklist-unresolved` guard event reads as one quiet line in the trace feed, not an error. A turn whose answer was written from tool results the model had not read says so in a small note. A run the strategy accepted after a capped pass (authority `strategy-accepted`) reads as an accepted finish: completed in the Runs table, never failed. Notes are stored with the turn, so a reload shows them; unknown provenance, reason or authority values degrade to a neutral label. ui-core adds `runNotesOf`, `runNotesFromStorage`, `runNotesWorthShowing`, `checklistReconciliationOf`, `checklistFromCompletion`, `checklistUnresolvedOfGuard`, `terminalAuthorityView`, `terminalAuthorityOf`, `unreadResultsNoteOf` and an optional `authority` on `TurnOutcome`.

Cortex no longer carries its own copies of two framework rules. Chat and channel-hub session turns pass no `useTools` and rely on the framework's capability default (only the user's tools-off switch is still passed), and the channel ingress opt-out rides `AgentConfig.gateway.ingress` instead of a `withGateway` overlay. Behavior is unchanged.

Model pickers say why a list is a fallback. When a provider's live model list fails, Cortex now lists every known model (framework presets, then PriceBook ids) with the note "Live list unavailable (…); showing known models." An out-of-credits or spending-limit refusal reads "Live list unavailable: <provider> account out of credits or spending limit reached; showing known models." PriceBook-only ids sit in their own "Known models (not confirmed live)" section in the Lab model select and the chat model menu. `GET /api/models/:provider` rows carry the framework's `listedBy`. The model page price card for hosted $0 models no longer claims a "free tier".

Channel routes gain `resetCommands` (default `["/new", "/reset"]`, `[]` disables). A route owner who sends one as the whole message ends the conversation's session and starts a fresh one; the command never reaches the agent, and the router replies "Started a new conversation." `RoutedSession` gets an optional `reset` port for resolvers that keep history outside the session, and the router publishes a new `ChannelConversationReset` event.

Cortex's chat plan card can take a plan out and bring one in. **Export** copies the saved plan as Markdown or downloads it as Markdown, a self-contained web page or JSON; **Import** replaces the plan from a file or pasted Markdown or JSON, records it as a user edit, and shows the reason when the text cannot be read (no steps, invalid JSON, wrong shape, newer version). The formats and parsers are the framework's (`planToMarkdown`, `planFromMarkdown`, `planToJSON`, `planFromJSON`, `planToHtml`); new routes `GET /api/chat/sessions/:id/plan/export` and `POST .../plan/parse`, and `PUT .../plan` takes an optional `goal`. A step's tool is now a dropdown of the tools the chat offers (its own tools, MCP tools grouped by server), reading the quick bar's catalog; a hint the chat no longer offers stays visible. Tool hints and plan origin now ride the to-do rows (the framework's own seed row) instead of a Cortex-only copy in the plan meta; older sessions are read as before. A user plan edit is no longer held for the next run's event feed (the framework stamps plan events with the session id).

`@reactive-agents/ui-core` exports the pure plan-editing rules a chat UI needs to edit a plan's step list: `addStep`, `removeStep`, `moveStep`, `setStepTitle`, `setStepTool`, `nextStepId`, `planEdited`, `planProgressLine`, `stepStatusLabel` and the `PlanDraftStep` type.

Cortex chat: richer final answers, `@` file tags and attachments.

- The final answer (chat turn and run view) has a toolbar (copy rich, copy as Markdown, save as `.md` or a standalone web page, outline of headings), renders callouts, task lists and code language labels, and opens links only as safe external pages. A **Deliverables** strip lists the files, edits and typed result the run produced, read from its tool calls and receipt, each with preview, copy and download.
- `@` in the composer searches the chat's workspace and tags files as removable chips with a preview of exactly what is sent (long files say `64 KB of 340 KB, cut`). The list never leaves the workspace root and never shows secrets, VCS data or dependencies.
- The paperclip, drag and drop and paste attach pictures, audio and text files. Pictures and audio are sent to the model as typed content parts; kinds the chat's model cannot take are disabled with the reason, and a refusal reads as a plain message before anything runs.
- ui-core adds `deliverablesOf`, `deliverableCallsOf`, `outlineOf`, `calloutKindOf`, `rankPaths`, and the attachment rules (`ATTACHMENT_CAPS`, `classifyAttachment`, `gateAttachmentKind`, `fileContextBlock`); `connectRunStream` now reports the server's own `error` text for a refused request.

README rewritten to the package README standard: stability tier, install, a runnable `.compose()` example, API table of the five killswitches, and a link to the Compose API reference. The stability line now reads unstable, because killswitch options are still changing.

Built-in and meta tool parameters with a closed set of valid values now declare them as a schema `enum`, not only in the description: `todo.action`, `brief.section`, `find.scope`, `relate.mode`, `relate.type`, `final-answer.format` and `final-answer.confidence`. Compact (local-tier) profiles drop parameter descriptions from the wire but keep `enum`, so these models used to see a bare `action: string` and could send a task title as the todo action.

`ToolParameter` gains an optional `aliases` map (off-enum word to canonical value, never sent to the model). The input validator now rewrites a case/whitespace variant of an enum value, or a declared alias, to its canonical value before the enum check, so `find({ scope: "internet" })` still runs as `"web"`. Values that match neither still fail with the list of valid values. One tightening: `relate` with an unknown `mode` now fails validation instead of silently running as `"links"`.

Cortex shows a tool call's arguments as soon as the call starts, and tool approvals no longer need durable runs.

- **Arguments while running.** `ToolCallStarted` now carries the call's arguments (ui-core `ToolCallStarted.args`; `foldTurnTrace` keeps them on the running call). Chat shows them on the running tool row and in the step detail, the run view lists the calls still running with their arguments, and the Events tab previews them. Credential-shaped values (API keys, bearer tokens, `?key=` query values) are redacted on screen.
- **Live approvals.** A "Pause and ask me" (`detach`) approval policy no longer turns durable runs on. Without durable runs the run waits live in Cortex: chat shows Approve / Deny in the streaming turn, and the run view header, Runs "Waiting on you", Beacon and the app-wide prompt offer the same decision. Approve continues the same run; Deny tells the agent the call was refused. With durable runs on, the pause still survives a restart as before. A live wait in chat ends if the chat page is closed or reloaded while it waits.
- **One approval surface at a time.** The "Approval needed" prompt shows only when the approval's chat or run is not on screen, and goes away when you open it; answering from the prompt, the chat card or the run header clears all of them. Dismiss on a chat approval card now hides the card only; the call stays pending and the run header and "Waiting on you" still answer it. Agents saved while the Lab forced durable runs on keep them until you switch durable execution off.

`ObservabilityService` stays quiet when stdout is not a terminal. With no `verbosity` configured, a TTY keeps the `"normal"` output as before. A server, pipe, CI job or embedding app now gets only warning and error log lines: no phase narration, no span list, no metrics dashboard. `obs.verbosity()` reports `"minimal"` in that case. An explicit `verbosity` always wins, and an explicit `"minimal"` stays fully silent. The policy is exported as `resolveVerbosity(explicit, isTTY)` along with `stdoutIsTTY()`. `ObservabilityServiceLive` accepts an optional second argument, `{ stdoutIsTTY }`, to pin the TTY state in tests.

`@reactive-agents/observe` now uses the same OpenTelemetry 2.x line as `@reactive-agents/observability` (`sdk-trace-node`/`sdk-trace-base` `^2.6.0`, `exporter-trace-otlp-http` `^0.213.0`). A clean install resolves one copy of each OTel package and no longer prints the deprecated `sdk-trace-base` 1.x warning. `@opentelemetry/sdk-trace-base` is now a declared runtime dependency, because `setupOpenInferenceExporter` imports `BatchSpanProcessor` from it. Public exports are unchanged. If you read `ReadableSpan.parentSpanId` from spans you collect yourself, switch to `parentSpanContext?.spanId` (OTel 2.x).

Stored skills now track their own usage. After each run, every SkillStore skill the run used (pinned, relevance-activated, or loaded with `activate-skill`) gets `useCount`, `successRate` and `lastActivatedAt` updated from the run outcome: a failed run counts against the skill and an abstained run adds no evidence. Needs memory on, where the skill store lives.

Fix: the run's skill resolver now sees the SkillStore. Before, it was built as a sibling layer and never got the store, so stored skills (learned ones, or ones added with `agent.loadSkill()`) were missing from every run's catalog and could not be pinned or activated.

`rax-diagnose cause` now names two more provider failures: `provider-error/malformed-output` (the provider rejected the model's own tool-call output, e.g. Ollama "XML syntax error" or Groq "Tool call validation failed") and `provider-error/token-rate-exceeded` (one request is larger than the per-minute token budget, e.g. Groq "Request too large ... tokens per minute"). The sub-cause comes from the structural error class first (`malformed_output`, `token_rate_exceeded` and the rest of the provider's closed set), then the error tag, then the error text. Older traces that tagged an XML parser failure as a rate limit, or a per-minute budget as a context overflow, are now read from the provider message instead. The evidence line says which source picked the sub-cause.

A bare `.withObservability()` shows more again, and a failed `run()` prints one readable error.

- `.withObservability()` with no options no longer counts as `verbosity: "minimal"`. Verbosity stays unset, so it follows stdout: `"normal"` in a terminal (live status line and build-info line on), `"minimal"` when piped (warnings and errors still print). Only an explicit `withObservability({ verbosity: "minimal" })` turns the status line off in a terminal. `toConfig()` no longer emits a `verbosity` you did not set.
- An uncaught `run()` rejection, such as a typo'd or revoked API key at a top-level `await`, now prints one error with one source frame. Before, Bun also printed the error's `cause` and its internal `_originalTaggedError` as two more stacked frames. Both stay available: `err.cause` is still the full unwrapped error, and `_originalTaggedError` is still on it (now non-enumerable).

Cortex Runs and the run view in the "Bench" design (step 4 of the modernization plan).

- **Runs** is a real table capped at a readable width: status, the run's name (its label or the chat it came from, never a bare id) with its source, model, strategy, steps, tokens, cost, time and start, with Pinned and Recent groups and live rows marked by an accent edge. A toolbar holds search, a status segment with counts (All, Running, Waiting, Finished, Failed, Stopped), sort and the token and cost totals. With no runs the page shows the neural mark and what to do next.
- **Waiting on you**: approvals and `request_user_input` questions sit in one strip above the list, only while something waits, with Approve / Deny, the answer controls, and Open run or Open chat. The two always-empty panels are gone.
- **Run view**: a header with the run's name, status and a link back to the chat that started it; a vitals line that wraps instead of clipping (`Loops 2 of 3`, `η 0.25` with a small entropy line); the Answer and the Trace (Loops / Timeline tabs) on the left; and an inspector with Summary, Decisions, Signal, Context, Memory, Messages and Events beside them on wide windows and under them below 1360px. The resizable bottom panel is gone. Export and More menus hold the downloads, Replay, Rerun, Rename and Delete.
- **Continue in chat** replaces the run view's Chat tab. It opens the chat that started the run, or creates a chat session with the run's recorded settings, the run as context, and its task and answer as the first exchange.
- Fixed: a run stopped or terminated from the run view read as failed; it now reads Stopped in the run view and in Runs (the server reads the framework's `AgentStopped` / `AgentTerminated`). A stopped run row also read as Finished in the run view.
- Fixed: the Summary said "no entropy data" when the run had one entropy sample; the Events tab labelled different event types with the same word ("Emitted 4" twice) and previewed most events as raw JSON; "Replay (1 events)".
- Fixed: the small entropy line drew nothing for a flat signal (one sample).
- `/run` redirects to `/runs`, and the nav says Runs instead of Trace.
- Run summaries (`GET /api/runs`, `GET /api/runs/:runId`) carry `chatSessionId` and `chatSessionName` for runs a chat session started.
- ui-core: `statusOfRun` labels match the chat turn vocabulary: Running, Finished, Waiting on you (were Live, Done, Paused). Tones are unchanged.

`SkillEvolutionService` and `makeSkillEvolutionService` are now exported from the package root. `refine()` records the current version as an "active" history entry before adding the candidate, so `checkRegression()` can roll back after a first refinement. `checkPromotion()` no longer promotes skills with `evolutionMode: "locked"`.

Failure attribution no longer reports `harness:tool-call-dropped` for calls that ran. A native call and the tool event that ran it now match when the tool name differs only by alias (`file_write` vs `file-write`) or the model path is a directory root (`.`) the tool resolved to the absolute task directory. One `canonTool`/`sameTool` normalizer is used at every tool-name comparison in attribution.

Traces record a run's final billed cost and say when a cost total is partial.

- **trace:** a new `run-cost-finalized` event (`totalCostUsd`, `costComplete`) records the core `RunCostFinalized` event. It can arrive after `run-completed` (the background debrief call settles first), and the trace bridge appends it to the same run's trace file. `run-completed` gains an optional `costComplete`. A run whose publisher reported no cost now records `totalCostUsd: 0` with `costComplete: false` (unknown spend, not a measured $0). New `runCost(events)` reads a run's cost: the `run-cost-finalized` total when present, else `run-completed`'s, with its completeness. `renderRunCost` formats it, marking a partial total as `≥$X (partial: unpriced calls)`. `analyzeRun` exposes it as `cost.spend`, and the run report prints it. Traces recorded before these fields load unchanged; their completeness reads as unknown.
- **replay:** `TraceSnapshot` gains an optional `costComplete`, read through `runCost` (the finalized total first). An unknown cost is `0` with `costComplete: false`, not $0. `ReplayDiff.costPartial` is `true` when either side's cost is a lower bound. The replay LLM layer reports its deterministic $0 with `priceSource: "price-book"`.
- **diagnose:** `rax-diagnose replay` shows the run cost in the stats line and on the `run-end` line, and prints the `run-cost-finalized` record.

Plan-execute in detach approval mode no longer pauses for a planned tool step its tool will refuse anyway (for example a shell command outside the allowlist). The step fails with the tool's refusal so the plan can adapt, matching the kernel path.

`recall` advertises its segmented-read parameters again (`start`, `maxChars`, `lineStart`, `lineCount`, `arrayStart`, `arrayCount`). Tool input validation keeps only advertised parameters, so these were dropped before reaching the handler, and the segmented-recall hints in compressed tool results (for example `recall("k", start: 0, maxChars: 1200)`) did nothing. Section reads now work end-to-end.

EventBus.publish now isolates handler failures and defects: a throwing subscriber no longer interrupts sibling handlers or fails the publisher; the failure is reported as an `ErrorSwallowed` event (tag `EventHandlerFailed:<eventTag>`). New `errorMessage(unknown): string` helper replaces the `instanceof Error ? e.message : String(e)` idiom.

Plan posture keeps the planning tools so the plan is a durable checklist: `todo`, `brief` and `final-answer` are offered (every capability tool is still blocked and recorded), and the single guidance line tells the model to record the steps with `todo` before presenting the plan. When the model records no list, the harness derives the checklist deterministically from the reply's numbered or bulleted step lines and records it through the same checklist ledger facts (flagged `harnessDerived`), so `ChecklistUpdated` fires; a reply with no derivable steps emits an explicit `planNoSteps` on the `posture-applied` trace signal. An execute run seeded with a checklist that still has unchecked steps gets one advisory guidance line to follow it (no veto, no exit-gate change; an empty or absent seed is byte-identical). New opt-in harness switch `planToolCatalog` (default off, `RA_PLAN_TOOL_CATALOG=1`) appends a capped line naming the execute-phase tools to plan guidance.

Tool-error recovery hints are more accurate.

- A `file-edit` error saying its `oldText` was not found no longer gets a hint to call `list-directory`. The file exists; the edit text did not match. The missing-path hint now fires only on a real missing path (`ENOENT`, `no such file`, `file not found`).
- A tool error that already names the fix (`Closest valid call`, `Allowed commands`, `Valid:`, `Did you mean`, `Read the file first`, `Use <tool>`) no longer gets a generic hint appended.

`ToolDefinition` gains an optional `mutatesExternalState` flag, set on every built-in tool, plus exported `isReadOnlyTool(def)` / `readOnlyTools(defs)`. A tool is read-only only when it declares `mutatesExternalState: false` and does not require approval; tools that omit the flag (user, MCP) are treated as not read-only. Tools whose writes outlive the run (`rag-ingest` document store, `relate` memory graph) are marked mutating; per-run stores (`recall`, `checkpoint`, scratchpad) are not.

Cortex now runs one channel router for all messaging channels (the channel hub). Channels and routes are stored in the Cortex database; any saved agent, gateway or not, can be a route target, built per (route, role) on the first message. On startup each gateway agent's `channels` and `gateway.accessControl` are imported (the agent config is untouched, webhook channels stay on the agent): senders from the old allowlist become route owners and keep full tools, everyone else the old policy let through runs a read-only, memory-free build, and the Gateway overview explains each route's roles. One bot token is never polled twice: a database lease per account and a guard in the per-agent host. Dedupe, turn caps and spend caps are durable. New `/api/channels` endpoints manage channels, routes, explain and simulate; adding an owner, `open` or full tools for non-owners needs an audited confirm. `CORTEX_CHANNEL_HUB=off` restores per-agent hosting. `GET /api/gateway/status` gains a `hub` block.

The `todo` tool can manage the list. New actions: `edit` (`{id, text}` renames one item and keeps its status; the title must not be empty), `remove` (`{id}` or `{ids}`; an id not on the list is a `No change` line, not an error), `clear` (every item, or only one status with `status:"completed"`), and `patch` (`ops`, several edits, status changes and removes in order as one result; if any op is invalid, nothing changes). They emit core's `edit` and `remove` checklist ops. `delete`/`rm` heal to `remove`, `rename` to `edit`, `reset` to `clear`, and `clear_completed` to a done-only clear. Every result still renders the list and the next-step line. The tool schema gains `ids`, `text`, `status` and `ops`. `ops` is a JSON string, so OpenAI strict mode keeps the op fields; an array is accepted too.

`applyTodoChecklistAction` takes an optional fourth argument, the checklist op history. When given, `add` issues ids after the highest id ever added, so a removed item's id is never reused. Without it, ids continue after the current items, as before.

The read-only git/gh shell now allows redirects to exactly `/dev/null` (`git log 2>/dev/null`). Output redirects to any other file are still refused. `splitCommandSegments` no longer reads the `|` of a `>|` redirect as a pipe.

The unbacked-action check no longer treats a passive sentence about someone else's action as the agent's claim. "Issue #12 was created by alice" in a summary used to count as a claim that `create_issue` ran, so the exit gate denied a correct answer and pushed the model to call the tool. A passive form now counts only with no doer named, with "by me" / "by us", or with the agent's means ("by calling the API").

The iteration-0 satisfiability preflight now abstains an action-required task (for example "send X to Y") when every visible domain tool is flagged `mutatesExternalState: false`. Before, a read-only search tool whose words matched the task kept the run going, and it spent iterations web-searching for how to send a message. Tools with an unknown flag behave as before. `ToolSchema` gains an optional `mutatesExternalState` field.

Add living-skills view helpers: `skillConfidenceLabel`, `skillLineDiff` and `skillDiffStats` for comparing skill versions, and `skillLifecycleEntryOf` to turn `SkillActivated`, `SkillRefined`, `SkillRolledBack` and `SkillPromoted` events into timeline entries.

The kernel carries structured `request_user_input` questions end to end. `AskUserRequest` now has `questions` (always set; legacy `kind`/`prompt`/`schema` calls are normalized) and `structured`. For a call with `questions`, the kernel validates the request and the host's id-keyed answer map (live `askUser` rail or durable resume) and gives the model the typed answer JSON. A malformed request or invalid answers return a tool-result error and the run goes on, so the model can ask again; a timeout (`AskUserOutcome.timedOut`, or a reason containing "timed out") returns every question as `timeout`. Legacy single-question calls behave as before.

Lab > Tools: opening the Servers tab checks every enabled server that was never checked or was last checked over 10 minutes ago, in the background (two at a time, 15 seconds each, one per server), so chips read Checking… then Connected or Failed without a manual Test; Recheck all in the list header. The three tabs share one layout (search and the one primary action in the list header, a count line, the first item shown), the tab counts use the UI face so a zero no longer reads as an 8, and the stray scrollbar bars and the collapsed tools search are gone.

A switched-off MCP server is no longer offered anywhere an agent is configured (Builder and chat tool lists, `/mcp`, the quick bar, plan step tools); a config that still lists one shows "Uses a disabled server (skipped)" with an Enable button.

Lab form rows line up: fields in a row keep their label, control and hint at the same height even when a neighbour's hint wraps, the Select matches the inputs, and inline Save, Add, Replace and Test connection buttons take the input height (new `--cortex-control-h` token and `Button size="field"`).

Tools can declare a deterministic `preflight` that runs before any approval is requested. `ToolDefinition.preflight(args)` returns the refusal text the tool would return at execution, or `undefined` to proceed; `defineTool({ preflight })` passes it through and `preflightToolCall(tool, args)` runs it safely (a throwing preflight means proceed). `shell-execute` implements it with the same input policy its handler enforces, so a command outside the allowlist (for example `gh` when it is not granted) is refused with the identical message and no approval prompt. The checks moved to `skills/shell-input-denial.ts`; `sanitizeCommand` and `findDisallowedCommand` keep their exports.

Cortex shows live questions, typed results and how they were obtained. A chat turn whose agent calls `request_user_input` shows the question inline (yes or no, options, form fields or free text) and the same turn carries on with your answer; desk runs list the question under Waiting on you. A run or chat turn with an output schema shows its object as a table of fields (Raw JSON one click away) with a "How output was obtained" panel from the framework's structured-output report (layer, repairs, failed fields as JSON Pointers). Lab gets an Output schema section, and Variables and the schema share one field editor (name, type, description, required); the schema is now plain JSON Schema in the agent's config. Lab Memory and Skills pick an agent through a searchable combobox (named agents first, no raw ids, capped list, stale loads cancelled) instead of a native select. The prompt-library popover lists every saved prompt. ui-core adds `StructuredOutputReported`, `StreamCompleted.object/objectError/objectReport`, `foldStructured`, `fieldRowsOf`, `obtainedOf`, `fieldsToJsonSchema` and `jsonSchemaToFields`.

A `find` result that was large enough to be compressed now reaches the model. Before, the model saw its own `find` call with no result, plus guidance saying "You have tool results above", and answered that it could not see the results. The cause: `find` stores its full result by replacing the run's scratchpad map, and the act phase then synced only the replaced map. The compressed result's stored key (`_tool_result_N`) was lost from the run state and from `recall`. The end-of-round sync now merges the kernel's writes with the tools' writes.

The thread now enforces tool-result pairing: every tool call in the model's thread is answered by its result. A stored key missing from the scratchpad projects the message's own preview instead of dropping the message. Any such recovery, or a tool call left unanswered, emits a `tool-result-pairing` guard event in the trace. The "You have tool results above" guidance renders only when the thread carries a tool result.

Gemini (gemini-2.5-flash) sometimes starts visible text with a bare `thought` line, as plain text rather than a thought part, so it leaked into answers as a literal "thought" prefix. The Gemini adapter now strips exactly one leading `thought` line from visible content on both `stream()` and `complete()`. Text that only starts with the word (for example "thoughtful ..." or "Thought: ...") is left alone.

The `git` toolset (and the `gh-cli` / `git-cli` names) is now read-only. That shell asks for no approval, and its git block-list missed `git config core.fsmonitor '<cmd>'` and `git config alias.x '!cmd'`. Both store a command in `.git/config` that a later `git status` or `git x` runs.

- New `ShellExecuteConfig.gitReadOnly`, set by `scopedShellConfig` whenever `git` or `gh` is in the list. A base config cannot turn it off. git and gh then run only read-only subcommands (`GIT_READ_ONLY_SUBCOMMANDS`, `GH_READ_ONLY_COMMANDS`), such as `git status`, `log`, `diff`, `show`, `fetch`, `branch` / `tag` in list mode, `remote -v`, `gh pr list` and GET `gh api`. Everything else is refused with a reason that names the full terminal (`.withTools({ terminal: true, builtins: ["git"] })`, which asks for approval). This includes `commit`, `push`, `config`, aliases, `rebase -x`, `submodule foreach`, `bisect run`, `difftool`, `--output`, `grep -O`, output redirects (`>`), `gh alias`, `gh extension` and `gh api` writes. The git block-list still applies first.
- The read-only shell also turns off the system git config, hooks (`core.hooksPath` points at an empty directory) and `core.fsmonitor`. These are set at command-line level, so a hook or fsmonitor command in the repository's own config does not run.
- `inheritGitConfig` no longer copies your global git config. git gets a per-call config with only `user.name` and `user.email`. Aliases, credential helpers and `insteadOf` URLs (which can hold tokens) are not passed. The file lives in its own temporary directory and is removed after each call, so no `.gitconfig` is left in the shell's home directory. This also applies to the terminal when `git` is allowed. Side effect: git credential helpers from your config no longer apply, so `git fetch` from a private HTTPS remote fails in the shell. `gh` commands keep their own credentials (`GH_TOKEN` or `gh auth login`).

`extractStructuredOutput()` now reports how each extraction succeeded or failed. A success carries `result.report`. A failure is a `StructuredOutputExtractionError` with the same `report`. The report covers the layer that produced the value (`native | prompt | repaired | coerced | retried`), the native outcome, the attempt counts, the JSON repairs applied, coercion, and budget escalation. A failure also lists field-level validation errors (JSON Pointer `path` plus `message`) and a failure kind. Error messages and retry prompts are unchanged.

A guard that stops a run late now still gives the model its one "write the final answer" turn. The exit gate counted one fewer remaining LLM call than the run loop allows, so a low-delta or stall stop on the second-to-last iteration (for example after a long open-ended "explore" gathering phase) skipped that turn and ended the run. The gate now uses the same bound as the loop. If the model answers on that turn, the run ends with the model's answer. If it does not, the handoff applies (see the answer-turn changeset), and no extra iterations are added.

xAI's default model is priced, and remote price rows are no longer labelled as your pricing.

- The default xAI model is now `grok-4.7`. It was `grok-4`, which is no longer on xAI's price list, so the default model's calls had no known cost. `grok-4.7` is priced from the bundled snapshot at $2 / $6 per 1M tokens, with 2x rates above 200k prompt tokens. The capability table seeds `xai/grok-4.7` in place of `xai/grok-4`. `grok-4` still works and resolves through the hosted fallback, but it has no price.
- `priceFor` now labels rows from `withDynamicPricing` as `source: "remote"`, with `origin` naming the price list. Before, it labelled them `"user"`. These calls bill as `priceSource: "price-book"`. Rows from `withModelPricing` stay `"user"` and still win over remote rows.
- `openRouterPricingProvider` and `urlPricingProvider` set `origin` on each row they fetch. A custom `PricingProvider` can set `origin` itself or pass its rows through the new `markRemotePricing(rows, origin)`.
- New exports: `PricingRow`, `PricingRowSchema` and `markRemotePricing`. `PricingRegistry` rows are now `PricingRow` (`ModelPricing` plus an optional `origin`). `PriceEntrySource` adds `"remote"`, and `PriceEntry` adds an optional `origin`.

The harness no longer writes the answer. It decides when the model must answer, and the model writes the answer.

- **Answer turn.** Sometimes a guard (stall, low-delta, loop, controller early stop) proposes to end a run while only the answer is missing (no required tool or write target is left). The exit gate's one "write the final answer" turn is then an answer turn: that one think call is sent with no tools. A small model can no longer use it to gather again. The call after it offers tools again. The gate's record carries `exitGate.answerTurnAt` (the LLM-call count of the tool-free call). The trace gets an `exit-gate-answer-turn` signal. If tool work is still outstanding, the denial keeps the tools.
- **No more harness-written answers on unfinished runs.** Before, a second soft exit or the iteration cap with work outstanding started a "handoff synthesis": an extra LLM call that wrote an answer from the evidence and labelled the run `partial` (`terminatedBy: "harness_deliverable"`). That path and its extra LLM call are removed. Such a run now ends one of two ways:
  - **The model wrote an answer** (for example 2 of 3 files are written): the run ends `partial` with `success: false`. The output is the model's own draft followed by an `Unfinished:` list with one `- item` line per unmet item. This is the same shape plan-execute's strategy handoff already produces. `harnessAuthoredOutput` is not set. The deliverable decision is refused (`accepted: false`) and carries the gate's record. A draft written before tool results that arrived after it is not shipped. A required tool that was never called still fails the run (`missing_required_tool`).
  - **The model never answered:** the run ends `failed`. Its error names what is outstanding (`Outstanding: …`). The gathered tool evidence is attached unchanged under `result.metadata.extensions.unfinishedEvidence` (`{ toolName, content }[]`, each content capped at 6,000 characters).
- **`terminalOutcome.outstanding` lists the unmet items** in both cases, as the gate phrased them (for example `write the file ./report.md`). Outcome readers no longer have to parse `result.error`.
- `terminatedBy` is the proposing guard's own reason (for example `low_delta_guard`, `dispatcher-early-stop` or `max_iterations`). A guard that claimed `harness_deliverable` is now reported by its name, for example `stall_deliverable`.
- Removed internals: `kernel/loop/handoff-synthesis.ts` (`runHandoffSynthesis`, `buildHandoffPrompt`, `composeHandoffOutput`), `pendingHandoff`, and the `handoff` option of `terminate()`. `unfinishedBlock` and `UNFINISHED_HEADER` now live in `kernel/loop/exit-gate.ts`. `strategy-exit-gate.ts` re-exports them, so both gates use one formatter.

Durable-run storage is now owner-only (directory 0700, `runs.db` 0600), and agent ids are contained to a single path segment in the default durable-runs directory so `../` or absolute ids cannot escape `~/.reactive-agents`.

The channel hub activity feed now says why a model-written acknowledgement fell back to canned text (`timeout`, `empty`, `thinking_only` or `error`), for example `acknowledged (canned, owner; model ack fell back: thinking_only)`. The activity record also carries the reason as a field. No message text is shown.

A required tool that keeps failing now ends the run honestly instead of burning iterations to the stall guard. After 10 consecutive failures with no success, a new `broken-tool-exit` turn operation proposes an exit (`terminatedBy: required_tool_quota`, guard event reason `required_tool_unavailable`) and the exit gate names the tool in the result as unavailable instead of asking for a call that cannot land; a model draft ships as a labelled partial, otherwise the run fails with its gathered evidence attached. From 4 consecutive failures the recovery and loop guidance name the tool as unavailable and never tell the model to retry it, and when the run has already routed around it (for example `http-get` succeeded after `web-search` failed) the guidance says so. An exit left with only an unavailable tool outstanding is no longer denied for work that cannot land.

Security: `.withApprovalPolicy()` now gates tools that are registered after `build()`. Before, only built-in and custom tools that need approval were gated, so these ran without approval under every strategy:

- MCP tools the server marks as writing (`destructiveHint: true`, or `readOnlyHint: false`). MCP tools with no annotation and no `readOnly` promise are not gated by default, the same rule as custom tools without `requiresApproval`. To gate them, name them in `tools` (`"server/tool"`) or use `requireFor`.
- `.withAgentTool()` sub-agent tools. Their documented default is `requiresApproval: true`.
- Tools added with `agent.registerTool()` that set `requiresApproval: true`.

Each reasoning pass reads the live tool registry, so the block and detach gates and code-action's refusal check all see these tools. Agents with no approval policy behave as before.

Chat sessions: the first turn of a conversation no longer gets an "Environment update since your last turn" notice from a stale `initialEnvironment` seed. With no earlier turn there is nothing to compare against, so the current environment becomes the baseline.

`codeActionApprovalConflict` and its `CodeActionApprovalConflict` / `CodeActionApprovalConflictInput` types are now exported from `@reactive-agents/runtime` and `reactive-agents`, so apps can warn before a code-action run without importing `@reactive-agents/reasoning`.

The `reactive-agents` facade now re-exports the cost helpers the 0.19 cost migration needs: `sumCosts`, `addCost`, `EMPTY_COST_SUM` and the `CostSum` and `PriceSource` types (from `@reactive-agents/core`), plus `priceFor`, `priceUsage` and the `PriceEntry`, `BillableUsage` and `PricedUsage` types (from `@reactive-agents/llm-provider`). Code that sums `estimatedCost` (now absent when a model's price is unknown) or prices usage itself can import everything from `reactive-agents`.

Add typed `AgentEvent` members for the channel router: `ChannelRouteMatched`, `ChannelRouteDenied`, `ChannelUnrouted`, `ChannelTurnStarted`, `ChannelTurnCompleted`, `ChannelTurnDropped` and `ChannelOwnershipChanged`. `ChannelDeliveryFailed.kind` gains `"conflict"` (another consumer owns the account).

Strategy planners plan from one shared context, and a strategy run can no longer finish `completed` with plan steps left open. The `blueprint` and `plan-execute-reflect` planner calls (generate, patch, augment) now carry the plan-only posture, the tool catalog with each tool's parameters and read or write effect, and the env date and timezone (the date rule appears when a tool takes a date). Plan-execute's planner now sees tool descriptions and parameters, as blueprint's already did.

Tool-call arguments are checked against the tool schemas when the plan is made. A missing required argument, or a date the goal does not give (a baked `2024-11-21` on a 2026 run), is no longer dispatched as written: the step becomes a composite step and the model chooses the argument when it runs. A relative phrase the goal used (`tomorrow`) resolves against the env date. A step typed `analysis` that names a tool becomes a composite step scoped to that tool. A `plan-args-validated` guard event lists the findings.

Each plan step now ends `done`, `skipped` or `failed` in `result.metadata.planSteps`. Blueprint's step executor finishes steps its worker does not run; a step the budget no longer allows stays open, the run is `partial`, `metadata.planIncomplete.open` names it, and a `plan-incomplete` guard event is published (this replaces blueprint marking unrun steps done). Plan-execute sends a SATISFIED reflection on a plan with unrun steps back to run them. Both strategies' final synthesis call chooses over-long step results by relevance to the goal within the model's evidence budget, names what it left out, and records the choice in a `solve-evidence` guard event.

Security hardening, second pass. Approval command rules now match the program that runs: git global options (`-C`, `--no-pager`, `-c`, `--git-dir`) and wrappers (`env`, `xargs`, `timeout`, `sudo -u x`) no longer hide `git push` from a `"git push"` rule. `shell-execute` forwards `gh` and `gws` credentials only when that command is granted, so `jq env` or `awk ENVIRON` cannot print them. MCP docker HTTP mode publishes its port on `127.0.0.1` only and passes the allow-listed environment to docker. Scratchpad spill files are owner-only (0700/0600). `http-get` drops credential headers on cross-origin redirects and stops reading a body at the size cap. File tools (`file-read`, `file-write`, `file-edit`, `list-directory`, `grep`) refuse credential paths inside the file root (`.env`, `.env.*`, `.ssh`, `.cortex`, `secret.key`, `provider-keys.json`, ...), including through symlinks; hosts opt out explicitly with `withSecretPathAccess`. `@modelcontextprotocol/sdk` is now `^1.32.2` (fixes GHSA-6qxp-vccf-f47h and GHSA-6prh-2h8m-c8cw); `client_credentials` and `private_key_jwt` auth accept an optional `expectedIssuer` so credentials go only to that authorization server.

Cortex run view and run compare fixes from live QA:

- A run whose answer an output guardrail withheld no longer shows that text as the run's Answer (or seeds "Continue in chat" with it); the failure banner explains the block.
- Compare marks a loop only one run reached as a difference ("did not reach this loop") instead of "Same on both".
- Compare deltas read "same" when the two values look the same (0s vs 0s), and the config line reads "1 setting differs".
- Runs without a name show 12 characters of their id (as the run header does), so runs started in the same second are told apart in Runs and the Compare picker; the picker also shows each run's strategy.
- Durable-run agents get the user-question rail through the AgentConfig (`userInteraction`) instead of a Cortex-only builder call, so Export shows `.withUserInteraction()` in the code.

Export `isRetryableLLMError` from `@reactive-agents/llm-provider`. It is the predicate the provider retry schedule uses to decide whether to re-send a failed request. Import it to learn whether the provider already retried an error, instead of keeping a copy. Retry behavior does not change.

The continuation-intent verifier check rejects again: a rejected continuation announcement ("I'll make one more attempt...:") never ships as the run's output. Only the semantic checks (fabricated-measurement, listed-entities) stay demoted to advice.

`find` is easier for small models to use.

- `find` matches a query against loaded document names: `README`, `README.md` and `cortex readme` return the chunks of `apps/cortex/README.md`.
- A query that only names a document (`Cortex README`, `the readme`) also returns that document's `outline` (its markdown headings, or the first line of each chunk; up to 15) and a `hint` to search its content with the words of the needed fact.
- A query that names a document and adds content words (`cortex readme port environment variable`) ranks that document's chunks by the content words, not by the name.
- When `find` returns a preview of a large result set, each preview is the 200-character window that holds the most query words, not the first 200 characters. A fact deep in a chunk (an env-var table row) now reaches the model.
- Document result `identifier`s and the `documents` list use the basename, or the shortest unique path suffix when basenames collide (`cortex/README.md`, `tools/README.md`), instead of the absolute path.
- Every `find` result that searched documents lists the loaded document names in `documents` (first 8, then `and N more`). When no passage matched, a `hint` names the documents and suggests a content keyword.
- The `find` description tells the model to query with the words of the fact it needs, not the document's name.
- `NOISE_KEY`, `isNoiseKey` and `SALIENT_FIELDS` (the result renderer's noise-key and label-field classes) are exported from the package index.

Piped runs and `verbosity: "minimal"` runs now print the answer alone.

- The `✓ Provider: … | Model: … | API key: …` line after `build()` follows the same verbosity rule as phase lines. It prints in a terminal, and when you set `withObservability({ verbosity: "normal" })` or higher. A piped run with no verbosity set (`| cat`, CI, a server) and any `"minimal"` run skip it.
- The live status line no longer turns on when verbosity is `"minimal"`. `logging: { mode: "status" }` still forces it on.
- Builder notices, such as `withTools: unknown option …` and the bare `.withTools()` "no capability tools" notice, print as one `⚠ <message>` line on stderr. Before, they printed as Effect logfmt on stdout (`timestamp=… level=WARN fiber=#N message=…`). Build validation warnings use the same channel.

Cortex chat: a failed turn now shows the run's cause (for example the provider's "400 Your credit balance is too low") under the "did not finish" badge, live and after reload, and the run's failure toast carries the same line. Each run gets at most one end toast. A queued message is kept, not auto-sent, when the reply's run failed. Run toasts keep arriving after you visit the Trace page. Restore on a set-aside draft is a swap: the text it replaces gets its own Restore, so Edit then Restore loses nothing. Compaction accepts section headings that differ only in case, spacing, a trailing colon or a parenthetical, and the summariser prompt no longer puts guidance in the heading lines.

Cortex: the chat plan card is compact (one line per step, a quiet "+ tool", and a dependencies/args chip that opens its editor in place), a turn you paused reads "paused by you" instead of "stopped by you", and an iteration-cap stop says "iteration limit" instead of "spending limit". ui-core adds `UserInterrupt`, `userInterruptOf` and `TurnOutcome.userInterrupt` (additive).

Cortex desk Continue (the Runs page "Can continue" strip) and Resume of a crashed run now start a new run linked to the one that stopped (`resumeRun(runId, { newRun: true })`), like chat Continue. The new run gets its own run row, filed with the original launch settings and a "continued from" link, its events land on it, and its page opens when you press Continue. The stopped run keeps its own page and trace and is no longer offered beside its continuation; a crashed run's row is closed as stopped. Approving or denying a paused run still continues the same run.

Harness polish before v0.19.0:

- An advisory verifier verdict (the answer is kept) now logs at debug level, so a correct answer no longer prints a warning line at normal verbosity. The verdict event is still recorded in the trace.
- A run stopped on request before any answer now reports the stop as its cause ("the run was stopped on request ... before an answer was produced") instead of a generic "no grounded answer" sentence. A stop on a run the fabrication guard already failed keeps the guard's cause and its `abstained` terminal.
- The no-tools carve-out now counts tools that relevance pruning hid but `discover-tools` can still surface, so a pruned-but-discoverable run with no evidence is not reported as success.
- The to-do wrap-up deferral in the exit gate now runs only when `todoWrapUp` is on.
- Curator `compressed` trace events are emitted once per result per run, not on every turn.
- `ContextProfile.recentObservationsLimit` is documented as accepted with no effect (slated for deprecation).
- Semantic entropy (opt-in) embeds only the new thought once the prior thought's embedding is cached, and keeps that cache in the sensor instead of writing into the caller's kernel state.

Add `TelegramChannelAdapter`, a native Telegram **bot** adapter (Bot API, bot token) on the canonical `ChannelAdapter` contract. Inbound uses long-polling `getUpdates` (default) with an `onOffset` / `initialOffset` persistence hook, or a webhook through `handleWebhook` (secret-token checked, fail closed). The offset advances only after an update is handed to the inbound queue, and repeats are deduplicated by `update_id` and message id. Identity is `telegram:<numeric id>` with the group as conversation and the individual sender kept; `mentionsSelf` resolves `@bot`, `/cmd@bot` and replies to the bot; bots' own and other bots' messages are flagged as echoes. `send` splits text at 4096 characters without breaking emoji or code fences, converts `format: "markdown"` to MarkdownV2 (falling back to plain text if Telegram rejects the entities), supports `replyTo`, forum-topic `threadId`, photo/document/url attachments, and returns the real message id as the receipt. Telegram failures map to typed `ChannelError`s (`auth`, `forbidden`, `not_found`, `rate_limited` with `retryAfterMs`, `too_large`, `network`; a 409 poller or webhook conflict is a non-retryable error), and sends respect Telegram's global and per-chat rate limits. The bot token is `Redacted` and scrubbed from every error. The Telethon personal-account MCP path (`docker/telegram-session.sh`) still works and is documented as legacy. The shared conformance suite gains optional harness fields `threadRef` and `expected().userId` for platforms with numeric ids.

`toolBuilderToEntry()` now runs a handler that returns an Effect and uses its value as the tool result. Before, the tool returned the Effect object itself, and the model saw `{"_id":"Exit",...}` in place of the value. Async handlers are awaited. A throw, a rejected Promise or a failed Effect now fails the tool call with `ToolExecutionError`, which the model sees as a tool error. Before, a synchronous throw escaped the handler.

`recall(key, full: true)` now returns the stored content instead of a compressed preview. When the content fits the remaining context window, it comes back in full as plain text. When it does not fit, the result states the total size and how much fits, shows that first section, and names the call that reads the next one (`recall(key, full: true, start: N)`). The result is never re-stored as a new `_tool_result_N` key. A repeated identical recall is replayed with the duplicate note.

The budget answer turn is now on by default (owner decision 2026-11-19, to be measured afterwards). A run can reach the last think call its iteration budget allows with tool evidence gathered and only the answer missing. That call now ships with no tools, so the model writes the answer instead of making a tool call that nobody answers. A guard stop (for example the dispatcher early-stop) that would otherwise end such a run without an answer also gets this one answer turn, even after an earlier denial. In a multi-pass strategy, only the run's own last call is reserved. A pass cap with run budget left is not. Turn it off with `harness: { budgetAnswerTurn: false }` or `RA_BUDGET_ANSWER_TURN=0`. An explicitly enabled `wrapUpReserve` takes the call first on seeded plan runs.

The streamed `TokenUsage` event now carries optional `firstTokenMs` (milliseconds to the first streamed output token), forwarded from `LLMRequestCompleted`. It is absent for non-streamed calls. With it, a consumer can report a true output rate instead of a duration-wide lower bound.

`rax-diagnose cause` and `attribute` now read three run shapes correctly:

- **Strategy errors.** A strategy body that fails (for example, code-action refusing `.withApprovalPolicy({ mode: "detach" })`, or reflexion's synthesis fallback failing) is the decisive cause `strategy-error`, with sub-causes `config-refused`, `synthesis-failed` or `body-error`. Before, it read `undetermined / insufficient-trace`, or the inner pass's iteration cap. A body that failed on a model call (`LLM call failed`) is a probable `provider-error`.
- **Several runs under one runId.** A trace file holding several runs (Cortex "Continue" reuses the runId) is split at each `run-started`. `cause` and `attribute` report the last run with a note (`2 runs share this runId; this is run 2 of 2`). `--segment=<n|all>` picks a run, and `--all` cohort mode counts each run once. Before, one report mixed the first run's start with the last run's end and summed tool counts across both. `analyzeCause` and `attributeFailure` read the last run. New exports: `runSegments`, `lastRunSegment`, `withRunSegment`, `runSegmentNote` and `CauseAnalysis.runSegment`.
- **Status override on a verified answer.** When a `terminal_status_override` (`labelsDisagree: true`) fails an answer whose terminal meant to deliver and whose deliverable gate passed, the cause is now `terminal-mislabel/status-override`, attributed `harness:terminal-mislabel`. Before, it read `budget-cap/cap-cutoff` ("raise the iteration budget").

The approval gate can now require approval for specific shell commands, not only whole tools. `ApprovalGateConfig` (and the resolved, configured and authored approval policy shapes derived from it) gains `commands?: readonly string[]`: a `shell-execute`, `git-cli` or `gh-cli` call whose `args.command` has a segment starting with a rule's words (`"git push"` matches `git push origin main`) is gated like a listed tool. Block mode refuses it unless the approval handler approves (deny by default); detach mode pauses the run on it. `shouldGate` now takes the call's `args`, and `requireFor` predicates receive `args` too. The code-action strategy refuses a policy that sets `commands`, as it already does for gated tools.

`agent.channelStatus()` returns the channel service snapshot (adapters, sessions, message counters; `null` before the gateway starts), and `agent.gatewayStatus().inboundQueue` reports the inbound queue's `ready`, `deferred`, `capacity`, `overflow` and a live `dropped` count. Also fixes `.withGateway()` options (`queue`, `port`, `webhooks`, `accessControl.mode`/`sessionTtlDays`) never reaching the running gateway; they silently fell back to defaults.

Eval cases can now be graded by a calibrated judgment rubric, after the deterministic checks.

- `EvalCase.rubric` asks one `JudgmentService` question (Noul yes/no, Choice, or Score) and states what passes: `passWhen: { minProbability }`, `{ accept: [...] }`, or `{ minScore }`, with an optional `minConfidence` (default 0.6).
- Order: `structured` checks run first. The rubric is asked only when they pass or are absent, so a case that data already failed costs no judge call.
- A grader that cannot decide says so. Low confidence, any `JudgmentError`, a wrong answer kind, an invalid rubric, or no `JudgmentService` wired gives `verdict: "inconclusive"`, never a guessed pass. An uncalibrated backend (the `llm` emulation) must reach confidence 0.8 or the verdict is inconclusive.
- `EvalResult` gains `verdict`, `rubric` (raw answer, score, confidence, calibrated, backend, reason) and a per-check `checks` breakdown. `EvalRunSummary.inconclusive` counts undecided cases apart from `passed` and `failed` and leaves them out of the averages. Stored runs stay readable; the new fields are additive.
- `checkRegression` also compares the pass rate over decided cases and returns `passRate` and `inconclusive` counts. Inconclusive cases are never counted as passes.
- `JudgmentService` exposes an optional `backend` name so verdicts record which judge answered.
- New exports: `gradeRubric`, `readRubricAnswer`, `rubricProblem`, `gradeCase`, `RubricSchema`, `RubricVerdictSchema`, `CaseVerdictSchema`, `RUBRIC_DIMENSION`.

Settings · Voice: the local listening preset is now "Speaches (local)" (the renamed faster-whisper-server) and there is a "Speaches (local, Kokoro)" reading preset (`speaches-ai/Kokoro-82M-v1.0-ONNX`, voice `af_heart`). When Test fails because the server has not downloaded the model ("not installed locally"), the page shows how to download it and a copyable `curl -X POST …/v1/models/<model>` command. Presets that share a URL are told apart by model.

MCP tools that declare an `outputSchema` now get a `returnType` on their tool definition: a compact type string such as `{ websites: { id: string; name: string }[]; total: number }` (object nesting capped at 3 levels, at most 240 characters). Code-action tool bindings render it as `Returns: <type>`, so the model can read the right result properties on its first attempt instead of guessing the shape. `MCPToolSchema` carries the server's `outputSchema`. MCP tools without an `outputSchema` are unchanged.

Settings · Providers can now add, replace, test and remove an API key per provider. Keys are stored only on the Cortex server, encrypted with AES-256-GCM in `.cortex/` (key file and keys file mode 0600), and never sent back to the browser: rows show `••••` plus the last four characters and whether agents use the saved key or the environment's. An environment key wins unless you choose the saved one. Agents get the saved key through `.withProvider(provider, { apiKey })` on every build path (chat, desk runs, gateway agents); `process.env` is never changed. The model list and key-missing labels count a saved key, and the no-key help on the Model page and model picker points to Settings · Providers. A saved key reaches agents for every listed provider, Anthropic and Gemini included.

Settings · About now shows the real Cortex version and the framework version. In a source checkout both come from the repo `VERSION` file plus the git commit, instead of the frozen workspace `package.json` baseline (`0.10.6`).

Plan-execute and blueprint now publish the typed `PlanRecorded` event when their plan first appears or its step set changes (including patches), and `PlanStepStatusChanged` for each step status change, from the same sync that writes their plan checklist rows. Strategy plans reach subscribers through the same events as `agent.plan()`, with the strategy run's task id as the plan id. Step-title de-duplication (derived checklists, patch and augment steps) now uses core's shared `isNearDuplicateTitle` rule.

Cortex Beacon in the "Bench" design (step 5 of the modernization plan).

- **Board** is Beacon's default view. *Running now* shows a card per working agent: its name (never a bare id), source, run time, task, what it is doing now (`Calling http-get`, `Thinking after 14 tool calls`), a small entropy line with `η`, a loop meter and steps, tokens and cost. Only running cards glow. The **Agents** grid lists the rest with status, source, the question or approval it waits on, why it failed, or its task, plus model, tokens and time, filtered by All / Needs you / Failed / Idle.
- **Field** keeps the free canvas, restyled: a dot grid, nodes named by agent with a sentence-case status (no more `STATUS: SETTLED`), the glow and one sonar ring on running nodes only, and parent-to-sub-agent links that flow only while both run. Drag and Arrange stay; the stats panel is gone (Board carries the counts).
- Switch views from the page header. The choice is kept in the URL (`/?view=field`) and remembered in the browser; the URL wins.
- First run shows a welcome with the neural mark and Open a chat / Build an agent / Connect an app.
- The prompt bar shows the model (it opens the full agent settings), the prompt library and Run.
- The top bar uses Cortex's own icons (no more icon names flashing as words before a web font loads), marks the current page with an underline, counts live runs on Runs, shows how many agents are running, and has a "Search or run a command" button. Toasts and the command palette use the same icons.
- Fixed: a stopped run read as finished ("settled") on Beacon; it reads Stopped. A late event no longer revives a run that already ended, and a periodic refresh no longer flips a run the socket ended back to running.
- Fixed: a page opened while an agent was running showed a blank card until its next event; Beacon now fills the entropy line, loop and tool calls from the run's stored events.
- Fixed: Arrange on the canvas could lock the page (an update loop).
- Fixed: an agent waiting on an approval counted as running in the top bar.

Chat sessions have a mode, `"execute"` (default) or `"plan"`. Read it with `session.mode`, switch it with `session.setMode(mode)`, or start in one with `agent.session({ mode: "plan" })`. Every turn's run posture comes from the session mode, so plan mode runs each turn as pure reasoning (no tools) and the prose plan stays in the session history for the next execute turn. A per-turn `posture` option still overrides the mode for that turn. Session mode is separate from the `plan-execute` reasoning strategy. Without a mode set, behavior is unchanged.

Strategy runs keep the input/output token split for their direct LLM calls. Reflexion's critique, plan-execute's reflect, synthesis and plan patches, blueprint's worker and patch calls, adaptive's fallback roll-up and the quality gate now account the provider's `inputTokens` / `outputTokens`, not only the total. A provider that reports a split now shows it on these strategies' results instead of leaving it unknown. Plan patch and augment calls also count their cost, which they dropped before.

`AgentMemoryEntry` (the `AgentMemory` port input) gains optional `taskId` and `runId` fields that record which run wrote the entry. Existing producers and adapters compile unchanged; adapters that do not store provenance ignore the fields.

Gemma models on the Gemini provider work again. Every Gemini request used to carry `thinkingConfig` (budget 0 when thinking was off), and Gemma models such as `gemma-4-26b-a4b-it` reject that field with `Thinking budget is not supported for this model.`, so the run failed before its first step. `thinkingConfig` is now sent only to models whose capability says they support thinking. Gemma ids resolve to `supportsThinkingMode: false` with their real window (gemma-4: 262144 input, 32768 output; other Gemma generations: a conservative 32768 / 8192), even when the model listing reports `thinking: true`. If the API still rejects the thinking field for some other model, the provider retries that request once without it, prints a one-time warning naming the model, and stops sending the field for that model.

The chat reads as one wider column. The transcript, the to-do dock, the error banner and the composer share one width (58rem) and line up edge to edge; before, the transcript was narrower than the composer and left much of a wide screen empty. Answer text still wraps at a comfortable line length (about 80 characters), while code blocks, tables and tool cards use the full column. The run view's Answer follows the same rule. Under 900px the gutters drop to 16px.

Token usage halves are now optional: a count the provider did not report is unknown, never a measured 0.

- `TokenUsage.inputTokens` / `outputTokens` are optional. Ollama leaves a half out when `prompt_eval_count` / `eval_count` is absent. OpenAI and LiteLLM streams emit no usage event when no usage chunk arrives, and `complete()` falls back to input + output when `total_tokens` is missing.
- Gemini now counts thinking tokens (`thoughtsTokenCount`) in `outputTokens` and reports them as `reasoningTokens`, matching the SDK's `totalTokenCount`. Totals and cost for Gemini thinking models rise to the honest figure.
- Reasoning sums a half only when every contributing call reported it. `LLMRequestCompleted` omits `tokensIn` / `tokensOut` / `billedTokens` it cannot know, and strategy direct calls (reflexion critique, plan-execute synthesis and patches) now carry the provider split.
- Core `DebriefPayload.metrics.synthesisTokens.input` / `output` are optional.

The duplicate-call refusal now leads with the write owed: when a listed input is already read but its paired numbered output (notes-N to out-N) is unwritten, the refusal tells the model to write that output from the value just read instead of steering to another read.

Cortex MCP servers can declare themselves read-only (all tools, or named tools) and trust the server's own read-only hints; both are saved with the server and reach the agent. Attaching an MCP server in the Lab tool picker or the chat `/mcp` menu now makes all of its tools available, with no need to select each one; clicking a tool leaves it out. Saved agents with explicit `server/tool` lists keep working unchanged.

Cortex agents now ask before risky tools by default. Writing files, running code and the full shell wait for your approval in chat and desk runs (gateway agents refuse them, since nobody is watching). Switch it off per agent with "Ask before risky tools" in Lab · Tools, or `/approvals` · Turn approvals off in chat (`askBeforeRiskyTools: false`). The framework's own default is unchanged.

The chat composer now has one command surface: typing `/` and the Config button open the same list, anchored to the composer, with each setting shown beside its slash command and current value. A command with options (`/model`, `/tools`, `/agent`, `/approvals`, ...) opens in place under a Back row; Esc goes back one level, then closes. `/agent` gained an On/Off panel.

Chat no longer leaks tool results across conversations. The tool path sends the raw message as the task (same as the streaming path) instead of prepending the agent's last-run debrief and tool results; the direct (tools-off) path now shows a session only its own latest tool results. `.withHarness({ leanThinking })` is accepted and recorded in `run-started.config.mechanisms` (default off).

Cortex chat: the composer stays editable while a reply runs. Enter queues the next message and sends it when the reply finishes (Escape or Clear drops it). Text that would overwrite a draft (starter chips, `/help`, `/docs add`, Edit) sets the draft aside behind a Restore toast. Compaction summaries follow a fixed section structure, long chats are trimmed before summarising, and the context meter shows the post-compaction estimate immediately instead of the pre-compaction reading.

Cortex chat sends a tagged `@file` to the agent as a pointer (workspace path, size, "read it with file-read") instead of inlining the whole file, so paths mentioned inside the file no longer look like requests and context is not spent on text the agent may not need. A file of 2 KB or less is still placed in the block whole. Edit message now puts the message's tag chips back in the composer, Rerun sends the tags again, and the thread shows tags as chips, never as file text.

Cortex: "All framework options" no longer duplicates curated controls (each builder section declares the AgentConfig paths it sets; pinned against the mapping) and now renders `reasoning.observationSummary`. The Model page shows what the strategy-choice bandit learned per task category (from the calibration database). Debriefs: the run view no longer points to a nonexistent Observability setting; it says debriefs need memory and links the run's config, and the Memory section has a "Debrief after each run" switch that maps to memory.

Chat runs now state the current turn as typed data. `run()`, `runStream()` and the gateway chat path set `task.metadata.currentTurn` (the user's message without the folded-in history block), and intent readers (tool relevance, strategy routing, skill matching) read it before falling back to parsing text markers. Runs with no history are unchanged.

Rewrite the npm READMEs to the shared package template: pitch, stability tier, install, one example, API table, docs links, runtime and license. Remove the duplicated strategy table, the unsourced healing percentage and links to exports that do not exist. README code examples now type-check against the public API.

`.withJudgment(false)` turns judgment off and opts out of the build-time auto-shadow probe (no Ollama `/api/tags` call, no observation-only shadow backend, no `judgment-shadow.db`). Default behavior is unchanged, and `REACTIVE_AGENTS_NO_AUTO_SHADOW=1` still works.

An answer that only announces the next step ("Let me list the workspace.", "I'll check the files now.") is no longer accepted as a finished result. The output-not-continuation-intent check now flags a short output (one or two sentences, up to 200 characters, with no list, table or code block) when every sentence is a first-person future-intent clause, whatever the verb. A real answer that ends with "Let me know if you need more." still passes. Tree-of-thought also has a test now confirming that a model's thinking never becomes its answer.

Security hardening for channels, A2A and deploy scaffolds.

- channels: an empty or whitespace webhook / Telegram `secretToken` secret is treated as unset and fails closed (previously an empty key let anyone forge a signature). Sender identity (`sender`, `platform`, `adapterId`) can no longer be overridden by adapter-supplied `metadata` when the policy event is built. The per-sender session map is now bounded (LRU, default 500, `SessionBridge({ maxSessions })`). Telegram and Signal adapters ask the new `ChannelAdapter.setSenderGate` hook (installed by `ChannelService`, backed by the gateway access policy or `ChannelServiceDeps.allowSender`) before downloading inbound attachments, so unknown senders cannot force downloads.
- a2a: the HTTP server counts request bytes on the stream (default 1 MiB, `maxBodyBytes` option, 413 on excess) so chunked bodies cannot bypass the cap; the task store is bounded (default 1000, `createA2AServer(card, { maxTasks })`, oldest evicted); discovery and `getAgentCard` no longer follow redirects, and `getAgentCard` now goes through the same `assertPublicUrl` egress guard as `discoverAgent` (cloud metadata always blocked, private targets blocked with `strictEgress`).
- cli: `rax deploy` SDK scaffolds now create or extend `.dockerignore` (`.git`, `.env*`) so `.env.production` and git history never land in image layers.
- docker/signal-mcp: the Signal data dir is `chmod 700` (was 777; the compose service runs as `SIGNAL_UID`/`SIGNAL_GID`, default 1000), Bun is pinned, and the signal-cli tarball is verified against a SHA-256.

Cortex: the Model page shows what a model costs and how the harness adapts to it, and Runs can resume a crashed durable run.

- **Spend** on the Model page: spend over the model's last 50 runs (priced by the framework), spend per successful run, and tokens in, out and served from the prompt cache.
- **Calibration** on the Model page: the framework's calibration for the model in plain words (tool result size, attention to instructions, act or answer, tool classifier, parallel tool calls, shortened results, tool-call format), each marked Shipped or Learned from your runs, plus the run observations behind the learned values and the learned uncertainty thresholds. Read only.
- **Stopped mid-run** on Runs: a desk run with durable runs on that was still going when Cortex stopped is listed with **Resume**, which continues it from its last checkpoint with the framework's `resumeRun` on the same run.

Streaming and structured output: `runStream` events carry tool-call arguments while a call runs (`ToolCallStarted.args`) and emit `StructuredOutputReported` with how a typed result was obtained (native, prompt, repaired, coerced, retried); `AgentConfig.outputSchema` accepts JSON Schema (checked by a dependency-free subset validator that rejects unsupported keywords at build time); `runStream(task, { outputSchema })` applies a per-turn schema; `result.objectReport` and `StreamCompleted` carry the object, error and report.

Cortex chat: Stop and Pause show "Stopping…" / "Pausing…" the moment they are pressed, and editing or sending right after a Stop no longer fails with "Chat session is busy: a turn is already in flight". The stop route now answers once the aborted turn has released the session (bounded at 8s, `settled` in the answer), and a history change or send that arrives while a stop is still winding down waits for the release instead of failing. A busy answer that still slips through reads as plain words.

The channel hub activity feed shows how long a model-written acknowledgement took, for example `acknowledged (model, owner; 5.8s)` or `acknowledged (canned, owner; model ack fell back: timeout after 12.0s)`. The activity record also carries `ackLatencyMs`.

Multi-pass strategies keep stored tool results visible across passes. A kernel pass seeded with an earlier pass's thread (reflexion's improve passes, any strategy passing `initialMessages`) started with an empty scratchpad, so a large tool result stored in an earlier pass showed only its cut preview with no recall hint, and a `tool-result-pairing` warning fired. The pass now resolves the carried refs from the run's scratchpad store and the model sees the result as the earlier pass did.

When a strategy's own check accepts the answer after a pass ended at its cap (reflexion's SATISFIED critique), `outcome.authority` is now `strategy-accepted` instead of the capped pass's `strategy-exhausted`, and the strategy records its own `terminal_decision` for the run. A finalization arm that caps the status (contract coverage, outstanding criteria, a gate refusal) still owns the label.

Chat and gateway turns now classify intent on the current user message only. Tool-relevance and literal-mention detection, strategy and complexity routing, task classification, and skill and experience lookups no longer read the inlined conversation-history block, so an old turn that named a tool or action no longer drives the current turn.

The gateway no longer drops events. An event that arrives while the agent is already running (a cron during a chat reply, a channel message during a cron run) now waits in a bounded FIFO queue and runs in order after the current run. A policy `queue` decision (rate limit or token budget) holds the event and re-runs it once the limit window rolls. The cron/heartbeat tick only enqueues, so a long agent run no longer delays heartbeat, session pruning or compaction. Queued, deferred and dropped events publish `ProactiveActionSuppressed` with `policy: "inbound-queue:queued" | "inbound-queue:deferred" | "inbound-queue:dropped"`. New `withGateway({ queue: { capacity, overflow } })` (default capacity 100, overflow `"drop-oldest"` or `"drop-newest"`). The queue is in memory: waiting events are lost on restart; durable cron fires replay through the schedule registry.

Gateway schedules are now durable and observable. Cron schedules persist in `~/.reactive-agents/schedules/<agentId>/schedules.db` (in memory under `provider: "test"` or `NODE_ENV=test`), so `lastRun`/`lastResult` and restart catch-up survive restarts. Each fired cron reports its outcome (`succeeded`, `failed`, or `skipped` when policy or the queue refused it) to the registry and, when the schedule has a `delivery` target, delivers the output through `ChannelService.deliver` and records the receipt. A schedule-store failure during a tick is logged and no longer crashes the tick. New `agent.schedules()` returns a Promise API (`list`, `get`, `create`, `update`, `pause`, `resume`, `remove`, `runNow`, `lastResult`); it rejects with `ScheduleUnavailableError` without `.withGateway()`. `GatewayConfig.port` and `webhooks` are now served: `start()` opens the ingress server (default port 3000, loopback), mounts webhook-capable channel adapters at `/channels/<adapter id>`, and feeds verified events through the bounded queue; `stop()` closes it.

`.withHarness({ stableToolList: true })` turns on the reasoning `stableToolList` switch from the builder. The field is part of the `AgentConfig` harness schema, so it survives `toConfig()`, JSON, and `fromConfig()`. `run-started.config.mechanisms.stableToolList` records whether a run had it on. Default off until an ablation measures it.

Lab Skills · Agent skills: Lock / Unlock a skill (`agent.setSkillMode`, version history kept); Roll back goes through `agent.rollbackSkill`, and manual rollbacks and Refine now refinements appear in the skill's history marked "in Cortex". Moving a Cortex library skill into an agent lets you choose how it evolves, and a name clash offers Update existing, which loads the row as the skill's next version. Memory studio filters a run's facts and workflows in the store query (no 500-row cut-off), and search now matches words of 2 or more characters.

Cortex: the first-run Beacon hero brings back the original landing motion (the core drifts violet to cyan, the orbit ring breathes, a quiet "waiting for your first agent" line); a sonar ring goes out only while a run is starting. Buttons and form controls no longer collapse in scrolling panels (the Lab "Run this agent" button was a clipped pill). The durable run store path follows `REACTIVE_AGENTS_RUNS_DIR` again.

A run that a loop guard stopped can now be continued. On a `.withDurableRuns()` agent, `agent.resumeRun(runId, { note?, extraIterations? })` resumes a loop-stopped run from its final checkpoint with corrective guidance (what was done, what is unfinished, what not to repeat; the original task is the goal), appends `note` to that guidance, and gives the continued run a fresh iteration budget (`extraIterations`, default 10). Completed tool steps are not re-run. Passing options for a run that did not loop-stop fails the new `RunNotResumableError`; plain `resumeRun(runId)` is unchanged.

`AgentResult` gains `runId`, `loopStop` (reason, repeated tool, tools done, unfinished, iteration) and `resumable`. `listRuns()` rows gain `loopStop` and `resumable` (new `loop_stop_json` column, added by a guarded migration). Tool-path `ChatReply`s carry the same fields, and the history note for a failed loop-stopped turn says what was done and that Continue is available (`ChatMessage.runId` / `resumable`).

Re-storing a skill no longer deletes its version history. `SkillStoreService.store` now upserts instead of using `INSERT OR REPLACE`, which cascaded a delete through `skill_versions`; an existing skill keeps its original `createdAt`. `SkillStoreService.update` accepts `evolutionMode`, so a skill can be locked or unlocked in place.

Memory search finds short words: `toFts5Query` keeps terms of 2+ characters (`bun`, `ai`, `db`) and drops common stop words instead of every word under 4 characters. Zettelkasten auto-linking keeps its 4-character floor.

`SemanticMemoryService.listByAgent(agentId, limit, { taskId, runId })` and `ProceduralMemoryService.listActive(agentId, { taskId, runId })` take an optional provenance filter.

Tools of an attached MCP server are no longer hidden by `allowedTools`. Previously an agent with `allowedTools` set (as Cortex chat always does) could not call any MCP tool. They now join the allowlist automatically, so you do not list each `server/tool` by hand:
- Naming any `server/tool` of a server in `allowedTools` keeps the list authoritative for that server.
- `forbiddenTools` and `.withContract()` forbidden tools stay hidden.
- The ToolService allowlist wrapper (list, describe, execute, function-calling schemas) applies the same rule as the run setup.

The declarative agent config (`mcpServers[]`) now carries `readOnly` (`true` or a list of tool names) and `trustAnnotations`, so the operator read-only marking works from JSON config and survives `toConfig()` round trips.

Skill regression rollback now needs evidence. `SkillEvolutionService.checkRegression` rolls a refined (candidate) skill version back only after it has at least 3 uses since refinement and its success rate is below the rate at refinement. A single failure right after a refine no longer reverts it. Tune the bar with `makeSkillEvolutionService(llm, { regressionMinUses })` (`DEFAULT_REGRESSION_MIN_USES` = 3). Skill versions now record the skill's use count at refinement (new nullable `skill_versions.use_count_at_refinement` column, added in place on existing databases; legacy rows count every use, the old behavior). `useCountAtRefinementOf(version)` reads it.

Plan follow-ups. Plan provenance now reads the checklist row `origin` (`agent.plan()` and `session.plan` report `source: "harness-derived"` when the harness derived the steps), and a step's `tool` hint rides the to-do seed so the execute run can act on it. Buffered `session.chat()` tool turns carry the to-do list like streamed turns, chat session turns publish `PlanStepStatusChanged` (and `PlanRecorded`) stamped with `sessionId`, and durable agents honor `run(input, { plan })`, `initialTodo` and plan posture. `planToolCatalog` is on by default; set `.withHarness({ planToolCatalog: false })` or `RA_PLAN_TOOL_CATALOG=0` to turn it off.

Fix channel-hub turns failing with `turn_failed` after a saved agent was edited: an open conversation kept its session on the disposed agent until Cortex restarted. Each turn now uses the current built agent. A failed hub turn or agent build also logs and shows its real cause (sanitized: message only, no URL queries or tokens) in the activity feed and the simulate result.

**Breaking (types):** the public stream's `TokenUsage.costUsd` is now optional (absent = price unknown), and in `@reactive-agents/cost` `costPer1MInput`, `costPer1MOutput` and `ComplexityAnalysis.estimatedCost` are optional (absent when the model has no known price). Migration: handle `undefined` where you read these fields; for a run's billed total use `await result.totalCost()`.

Run cost now matches what the provider bills, an unknown price is reported as unknown, and a pricing outage no longer breaks `build()`.

**Why your cost numbers change.** Every LLM call is now priced from the PriceBook (see the `@reactive-agents/llm-provider` notes): full usage, per-model cache rates and long-context tiers, from a snapshot cross-checked against the providers' price pages. `result.metadata.cost` is the sum of those per-call prices, so most runs report a different, correct number. The old keyword guesses for unlisted models are gone.

- **Unknown prices are flagged, not counted as $0.** When any call in a run (delegated children included) used a model with no known price, `result.metadata.costComplete` is `false` and `cost` is a lower bound: the sum of the calls that were priced. A fully priced run has no `costComplete` field. `runBudgetSpend` carries the same flag. On the public stream, `TokenUsage.costUsd` is now optional (absent = unknown price, previously `0`) and `TokenUsage.priceSource` says where a cost came from. Sum it with `addCost` / `sumCosts` from `@reactive-agents/core`. A debrief whose model is unpriced reports `synthesisTokens.costComplete: false`.
- **What `cost` covers, and the run's total.** `result.metadata.cost` counts every call up to the result. The background debrief synthesis (when `.withMemory()` or `.withDebrief()` produces one) runs afterwards, so it is not in `cost`. For the billed total, debrief included, use `await result.totalCost()`, which resolves to `{ usd, complete }` (at once when no debrief runs, otherwise when the debrief call settles; it never rejects). The same value is on the new `RunCostFinalized` bus event, published exactly once per run: after the debrief call on debrief runs, right after `AgentCompleted` otherwise, and after `AgentAborted` (or a stream cancel) when a run fails or is aborted. `AgentCompleted` now carries `costComplete` next to `totalCostUsd`. A debrief call with no known price, or one that failed, makes the total `complete: false`. On `.withOutputSchema()` runs whose answer is not already schema-shaped JSON, the extraction LLM call is also in `totalCost()` and `RunCostFinalized` (not in `metadata.cost`), so the total equals the sum of the run's `LLMRequestCompleted` costs.
- **A call cut in flight makes the cost incomplete.** When a run is aborted (or a call is raced by a timeout) after an LLM call started but before it reported usage, the provider may still bill that call. `RunCostFinalized.costComplete`, `totalCost().complete` and `metadata.costComplete` are then `false` instead of reporting the partial sum as exact.
- **`chat()` replies flag partial cost.** `ChatReply.costComplete` is `false` when a call in the reply had no known price, so `cost` is not the full spend (absent = every call priced).
- **`withDynamicPricing` fallback fixed.** A failing pricing fetch used to fail `build()`: the non-strict fallback was a `try/catch`, which never sees an Effect failure. Now, unless `withStrictValidation()` is on, the build continues with your `withModelPricing` rows plus the bundled price snapshot, and logs a warning (`LoadBearingFailure:dynamic-pricing`). Your `withModelPricing` rows also now win over remote rows (they used to be overwritten), and remote rows from a custom `PricingProvider` that set no `origin` are labelled `"remote"`, not `"user"`. Both withers and the `pricingRegistry` config key accept the optional `cacheRead`, `cacheWrite5m` and `cacheWrite1h` rates.
- **Cost tracking records the real token split.** `.withCostTracking()` entries used to record the run's total tokens as output tokens and usually 0 input tokens. They now record the run meter's input/output split (0/0 when the provider reported totals only).
- **`@reactive-agents/cost` routing reads the PriceBook.** The router's own price table is deleted: `getModelCostConfig` returns the PriceBook's rates for each tier model (`claude-opus-4-7` was $15/$75 there, it bills $5/$25). `costPer1MInput` / `costPer1MOutput` and `ComplexityAnalysis.estimatedCost` are optional: absent when a model has no known price. The Gemini light tier moves from the retired, unpriced `gemini-2.0-flash` to `gemini-2.5-flash`.

Per-turn hooks now see the state of their moment. `after act`, `before observe` and `after observe` hooks get the round's merged state, including the tool calls and results just made (they used to get the state from before the round, so an `after act` hook could not see the tool it had just run). `after observe` also sees the round's ledger. `before think` and `after think` for the same turn now report the same 0-indexed `iteration` (the after hook used to report the next turn's number).

New prompt-fragment contract, so harness-authored model-visible text (guidance lines, the outstanding-requirements tail, exit-gate text, tool descriptions) can be inspected, replaced or disabled by id. `@reactive-agents/core` now exports:

- `PromptFragmentId` (a dotted id such as `"tail.outstanding"` or `"tool.web-search.description"`), `PromptFragmentSlot` and `PromptFragmentDefinition` (a registry entry: id, slot, owner, summary, and a `render(vars)` that returns text parts).
- `PromptOverrides`: a map from fragment id to a string (replace the text), `null` (disable it), or a transform that receives the default text and returns a string, `null`, or `undefined` (keep the default). `SerializablePromptOverrides` is the JSON-safe subset, with no transforms.
- `resolvePromptFragment(definition, vars, overrides)`, plus `promptFragmentText` and `promptFragmentHash` (SHA-256 of the text), so every package resolves and hashes fragments the same way.
- A new `PromptAssembled` event that records, per model request, each fragment's id, slot, status (`default` | `overridden` | `disabled`), hashes and character count, plus optional tool-description hashes.

These are types and helpers only. No package uses them yet, so no prompt text or run behavior changes in this release.

A run blocked by the final-output guardrail screen now says so. `GuardrailViolationError` carries `direction: "input" | "output"`, and `errorContext()` reports output blocks as "Output blocked by a guardrail" instead of "Input blocked", with advice that fits a withheld answer rather than "rephrase input".

Rewrite the gateway, channels and a2a package READMEs to the shared package README template: stability tier, install, one working example, export table and working docs links. Duplicated gateway and adapter explanations now link to the docs, and the channels webhook example no longer shows options the adapter does not accept. The a2a README now labels the package experimental, matching the stability reference and feature page.

Judgment auto-shadow is now opt-in. Before, every `build()` that could reach Ollama at `/api/tags` silently wired a judgment service on the `nimble` model, without checking that the model was installed, and wrote to `~/.reactive-agents/judgment-shadow.db`. A default `build()` now makes no Ollama call for judgment and writes no shadow DB. To opt in, use `.withJudgment({ shadow: true })` (optional `model`, default `nimble`, and `baseUrl`) or set `REACTIVE_AGENTS_AUTO_SHADOW=1`. With the opt-in, the service is wired only if the model is listed in `/api/tags`. `REACTIVE_AGENTS_NO_AUTO_SHADOW=1` and `.withJudgment(false)` still turn auto-shadow off, and both override the env opt-in.

Channel routes can acknowledge a slow turn before the final reply. New optional `RouteSpec.ack` (`{ afterMs?, text?, typing? } | false`, off by default): the router shows a typing indicator when the turn starts and, if the turn is still running after `afterMs` (default 4000), sends one fixed acknowledgement message (default "On it..."), then the final reply. It is deterministic and costs no tokens; the ack is not agent history, is skipped for quick, denied, dropped and meter-refused turns, and a failed ack never fails the turn. New optional `ChannelAdapter.sendTyping`, implemented by the Telegram adapter via `sendChatAction`. Core adds the `ChannelTurnAcknowledged` event.

Add `PlanFindingWire` and an optional `findings` field on `PlanWire` (mirrors core `Plan.findings`).

Provider retries are classified by status first. A 5xx response, or a network fault with no status, is now retried even when its body mentions an API key, a missing model or a content filter. Before this fix, such a 503 failed at once with no retry. A 401 or 404 still fails at once. An error is retried only when its class is transient (rate limit, timeout, network, 5xx, malformed output), whatever its `retryable` flag says. Malformed model output (`LLMMalformedOutputError`) is now resampled with no backoff delay. The 3-retry cap is unchanged.

Read-and-answer tasks ("read config.json and tell me ...", "add the two counts and reply with the sum") no longer end as `failure` with a correct answer. The prose heuristic that derives a `SideEffectLanded` condition paired a mutation verb and a resource noun anywhere in the task text, so a harness line like "Working directory for this task: ..." plus the answer-shaped "reply"/"add" seeded a condition nothing a read can meet. Verb and noun must now share a sentence or line, so "send an email to the team" still derives it and a read-and-answer prompt with a preamble does not.

A desk run or saved-agent (gateway) run now stores one debrief, not two. The framework publishes `DebriefCompleted` on the agent's event bus, which Cortex already forwards; Cortex no longer adds a second copy from the run result.

`agent.stop()` now ends a run within about 100 ms, even inside a long reasoning loop or an in-flight model call. It used to be checked only between engine phases, and the whole reasoning loop is one phase, so `stop()` waited for the loop to finish. The run ends as before: `AgentStopping` and `AgentStopped` are published and `run()` rejects with `KillSwitchTriggeredError` (reason `stop() requested`).

`agent.terminate()` now publishes `AgentTerminated` for an in-flight `run()` before it resolves, exactly once. A caller that disposes the agent right after `await agent.terminate()` used to lose the event, because it was published only after the run's rejection settled, on a runtime that might already be disposed.

Terminal synthesis no longer rewrites answers as prose when the task names no detected output format. The synthesis prompt now states a format only when one was detected, and otherwise asks for the format the request names. Format detection now also recognizes "markdown report", "markdown document", "markdown summary" and "as a markdown ..." phrasings. Every act-phase guard refusal (repetition, duplicate, side-effect, unavailable tool, meta-tool dedup, unconsumed evidence, write-before-read) now emits a `GuardFiredEmitted` event with `outcome: "block"` (for example `guard: "repetition_guard"`), so traces and `mechanismActivity` count those guards (`guard:repetition_guard:block`).

Cortex shows the plan-sized iteration budget: the feed lists "iteration budget raised to N for the plan" and the loop readouts divide by the raised bound instead of the configured one. A plan step with no stored tool takes the hint its text names (the core helper), so model-written steps no longer show an empty tool dropdown, and a saved plan's tool choices resolve through the core `tool` checklist op.

Tools Lab server routes: MCP servers keep a connection status, can be tested without touching their tool list (`POST /api/mcp-servers/:id/test`), switched off (`PATCH /api/mcp-servers/:id/enabled`; an agent never starts a disabled server on any path), return per-tool input schemas (`GET /api/mcp-servers/:id/tools`) and take per-key write-only credential edits (`PUT /api/mcp-servers/:id/secrets`). Custom tools can be edited in place (`PATCH /api/tools/lab-custom/:id`). `POST /api/tools/mcp-import-json` now answers 410; use `/api/mcp-servers/import-json`.

The `reactive-agents` package now exports the `ProviderName` type (the provider names `.withProvider()` accepts), so you do not need to declare your own copy.

A failed run's debrief now says it failed and why. Its summary used to fall back to "Task completed." when the run had no answer text. A run that a runtime check failed after the kernel finished (for example, a declared deliverable that was never produced) also had its debrief recorded as `outcome: "success"`. The debrief now reads the run's failure cause, the same text as `result.error`. A run with a cause is never recorded as a success, and its summary starts with that cause. The LLM-written debrief is told the run outcome and cause too.

Custom and MCP tools can now be marked read-only. `defineTool` accepts `mutatesExternalState` (set `false` to declare a tool read-only). MCP server config accepts operator-set `readOnly` (`true` or a list of tool names) and `trustAnnotations` (honor the server's `readOnlyHint`); `destructiveHint` or `openWorldHint` always wins, and unset config behaves exactly as before.

Channel correctness fixes. A failed turn no longer blocks later messages in the same conversation (`SessionBridge` serialises turns per key with a semaphore instead of a promise chain that stayed rejected). A defect in an inbound handler now marks the channel `failed`, reports an `ErrorSwallowed` event and calls `onChannelFailed`, instead of ending the inbound fiber while the hub still reported `connected`. Router shutdown now stops adapters before releasing account leases, so a second process cannot take the account while the first still polls it. A failed adapter start leaves no registration behind, and concurrent registrations share one scope. File-lease takeover renames the stale lock aside atomically instead of unlinking it, and an unusable lock directory is a typed `ChannelLeaseError` (surfaced by the router as `channel_start_failed`) instead of a defect. Telegram and webhook ingest wait at most `enqueueTimeoutMs` (default 5000) for room in a full inbound buffer, then fail as `rate_limited` (HTTP 429) so a stalled consumer cannot exhaust ingress slots.

`run-started.config.mechanisms` now records every resolved harness key, so a trace names every mechanism the run ran with. Added: `todoWrapUp` (`RA_TODO_WRAPUP=1`), `writeCoverage`, `toolIndexMaxEntries`, `disclosureMode`, `recencyBudgetChars`, `toolResultBudgetChars`, `treeOfThoughtExploreBudgetMs`, and `promptDumpPathPrefix` (presence only; the path is not recorded). A compile-time check and a drift test fail when the reasoning harness gains a key the record does not carry. No default changes.

`isNearDuplicateTitle` no longer treats two titles as duplicates when both carry digit-bearing tokens and those tokens differ (`out-1.txt` vs `out-2.txt`, `Step 1` vs `Step 2`, `Q3` vs `Q4`). Per-item numbered steps are distinct work and are no longer collapsed by `todo add` or plan refinement.

Cortex chat: approving or denying a paused tool call is now a live turn. Approve answers at once, the approval card goes away and the chat returns to the live view, where the approved call shows as a normal tool call that runs and then carries its parameters and result (kept after a reload) while the run keeps streaming; before, the card sat on "Running shell-execute..." until the command and the rest of the run had finished. The approval card also gets a "Show full parameters" expander for long, multi-line or nested arguments (secrets still masked).

Cortex security hardening. Loopback stays zero-friction; everything else is tightened.

- **Access token.** Binding off loopback (`CORTEX_HOST=0.0.0.0`) now needs `CORTEX_TOKEN`; the server refuses to start without it. When set, `/api/*` and `/ws/*` require it as `Authorization: Bearer`, the `cortex_token` cookie (`GET /?token=<token>` sets it, HttpOnly and SameSite=Strict), or `?token=` on `/ws/*`. Requests tagged `Sec-Fetch-Site: cross-site` are refused, closing cross-site `GET`s that carry no `Origin`.
- **Outbound URLs.** The Ollama endpoint (`GET /api/models/ollama?endpoint=`, `PUT /api/settings/ollama`) and the voice base URLs share one validator: http(s) only, no credentials, no link-local or cloud-metadata host, including names that resolve to one. Model discovery and voice calls never follow redirects, and voice errors no longer echo the upstream body.
- **MCP credentials are write-only.** `GET /api/mcp-servers` masks `env` and `headers` values and OAuth secrets; saving a config with a still-masked value keeps the stored one. `refresh-tools` no longer logs endpoints or command lines.
- **Tool playground.** `POST /api/tools/invoke` answers 409 for tools the framework gates with `requiresApproval` (`code-execute`, `file-write`, `file-edit`, docker, shell) until the body carries `approved: true`; the Tool Workshop asks first.
- **Private storage.** `.cortex/` is created 0700 and the database (and its `-wal` / `-shm`) 0600.
- **Smaller fixes.** `/ws/ingest` frames over 4 MiB are dropped; the markdown sanitizer no longer allows `class` (only the fence `language-*` marker survives); the browser opener uses an argv spawn, not a shell string.

`ChecklistItemOp` gains two ops: `{ op: "edit", id, title }` replaces an advisory item's title (status kept, not a status mark), and `{ op: "remove", ids }` deletes items. `foldAdvisory` and `inferChecklistProgress` now switch on `op` exhaustively, so a new op can no longer be misread as a status change. Ops naming an unknown or removed id are no-ops; a removed id added again starts as a fresh pending item with no inherited marks. Code that narrows on `change.op` should handle the two new members.

`shell-execute` now allows redirects that contain `&`: `2>&1`, `>&2`, `1>&2`, `&>file`, `&>>file` and `|&`. They were refused as a background operator, which broke commands like `bun test 2>&1 | tail -20`. Background `&` (`sleep 1 &`, `sleep 1 & ls`, `a &b`) is still refused. `|&` starts a new pipeline segment, so the program after it is checked against the allow-list. Redirect targets are now path-checked even when glued to the operator (`>&/etc/x`, `2>/etc/x`). In the read-only git/gh shell, a descriptor dup such as `git diff 2>&1 | head` no longer counts as an output redirect.

`todo` keeps one item in progress at a time. `start` with several targets starts one: the item already in progress, else the first pending one. `start` with no id starts the first open item. A `start` or `done` call that changes nothing now begins with a `No change: …` line that names the next step, for example `No change: item 1 is already in progress — do its work now with a tool, then todo({action:"done", id:1}).`

`todo` has a new `reopen` action that puts a done item back to pending. `undo`, `re-open` and `uncheck` heal to it, and canonical verbs are accepted in any case (`Done`). The `todo` checklist cannot edit, remove or clear items yet. `remove`, `delete`, `edit`, `rename`, `clear`, `reset` and `patch` now return an error that says so. Before, the error suggested the closest valid verb, so `delete` could get `done`.

A run paused at an approval gate or a pending interaction no longer reports itself as failed. It used to publish `AgentCompleted` and `TaskCompleted` with `success: false` and an error such as "A declared deliverable was not produced.", so every bus subscriber recorded a waiting run as failed. A paused run now publishes no terminal event, carries no `error`, and the runtime's deliverable, required-tool and empty-output checks no longer run on it. Read the pause from the result's `status` and `pendingApproval` / `pendingInteraction`. The resumed run publishes its terminal events when it ends.

`timeoutAfter()` now measures the whole run. Before, its clock restarted at every kernel pass, so a run with continuation passes (`withMinIterations`, verification retry, plan-execute steps) could run past its timeout. Once it had fired, it also fired on the first turn of every later run on the same agent. Each run now gets its own clock, started at the run's first kernel pass.

`watchdog()` now starts its no-progress clock when a kernel pass starts. Before, the clock ran from when the agent was built or from the previous run's last turn. A run started after an idle gap longer than `noProgressFor` was aborted on its first turn.

Every strategy switch is now on the result, and a failed verification retry reports one status.

- **`metadata.strategySwitches`.** `AgentResult.metadata` and `StreamCompleted.metadata` now list every mid-run strategy switch, in order, as `{ from, to, iteration? }`. Before, only the last target was kept (as `strategyUsed`), so a UI could not show a run that went `plan-execute-reflect` → `reactive`. `strategyUsed` is unchanged: it is still the strategy that finished the run. The field is absent when the run never switched. The record type is exported as `StrategySwitchRecord` from `@reactive-agents/runtime` and `reactive-agents`.
- **A failed verification retry reports `failed` everywhere.** When `.withVerification()` rejected an answer and the retry then failed, `AgentCompleted.runOutcome` (and `AgentResult.outcome`) said `failed`, but `AgentCompleted.outcome.status` (and the trace's `run-completed.outcome.status`) still said `completed`, from the first pass. Both now say `failed`. `outcome.authority` is `runtime-success-veto:strategy-result-failed`, `kernelAuthority` keeps the kernel's own authority, and `statusReason` still names the first pass's status. A run that succeeds is unchanged.

The A2A client's `auth: { type: "apiKey" }` now sends `Authorization: Bearer <apiKey>`, the only scheme the built-in server accepts (it previously sent `X-API-Key` and got 401). Agent-card discovery (`discoverAgent`, `getAgentCard`) now goes through the SSRF-safe pinned fetch (DNS validated once and pinned, redirects refused) and has a time budget, default 10s, set with `egress: { timeoutMs }`.

Cortex configures and shows the framework's Judgment API, and supports Ollama Cloud.

Judgment: a TypeSafe (Jev) key entry in Settings · Providers (saved encrypted, never echoed, `TYPESAFE_API_KEY` fallback, Test reads the model catalog); a Lab Judgment section (backend, model, timeout, Ollama keep_alive) applied as `.withJudgment()` on runs, chats and saved agents; a Judgments tab and a header badge on the run view. ui-core adds `foldJudgments` and `judgmentBadgeOf`, which fold `JudgmentEvaluated`, `JudgmentFailed` and `JudgmentShadow` into a ledger with low-confidence and uncalibrated flags.

Ollama Cloud: an Ollama API key entry and an Ollama endpoint with a one-click Ollama Cloud preset. The endpoint reaches runs, chat, helper agents, the model list and capability probes; the key is sent only to a non-local host. A 401 reads "Ollama Cloud key missing or invalid" with a link to Settings.

Streamed model calls now set `firstTokenMs` on `LLMRequestCompleted`: the milliseconds from request start to the first streamed output (text, tool call, or thinking). `outputTokensPerSecond(event)` from `@reactive-agents/core` uses it to measure generation speed without queue and prefill time. Non-streamed calls, and streams that emitted no output, leave the field absent.

New `agentConfigToSource(config, options?)` prints the `ReactiveAgents.create()…build()` TypeScript for an `AgentConfig` ("config as code"). Secrets never appear in the output: MCP `env` and `headers` values and `apiKey` / `secret` / `password` strings print as `process.env.X` references. New `agentConfigToBuilderCalls(config)` returns the ordered `{ method, args }` builder calls for a config. `agentConfigToBuilder()` now applies exactly that list, so the printed code and `ReactiveAgents.fromConfig()` build the same agent.

An aborted `runStream()` now publishes one `ExecutionCancelled` bus event with the run's `taskId`. Aborting through the signal, `handle.terminate()`, or by breaking out of the stream before the run ended used to publish no terminal event, so subscribers (dashboards, trace bridges) saw the run as live forever. A run that already ended (completed, failed or paused) publishes no extra event.

Cortex chat shows a live card for the running reasoning strategy (tree of thought as a real tree with pruned and selected nodes, reflexion rounds with critique verdicts, code action with code, output and verification, plan strategies as phase rows), and the "Thinking" status line names the current phase. Reasoning now leads each turn as a collapsible "Thinking" pill that streams live and collapses when done, and a leaked `thought` preface no longer opens the answer. Code Action with an approval gate is refused up front with a plain message and one-click ways out, instead of failing mid-run. ui-core adds `strategy-phases` (phase table, fold, tree helpers), `strategy-conflict`, and `splitReasoning`; the transcript gains a `thinking` segment.

**Breaking (types):** `LLMRequestCompleted.estimatedCost` is now optional (absent = price unknown). Migration: replace `total += e.estimatedCost` with `addCost(total, e.estimatedCost)` (or `sumCosts`) and show the total as a lower bound when `complete` is `false`.

`LLMRequestCompleted` can now say when a call's cost is unknown. A new optional `priceSource` field (`"provider-reported" | "price-book" | "user" | "unknown"`, exported as the `PriceSource` type) records where the cost came from. **Contract change:** `estimatedCost` is now optional. Absent means the price is unknown, not zero, so readers that sum it must handle `undefined` (and should mark the total as partial) instead of assuming a number. Producers that still always set a number keep compiling.

Core adds `sumCosts(costs)` / `addCost(total, cost)` (with `EMPTY_COST_SUM` and the `CostSum` type): they return `{ usd, complete }`, where `complete: false` means at least one call had an unknown price and `usd` is a lower bound.

Observability readers now treat an unknown price honestly. The metrics collector no longer records an unpriced call as $1 on `llm.cost_usd`; it skips the cost and counts the call on a new `llm.cost_unpriced_calls` counter. Telemetry records carry an optional `costComplete` flag, and the telemetry aggregate reports `partialCostRuns`. The OpenInference tracer (`@reactive-agents/observe`) omits `llm.estimated_cost_usd` when the price is unknown instead of emitting 0, and adds an `llm.price_source` span attribute.

The billed run total now has one home. A new `RunCostFinalized` event (`taskId`, `agentId`, optional `runId`, `totalCostUsd`, `costComplete`) is published exactly once per run, with or without a debrief, after any background debrief LLM call settles; read the run's total from it. `AgentCompleted` gains optional `costComplete` (`false` = some call was unpriced, `totalCostUsd` is a lower bound; absent = complete), and its `totalCostUsd` is documented as the pre-debrief spend. `DebriefPayload.metrics.synthesisTokens` gains optional `costComplete` (`false` = the debrief model is unpriced and `cost` is not its spend).

Under plan posture, a model that already recorded a plan can no longer grow it with rephrased `todo add` rows. An add whose steps restate existing rows (core's near-duplicate rule, or at least 60% of the smaller title's key words already present) is answered with the existing list and one line, "A plan is already recorded (N steps). Edit or remove rows instead of adding rephrased ones, or finish."; genuinely new steps in the same call are still added. Plan-posture `todo` edits are capped at 3 per turn, and each intervention emits a `plan-todo-churn` guard event. A rejected `request_user_input` call now includes a valid `questions` example.

Lab · Channels tab now has the same side gutter as the other Lab tabs, scrolls, and uses wide screens (test panel beside channels and routes from 1280px).

Billing and quota failures now classify as their own fatal `quota` error class. Anthropic "Your credit balance is too low" (a 400), Gemini "Your prepayment credits are depleted" (a 402), OpenAI `insufficient_quota` (a 429) and OpenAI billing hard limits previously read as `invalid_param`, `unknown` or a non-retryable `rate_limit`. `recoveryFor("quota")` is `fatal`. A new exported guard, `isLLMErrorClass(s)`, narrows a string read off an error value to the closed `LLMErrorClass` set.

Calibration probes (probe version 3) can now tell models apart. Steering asks which channel wins when the system prompt and the user message conflict. Before, it returned "hybrid" whether every channel passed or none did. System-prompt attention scores every turn of a 10-turn conversation, so "moderate" can occur. The tool-result size probe sums two records among distractors on a ladder up to 8000 chars. Before, it stopped at 2000.

A tool call that omits a required parameter now gets an error that names the parameter and shows a valid example call, for example `Missing required parameter "command". Valid call: shell-execute({"command":"git log --oneline -5"})`. The `shell-execute` definition carries a typed `commandPolicy` (`allowedCommands`, `notEnabledCommands`, `sandbox`, `workingDirectory`) derived from its real allowlist, and the new `shellCommandAvailability()` and `isCommandOnPath()` report which allowed commands exist on PATH (cached, no process spawn), so a planner does not need a step like `gh --version`.

A plan-posture run can now ask the user questions and, opt-in, run bounded read-only recon. When user interaction is wired (`metaTools.userInteraction`), plan posture offers `request_user_input` with one guidance line on when to ask (only when the answer changes the plan; batch the questions; never ask what recon or the conversation can answer). A run without interaction never sees the tool. With `harness: { planRecon: true }` (or `RA_PLAN_RECON=1`, default off) plan posture also lets the model call tools whose kernel `ToolSchema.effect` is `"read"`; `"write"`, `"unknown"` and absent effects never run in plan. Recon is bounded by a harness budget (6 calls per run, 2 per tool); a call over budget is blocked and recorded. Each successful recon result is recorded as a `plan-finding` ledger fact `{id, tool, summary}` (summary clipped to 200 characters). When recon is spent, or on the last iteration, only `todo` and `final-answer` stay offered and a guidance line asks for the plan reply. Recon rounds are refunded against `maxIterations` by the same bounded mechanism as todo-only rounds. The plan catalog line marks recon-eligible tools `(read; ...)`. An execute run given `rails.planFindings` renders them once as `Findings from planning: ...`. Default behavior with the flag off is unchanged.

An honest decline no longer ends as a failure. When a guard (for example the dispatcher early-stop) stops a run whose required tool errored on every call, and the model's latest text says it cannot answer because the input is missing (and carries no figure of its own), the run now ends `abstained` with the model's text as its output. Before, it ended `failure` with "stopped before the model wrote a final answer" even though the model had written the true answer. A tool that has not failed, or a partial answer, keeps the existing outcome.

`.withModel(modelId, params)` is now a typed overload: `.withModel("gemma4:e4b", { numCtx: 8000 })` is the same as `.withModel({ model: "gemma4:e4b", numCtx: 8000 })` and applies `numCtx`, `temperature`, `maxTokens` and `thinking`. Before, the second argument matched no overload and was silently dropped, so Ollama loaded the model at its default context window.

`.withModel()` now throws `ModelOptionError` (exported) instead of dropping a setting: for a `params` value that is not an object, a key that is not a `ModelParams` field (for example `num_ctx`, or `provider`, which belongs in `.withProvider()`), a second argument after the object form, or a first argument that is neither a string nor an object. TypeScript callers already got compile errors for these; plain-JS callers now get the error at the call.

The run view has a **Safety** tab: every time a guardrail, the verifier or result check, a budget, the context window, calibration or the reactive controller stepped in, in plain words, each linked to its loop. When anything fired, the run header shows the count and each affected loop row in the trace carries a badge. ui-core adds `safetyEntriesOf` / `safetySummaryOf` (the lane, for any builder's own UI) and `foldRunStrategy` / `runStrategyOfEvents`: one rule for a run's strategy (resolved config, then the kernel loop, then step events), now used by both the run view and the stored run row, so they no longer disagree. A run that ends with `AgentAborted` (for example an output guardrail block) now settles as failed, or stopped after a user stop, instead of reading Running forever.

A model that prints its reasoning into the visible reply (a bare `thought` marker followed by "The user wants...", "I'll...", "Let me...") no longer shows that reasoning as the answer. `splitReasoning` now moves the leading reasoning block to the Thinking pill even when no reasoning channel reported it, ending the block at the first blank line or the first markdown structure (heading, list, table, fence), and while the turn streams the unfinished block stays in the pill. A first line that does not read as reasoning, or an answer that merely starts with the word "thought", is left untouched. Reloaded turns replay the pill from the stored text, and Copy, Read aloud, voice replies and "copy conversation" use the answer only.

An honest decline is no longer blocked by heuristic-basis outstanding items (for example "the last text was narration around a tool call") when the required tool never succeeded and the model's own decline text follows the evidence; declared and evidence items still block. The `exit_gate` event now carries a `declineCheck` field (missing tools, the text the check judged, the clause that rejected it) so one traced run explains a handoff.

Provider failures caused by malformed model output now fail with a new tagged error, `LLMMalformedOutputError` (`errorClass: "malformed_output"`, `retryable: true`). They used to read as a `network` fault on `LLMRateLimitError`, or as a permanent `LLMError`. This covers Ollama's tool-call parser ("XML syntax error on line 1: unexpected EOF", "error parsing tool call") and Groq's "Tool call validation failed" / `tool_use_failed`. The provider retry schedule resamples them, on a stream only before the first emitted event. `LLMErrors` now includes `LLMMalformedOutputError`: an exhaustive `switch` on `_tag` needs a new case.

The provider retry schedule now keys on an error's `retryable` flag (exported as `isRetryableLLMError`) instead of on its tag. Two visible changes follow. A 429 for an exhausted quota (`insufficient_quota`) is no longer retried. A provider timeout reported only in the error message ("Request timed out.") is now retried.

"Request too large ... tokens per minute (TPM/ITPM/OTPM)" is now its own class, `token_rate_exceeded`. A hard 413 body limit stays `request_too_large`, and "Rate limit reached ... Used N" stays `rate_limit`. Input-side TPM/ITPM still maps to `LLMContextOverflowError`, now with `tokenCount` = Requested and `maxTokens` = Limit. Output-side OTPM maps to `LLMError`, because a smaller prompt does not fix it (lower `max_tokens`). A 429 "Request too large" on a per-minute budget is no longer retried, since the request alone exceeds the budget.

New export: `recoveryFor(errorClass, retryable?)` returns `"resample" | "shrink" | "backoff" | "fatal"` (type `LLMRecovery`).

`.withHarness({ wrapUpReserve: true })` is now a typed, serializable harness key (default off; config beats `RA_WRAPUP_RESERVE`) and is recorded in the run-started mechanism record.

Plan posture is now a pure reasoning mode: the run offers no tools at all (every call, `todo` and exit tools included, is blocked and recorded), the model may think and reason freely, and the run completes when it replies with its plan. The single guidance line now says plan mode, no tools, give the plan, the user switches to execute mode to carry it out. The `posture-applied` trace signal no longer carries `planRecorded`. Execute and absent posture are unchanged.

`PlanStep` gains optional `dependsOn` (ids of prerequisite steps) and `args` (tool arguments). Both survive the Markdown, JSON and HTML plan formats and `planFromChecklist` (via `meta.dependsOn` / `meta.args`). Importing a plan with an unknown step id, a self reference or a cycle in `dependsOn` fails with a `PlanParseError` (`invalid-shape`). New helper `findPlanDependencyProblem(plan)` runs the same check.

Structured `request_user_input` questions now reach the live HumanGate, the `InteractionRequested` stream event and `listPendingInteractions()` (live and durable) as an optional `questions` field; a legacy `kind` + `schema` request is unchanged. A HumanGate timeout now reports `timedOut: true` to the kernel so the model receives the structured timeout answer.

`rax` now runs on Node.js 22.5+ without Bun installed: the binary's shebang is `#!/usr/bin/env node`, so `npx @reactive-agents/cli demo` works on a Node-only machine. `rax --help`, `demo`, `init` (every template), `run`, `playground` and `cortex --help` run on Node, and Node's "SQLite is an experimental feature" notice no longer prints on every command. On Node, `rax init` and `rax demo` print commands for the package manager that launched `rax` (npm by default). `rax dev` runs your entry with Bun when installed and otherwise with the project's `tsx`. `rax cortex` and `rax examples suite|demo` still need Bun. On Node they re-run under Bun when `bun` is on `PATH`, and otherwise print one "needs Bun" line instead of a stack trace. Bun users can force the Bun runtime with `bunx --bun rax` or `bun run --bun rax`.

Cortex voice mode: the bar has a reading-speed stepper (0.75x to 2x, the saved Settings reading speed, applied from the next sentence and kept), and a question the agent asks while voice mode waits is read aloud and can be answered by voice. Spoken answers are matched deterministically (option names, "the second one", "option B", yes/no, numbers, free text), read back, and sent only after "send it" or a button; approvals are never answered by voice.

Cortex Lab Channels: the route editor edits the turn limit (`turnTimeoutMs`, shown in seconds) and the failure notice (`failureNotice`, on by default). A failed turn in the activity feed and the test panel now says why in words, for example `turn timed out after 120s (the route's turn limit)`, instead of the bare `turn_timeout`. The docs page now states the real model-ack wait bounds (1 to 30000 ms, default 12000).

An action-required task ("send an email ...") can no longer end `success` on meta-tool calls alone. The run contract's `action-required` requirement is checker-tier, so with no domain tool on the surface the exit gate saw nothing outstanding and a successful `recall` save let a fabricated "email sent" ship. The gate now lists a declared action requirement as outstanding until a successful substantive (non-meta, non-retrieval) tool result lands, the same rule `SideEffectLanded` uses.

A recoverable provider failure on a think turn no longer ends the run. When the stream fails, at start or mid-stream, the kernel retries the turn and picks the recovery from the provider's error class (`recoveryFor`):

- Malformed model output, such as Ollama's "XML syntax error on line 1: unexpected EOF", is resampled.
- An oversized request (context overflow, request too large, or an input tokens-per-minute budget) is compacted once per run and re-sent, sized to fit the budget.
- An output tokens-per-minute budget halves the turn's `max_tokens`.
- A rate limit, timeout, network fault or 5xx waits (the provider's retry-after, else 1s doubling, at most 10s) and re-sends.

The budget is 2 recoveries per run, and the same class is never retried three times in a row. Set it with `.withHarness({ llmRecoveryBudget })`, where `0` turns recovery off. Fatal classes (auth, exhausted quota, invalid request, ...) and a spent budget still end the run with `llm_error`. Each retry emits an `llm-recovery` harness signal with the iteration, error class, recovery and attempt. A failed attempt's partial output is discarded. When it had already streamed text, the signal sets `streamedTextVoid: true` so consumers can drop that text.

The lift gate now rejects a candidate whose runs end non-success (`run-completed.status`) at least 25pp and 2 runs more often than baseline, even when accuracy is flat, and also when a single task flips from near 0 to all-or-nearly-all runs non-success (per task, k>=3, vs that task's own baseline; the receipt names the tasks); `runSession` records `RunScore.endStatus` from the trace and the receipt prints the status read and the billed-token ratio per run. The H3 runner labels run causes in process with `analyzeCause` instead of spawning the CLI, so a healthy trace no longer prints `cause=parse-failed`.

A blocked answer is never published. With `.withGuardrails()` or `.withBehavioralContracts()`, the reasoning kernel's `FinalAnswerProduced` event is now held until the final-output screen passes. Before, the event went out before the screen ran, so any event consumer (a UI, telemetry, `agent.subscribe`) received an answer the output guardrail then blocked, PII included. A blocked run fails with `GuardrailViolationError` as before and its held answer is dropped. On `runStream()` the `TextDelta` tokens are held the same way: they arrive just before `StreamCompleted` when the run succeeds and are never delivered when it is blocked. Runs without an output screen are unchanged.

Asking the user no longer needs durable runs. `.withUserInteraction()` builds without `.withDurableRuns()`: a `request_user_input` question then waits live in process. The stream shows `InteractionRequested`, `listPendingInteractions()` lists the question, and `respondToInteraction(runId, interactionId, value)` answers it; the same run continues with the answer. With `.withDurableRuns()` the run pauses durably as before.

Also in this release:

- `.withUserInteraction({ timeoutMs })` bounds a live question. With no answer in time the model reads `The user did not answer: no answer within <ms>ms` and the run continues. Round-trips through `toConfig()` as `userInteraction: { timeoutMs }`.
- `.withApprovalPolicy({ timeoutMs })` is enforced. A live `detach` wait or a `mode: "block"` `onApprove` callback that does not decide in time denies the call. `approvalPolicy.timeoutMs` is part of `AgentConfig`.
- `.withName()` now labels the run: `AgentStarted.agentDisplayName` is the builder name instead of the generated `<name>-<epoch>` id. Without a name the id is shown, as before.

The chat plan card can run an edited plan in a strategy. An **Execute strategy** picker (Auto, Blueprint, Plan-execute-reflect) next to Execute runs the plan through the framework's `agent.execute(plan, { strategy })`; the reply lands in the thread and the card shows each step's final status. Each step has a folded **Dependencies and args** editor (the steps it waits for, and a JSON object of tool arguments) that is checked with the framework's dependency rules and saved with the plan, so Export and Import carry them. When the framework refuses a plan, its reason shows under the card. New route `POST /api/chat/sessions/:id/plan/execute`; `PUT .../plan` steps accept `dependsOn` and `args`.

Run view: a **Why it ended** card diagnoses every finished run with the framework's own trace diagnosis (`analyzeCause` + `attributeFailure` from `@reactive-agents/trace`, the engine behind `rax-diagnose cause`). It shows the cause in plain words, harness vs model vs environment attribution, and the decisive steps, each linked to its trace row; it opens by itself for failed, abstained, partial and stopped runs. New route `GET /api/runs/:runId/cause` (cached per run until the trace file changes).

Gateway schedules are now durable and manageable. A new `ScheduleRegistry` gives every cron entry a stable id (config crons get an id derived from their definition), `enabled`, `nextFireAt`, `lastRun` and `runCount`, with `list`, `get`, `create`, `update`, `pause`, `resume`, `remove`, `runNow` and `lastResult`. Pass a SQLite `path` and schedules, last results and the last-evaluated time survive a restart. After downtime, missed fires follow a per-schedule catch-up policy (`skip`, `fire-once` (default) or `fire-all`, bounded). `SchedulerService` now fires through the registry and gains `runNow`; `checkCrons` can fail with `ScheduleStoreError`.

The gateway can now serve webhooks. `startIngress` and `startGatewayIngress` mount the WebhookService routes (GitHub, generic) and channel webhooks on one HTTP server bound to 127.0.0.1 by default, with POST-only, a body size cap (default 1 MiB), and per-route secret verification that fails closed. `GatewayConfig.port` and `GatewayConfig.webhooks` are now consumed. `@reactive-agents/channels` adds `channelWebhookRoute` (mount `TelegramChannelAdapter.handleWebhook`) and `deliverScheduleResult` (deliver a schedule result through `ChannelService.deliver` and record the receipt). `@reactive-agents/gateway` now depends on `@reactive-agents/runtime-shim`.

New typed `AgentEvent` members `ChannelSendFailed` (outbound send failed for good, no message text) and `ChannelFollowUpScheduled` / `ChannelFollowUpFired` / `ChannelFollowUpCancelled` (follow-up timer lifecycle). Additive; `@reactive-agents/channels` emits them.

Strategy-selection learning now persists. The bandit's arm stats are stored in the calibration DB file (`calibrationDbPath`, table `bandit_arms`), so they survive process restarts whenever calibration does; `":memory:"` keeps both per-process as before. New read API: `BanditStore#listArmStats({ modelId?, taskCategory? })` and `readBanditArmStats(dbPath, filter?)` list arm stats per model and task category with posterior mean reward and last update time.

Three root-cause fixes from the live zoo validation. `leanFinalTurn` now extracts file inputs through dot-directory paths (`.bench-run-*`, `~/.config`) and fails closed when the task names a file it cannot parse, so it no longer ends a run after reading one of two files. An honest decline settles after one failed call for permanent errors (ENOENT, 404, not found), so `actOrAnswer` no longer forces a second read of a missing file. Invented percent benchmarks are now hard fabrication violations; figures present in tool results or the task text stay allowed.

Observation-only judgment asks (completion, grounding-fabrication, task comprehension, strategy selection) now pass `priority: "shadow"`, so the JudgmentService concurrency gate bounds them instead of letting bursts starve real work. No run decision changes.

Cortex shows a multi-part `request_user_input` as a form (pick one, pick many, yes or no, number, text) in the streaming chat turn, a paused chat turn and "Waiting on you", and sends the answers as one id-keyed map. The server checks the map against the asked questions first and returns what to fix instead of failing inside the run. Voice mode answers the required questions one at a time with the usual read-back and confirm, then sends them together. Older single-question asks work as before. ui-core's `PendingInteractionWire` and `InteractionRequested` gain an optional `questions` field (new types `InteractionQuestionWire`, `InteractionQuestionOptionWire`).

Add the `MemoryRecalled` event (items a run recalled, with tier, summary, score and importance) and the `"guardrail"` member of `RunAbortReason` for runs ended by a guardrail or output screen.

Add the `tool` checklist op (`{ op: "tool", id, tool? }`) to set or clear a row's tool hint without removing the row; an explicit tool wins over a hint parsed from the title, and clearing falls back to the text hint.

`request_user_input` now publishes the item schema of `questions` (`id`, `prompt`, `type` required; `options` for choice types), generated from the parser's own schema, and `ToolParameter.items` can carry `properties`/`required`. A call mixing the legacy `prompt`/`kind` form with `questions` is repaired when unambiguous (alias type, string options, missing id, top-level prompt) instead of rejected; other malformed calls are rejected with a valid example. `todo` `edit` accepts `items: [{id, text}]` as a multi-rename and otherwise names the accepted shapes.

Cortex shows the framework's new plan features. A Plan turn that stops to ask a question keeps its reply box in the thread. The plan card lists recon findings (tool chip and summary) under a collapsed Findings section, and a finding can be removed before you Execute; findings are stored with the plan and ride exports. The Lab builder's Reasoning section gains switches for the harness options Plan recon, Plan budget, Wrap-up reserve and Plan tool catalog, each showing the framework default until flipped.

`selectAdapter` takes an optional 4th argument, the resolved calibration (`"auto"` default, `"skip"`, or a `ModelCalibration`). `"skip"` no longer loads the shipped calibration JSON, and an explicit calibration object wins over it. Adds `describeCapabilityResolution(cap)` and the `CapabilityResolution` type (source, tier, recommendedNumCtx, supportsThinkingMode) for tracing. Additive; callers that pass no 4th argument behave as before.

The chat session builder panel no longer offers a Channels editor it cannot save. Channels and the gateway block run only on a saved Gateway process agent, so the section now says so and points to Lab; a drift test pins that neither the chat nor the run config body stores them.

The routing engine now sets `ackLatencyMs` on `ChannelTurnAcknowledged` when a model-written ack was attempted: the time from the model call's start to its result, or to the timeout bound when it timed out. Narration and canned-only acks omit it.

A failed `agent.run()` (for example a 401 from a bad API key) now rejects with `AgentRunError`, exported from `reactive-agents` and `@reactive-agents/runtime`. Left uncaught at a top-level await, it prints as one line: `AgentRunError: <message>` under Bun (no runtime source excerpt) and `[AgentRunError: <message>]` under Node (no `_RunBoundaryError` internal name). The full error, with its remediation hint and the original tagged error, is still on `err.cause`. `RA_DEBUG_ERRORS=1` still rejects with the full error and stack.

Export `toChannelHandle`, `makeAcknowledge`, `drainWithNarration` and the `ChannelAgentHandle` / `StreamedTurn` types so custom channel resolvers can implement model-written acknowledgements.

Agents gain skill control methods. `agent.rollbackSkill(name)` restores a stored skill's previous version and publishes `SkillRolledBack` with `reason: "manual"`. `agent.setSkillMode(name, mode)` locks (`"locked"`) or unlocks (`"auto"`, `"suggest"`) a skill in place, keeping its version history. `agent.loadSkill(path, { evolutionMode })` sets the mode of a loaded skill (new skills still default to `"locked"`), and reloading a skill the agent already stores now keeps its version history, stats and confidence instead of resetting it to version 1; changed instructions become a new version. `agent.memory().semantic.list()` and `procedural.list()` accept `taskId` / `runId` filters, applied in the store query.

`SkillActivated` gains optional `taskId` (the run the activation belongs to) and `sha256` (hash of the injected SKILL.md body) fields, so observers can tie an activation to a run and a skill version. Existing producers and subscribers compile unchanged.

Unknown Gemini models now resolve to their real limits. A Gemini model id that is not in the static capability table (for example `gemini-4-carbon`) previously fell back to a 2048-token window with thinking off. The build step now asks the Gemini API's `models.get` once per model and process, and uses the reported input limit, output limit and thinking support. Gemma ids still have thinking off. If the request fails or no API key is set, the model keeps the conservative fallback and its one-time warning.

Discovery is a general per-provider hook: `registerCapabilityDiscoverer(provider, discoverer)` installs one, and Ollama's `/api/show` probe now runs through the same hook. Static table rows still win over discovered values. Added static rows for `gemini-4-carbon` and `gemini-4-argon` (1,048,576 input / 32,768 output tokens, thinking on, per `models.get` on 2026-11-19).

Add the `Plan` primitive: `Plan`, `PlanStep`, `PlanSource`, `PlanStepStatus` (Schema plus types), `isPlanEmpty`, and `planFromChecklist` / `planToChecklistSeed` so a plan is the advisory checklist. Add `PlanRecorded` and `PlanStepStatusChanged` AgentEvent members.

A resumed run now honors the raised per-run iteration cap. When a run resumes from a saved kernel state and the runtime's resume cap is higher than the strategy's resolved cap, the loop uses the resume cap, even over an explicit `withMaxIterations` cap. Before, a Continued run kept the old threshold and stopped at the same limit. Runs that are not resumed are unchanged.

Chat context meter now shows a reading for hosted models (OpenAI, Anthropic, Gemini). The framework only reports a context window for Ollama, so those turns showed tokens and cost but "no reading yet". Cortex now derives the reading from each call's reported prompt tokens and the framework capability window, and only when the model has a real capability row (never the conservative fallback).

Reasoning's context-window readers take the agent's declared window per call. `resolveProfileWithWindow(model, provider, { userNumCtx })`, `applyCapabilityMaxTokens(..., userNumCtx)` and `makeObservableLLM({ userNumCtx })` pass it to the capability resolver. So an agent with `.withModel({ numCtx })` on a model id the capability table does not know keeps its profile window and its ContextPressure gauge, and no process-wide capability row is needed. Without the option, behavior is unchanged.

Channel routing, slice one: `createChannelRouter` opens each channel once and routes inbound conversations to any agent by flat `RouteSpec` rules (`match`, `target`, `allow`, `deny`, `owners`, `open`, `session`, turn caps). Access is fail-closed per route (through `createAccessControlPolicy`), a denied sender never reaches the `AgentResolver`, duplicate platform message ids run once, and the resolver builds a distinct agent per `(routeId, role)` so non-owners get a restricted tool surface at construction. A per-credential account lease fails a second owner with `ChannelAlreadyOwned`. `explain()` and `simulate()` answer why a message was or was not routed. `ChannelService` now runs on the same engine as one implicit route; its behavior and API are unchanged. Telegram `409` is now a typed, non-retryable `conflict` error kind (also added to the gateway delivery error vocabulary). Telegram and Signal adapters expose a hashed `accountFingerprint`. Router decisions publish typed events (`ChannelRouteMatched`, `ChannelRouteDenied`, `ChannelUnrouted`, `ChannelTurnStarted`, `ChannelTurnCompleted`, `ChannelTurnDropped`, `ChannelOwnershipChanged`) and a Telegram conflict reaches `ChannelDeliveryFailed` as `kind: "conflict"`.

Ollama Cloud works end to end. The Ollama provider now honours `.withProvider("ollama", { baseUrl, apiKey })` per agent (env `OLLAMA_ENDPOINT`/`OLLAMA_HOST` and `OLLAMA_API_KEY` remain the fallback), and model discovery (`GET /api/tags`) sends the Bearer key like the capability probe and chat calls already did. New exports: `resolveOllamaTarget({ baseUrl, apiKey })` returns the endpoint, key and auth headers for one Ollama call; `checkOllamaConnection` is a pre-flight that returns a typed `OllamaAuthError` (with `status`) on 401/403. `OLLAMA_API_KEY` is sent only to the env-resolved endpoint, never to a different caller-named `baseUrl`.

Checklist rows now take their tool from the step text. An `add` item with no structured `tool` whose title names one (`tool: x`, `(tool: x)`, `tools: a, b`) gets `row.tool` set when the checklist folds, so model todo steps, harness-derived steps and imported plans show their tool. An explicit `tool` still wins and titles are unchanged. New pure helpers `planStepToolHint` and `planStepToolHints` are exported.

Cortex UI foundation for the "Bench" design (steps 1 and 2 of the modernization plan).

- One semantic token layer drives both themes. Light mode no longer depends on a block of `!important` overrides, so panels, inputs and the chat composer read correctly in light mode, and muted text keeps WCAG AA contrast in both themes.
- New Settings · Motion option: follow the system's reduced-motion setting or reduce motion in Cortex regardless.
- Text fonts are bundled (no Google Fonts request for Geist or JetBrains Mono). The wordmark is now "Cortex" in Geist, and the neural mark is one shared component (logo, Beacon empty state and favicon).
- Costs use one format everywhere (`<$0.0001` instead of `$0.0000` for tiny amounts), and Lab "last used" times read like the rest of Cortex ("5 minutes ago").
- The ambient orbs now appear only on Beacon and the empty Runs page.
- A component kit (buttons, chips, badges, status, panels, page header, tabs, form fields, empty states, overlays, meter, entropy line) for the page-by-page restyle that follows.

`agent.resumeRun()` now gives a run that stopped on its iteration cap more iterations, so Continue no longer re-stops at once. A resume of a spent cap (including a cap a plan raised at run start) runs to the restored iteration plus `extraIterations`, default 10, and the raised cap is stamped on the restored state. A run that stopped with iterations left keeps its own cap. The stop record of an iteration-cap stop keeps `kind: "budget"` and now carries the stable `reason: "max_iterations"`, so a UI can word it apart from a token or cost budget.

Breaking for open channels: a gateway with no `accessControl` now denies every inbound channel sender (Telegram, Signal, webhook-channel) instead of letting them drive the agent. The deny reason names the sender (`telegram:123`) and how to allow it, and the gateway logs a warning at start. Migration: set `accessControl.allowedSenders` (entries are `platform:userId`, e.g. `"telegram:123456789"`), or, to keep the old behavior, opt in explicitly with `accessControl: { accessPolicy: "open" }`. An `accessControl` block with no `accessPolicy` still defaults to `allowlist`.

Also: the GitHub webhook adapter rejects a replayed `x-github-delivery` id (bounded per-adapter cache of 1024 ids), and the A2A HTTP server validates `message/send`, `message/stream`, `tasks/get` and `tasks/cancel` params against their schemas, answering malformed params with JSON-RPC `-32602`.

Fix three false strings in `rax` help output. `rax help` now lists the real `rax init` templates, read from the scaffolder (it listed `minimal|standard|full`, and `standard` and `full` were rejected). The `rax run` usage hint now says `rax cortex` instead of the contributor-only `bun cortex`. `rax cortex --help` now says that a non-loopback `--host` requires `CORTEX_TOKEN`, replacing the stale claim that Cortex has no auth.

Plan then execute is now a framework primitive, usable without any UI. `agent.plan(input)` runs the task under plan posture (planning tools only) and returns a typed `Plan` (`{ id, goal, steps, createdAt, source }`) that always has steps: the model's `todo` list, else steps the harness derives from the reply, else a typed `PlanNoStepsError` rejection. `agent.execute(plan)` and `agent.run(input, { plan })` run seeded from the plan's checklist (the follow-the-list guidance rides that seed) and add `result.plan` with each step's final status; an empty or absent plan runs exactly as before. `PlanRecorded` and `PlanStepStatusChanged` are published on the EventBus. Chat sessions gain `session.plan` (the conversation's to-do list as a `Plan`) and `session.setPlan(planOrSteps)` (edit before switching to execute). `planToolCatalog` is a typed `.withHarness({ planToolCatalog: true })` flag (default off), recorded in the run's mechanisms.

New harness switch `leanThinking` (default off; `RA_LEAN_THINKING=1` or `harness: { leanThinking: true }`). On a thinking-capable Ollama model, a tool-selection turn (native function calling, a domain tool on the wire, tool work outstanding, the last tool result not a failure) is requested with `thinking: false`, so qwen3-family and deepseek-r1 runs stop spending the turn's wall clock on a reasoning chain before a tool call. Other turns think as before, and the thinking-runaway recovery is unchanged. Each decision emits one `guard-fired` event (`guard: "lean-thinking"`). Boolean only: llm-provider has no per-turn thinking-token budget.

A model that only narrates a required tool call in prose is answered by the existing `actOrAnswer` forced retry; an end-to-end pin now covers that shape (forced call runs and the run succeeds on the tool receipt; a model that never complies ends the same honest required-tool outcome as before, with no new exit).

Cortex chat gets a persistent Plan | Execute mode toggle in the composer. The mode is stored with the chat session (`PUT /api/chat/sessions/:id/mode`) and passed to the framework session mode, so Plan is reasoning only with no tools until you Execute. A Plan reply renders as a plan card whose Execute button switches mode and sends the follow-up in one step; `/plan` and `/execute` (`/go`) flip the same session mode and Shift+Tab toggles it. Provider and model now share one quick-bar chip whose two parts open `/provider` and `/model`.

The Lab builder's **Plan budget** switch now shows off by default, matching the framework, where `planBudget` is opt-in. Cortex writes the `planBudget` key into the harness config only when you flip the switch; an untouched config sends nothing.

A loop-guard stop now rides `metadata.extensions.loopStop` on every kernel-backed strategy result, so non-durable and streamed runs can surface the stop summary. `appendGuidanceText` and `contributeGuidance` are exported. `ReasoningService.execute` and the strategy registry take an optional `plan` (core or strategy shape) that `blueprint` and `plan-execute-reflect` adopt; `adaptive` forwards it and runs `plan-execute-reflect` when its pick would not adopt a plan. The final plan returns in `metadata.extensions.plan` in core shape with each step's final status. The wrap-up reserve publishes its own `wrap_up_reserve` guard event. New kill switches for seeded-plan runs, both default on: `autoTick` (`RA_AUTO_TICK=0`) and `bookkeepingRefund` (`RA_BOOKKEEPING_REFUND=0`).

`ReasoningStepCompleted` gains an optional `structured` field (`ReasoningStepData`, discriminated on `kind`: `tot-node`, `tot-path`, `code-action`, `reflexion`, `strategy-choice`, `plan-step`) so UIs can render per-strategy visuals without parsing text. Additive: existing events and recorded traces are unchanged. Schemas are exported as `ReasoningStepDataSchema` and per-variant schemas.

Tree-of-thought, code-action and reflexion now fill it: ToT publishes a `tot-node` per explored node (score, `pruned`), re-emits the chosen nodes (and the root) with `selected: true`, then one `tot-path`; code-action carries the generated code, the sandbox result (`stdout` is the observation text, `stderr` the sandbox failure) and the verify verdict; reflexion carries the full critique and whether it accepted the attempt. Text fields are unchanged.

Adaptive publishes a `strategy-choice` payload (`selected`, `reason`: `heuristic | classifier | classifier-skip | cost-downgrade | fallback`, optional `note`) at each decision point. Plan-execute and blueprint publish `plan-step` payloads (`stepIndex`, `status`: `started | done | failed | retry | patched`, `attempt` on retry, optional `note`) on their step lifecycle events. Labels and text are unchanged. `rewoo` stays an alias of blueprint, so its events carry the `blueprint` strategy name and `blueprint:*` labels.

Loop detection now measures state change, not call classification, and answers a detection with graduated guidance before it can stop a run. A state-mutating meta tool (`todo`, `checkpoint`) whose result differs from its previous result counts as progress, so a run that calls `todo` many times with different arguments while the list moves is no longer terminated as a loop (Cortex run `01M78GC3H6JW5RWNRS7FCSC7X3` ended `loop-after-work` that way). An identical call whose results keep changing (polling) is no longer a repeated-tool-call loop. The first detections get a model-visible loop warning (budget `2 + floor(maxIterations/20)`, max 6; +2 for long-horizon runs, max 8; override with `loopDetection.guidanceCycles`, `0` = stop on first detection); only sustained zero progress reaches the strategy switch or stop path, and any progress action resets the count.

`AgentConfig` now carries the data-like builder options that `toConfig()`, `agentConfigToBuilder()` and `agentConfigToSource()` used to drop:

- `thinking` accepts `{ enabled, effort, budgetTokens }` (`.withThinking()`). Fixes `.withThinking({ effort })` losing its effort through `toConfig()`. A plain on/off still serializes as a boolean.
- `skills` (`.withSkills()`), `metaTools` (`.withMetaTools()`, `false` turns them off), `agentTools` (`.withAgentTool()` and `.withRemoteAgent()`), `dynamicSubAgents`, `verificationStep`, `documents` (`.withDocuments()`), `modelRouting` and `execution.llmTimeoutMs` (`.withLlmTimeout()`).
- `reasoning.synthesis`, `synthesisModel`, `synthesisProvider`, `synthesisTemperature`.
- `tools.terminal` accepts the shell's data options (`cwd`, `allowUnsafeCwd`, `timeoutMs`, `maxOutputChars`, `allowedCommands`, `additionalCommands`, `commandAccess`, `sandbox`). Before, an object `terminal` serialized as `true`.

Code-only parts stay code-only: a sub-agent's `parameters`, a shared document `store`, and the shell's `blockedPatterns`, `onAudit` and `dockerEscalation`.

`JudgmentService.ask` accepts `priority: "shadow"` for observation-only calls. Shadow asks run through a per-service gate (default 1 in flight, 8 queued, 5 s budget, no retry); excess asks fail fast with the new `JudgmentShadowDropped` error and are counted, readable via `shadowStats()`. Explicit asks (the default) are never gated or dropped. Callers that fire shadow judgments must pass `priority: "shadow"` to get the cap.

Declared deliverables are derived only from the user's instruction. Host-attached context wrapped in `--- Attached file: <label> ---` ... `--- End attached file ---` is ignored when deriving "produce the file X" goals, and a task naming more than 8 file paths declares none instead of dozens of junk goals.

Failed runs now report what went wrong, and chat no longer records them as answers.

- **`error` is the real cause.** Before, a failed run whose model had written any text used that text as `AgentResult.error` and `AgentCompleted.error`. A provider failure (for example `ollama call failed … unexpected EOF`) then showed as the model's last sentence. The error is now the cause, in this order: the verifier block, the kernel or provider failure, the runtime veto with what it found (unmet requirements, refused answer, abstention reason), or the termination reason. It is never the output text. A partial run (model draft plus an `Unfinished:` list) keeps the draft as `output` and names the outstanding items in `error`.
- **A failed run's `output` is empty.** The harness no longer writes an answer for a failed run. Before, a run that ran out of budget or had its final answer rejected shipped `Could not complete the task…` as `output` with `metadata.harnessAuthoredOutput: true`. Now `output` is `""`, `harnessAuthoredOutput` is absent, and the cause rides `error`, followed by `What was attempted: N tool call(s) attempted (…), M succeeded.` when the kernel recorded it. A partial run still ships the model's draft. Code that showed `output` for failed runs should show `error`.
- **Failed runs keep their runtime verdict.** The result-boundary verifier used to skip any empty output. It now judges a failed empty-output run: `receipt.verifierVerdict` is `reject` and the runtime `VerifierVerdictEmitted` event is still published. A successful run with empty output is still skipped.
- **`StreamCompleted.error`.** A failed stream completion now carries the same cause. `AgentStream.collect()` copies it to `AgentResult.error`.
- **`ThoughtEmitted.iteration` is the kernel iteration.** It held the step index before (a 3-turn run streamed thoughts at 1, 4, 7 while other events said 0, 1, 2), so UIs that group by iteration split one turn into several. It now matches `TokenUsage`, `ToolCallStarted` and `ExitGateDecision`.
- **Chat records a failed run as a failed turn.** `ChatEngine.streamTurn()` and `turn()` (so `agent.session()`, `agent.chat()` on the tool path, and the gateway) used to record a failed run's output as the assistant reply. The next turn's history then told the model it had answered, and it repeated the same steps. Now the user turn is kept, and the assistant row is `[previous run failed: <cause>; no answer was given]` with `failed: true` and `error: <cause>` on the `ChatMessage`. The published assistant `ChatTurn` event carries the same note plus `failed: true` and `error`, so apps can show a failed turn without parsing the note text. Paused runs (awaiting approval or interaction) are recorded as before.
  - Builders: render rows with `failed: true` as a failed turn, not as an agent reply. `ChatReply` (tool path) also has `failed` and `error`; `message` is still the failed run's output.
- **`AgentResult.outcome`: one field for how a run ended.** Every finished run carries `outcome: "success" | "partial" | "failed" | "abstained"`, on `run()` and on `StreamCompleted` (so `AgentStream.collect()` too). You no longer combine `success`, `terminatedBy` and `abstention` yourself. `success` is `true` exactly when `outcome` is `"success"`. `partial` means the model wrote an answer but the run fell short (iteration cap, guard stop, outstanding requirement, missing deliverable). `failed` means nothing usable was delivered. `abstained` means the agent honestly declined. A paused durable run has no `outcome`; `status` says why. `parallel()` derives one for the combined result. The type is exported as `AgentOutcome` from `@reactive-agents/runtime` and from `reactive-agents`.
- **`AgentCompleted` carries the outcome and the deliverables.** The event now has `runOutcome` (the same value as `AgentResult.outcome`) and `deliverables` (the verified `{ spec, produced }` list, the same as `receipt.deliverables`). Read `deliverables` when `output` is `""` because the run wrote files. A paused run carries neither. A sub-agent's completion inside a stream (`SubAgentActivity` wrapping `StreamCompleted`) now has `outcome`, and `error` when it failed.
- **Learning, telemetry and debrief record abstentions apart from failures.** A run the kernel ended failed (a guard stop before the model answered) is classified `failure`. An abstention is now its own `abstained` label, not `failure`: `AgentDebrief.outcome` can be `"abstained"`, and an abstention has no telemetry failure pattern. An abstention neither credits nor penalizes the procedural skill that was applied. The `DebriefCompleted` event says `"abstained"` too. One wire type does not have the label yet: the telemetry `RunReport.outcome` / learning `RunCompletedData.outcome`. There an abstention still reads `failure`; the telemetry record's `terminatedBy: "abstained"` tells it apart.
- **`output` is only the model's answer.** When the model wrote nothing, the runtime used to fill `output` with the last tool result (for example `✓ Written to ./x.txt`), and the kernel's deliverable terminal shipped that text with `metadata.harnessAuthoredOutput: true`. Neither ships now: `output` is `""`. If every declared deliverable landed, the run succeeds and `receipt.deliverables` lists the files. Otherwise the run fails with its cause on `error`.
- **An abstention is its own outcome.** When the agent declines (no grounded answer, a required tool missing), `output` is `""`. Before, the runtime could fill that empty output with the last tool result, and the error read `The run did not complete successfully`. Now nothing fills it, and `error` is the kernel's cause or `The agent abstained: <reason>.` The run never reports success.
- **No harness text in `output`, anywhere.** Four more runtime paths wrote their own text into `output`:
  - A failed stream wrote `Strategy execution failed (…)`.
  - A verifier block (`onReject: "block"`) wrote `[verification blocked] …`.
  - A strategy crash wrote `Strategy execution failed (…)`.
  - A failed verification retry (`.withVerification()` re-running the answer turn after a rejection) wrote `Verification retry failed: …`. The run now fails with that cause on `error`.

  All four now leave `output` empty and put the message on `error` and `StreamCompleted.error`. The streamed strategy name is still on `metadata.strategyUsed`. When the model's last turn is empty and every declared deliverable landed, the run still succeeds. It no longer ships a `Completed: <deliverables>.` note with `harnessAuthoredOutput: true`. `output` stays `""`, and `receipt.deliverables` lists what landed (`{ spec, produced: true }`). `onReject: "annotate"` no longer puts its warning before the answer either: `output` ships unchanged, and the reason is on the new `metadata.verificationNote` field (on `run()` and `StreamCompleted`). Code that read the warning out of `output` should read `metadata.verificationNote`.
- **Reading a finished run (builders).** Switch on `outcome`:
  - `success: true`: the answer is in `output`. If `output` is `""`, the deliverables are the answer; read `receipt.deliverables`.
  - Partial (the kernel stopped with a model draft): `output` keeps the draft. `error` names what was left unfinished. `success` is `true` only on the tolerance path (draft, nothing outstanding), and there `outcome` is `"success"` and `metadata.outstandingCriteria` is absent.
  - Failed: `success: false` and `output: ""`, or the model's own last text when the kernel kept it. `error` is the cause: verifier block, provider or kernel failure, runtime veto, or termination reason. The kernel's `What was attempted: …` line follows when it was recorded. `terminatedBy` says how the loop ended.
  - Abstained: `success: false`, `output: ""` and `terminatedBy: "abstained"`. `abstention` is `{ reason, missing }`, and `error` is the cause. On the trace, `run-completed.outcome.status` is `"abstained"` and `authority` is the kernel's. Show `error` (and `abstention.missing`) to the user, not `output`.

The live status line no longer floods terminals that are too small for it. A terminal that reports a size of 0 columns or 0 rows (0x0 ptys in CI runners, web terminals before layout, some IDE panes) now gets plain permanent lines only, with no live redraws or cursor movement. In narrow terminals the status line is clipped to one row (ending in `…`) and the thinking panel wraps to the terminal width, so redraws stop scrolling a new line on every spinner tick. Terminals that report no size keep the 80-column fallback.

Security: recorded traces now redact more secrets and are owner-only on disk. The trace recorder additionally redacts `sk-proj-` keys containing `-`/`_`, `github_pat_`, `gho_`/`ghu_`/`ghr_` tokens, Slack `xox*`, Stripe `sk_`/`rk_` live/test keys, OpenRouter `sk-or-`, Groq `gsk_`, xAI `xai-`, PEM private key blocks, `Basic` auth headers and `password=` / `secret=` / `token=` assignments. New trace directories are created `0700` and trace files `0600` (existing directories and files keep their current permissions).

Beacon Field: dragging a node works any number of times (a second drag of the same node used to snap back), a filter bar (status chips, search, "12 of 48") narrows it with the same rules as the Board, nodes show model, run time, tokens and cost, a parent can fold its sub-agents (finished trees fold on their own past 12 nodes), arrow keys nudge a focused node, and a legend counts agents by status.

Cortex Settings has a Web search section: add, test and remove an API key for each keyed web-search provider (Tavily, Brave, Serper, Keenable), stored encrypted like the LLM provider keys. The framework's `web-search` tool reads these keys from the process environment only, so a saved key is not yet passed to agents; the row says so. The provider docs and `.env.example` now list Keenable.

Read-aloud no longer toasts "Could not reach Cortex for speech: The play() request was interrupted" when playback is interrupted (pause, element removed, next utterance). An interrupted `play()` is a normal stop; a user pause stays paused, other interruptions end the utterance. Other playback failures now say "The audio could not be played." instead of blaming the server connection.

The run view's **Why it ended** card now uses the framework's own cause descriptions and adds **What to try**: the next steps `causeNextActions` gives for the cause (the same lines `rax-diagnose cause` prints). `GET /api/runs/:runId/cause` returns them as `nextActions`.

Chat provider picker: providers with no API key, or an unreachable Ollama, show greyed out with the reason and cannot be picked. Switching provider keeps the current model when the new provider lists it, otherwise uses that provider's default.

Audio and file parts in user and assistant turns now reach the provider as content blocks instead of kernel text stubs, so the provider wires them, uses the transcript, or records its own degrade. Tool-result audio and file parts are still stubbed by the kernel (the tool message block has no audio or file shape).

Channel hub route editor gains a batch window (`batchWindowMs`, 0 to 30 000 ms) and a "while a turn is running" choice (`midRun`: queue, fold, interrupt), both hidden on webhook routes and validated before save. The hub header shows router inbox counts (received, running, done, failed, dropped) when the router reports a durable inbox, else an in-memory note. Chat sessions rebuilt from storage seed the plan's recon findings through `session({ initialPlanFindings })`, replacing the read-time stand-in.

Plan posture now names the tools the execute phase will have, by default. The plan turn's guidance gains one capped line listing the agent's own tools and its MCP tools (grouped by server, full `server/name` names, up to 40, one-line descriptions), so plan steps can reference real tools as `tool: name` instead of generic ones. The list comes from the full tool catalog, not the relevance-pruned set. Turn it off with `.withHarness({ planToolCatalog: false })` or `RA_PLAN_TOOL_CATALOG=0`. Execute posture is unchanged.

Plan steps derived from a prose reply (when the model recorded no `todo` list) now skip first-person narrative ("I need to…", "To understand X, I'll…") and drop near-duplicate restatements.

Chat: name a skill anywhere in a message (`summarize this repo /codebase-health-sweep`). A recognized skill token is highlighted as you type, used for that message on send, and left out of the prompt; `/skills <name>` mid-message pins it for the chat. Typing `/` after a space opens the skill list at the cursor. Paths, links, unknown `/words` and code spans stay as typed, and `\/name` sends a skill name literally. Picking a skill from the menu or the skills chip now inserts it at the cursor instead of clearing the draft, and prompt-library picks go in at the cursor too.

Cortex builds chats, desk runs and gateway agents with Durable runs on unless you turn them off, so a Stop, a Pause or a crash leaves a run you can Continue instead of losing progress. An explicit off (the Builder's Execution switch, or `/durable` in a chat) is saved and kept; chats and saved agents from before the default have no setting and now read as on; a chat with tools off builds none. With it on, approvals and questions pause the run durably ("paused until you decide") instead of waiting live. Continue now streams: the reply fills in and tool calls appear as the resumed run works, with Pause and Stop working, instead of nothing until a reload (`POST /api/chat/sessions/:id/resume/:runId/start`).

The shared `defaultRedactors` now also redact `sk-proj-` keys containing `-` or `_`, OpenRouter, fine-grained GitHub and `gho_`/`ghu_`/`ghr_` tokens, Slack, Stripe, Groq and xAI keys, PEM private-key blocks, `Basic` auth credentials and `password=` / `secret=` / `token=` assignments, so logger and OTel exporter output no longer leaks them. The file exporter and file logger now create directories with mode 0700 and files with mode 0600.

Only declared requirements and literal anchors checked against a receipt can block a run's success; semantic guesses read from task prose now advise. An action requirement inferred from prose (and the derived `SideEffectLanded` condition) no longer fails a run; the verifier's continuation-intent check and percent-only fabricated-measurement findings warn instead of rejecting (a unit-bearing number that no observation holds still rejects). A completed outward-action claim ("I've sent the email") with no successful non-meta tool call is now unbacked even when the run has no tools. `all_tools_called` counts successful tool results, not attempts, and a guard's synthesized reply is no longer recorded as a successful tool call in the trace or ledger. The exit-gate trace records a `basis` (`declared`, `evidence`, `heuristic`) for each outstanding item and lists advisory items.

**Two harness switches for faster runs: `parallelToolHint` (on by default, calibration-gated) and `leanFinalTurn` (opt-in).**

`parallelToolHint` adds one sentence to the system prompt asking the model to make independent tool calls together in one reply. The kernel already runs every call of a reply before the next turn. It is on by default: the default (`true`) adds it only when the model's calibration rates parallel calls `reliable`. `"always"` adds it for any model. Turn it off with `.withHarness({ parallelToolHint: false })` or `RA_PARALLEL_TOOL_HINT=0`; `RA_PARALLEL_TOOL_HINT=always` forces it. The default mid, large and frontier prompts already end with this sentence, so the switch changes the local tier and custom system prompts. It is never added twice. It is not added with text-parse tool calling, on a turn without tools, under plan posture, or when parallel tool calls are off. Trace: a `harness-signal-injected` event with origin `parallel-tool-hint`. Measured on two local Ollama models (gemma4:e4b, cogito:14b; `wiki/Research/Ablations/2026-11-18-speedups/`): same pass rate, 37% fewer turns, 33% to 39% fewer billed tokens. Ollama generates batched calls one after another, so wall time gains are small. The lift gate scored it opt-in (within noise, no non-inferior-plus-savings path); the default is an owner decision on that efficiency evidence.

`leanFinalTurn` stays opt-in (off by default); its ablation was a reject and it needs rework before any default change. It applies when the run contract declared tool work (a required tool, a file, an action), all of it is done, and only the answer is left. The next model call then ships with no tools and `thinking: false`. Its output budget drops the thinking allowance. If that reply is not the final answer, the next call has its tools again. A second lean turn needs another tool call first. Native function calling only. Env: `RA_LEAN_FINAL_TURN=1`. Trace: a `guard-fired` event with guard `lean_final_turn`.

The unused internal `buildToolElaborationInjection` helper is removed. It had no caller.

**Breaking (types):** ui-core `TokenUsage.costUsd` is now optional (absent = price unknown). Migration: sum with `addCallCost` / `foldRunCost` and show partial totals with `formatCostTotal`.

Cortex shows model prices and never counts an unpriced call as free.

- `GET /api/models/:provider` rows and `GET /api/models/capability` carry `price` (`input`, `output`, `cacheRead`, `tiers` in $/1M, `source`, `asOf`, and `origin` for a `source: "remote"` price) from the framework PriceBook; absent means the price is unknown. Ollama models are `source: "local"`, $0. A remote price list reads "remote price list (origin)".
- Model dropdowns (chat `/model` menu, builder **Model** section) show `$in / $out per 1M`, `free (local)` or `price unknown`. The model page has a **Price** section beside **Spend**, and a provider's model list can be sorted by lowest price.
- Run costs (server `cortex_runs`, Runs list and total, run vitals, trace rows, compare, Beacon nodes) add only priced calls. A call with `priceSource: "unknown"` or no `estimatedCost` marks the total partial, shown as a lower bound (`≥ $0.012`) or `price unknown`. The run's stored total is the framework's `RunCostFinalized` (published once per run after the background debrief call, so the debrief's spend is included) with its `costComplete`; until it arrives the total is the provisional sum of the calls seen so far. `AgentCompleted.totalCostUsd` (pre-debrief) is no longer read; its `costComplete: false` still marks the run partial. Rebuilding a run stored before `RunCostFinalized` keeps the old rule. New column `cortex_runs.cost_complete`; `RunSummary.costComplete` is `false` when partial.
- Desk and gateway runs keep forwarding the agent's events until `result.totalCost()` settles, so `RunCostFinalized` is no longer lost when the debrief outlives `run()`. Lifecycle webhooks can subscribe to `RunCostFinalized`.
- ui-core adds `llmCallCostOf`, `addCallCost`, `foldRunCost`, `finalRunCostOf`, `formatCostTotal`, `partialCostNote`, `EMPTY_COST_TOTAL`, `CostTotal`, and model price helpers `formatModelPrice`, `formatPerMillion`, `priceSourceLabel`, `compareByPrice`, `isLocalPrice`, `ModelPrice`.
- ui-core `TokenUsage.costUsd` is now optional and `TokenUsage.priceSource` is added (mirrors the runtime stream). `summarizeUsage` adds only priced calls (an unknown price used to make the turn's `costUsd` `NaN`), `CallUsage.costUsd` is absent for an unpriced call, and `TurnUsage.costComplete` is `false` when any call had no known price.
- Chat turns store a partial cost as a lower bound when the run reports `costComplete: false` (streamed and non-streamed turns, and `ChatReply.costComplete` on direct replies) or a streamed call had no known price.
- ui-core `ModelPriceSource` adds `"remote"` and `ModelPrice.origin`.
- A hosted model billed $0 for input and output (e.g. Gemma 4 on Gemini, free tier with no paid price) reads `free` instead of `$0 / $0 per 1M` in the chat `/model` menu, the builder model dropdown and the provider model list, and the model page Price section says so in words. Sort by price puts local models first, then free hosted models; unknown prices stay last. ui-core adds `isFreePrice` and `modelPriceDetail` (tooltip text for a price label). The Runs toolbar's partial-cost note is a Cortex tooltip instead of a native `title`.

An honest decline is no longer rejected as "tool-viable" when the required tool already failed permanently (it was dropped from the effective missing list, so the exit gate saw nothing missing and lost the decline). The `exit_gate` decline check also reports a new `no-missing-required` value when no required tool is missing at all. A task that lists inputs as a range ("notes-1.txt through notes-6.txt") now yields every member, so the duplicate-call refusal names the first unread file instead of the range's last end.

A strategy run no longer ships an old draft over tool results it fetched and never read. When the answering kernel pass ends with tool results no think read (for example the batch a pass runs at its iteration cap), and the output to ship was written before those results, the shared strategy terminal makes one synthesis call. The call covers the task, the pass's tool results and the draft. Before this, a reflexion improve pass ran 4 market-trend searches and the run still answered "The EV market is large.". The call is bounded. It runs only when new, non-error, non-meta results exist and the shipped answer predates them. It does not run for an answer the model wrote in the same turn as its calls or through `final-answer`, for results identical to ones already read, or for a pass that ended on a provider error. When the run's token or cost budget is spent, the call is skipped and the skip is recorded. Every use is recorded as a `harness_signal` step (actor `unread-results-synthesis`), as `metadata.unreadResultsSynthesis` and as one more `llmCalls`.

Separately, harness meta tools such as `discover-tools` are never nominated as required tools. A research task used to nominate `discover-tools` because its description says "search web", so the repetition guard told runs with no required tools "You still need to call: discover-tools".

Fix state the UI showed that disagreed with live state. The Lab Gateway tab now reads channels hosted by the channel hub from the hub's own status, so a running Telegram agent shows Connected with its real message counts, last message and reply times, a listening phase, hub traffic in its activity and the access line from its routes (it read "Not started / No channels running / 1 need attention" before). The chat quick bar keeps the steps and strategy chips after you pick a value equal to the default (choosing 16 steps made the chip vanish). A saved agent's run count now comes from its recorded runs (a Telegram agent answering through the channel hub showed "0 runs" beside real stats). The route editor gains the pacing field (`minGapMs`), and the hub header shows outbox and follow-up timer counts when the router keeps them.

Chat environment notices no longer report a stale "to-do list edited" line. The environment baseline moves only when a turn settles (not on every read), and to-do edits count only the user's own dock edits; to-do lists applied from an agent's session-control proposal are not reported as user edits.

The `rax` binary shipped by `reactive-agents` now starts with `#!/usr/bin/env node`, so `npx rax` works on machines with Node.js 22.5+ and no Bun installed. `rax cortex` still needs Bun.

When stdout is not a TTY and verbosity is not set, live warnings and errors now print to stderr, not stdout. Piped output (`agent | jq`) now gets only the answer.

New opt-in harness switch `stableToolList` (`RA_STABLE_TOOL_LIST=1`). A kernel pass picks its tool list on the first think turn and keeps it. Tools are only added, by `discover-tools` or when the model uses a tool, and new tools go at the end. The tool block at the head of the prompt therefore stays the same between turns, and the provider prompt cache keeps working. A listed tool that is not ready yet is refused when called, with a note saying what to do first. Examples: `recall` before anything is saved, `discover-tools` when every allowed tool is already listed, `abstain` on the first turn. Required-tool steering uses `Guidance:` and the existing call-time gate; the FC tool list is not narrowed. On Ollama, the head-truncation guard may drop tools only on the first turn. Later turns shrink history instead. Default off until an ablation measures it.

Always on:
- `tool-surface-resolved` now records a reason for a withheld `final-answer` or `abstain`. Before, 179 removals in the 2026-11-10 census had no reason.
- In strict discover mode, a discovered tool now reports `discovered` instead of `allowed-floor`.
- Kernel `ReasoningStepCompleted` events now include `iteration`.
- Blueprint plan verification heals tool names with the canonical healer from `@reactive-agents/tools`. Very short names and tied matches are no longer guessed.

Ollama: `OLLAMA_API_KEY` from the environment is now attached only to https endpoints (or `https://ollama.com`), never to loopback or plain http hosts. Previously it was sent as a Bearer token to whatever endpoint resolved, including cleartext LAN hosts. An explicit `apiKey` passed to `.withProvider("ollama", { apiKey })` is still always honoured; `resolveOllamaTarget` now returns a secret-free `warning` when a key is withheld or would travel over cleartext http.

A run a person stops (`stop_requested`, or a hard `terminate_requested`) is now reported as an honest partial instead of a success. The result keeps the answer so far, carries status `partial` with `outstandingCriteria: ["stopped_by_request"]` (so the runtime reports `success: false`), and its terminal outcome has `terminatedBy: "stop_requested"`, authority `user-stop`. The terminal verify, required-tools and quality gates leave a stopped run alone, and unmet post-conditions no longer turn a stop into a failure that discards the answer. On a stop the kernel also writes its own final checkpoint (the live state, one iteration past, through the same rail as the loop-stop checkpoint), so the run resumes from exactly where it stopped. `buildLoopStopRecord` is now exported and works for any stop reason (user stop, budget, timeout, error), reading the unfinished rows from the checklist or a supplied run ledger; `buildStopRecordFromSerialized`, `isUserStopReason` and `USER_STOP_CRITERION` are exported alongside it.

The chat to-do dock shows in-progress rows with the same spinner ring as its header, centered and steady, instead of a rotating retry icon that wobbled.

Opt-in (off by default): with `harness: { planBudget: true }` or `RA_PLAN_BUDGET=1`, a run seeded with a plan checklist gets an iteration budget sized from the plan. It is off by default because its ablation measured higher token use without a gain in task success. When the unchecked steps plus a reserve (the larger of 2 and 25%) need more iterations than `maxIterations`, the bound is raised once at run start, to at most the smaller of 60 and 3x the configured value. The raise is recorded as a `plan-budget` harness signal and a `plan_budget_raised` event carrying `{configured, steps, effective, hardCap}`. The todo-only refund keeps its cap on the configured budget, and the raise plus refunds never pass the hard cap. Unseeded runs and plans that fit are unchanged, and cost, token and time limits still end the run.

Export `tokenizeToolName`, the one tool-name word splitter, so other packages import it instead of re-implementing it.

A control-plane `abstain` for a stalled enumeration requirement ("expects N items, found 0, no progress") is now acted on instead of being resolved and ignored every iteration. The run ends through the exit gate once the stall passes its patience (the larger of 4 and 10% of `maxIterations`): the model's draft ships as a partial with an `Unfinished:` list, or the run fails naming the incomplete requirement with the gathered evidence attached. An enumeration that is still advancing never abstains.

`.withProvider(p, { apiKey })` now works for every provider. The Anthropic, Gemini and Ollama adapters used to ignore it and read only `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` / `OLLAMA_API_KEY`. Now the passed key wins over the env var for all adapters, so you can set a per-agent key for any provider. When a provider rejects a key passed this way, the error now says to check the key passed to `.withProvider`. Before, it told you to set an env var that the adapter never read.

A run stopped by `.withBudget({ tokenLimit | costLimit })` (`terminatedBy: "budget_exceeded"`) now publishes `BudgetExhausted` with the budget kind (`"tokens"` or `"cost"`), the limit and the amount used, before the terminal event. Before, only the `budgetLimit()` killswitch published it, so a builder budget stop showed up only as `terminatedBy` on the terminal event. One event is published per exhausted budget.

`MemoryService.bootstrap` accepts an optional `taskId` and, when given, publishes the core `MemoryRecalled` event once per non-empty recalled tier (semantic, episodic, procedural) with bounded items (max 20, summaries max 160 chars). Nothing is published when nothing is recalled.

Cortex chat: the agent's session-control proposals are now part of the thread and cover most of the session.

- The "The agent proposes" banners no longer outlive the conversation: clearing a chat deletes them, rewinding removes the ones the rewound turns made, compacting drops the settled ones, and a fork starts without them. The UI re-reads them at once, so nothing lingers until a reload.
- Identical proposals collapse to one card (the tool also tells the agent "already proposed" instead of stacking another), applied and dismissed proposals shrink to a one-line row, and every banner can be removed (`DELETE /api/chat/sessions/:id/proposals/:proposalId`).
- With Agent control on, `/agent` now has "Let the agent change" switches (all off by default): tools (add or remove a tool or toolset, enable a configured MCP server), limits and strategy (max steps, strategy, context budget), memory tiers, system prompt, approvals, workspace folder, and conversation (to-do list, compact, fork, rewind). A read-only `describe-session` action lets the agent see its effective setup.
- Every proposal shows a before and after diff. Nothing applies without your Apply, except a stricter change in a group you also allowed to auto-apply; a looser change can never auto-apply, and a chat that reads outside content marks its proposals with a warning and never auto-applies them. The full host shell cannot be proposed.

Audio and file content parts now reach the provider boundary honestly instead of being silently dropped. `Capability` gains an optional `supportsAudioIn` (Gemini rows, `gpt-4o-audio-preview` and `gpt-audio` rows, and the Ollama `/api/show` `audio` capability). OpenAI maps audio to `input_audio` (wav and mp3, base64, user turns) and Gemini maps it to `inlineData`, only on a model whose authoritative row says it accepts audio. Every other case (Anthropic, Ollama, LiteLLM, a guessed model row, a URL source, an unsupported format, a non-user role) replaces the part with a deterministic stub such as `[audio omitted: audio/wav, 120 KB; model has no audio input]`, keeps an audio `transcript` in the stub, and logs a `content-part-degraded` fact with `partType` `audio` or `file`. A text-like file whose bytes are an inline `data:` uri is inlined as text up to 32 KB with a truncation marker; any other file is stubbed. `DegradedPart.partType` widens to `"image" | "audio" | "file"`, and the exchange record gains `[audio:...]` and `[file:...]` placeholders. `ContentBlock` now includes core `AudioPart` and `FilePart`.

`scripts/dev-stack.ts` gains `start`, `stop` and `status` subcommands. `start` runs a detached Cortex server and UI on chosen ports (`--port`, `--ui-port`, `--cwd`) and writes one pid file per child; `stop` ends only those recorded processes (never by port, and never a pid whose command line no longer matches); `status` lists pid, liveness and port. Plain `bun start` is unchanged.

Cortex chat Continue now starts a new run linked to the one that stopped (`resumeRun(runId, { newRun: true })`) instead of reusing its run id, so each run keeps its own trace file. The continuing turn, the Runs list, the run header, the trace drawer and the compare picker show "continued from <run>" with a link, the stopped run is no longer offered beside its continuation, and runs from before this render unchanged. ui-core adds `continuationsOf` and `continuationChainOf` (run lineage over `continuedFrom`).

`agent.session({ initialPlanFindings })` seeds a conversation's stored plan findings next to `initialTodo`. A session rebuilt after a restart or eviction keeps `session.plan.findings`, carries them into the next execute turn, and `setPlan(steps)` keeps them. Malformed rows are dropped and duplicates kept once.

A streamed durable run that is aborted while a Pause is still pending is now stored as `paused` / `user-paused` instead of `stopped` / `user-stopped`. An abort that arrives first, or a Stop/terminate, still stores `user-stopped`.

ContextPressure is now emitted for hosted providers (OpenAI, Anthropic, Gemini, ...). When the provider does not report a resolved context window, the framework capability row for the model supplies it, but only when a real row exists (never the conservative fallback window). Ollama's provider-set window is unchanged.

`agent.resumeRun` now names the run's still-open to-do rows in the continue guidance, so a paused or stopped run that is continued reconciles its list (mark done, remove, or finish) before its final answer. The kernel's own wrap-up turn is opt-in and is unchanged.

Gateway channel messages now have one consumer and an honest history. A message handled by the channel router (`.withChannels({ routes })`) is no longer also run by the legacy gateway chat handler, so routed messages stop running twice outside the router's access decision and meters. A message from a native channel adapter no longer tells the model to call an MCP send tool that does not exist. The gateway chat history keeps only replies from runs that succeeded: a failed, abstained or dropped run stores nothing (its reasoning text used to become an assistant turn that later runs read back), and `executeEvent` now returns `undefined` for a run that did not succeed. Kernel tool schemas carry `mutatesExternalState` from the tool definition.

An LLM call whose model has no known price is no longer counted as free. When the provider usage carries no `estimatedCost`, the `LLMRequestCompleted` event the reasoning layer publishes now omits `estimatedCost` and sets `priceSource: "unknown"`. A priced call also carries its `priceSource` (for example `"price-book"` or `"provider-reported"`).

The run spend meter (`RunBudgetMeter`) gains a `costComplete` flag. It turns `false` when any call in the run had an unknown price and stays `false` for the rest of the run. In that case `cost` is a lower bound (the sum of the known prices), not the full spend. Spend values (`TokenSpend` / `RunBudgetSpend`) carry the same optional `costComplete`. Structured-output results omit `usage.estimatedCost` when any attempt's price was unknown.

Kernel cost totals can no longer become `NaN` when a provider reports usage without a cost.

Webhook channels and routes no longer use messaging wording or chat-only settings: the route editor hides the conversation and trigger selectors, per-sender cap, reset commands and failure notice for a webhook, rewords the rest ("Runs per hour", "Run limit (seconds)"), and no longer preselects the first saved agent. The webhook channel card now shows how to connect a caller (the framework's own connection info with curl, Node and OpenSSL examples, loopback note), a Generate secret action (stored sealed, shown once) and a Send test request button that signs and posts from the server.

`.withChannels` now passes `inbox: { path }` (opens and closes the durable SQLite router store), `outbox` (retry and pacing) and `followUp` through to the channel router. With `followUp`, or routes using `midRun: "fold"` or `"interrupt"`, each conversation runs on its own agent: the `follow-up` tool is registered on it (never on a `ReadOnly` surface), folded messages are attached to the next custom tool result, and an interrupted turn aborts its stream. `agent.channelRouterStatus()` reports `inbox`, `outbox` and `timers` counts.

Tool descriptions keep what a call needs.

- Tool index promotion: a hidden tool that the tool index (`toolIndex`) promotes onto the provider wire now keeps the sentences that limit a parameter's values (for example "type is one of url, referrer, …"), after its first sentence. Before, it kept only the first sentence, so a promoted tool lost its valid values and models sent invalid arguments. Visible tools and promoted tools now share one description trimmer.
- New opt-in harness switch `compactCallConstraints` (`RA_COMPACT_CALL_CONSTRAINTS=1`). Compact tool profiles (`names-only`, `names-and-types`, the local tier) still drop description prose. With the switch on, they keep the value-constraint sentences in the prompt tool reference, the driver listing and the wire description, and the compact reference lists enum values as `a|b|c`. Default off: the measured gain on one local model was below the promotion bar. With it off, compact profiles ship the same schemas as before.
- Blueprint: when the SOLVE call fails, the joined step results now ship as `partial` with `harnessAuthoredOutput` and a verification warning. Before, they shipped as `completed`.

The duplicate-call refusal now names the first listed input the model has not read yet ("Read notes-5.txt first"), not only the unwritten outputs. On tasks that list several source files, a model that repeated a read used to be told to "do the next item" and wrote outputs from sources it never opened. With every listed input read, the refusal text is unchanged.

A plain question-and-answer run with no tools is no longer labelled `abstained` just because the harness ended it (for example at `max_iterations` or on loop detection). Such a run had no tools to gather evidence with, so a substantive answer it gives now keeps its own status, capped at `partial` as before when the harness forced the end. A run that gives up ("I cannot do this") or claims an action it could not have taken ("the message was sent") is still `abstained`. Runs that had tools available, or a required tool, are unchanged.

The Beacon first-run hero icon shows its pulsing sonar rings again: three calm, staggered rings around the neural mark while idle, faster and brighter while a run launches, and still under reduced motion. Sonar still means "running now" everywhere else.

New opt-in harness switch `computeOffload` (`RA_COMPUTE_OFFLOAD=1`, default off, behavior unchanged without it). When the task text asks for a numeric aggregate over data the run reads (an aggregate verb such as sum, total, mean or average, plus a data file or csv reference), `code-execute` stays on the visible tool surface even if the task did not declare it, as long as it is in the agent's permitted tools. Once data has been read without a successful `code-execute` call, one advisory guidance line says to compute figures with `code-execute` instead of estimating them. Advisory only: it never blocks a call or ends a run.

`resolveProviderModels` now degrades to every model RA knows when a provider's live model list fails (no key, out of credits, network, bad shape): the framework presets first, then each chat model id the bundled PriceBook prices for that provider (general ids before dated/beta/preview/latest variants; no ids invented, no aliases collapsed). Previously only the presets were listed, so xAI with an exhausted balance showed a single model. Each `DiscoveredModel` carries a new `listedBy: "live" | "static" | "price-book"` origin; `source` is unchanged (`"preset"` for every non-live row). `ModelDiscoveryError.reason` gains `"quota"`: HTTP 402, or a 403/429 whose body states an exhausted balance or a reached cap (used all credits, insufficient credits/balance/quota, spending limit reached, quota exceeded, payment required, billing hard limit; a body that only mentions or links billing stays `"http"`; the body is matched, never echoed); other non-2xx stay `"http"`. New `pricedModelIds(provider)` lists the PriceBook's ids for a provider. The live success path is unchanged.

`ToolBuilder...build()` now passes straight into `.withTools({ tools: [...] })` without a type error or cast. `build()` types `handler` as required when `.handler(fn)` was called, and keeps the handler's own type. Before, `handler` was always optional and returned `unknown`, so the documented builder chain failed with TS2322. A tool built without a handler, or with a handler that returns a plain value instead of an Effect, is now rejected at the `.withTools()` call at compile time, because `.withTools()` runs handlers as Effects. New exported types: `ToolBuilderHandler`, `BuiltTool`.

Multimodal task input: `agent.run`, `runStream`, `runEffect` and `chat` accept `string | ContentPart[]` (text, image, audio, file parts). Image parts reach the provider request. A model known not to accept images (probe or static capability table) fails fast with a typed `UnsupportedModalityError { partType, model }` before any model call; audio fails the same way when `supportsAudioIn` is explicitly false. Text-only runs are unchanged. New exports: `TaskInput`, `modelInputCapabilities(provider, model)` (`{ vision, audioIn?, authoritative }`), `UnsupportedModalityError`, `taskInputText`, `taskInputParts`.

code-action reads tool results more reliably and answers in the form the task asks for:

- When generated code fails after some tool calls succeeded, the repair prompt now shows the actual shape of each result (key names and value types, no data values), so the next attempt reads real fields instead of guessing.
- When the program returns an object or array, one answer-writing call (the shared quality gate every strategy uses) turns it into the answer the task asked for, such as a report. Tasks that ask for JSON or CSV keep the raw result.
- A "nothing found" result (or an empty value) is no longer graded success when a successful tool call in the same run returned data about it. The run retries with the contradiction stated, and fails if no attempts remain.

`.withTools({ webSearch: { apiKeys, providers } })` gives one agent its own web-search keys and provider order. `apiKeys` (tavily, brave, serper, keenable; plain strings or `Redacted`) win over environment variables and are never put in the process env, so shell and code-execute children cannot read them and concurrent agents do not share them. `providers` sets the order to try. It applies only when `web-search` is a permitted built-in. `toConfig()` and `fromConfig()` round-trip `providers` as `tools.webSearch`; `apiKeys` are runtime-only and never serialized.

Model thinking is no longer shipped as the answer. When a thinking model returned an empty answer channel and only reasoning text, plan-execute, blueprint, reflexion and the kernel's terminal synthesis used that reasoning as the deliverable, and the run could report success with output like "Let me check the workspace...". These sites now read the answer channel only (`extractDeliverableContent`); an empty answer fails the step or leaves the run unanswered with a cause, instead of succeeding.

Planner and plan-repair calls also no longer label their `ReasoningStepCompleted` events `structured-output-native`; they carry the strategy that ran (`plan-execute-reflect`, `blueprint`), so dashboards stop reporting a strategy switch that never happened.

`code-execute` now runs Python 3 as well as JavaScript/TypeScript. Set `language` to `python` (also `python3`, `py`): the code runs under the host `python3` in the same subprocess model as the Bun path (cwd `/tmp`, minimal environment, process-group kill at the timeout). It is not isolated, like the Bun path. Python has no `return`: print the answer and stdout arrives in `result` and `output`. Failures keep the last 20 traceback lines; a Python syntax error returns a Python retry example. A host without `python3` gets a clear "not found, nothing executed" observation; docker mode routes Python to the sandbox container and never falls back to the host (that Docker path is untested). The tool description and retry guide now state both languages.

An honest decline the model writes in the same turn as a tool call that a guard then drops (for example the dispatcher early-stop firing on a required tool that always errors) now ends the run as an abstention carrying the model's own words. Before, the decline was skipped because its turn had call ids, and the run failed with "stopped before the model wrote a final answer". A turn whose calls actually ran still defers to their results.

ui-core: read how a turn ended from the framework's result fields. The harness no longer writes text into `output`: a failed or abstained run completes with `output: ""` and its cause on `error`, a partial run ships the model's draft plus an `Unfinished:` list, and a run whose answer is a file can succeed with `output: ""` (its files on `receipt.deliverables`). The new `turnOutcomeOf(completion)` classifies a `StreamCompleted`, `AgentResult` or `AgentCompleted` payload as `succeeded`, `partial` (`draft`, `unfinished`), `failed` (`error`, `terminatedBy`), `abstained` (`abstention.reason`, `abstention.missing`) or `paused`, with `deliverables` attached; `splitUnfinished(output)` splits a partial draft from its list. `TurnEnding` gains `partial`, `abstained` and `paused`. The turn fold sets `trace.outcome` and `finishTurnTrace` persists it for any ending but a plain success. `buildTurnTranscript` takes `outcome`: a partial run's answer is its draft, and a new `ending` segment closes the transcript (code that narrows `TranscriptSegment` exhaustively must handle it). The run machine sets `RunState.outcome` and `RunState.error` on a failed completion, so `status: "completed"` alone no longer hides a failure. The `StreamCompleted` wire type declares `terminatedBy`, `error` and `status`.

Cortex: chat and the run view show each ending as its own state. A failed turn shows its cause in red ("did not finish"); an abstained turn is a quiet "abstained" note with the reason and missing inputs, not a red failure; a partial turn shows the draft then the unfinished items; a run whose answer is a file lists the files it produced. A failed or abstained turn is now kept in the thread even when no text streamed (before, it was dropped), is stored with its output instead of the streamed narration, and sent to the model as `[The previous run abstained: …]` or `[The previous run failed …]`. The run's cause comes from `StreamCompleted.error`; the bus cause is a fallback.

`attributeFailure` (and `rax-diagnose attribute`) now attributes a run whose failure cause is `strategy-error` to the harness, as the new reason `harness:strategy-error` (probable, from the cause). A strategy body that throws or refuses the run's configuration is the framework's fault; it was `unattributed` before. A strategy body that failed on a model call is still `provider-error` and attributes to `environment:provider-error`.

## [0.18.0] — 2026-11-07

Deterministic failure-cause classifier. `analyzeCause(trace)` (new, `@reactive-agents/trace`) returns a closed-union `cause` with `confidence` (`decisive` | `probable` | `insufficient-trace`), supporting `evidence` (`eventKind`, `seq`, `detail`) and the `missing` trace signals that would have made it decisive, using ordered trace-only rules (provider error, abort sentinel, undisclosed terminal mislabel, plan-posture veto, never-engaged, tool failure, stall/loop after work, verifier reject, budget/cap, residual). It never reads model text and returns `insufficient-trace` instead of guessing on legacy traces. `RunAnalysis.cause` is added additively; `analyzeRun` now labels runs with a `run-aborted` sentinel and no `run-completed` as `aborted` (was `honest-failure`) and reports `overlap-storm` on a successful run only when a storm iteration contains a terminating guard. `tallyCauses` aggregates a cohort. New CLI: `rax-diagnose cause <runId|path>` and `rax-diagnose cause --all [dir] [--real]`.

Wave 3 rung-2 mechanism: `REACTIVE_AGENTS_FORCE_TEXT_PARSE=1` forces the
text-parse driver (and suppresses the native resolver, avoiding the 482c11e4
divergence) so the taught grammar can be exercised on capable frontier models.
Unset/invalid values leave capability-based routing unchanged. Bench arms
(`forceTextParse`) pin it per run; the triad test pins both directions.

Wave 5 delegation composition + strategy-tier honesty. A delegated child's
completion envelope now crosses back on its result (executors derive it from
the engine result's honesty markers) and the parent terminal joins children
worst-of: a partial child caps a completed parent claim instead of laundering
it into a success. plan-execute per-step budgets derive from the run's own
iteration budget (floor 5) instead of the literal 3; code-action documents its
kernel-less reliability posture (terminal-mint guarantees, no mid-run repair).

Cortex: a failed utility run no longer becomes the chat title or a compaction summary; utility prompts run without extended thinking; failed chat turns are marked "did not finish" live and after reload; thinking blocks no longer repeat each other; per-pass guard rows move to the internal timeline lane; strategy switches and tolerated successes are shown in the run view. Console: metric values are rounded, the low-confidence grade no longer contradicts its cap, step-count alerts fire only on runs that did not succeed, and live mode no longer prints the logs twice.

The harness's own warning for a repeated tool call ("you have already called this tool N times") no longer counts as progress. It was recorded like a real tool result, so it could reset the no-progress counter and keep a stuck run going. Guard observations are now marked as harness-authored in the run ledger and classified as non-progress.

The run contract no longer adds phantom action requirements such as `[action:create-ticket] task requires a "create-ticket" action`. Detection now reads only the user's own message. Conversation history was already excluded; prior-context and recalled-memory blocks appended after the message are now cut too. The verb must also govern its object: imperative position, same clause, and a short plain-word gap. Before this, "files … issues" in recalled memory on a "get the price of xrp" turn, or "test file … bug" in a debug task, compiled a requirement the model could never satisfy. That requirement could also make a run abstain at iteration 0 with "missing capability". A request like "File a bug for the login crash" is still detected.

When the kernel withholds tools for one think call, the system prompt for that call no longer lists tools. The in-prompt tool reference, the text-parse call grammar ("How to Call a Tool"), the tool-index note, the rationale block and the checklist line are all left out, and the recall pointers in tool results drop with them. Before, a text-parse model could read "Available Tools" on a turn that offered none.

Adversarial-review fixes. Cortex chat: cached agents are an LRU (`CORTEX_CHAT_MAX_SESSIONS`, default 8) with single-flight builds and shutdown disposal; failed/cancelled turns no longer leave orphan user rows; concurrent turns on one session return `ChatSessionBusyError`; `skills.activate` is no longer stripped by the chat API; content-only documents are accepted; Run Chat and Chat share one SSE reducer. Signal edge: effect classification reads only post-render steps and `synthesize` requires a `final-answer` call. New `rax diagnose signals <runId>`. Runtime: telemetry tool-arg validity uses real tool arguments; structured-output routing uses real model calibration. Ollama capability entries added for bonsai-2:27b, qwen3.8:27b, gemma4:26b.

Pick a workspace without typing a path. The chat `/workspace` picker and the Lab builder's Workspace field now suggest the project Cortex was started in (its git root), `CORTEX_SKILL_SCAN_ROOT` and workspaces you used before. **Browse folders…** / **Browse** opens a folder browser: a breadcrumb, the current folder's subfolders (git repos marked; hidden folders behind a toggle) and **Use this folder**. New routes: `GET /api/workspace/candidates` and `GET /api/workspace/browse?path=&hidden=1`. The browse route lists directory names only and refuses relative or missing paths. A new chat still starts with no workspace; the launch project is suggested, never set for you.

The chat quick bar's slash menu now closes on a click outside it or on Escape, and gives back what you had typed in the composer. Clicking another chip switches straight to that picker, and clicking the same chip again closes it. The menu sits above the quick bar, so the chips stay clickable. Multi-value pickers (tools, toolsets, MCP servers, pinned skills, documents) show checkboxes and stay open while you toggle several items. Click or Tab toggles; Enter toggles and closes. Single-value pickers still close when you pick.

Fixed: changing a chat setting no longer empties the composer. Every session reload used to reset it.

`rax-diagnose attribute` no longer calls a tool's refusal of the model's own content an environment fault. Three new reasons: `harness:refused-repairable` (the refused JSON was deterministically repairable), `harness:misleading-refusal` (the refusal carried a contradicting hint), and `model:invalid-content` (the refusal was correct and the content was not repairable).

Per-run state now lives in one run scope that each run opens once. Every way to start a run (`run`, `runStream`, `resume`, approve/deny, `respondToInteraction`, `fork`, and gateway events) goes through one entry, so a new piece of run state cannot be missed at one of them. Sub-agents get a child scope: they keep the parent's file root and documents and get fresh tool stores.

User-visible effects:
- Gateway runs (heartbeat, cron, channel events) now honor the caller's file root, like `run()` already did.
- Calling `ReasoningService` directly, outside an agent, still isolates each run's tool stores.

Breaking for code that imported low-level tools internals: `withDocumentStore`, `DocumentStoreRef`, `bindFileRoot`, `FileRootRef`, `RunToolStoresRef`, `withRunToolStores`, `defaultRunToolStores` and the deprecated `scratchpadStoreRef` / `checkpointStoreRef` / `discoveredToolsStoreRef` are removed from `@reactive-agents/tools`. Use `.withDocuments(docs, { store })` to share a document store between agents and `withFileRoot(root, fn)` to set a file root; both are unchanged.

Agents can load a discovered skill mid-run with `activate-skill`. With `.withSkills()`, every workspace (and, with `global: true`, user-global) skill in the run's catalog can be activated by name: the tool returns the skill's instructions, they stay in context for the rest of the run, and a `skill-activated` fact is recorded on the run ledger. `activate-skill({ name, file })` reads one file bundled in the skill's directory. Skills already pinned with `activate` answer "already loaded". Runs without skills offer no `activate-skill` and send the same tools as before. Learned skills from the skill store stay catalog-only for now because they have no directory on disk.

Plan-execute runs are now held to the files their task names, through the same delivery check as the main agent loop. Before, a plan-execute run that never wrote a file the task asked for could finish as `completed`, and its result carried no verdict (`terminalOutcome.verdict` was `null`). Now the run compiles the same run contract at start (emitting `contract-compiled`), and its result carries a real verdict: accepted when every named file exists or no file was asked for, refused (status `partial`, outstanding requirements listed) when one is missing. A refused partial is not reported as success by the runtime. Plain answers with no files are unchanged except that their verdict is now `accepted`. Paused, abstained, failed and budget-stopped runs are not judged.

`rax-diagnose attribute` now tells you whether a harness change actually ran, and names one more harness failure.

- New attribution reason `harness:completeness-blind`: the run ended on its own with files the grader required never written, and neither the compiled contract nor any requirement declared later on the run ledger listed them. The fix is a completeness signal, not the prompt.
- New `mechanismActivity(trace)`, `compareActivity(before, after)` and `runsWithMechanism(runs, key)` in `@reactive-agents/trace`: stable keys for the harness mechanisms that acted in a run (guards that did not pass, injected signals, strategy switches, contract requirements by source). `rax-diagnose attribute` prints them per run (`activity`) and per cohort (`mechanisms that acted`).

Stored tool-result keys (`_tool_result_N`) are now minted from the run's own scratchpad instead of a process-wide counter, so identical runs in one process send identical prompts (replay determinism; long-lived servers no longer drift). The per-iteration repetition checks (flail signature, content stability) use a banded early-exit similarity test instead of a full Levenshtein matrix, about 12x faster on long thoughts with identical results.

Embedded-form gate (D7c) reprompts now name the exact call to restate. When a printed tool call on a non-low-risk tool is refused because it sits inside an expression (e.g. `const x = fileRead("/abs/a.txt", "utf-8")`) but its arguments parse as literals, the refusal reason the model sees ends with the canonical standalone call, e.g. `call it on its own: file-read {"path":"/abs/a.txt","encoding":"utf-8"}`. The gate still refuses; nothing executes. Calls whose arguments do not parse keep their existing reason.

A soft guard's `guard-fired` event (stall, required-tool quota, loop resolution, low-delta, oracle force, dispatcher early stop) no longer reports `outcome: "terminate"` before the exit gate decides. The gate now emits the guard's event after its decision: `terminate` when the run ended (accept or handoff), `block` when the gate denied the exit. Event kinds, guard names, reasons and metadata are unchanged.

`@reactive-agents/trace` adds `runEndingGuardEvents`, `guardEndedRun` and `gateDecisionFor`. They read a guard's run end from the paired `exit_gate` event, so older traces, where a denied proposal was labelled `terminate`, are read correctly too. `analyzeCause` (stall/loop after work), `analyzeInterventions` (terminal decision, overlap storms) and failure attribution (stop budget) use them.

Give-up honesty: a run may no longer report `success: true` when its answer is a give-up / incapability statement ("the tools do not include X, so I cannot complete this") and nothing was grounded. Such runs now terminate as an honest `abstained` (the model's own explanation is kept as `output`, `result.abstention` carries the reason). Fixes the hole where `resolveCompletionStatus` mapped a harness give-up (`loop_graceful` / exhaustion) to `completed`, and the terminal verifier's give-up check (which requires unused tools) never fired for zero-tool runs.

LiteLLM now sends an assistant turn's tool calls as OpenAI-format `tool_calls` (id, `function` type, name, JSON-string arguments). Before, the request kept the `tool` result messages but dropped the `tool_calls` entry that they answer. OpenAI-compatible backends behind the proxy rejected that thread with HTTP 400 on the turn after a tool call. `complete()`, `stream()` and structured output now use the same message mapping as the OpenAI provider.

`actOrAnswer` gains a proactive mode (`actOrAnswer: "proactive"` on the reasoning harness config, or `RA_ACT_OR_ANSWER=proactive`; default stays off). On native function calling, a turn that is known before the call to need a tool sends its first request with `toolChoice: "required"`, so no plain-text turn is spent first. A turn needs a tool when a required tool has not been called, a delivery condition that only a tool can satisfy is unmet, or a plan-execute step declared tools and has called none of them yet. Plan-execute steps get this check in the existing retry mode too. The first request is not forced right after a failed tool call, and not on Anthropic models that can think, because forcing a call turns extended thinking off there. If a forced reply has no call, the retry runs as the fallback. If the provider rejects a forced request, the same request is sent again without forcing. Proactive records carry `metadata.mode: "proactive"`. When proactive mode falls back to the retry, that record carries `mode: "retry"`. With `actOrAnswer: true` or with the switch off, requests and records are unchanged.

`find` now tells the truth about web search. `findToolFor({ web, webFallback })` drops the `web` scope and the "falls back to web" claim when the handler has no web source or the fallback is off. New `findDescriptionFor(state)` derives these options from the handler's `FindState`. The default `findTool` text is unchanged. When a caller asks for `scope: "web"` and no web source is wired, or the web search fails, the result now carries a `note` saying so instead of returning a silent empty list.

A run that ends between the model's think and the act phase no longer drops the model's tool calls without a record. One rule now handles every such ending, at the entry of the kernel terminal pipeline. If the iteration cap stopped the loop and the pending batch writes a declared deliverable the run still lacks, the batch runs once: one act, with no new think and no LLM call. The cap then judges the run with that write in evidence. Before this fix, recorded runs lost a final `out-6.txt` write this way and failed. In every other case the batch does not run. The run records a `pending-batch` intervention step, which reaches the receipt, and a `pending_batch` guard event that names the calls. This covers guard and controller exits (early stop, strategy-switch exhaustion, loop resolution) and a cap whose batch writes nothing outstanding. Durable approval and interaction pauses keep their batch for the resume.

The adaptive strategy now runs on the shared strategy run substrate and ends by relaying the result of the strategy it dispatched to. That result keeps its own status, output, verdict, abstention and pause fields exactly as the dispatched strategy produced them; adaptive no longer re-judges it. Reported `llmCalls` is now complete: it includes the dispatched strategy's calls plus adaptive's own classifier call (before, adaptive reported no `llmCalls` at all). When adaptive falls back to reactive after a partial result, the tokens, cost and calls of the abandoned attempt are now counted in the run's spend.

MCP tool results that mix text items with image, audio or resource items now keep the line breaks between adjacent text items. `mapMcpToolResult` merges each run of adjacent text items into one text part joined with "\n", so the kernel's text view of `[text "a", text "b", image]` is `"a\nb"` (it was `"ab"`), matching text-only results. Text-only results are unchanged.

Measurement-only: the final run status is now derived by one runtime function (`deriveFinalStatus`), and `run-completed.outcome` gains optional `statusReason`, `tolerated` and `toleratedBy`. A run that the partial-substantive-output lane flips to success is now marked `tolerated`, and `rax-diagnose cause` no longer reports it as a `terminal-mislabel`. No run changes outcome.

The builder panel (Lab builder and the chat new-session config) has a Tool disclosure select in its Tools section (`.withTools({ disclosure })`: tier default, all, index, discover). It shares its choices with the chat `/tools` picker. The Tools quick picks list capability tools only, so meta-tools such as `recall` appear once, in the Meta tools section.

Text tool calls with several positional literal arguments now bind to the tool's declared params in order. `fileRead("/abs/a.txt", "utf-8")` resolves to `{ path, encoding }` instead of being refused. Calls are still refused (the model is asked to restate) when there are more positionals than declared params, when the surface declares no param names, when a positional collides with a named arg, when a required param ends unbound, or when any value is non-literal. The embedded-form risk gate is unchanged.

Every final answer the model gives now passes the exit gate. Two paths used to skip it: the `final-answer` tool and the termination oracle's exit on the model's text. While a required tool or delivery condition is still unmet, the gate now denies both. A denied `final-answer` call gets the outstanding list as its tool result, not "accepted". A denied model answer is recorded as `gateDecision: "deny"`, a new value that can repeat. A guard's single per-run nudge stays `deny-once`. A controller early-stop that reaches the oracle is the harness's decision, not the model's. It is gated like the runner's dispatcher early-stop: it is denied once, then the run ends as a handoff.

The context-overflow retry now compacts the thread to 0.7x the prompt size the provider reported. It falls back to the projected window when the provider gives no size. The retry happens at most once per run, not once per think call, and a sub-agent gets its own. A successful recovery is recorded as the `context-overflow-recovered` trace fact.

GH #243 — confidence floor for calibration dialect priors (first program self-caught regression: wave-2 close capture measured S3 qwen3:4b 5/5 → 0/5 because a 2026-05-24 runsAveraged:1 prior flipped W2a's derived supportsToolCalling to false on a model whose live template evidence says native-FC).

`deriveSupportsToolCalling` now ships an explicit precedence (JSDoc + cited constant): a `toolCallDialect: "none"` prior can flip live routing ONLY when it is an explicit field in the calibration file (schema-default "none" is no longer a claim — four shipped priors were phantom claims) AND `runsAveraged >= DIALECT_PRIOR_CONFIDENCE_FLOOR` (2). Below floor, contradicted-by-evidence, or absent, the derivation stays fail-safe-permissive. Confident priors are also honored in the template-unmeasured arm (previously priors never governed there). Root-cause fix: the calibration-runner shipped a hardcoded `toolCallDialect: "none"` stub into every generated prior (probe suite v1 never measured dialect); v2 adds a real behavioral probe (required-tool chat call, parseable `tool_calls` ⇒ native-fc).

Audit (live /api/show + behavioral, 2026-10-13): qwen3:4b, qwen3:14b, cogito:14b priors REFRESHED to native-fc via the probe path (3/3 majority each; probeVersion 2; dated; STATIC_CAPABILITIES entries re-reconciled to match). gemma4-e4b / llama3.2-3b / qwen2.5-coder-14b / -7b / cogito-8b KEPT — the absent-field priors are inert under the explicit-presence rule. Plugin-model template stubs (gemma4's 13-char passthrough) now measure UNMEASURED instead of a stranding false (>= 64 scannable chars required).

Kernel messages carry typed content parts. `KernelMessage.content` (and the core `KernelMessageLike` harness payload) is now `MessageContent`: a string, or `ContentPart[]` when a non-text part is present. A user turn seeded through `initialMessages` with an image part now reaches the provider as an image block instead of being impossible to express. Text-only content is still one string, so text runs send the same bytes as before. Audio parts, file parts and image types the provider wire does not support (anything other than PNG, JPEG, GIF, WebP) become a short deterministic text note, and tool-result parts flatten to text, until per-provider mapping lands.

The stream looks the same whichever reasoning strategy runs. `ThoughtEmitted` now carries only the model's own reasoning from kernel turns (`ReasoningStepCompleted.producedBy: "kernel"`); a strategy's internal control notes (`[PLAN 2] ...`, `[REFLECT 1] ✗ UNSATISFIED`, raw plan JSON) stay in traces and no longer appear as thinking. A new full-density stream event, `ExitGateDecision` (`repair` | `handoff` | `accept-unfinished`, with the outstanding items), reports the shared exit gate's decision for the main loop and for every strategy alike. Plans reach consumers as live checklist rows from one shared planning primitive, now used by both plan-execute and blueprint. Cortex shows the gate decision as one line in the turn's checklist card.

A tool call the harness blocked (for example a repeated identical call) no longer counts as "called" or "succeeded". Before, it could satisfy a required-tool check, count as a landed file write, or clear tool-call protocol strikes, even though the tool never ran. Every ledger reader that decides "was this tool called" now reads only results from calls that actually executed.

Backlog sweep fixes. Reasoning: tool-relevance keyword expansion ignores 1-2 letter task words, so generic tools no longer leak into the primary set and suppress preflights; the action-need detector recognises more phrasings (text/ping, SMS/Discord/Telegram/WhatsApp/Teams, standup/sync/demo/webinar). Memory: the episodic schema now admits the `strategy-outcome` and `reflexion-critique` event types the runtime already wrote. Diagnose and replay: string-thrown errors are now tagged (`DiagnoseUsageError`, `GrepExpressionError`, `TraceNotFoundError`, `ReplayLoadError`) with unchanged messages; `diagnose` now depends on `effect` directly.

Dynamic capabilities for live-discovered hosted models, and a working Chat Completions tool path for the GPT-6 family.

**Provider-reported capabilities (`source: "inferred"`).** Model discovery lists new provider ids, but an id with no static row fell to the conservative fallback (tier local, 4096 ctx, `toolCallDialect: "none"`), so Cortex and the CLI showed blank capabilities. Discovery now ingests the limits the provider itself reports in its model listing and writes them through to a new resolver tier (`capability-reported.ts`) that sits BELOW probe, cache, static-table, and user-supplied rows and ABOVE the loud fallback. Parsed fields (each checked against the vendor's docs): Gemini `inputTokenLimit` / `outputTokenLimit` / `thinking`, Anthropic `max_input_tokens` / `max_tokens` / `capabilities.image_input` / `capabilities.thinking`, Groq `context_window` / `max_completion_tokens`. A row is built only when a context window was reported; the only non-reported fact is native tool calling (the tier is the conservative `mid` placeholder, never guessed from the id). OpenAI's listing reports no limits, and xAI/LiteLLM listing fields are not parsed (unverified), so those ids still hit the loud fallback. No id-pattern guessing. Inferred output ceilings are advisory and never clamp the requested output budget, and `DiscoveredModel.capabilitySource` exposes the provenance. `.withModel({ numCtx })` now overrides an inferred row (keeping its dialect/thinking facts) in addition to a fallback row.

**Chat Completions tools and reasoning.** Per OpenAI's GPT-6 guide, GPT-6 Sol and GPT-6 Luna accept function tools on `/v1/chat/completions` only with `reasoning_effort: "none"`, and GPT-6 Astra, GPT-6.1 Sol and GPT-6.1 Terra accept them only on `/v1/responses`. The OpenAI and LiteLLM (`openai/` routes) adapters now force `reasoning_effort: "none"` whenever tools are present for the first group (warning once per provider/model when a configured effort was overridden), and fail fast with an actionable error naming the model and the Responses API for the second group, instead of surfacing the provider's raw 400. The rules are named-model tables with a dated source comment in `capability.ts`. Every other model is unchanged.

"Which required tools are still missing, attempted or permanently failed" is now answered from the run's tool evidence, not by scanning the current pass's steps. A later pass of a multi-pass run is no longer told "Cannot finalize yet" for a required tool an earlier pass already called, and a required quantity counts calls across the whole run. A call the harness blocked is not an attempt, so a guard-blocked required tool is no longer reported as permanently failed. Delegated work counts through the sub-agent result's `delegatedToolsUsed`. `ToolEvidence` gains `attemptedCounts` and `permanentlyFailed`.

A `code-execute` call whose code did not run (`{ executed: false, error }`) is now a failed tool call: `ToolCallCompleted.success` / trace `tool-call-end.ok` is `false` and the model receives it as an error tool result. Before, the kernel trusted the tool service's `success: true` and counted the failure as a success.

shell-execute honors a configured timeout. `terminal.timeoutMs` (ShellExecuteConfig.timeoutMs) above 30s was silently capped at 30s, because the tool definition hard-coded `timeoutMs: 30_000` and ToolService enforces the definition timeout. The definition now uses the configured timeout plus a 2s grace margin (`SHELL_TIMEOUT_GRACE_MS`), so the shell's own kill fires first and returns the output it collected instead of a bare "timed out after 30000ms" error. The default kill stays 30s.

GH #243 review discharge — truthful full-suite v2 calibration refresh (data only, produced by the shipped `calibration-runner --commit` probe seam; runner source untouched). All fields of qwen3:4b, qwen3:14b, cogito:14b, and qwen2.5-coder:14b priors are now v2 measurements (probeVersion 2, runsAveraged 3), removing hand-merged v1 carry-overs whose suite metadata described partially-stub data.

Measured changes: qwen2.5-coder:14b `toolCallDialect` ABSENT->"none" (3/3 behavioral probes emitted no parseable tool_calls — corroborates the #243 audit) so `deriveSupportsToolCalling` now returns false for it as a confident measured posterior, not a phantom claim; Wave 3's S4 text-mode arm has a real measured target. qwen3:14b + cogito:14b `optimalToolResultChars` 4000->2000 — 2000 is the current probe ladder's cap, so this is a censored ">=2000" measurement, disclosed in the W2 fix report. No dialect movement for the three native-fc models (static-table reconciliation from 354b6aef8 stands).

`attributeFailure` (and `rax-diagnose attribute`) fix two over-blaming faults. A dropped call that repeats, with the same arguments (key order and resolved path ignored), a call that already failed twice is no longer `harness:tool-call-dropped`: running it would have failed again. A retry steer that names the tool whose own last call failed is no longer `harness:misleading-guidance`, even when the ledger counted the requirement as met. New reason `harness:contradictory-guidance`: the run's deciding `think` turn told the model to call a tool its request offered no schema for, the model tried, and the tool never ran. Such runs used to read `model:never-engaged`.

Workspace, pause outcome and run evidence follow-ups.

- Chat turns take a per-turn `workspace`: `agent.chat(msg, { useTools: true, workspace })`, `session.chat(...)` and `session.runStream(msg, { workspace })`. Precedence is turn, then `.withTools({ workspace })`, then ambient `withFileRoot()`. `agent.chat()` on the tool path now also forwards `posture` and `origin` to the run. Before this, both were dropped.
- Durable runs store their per-run `workspace`. `resumeRun`, `approveRun`, `denyRun`, `respondToInteraction` and `fork` run in that directory again, from any process. Before this, they fell back to the builder or ambient root.
- A durable run paused for approval or interaction now reports `success: false` and no `terminatedBy` on both `run()` and `runStream()`. `StreamCompleted` carries `status: "awaiting-approval" | "awaiting-interaction"`. Before this, a paused stream reported `success: true, terminatedBy: "end_turn"`. `AgentStream.collect()` now carries `status`, `pendingApproval` and `pendingInteraction`.
- New `AgentResult.evidenceDelta` (and on `StreamCompleted` and a tool-path `ChatReply`): the run's summed kernel assessment evidence. `goalRunOf()` prefers it over re-summing events. A tool-path `ChatReply` now carries `goalAchieved` and `outstandingCriteria` too, so `goalRunOf(reply)` honors the run's exit gate.

Traces and checkpoints no longer store image or audio bytes. In an `llm-exchange` trace event, a message that carries an image now has an optional `parts` summary (`type`, `media_type`, `bytes`, `sha256`) instead of the bytes. Text-only messages do not get the field, and traces recorded before this change still load. A new `content-part-degraded` trace event records each part the kernel replaced with a text stub before the provider call: audio parts, file parts and unsupported image types. Durable checkpoints (`serializeKernelState`, `RunHandle.inspect()`) replace each inline base64 image or audio part with a text stub that holds the same summary. A run resumed from a checkpoint therefore sees that stub where the media was. URL sources are kept, and an audio transcript is kept.

A tool result that contains an image is now sent to the provider as text and image blocks on the tool message. Before this change the image became the stub `[image omitted: image/png; tool results carry text only]`. Each provider maps the image to its own format. Tool results that contain only text are still sent as one string, unchanged.

Every strategy run now has one ledger source. Tool calls that a strategy runs outside a kernel pass (code-action's sandbox, adaptive's failed sub-strategy) reach the run ledger through the strategy engine, once, and a tool call that is already recorded is never recorded again. `growRunLedger` is no longer exported from `@reactive-agents/reasoning`; it was an internal ledger primitive.

A tool that returns `toolContent(parts)` (for example an MCP tool that returns an image) now keeps its parts in the kernel. The tool-result message carries the typed parts, and the observation step, compression and the scratchpad use the text parts only. Before this change the result was serialized to a JSON text view and the image was lost. Provider tool-role content is still text, so an image in a tool result reaches the model as a short placeholder such as `[image omitted: image/png; tool results carry text only]`, never as base64 bytes. Tool results that do not use `toolContent` are unchanged.

Loop detection now runs only at turn boundaries, so a strategy switch no longer discards a native tool call the model made in the same turn. A switch that still drops pending calls is recorded as a `strategy_switch` guard event.

Blueprint and code-action runs are now held to the files their task names, through the same shared delivery check as plan-execute and the main loop. Their results carry a real verdict (it was `null`): accepted when every named file exists or none was asked for, refused (status `partial`) when one is missing. Reflexion's own delivery check now judges the same run contract as every other strategy instead of deriving its own conditions, so all strategies agree on what a task asked for.

Wave 2d — FC payload honesty + classifier-skip enforcement (Local-Tier Reliability program, plan 2.4/2.6).

**2.4 (behavior change for local-tier FC):** the FC `tools:` wire array now honors `toolSchemaDetail` the way prompt text already did. On compact profiles (`"names-and-types"` — the local tier — and `"names-only"`), the wire schemas carry cleared descriptions (tool-level and parameter-level), while parameter `type`, the `required` list, `enum` values, and array `items` are KEPT — the exact semantics of the existing prompt-text stripper (one stripper, one meaning; no second implementation forked). Measured before the fix: the wire array cost ~4,000 corrected tokens ≈49% of an 8K local window, ~80% of it description strings the profile had already declared unaffordable. Mid/large/frontier profiles (`"full"`) are byte-unchanged — big models keep full tool fidelity (pinned by a frontier-arm test).

**2.6 (documented skip, now enforced at the site that actually fires):** `classifierReliability:"low"` (or `"skip"`) now genuinely skips the reasoning-side LLM round-trip. The live post-w1 S1 traces proved the per-run `purpose:"classify"` exchange on local arms was the STRATEGY EVALUATOR (loop/stall detection in `iterate-pass` → `evaluateStrategySwitch`), which — unlike the runtime's opt-in tool-relevance classifier — never consulted reliability at all. Under low/skip reliability it now returns a deterministic decline (`shouldSwitch:false`) with zero LLM calls, observable via a `harness-signal` event (`strategy-switch/classifier-skip`) so `rax diagnose` shows WHY no switch was evaluated; `hooks.onStrategySwitchEvaluated` still fires. Trusted/absent reliability is byte-identical legacy behavior; callers wanting a deterministic switch already have the adjacent pre-existing `strategySwitching.fallbackStrategy` seam. Note: no shipped prior currently sets `classifierReliability` (it is derived from observations after ≥5 runs), so live behavior changes only for models whose posterior says low — which is precisely the class of models paying the saved round-trip.

feat(runtime): add `initialHistory` to `ChatEngineOptions` and `SessionOptions`, and record streamed turns when the terminal event is observed (so a consumer closing on `StreamCompleted` cannot drop the turn). Cortex chat now runs the canonical per-session ChatEngine.

feat(cortex): overhaul chat to use the canonical ChatEngine (engine-backed sessions, server-side cancellation, live tool-call chips, config parity for budget/grounding/fabricationGuard/modelRouting/outputSchema/auditRationale/skills.activate, deleted dead `useReasoning` toggle). Sync batch: config-parity coverage guard over every builder wither, skill-lifecycle strip in run view, MCP OAuth 2.1 auth config, `withHarness()` advanced control surface, minimal RAG `withDocuments` ingestion, and a decision doc excluding production-hardening withers.

Typed content parts: `ContentPart` (text, image, audio, file reference), `MessageContent` (`string | ContentPart[]`) and the helpers `contentText`, `contentParts` and `normalizeContent`. Content made only of text is canonically one string. Nothing consumes these yet; they are the shared type for multimodal messages and tool results (Plan 9 Phase 4).

git-cli, gh-cli and gws-cli keep their partial output when a command hits the 30s timeout. Before, the kill error was raised and everything the command had printed was lost. A timed-out run now returns the output gathered so far with `timedOut: true` and a `note` naming the limit (the same marker as shell-execute). `CliRunResult` gains an optional `timedOut` field.

The exit gate's decision is now final for the turn. A run the gate ended (accepted or handed off) can no longer be reopened by a later guard in the same turn. Before this fix, a run with a required tool still missing could be handed off by a controller early stop and then sent back to thinking by the required-tools guard, which threw away the handoff synthesis. A forced oracle exit now also ends the turn, the same way every other guard exit does.

Real tool failures (handler error, timeout, non-zero exit) now reach the model as `tool_result` messages marked `isError`, so the tool-failure-streak guard can fire on the kernel path. Gate refusals stay `refused` and do not count as failures. Failed results are excluded from the synthesis tool data, as `finalize` already documented.

Each built agent now owns its document store. Documents from `.withDocuments()` and `agent.ingest()` go into that agent's store, and `find` searches only it, so two agents in one process no longer see each other's documents. To share documents between agents, pass one store to each builder: `.withDocuments(docs, { store })` with `store = createDocumentStore()` (exported from `reactive-agents` and `@reactive-agents/runtime`). `agent.ingest()` now also works on agents built with only `.withTools()`, as its error message already claimed.

Wave 7.1 judgment shadow: EvalStore-shaped SQLite sink records the existing
shadow-site events with per-site agreement analytics (inversion reads
measurements here), and builds auto-enable a cheap local Ollama-backend
judgment service when reachable (keyless-safe skip, opt-out env) so shadow
sites sample without user opt-in — decisions are never consumed.

Wave 5 fold (kernel review Important 2): honest success bit for contract-outstanding terminals. A terminal whose evidence partition still names outstanding/blocked contract requirements (`metadata.outstandingCriteria`, minted by the W5.1 coverage cap) no longer maps to `success: true` on the coarse bit — the engine's partial+substantive tolerance lane is vetoed by the outstanding partition, mirroring the abstention veto. Resolved invariant: envelope-authority (success requires nothing outstanding), NOT blanket partial=>false — an uncapped partial with nothing outstanding keeps the documented tolerance behavior, `completed` unchanged. The envelope honesty markers (outstandingCriteria, budgetTerminalPartial, envelope verificationWarning) were also being dropped at the normalizeReasoningResult whitelist boundary on every pass; they are now preserved and forwarded onto AgentResult.metadata (verificationWarning: engine-boundary value still takes precedence).

GH #236: `run-started` trace events now carry the real task/prompt end-to-end. `AgentStarted` gains an optional `task` (+ `taskTruncated`) field, the execution engine stamps the run's prompt at the emission site (capped at 64KB, same publisher-side budget convention as `AgentCompleted.output`), and the trace normalizer consumes `raw.task ?? ""` (empty-string back-compat for pre-fix emitters and hand-rolled events). Fresh recordings load through `loadRecordedRun` with a faithful `RecordedRun.task`, so `replay()` orchestrates the actual prompt instead of a blank; the committed replay CI-lane golden was regenerated through the real recorder and the first-llm-exchange workaround removed.

Guard, cap and early-stop exits are now proposals to one exit gate instead of ending the run on their own. The gate accepts when nothing is outstanding, denies a soft guard once (with guidance naming what is missing) when budget remains, and otherwise runs one handoff synthesis over the evidence that returns the best answer plus an explicit `Unfinished:` list, reported as `partial`. The iteration cap stays a hard bound. Each decision emits an `exit_gate` guard event and is recorded on the terminal decision.

Required tools are no longer capped at their required count + 2 calls by default. The runtime used to derive a per-tool call budget from the required-tool set (3 calls for a required tool with no quantity), which silently dropped legitimate calls to distinct targets — a task that must read six files and write six files lost reads and writes 4–6. The runtime now passes no per-tool call budget to the kernel; identical-call loops remain caught by the repetition guard. The internal `buildAutoMaxCallsPerTool` helper (re-exported from `execution-engine.ts`, not from the package entry) is removed.

`CompletionRequest` has a new optional `toolChoice: "auto" | "required"`. `"required"` makes the response carry at least one call to a tool in `tools`, on `complete()` and `stream()`. Anthropic gets `tool_choice: { type: "any" }`, with extended thinking turned off for that call because Anthropic does not accept both. OpenAI, Groq, xAI and LiteLLM get `tool_choice: "required"`. Gemini gets `functionCallingConfig.mode: "ANY"`. Ollama uses constrained decoding: `format` is a JSON schema that only accepts a call to one of the offered tools, and the result comes back as a normal tool call. If the output does not parse, it comes back as plain text. Leaving `toolChoice` out, or setting `"auto"`, sends the same request as before. Also new: `ToolChoice` type and `isToolCallRequired()` helper exports.

Wave 7.3: all shipped SLM priors re-measured (n=5 runs, probeVersion 2;
qwen3:4b at n=10 after a bistable attention probe). Data-only change, but it
moves routing posteriors: cogito:8b parallel partial→sequential-only,
gemma4:e4b + llama3.2 dialect None→native-fc, qwen2.5-coder:7b stub
(runs:0) replaced with measured data. Each behaviorally-significant delta
was confirmed by a second measurement pass.

`rax serve` now accepts `groq` and `xai`, and `rax run` checks `GROQ_API_KEY` / `XAI_API_KEY` for them. Every command takes its provider list from the framework, so a new provider works in the CLI without a separate edit.

`.withTools({ riskLevels })` overrides any tool's risk level by name, built-ins included, for example `{ "file-read": "low" }`. The text tool-call parser binds a call embedded in prose or code (`const x = fileRead("/abs")`) only for `"low"` tools, so this lets you allow embedded calls for tools you trust. The override applies to every tool definition the agent reads during a run (built-in, custom and MCP). Maps merge across `.withTools()` calls, round-trip through `toConfig()` / `createAgent({ tools: { riskLevels } })`, and an unknown tool name logs a build warning instead of throwing.

Wave 4 control plane (4.1 + 4.6 + 4.7): ONE progress arbiter (design law #5) + evidence-based pace banding.

**4.7 — the progress arbiter.** A single pure predicate (`kernel/assessment/progress-arbiter.ts`) classifies every step / observation / output as SUBSTANTIVE vs NON-PROGRESS (framework helper, no-op, or give-up). The loop detector's no-new-evidence pattern (d) and the byte-identical repeat (a) now route through it: a `success:true` META / pseudo / no-op tool result no longer counts as progress, so the varied-args thrash (the frozen `discover-tools` ×146 false-success, `evidenceDelta:0` on every assessment) trips the guard it previously slipped past. Pattern (c) keeps its "any action resets" rule — reclassifying META actions there fired on legitimate recall/find loops.

**4.1 — pattern (e) evidence staleness + band rule.** The loop detector gains pattern (e): N iterations with `assess()` `evidenceDelta == 0` while work remains fires regardless of tool variety/args, fed from the assessment's ledger-derived `health.iterationsSinceEvidence` (no private counter). Pace banding is now evidence-based: `band: "green"` is impossible while `evidenceDelta == 0` and deterministic work is outstanding (band from evidence, not token volume).

**4.6 — evidenceDelta crediting.** `assess()` `evidenceDelta` now credits only arbiter-SUBSTANTIVE results: a success-shaped HARNESS pseudo-tool or no-op (e.g. `discover-tools` → "No tools registered.", repeated `final-answer`/`recall` no-ops) no longer defeats pattern (e).

Pinned by behavior tests against the frozen false-success fixture via the replay lane, plus synthetic unit shapes (meta thrash trips; substantive tool with new evidence does not; band and crediting arms). Detection arms only — no live-thrash-elimination claim.

**W4-live — default-on efficient termination (actuation half of 4.1/4.2).** A live user report proved detection without actuation: an impossible task (`builtins:false`, no capable tool) still cost ~4-5 iterations / ~2K tokens before abstaining, because the band rule keyed on *deterministic* outstanding (the live shape's only outstanding requirement is the non-deterministic self-answer floor, so `detOutstandingCount===0` short-circuited it to `"green"`) and the pattern-(e) actuator was horizon-gated. Three fixes, all default-on:
- **Band honesty:** `"green"` is now impossible while ANY requirement is outstanding (the answer floor included) and this iteration produced no new evidence. The live trace's `evidenceDelta:0 ∧ requirementsOutstanding:1` shape is non-green from iteration 1.
- **Zero-evidence stand-down actuator:** a real LLM trajectory (tokens spent) with NO tool call at all, no deliverable, no declared required tool, no explicit `loopDetection` override, and outstanding requirements that produces no new evidence for 2 iterations now terminates as an honest `abstained` (`sentinelDeliverable("no_substantive_output", …)`, `harnessAuthoredOutput: true`) — reusing the assessment's ledger-derived staleness signal, not a private counter. Replaces the ~5-iteration `loop_graceful` grind with a <=2-iteration honest abstention.
- **4.3 early-stop through the terminal gate:** a `controller-early-stop` (RI dispatcher flat trajectory at confidence 0) no longer ships `exit-success` when the frozen contract still has unsatisfied requirements / ungrounded required tools — it routes through `evaluateTerminalGate` coverage and refuses success.

Pins: an impossible-task trajectory abstains in <=2 iterations with a named reason; the progressing-run false-positive guard (substantive tool + new evidence) is not terminated; the band shape is non-green; the 4.3 coverage arm (unsatisfied → refusal; satisfied → still terminates). Cut arm (sever the actuator) recorded RED.

**W4-live fix (round 1) — stand-down requires a FLAIL signature; no-tool reasoning survives.** The bare staleness gate (`evidenceDelta==0` for 2 iterations) was ALSO true of a legitimate no-tool reasoning trajectory (`health.iterationsSinceEvidence` equals the iteration index whenever there are no tools), so a weak model deriving a multi-step answer was aborted mid-derivation at pass 3. The stand-down now requires a flail signature over the trailing thought window (new pure `kernel/loop/runner-helpers/flail-signature.ts`): **refusal** (reusing the canonical `isGiveUpAnswer` detector — no forked copy) **or repetition** (near-duplicate thought content, `normalizedLevenshtein > 0.85`; empty-thought loops included). A deriving run's thoughts change each pass → no signature → survives. Also: `.withLongHorizon()` (or a contract whose classified horizon is `"long"`) is now a real escape hatch that defers the stand-down; `NO_OP_MARKERS` matching is word-boundary + length-capped so a long substantive result containing a marker phrase is not misclassified. Pins added: a no-tool reasoning trajectory needing >=3 distinct passes survives (RED at the previous HEAD), and the impossible-task pin still fires; the `#206` budget-exhaustion e2e arm is restored via the long-horizon escape hatch (exact sentinel text). Cut arms (sever the actuator; sever the flail requirement) both recorded RED.

**W4-live fix (round 2) — flail precision.** Round 1's discriminator still stood down deriving runs in two demonstrable shapes. (a) REPETITION had no minimum-length guard, so terse increments (`"Step 1: …"` vs `"Step 2: …"` = 0.967 on `normalizedLevenshtein`; `"Let x …"` vs `"Let y …"` = 0.903) read as near-duplicates. It now requires both thoughts to be SUBSTANTIVE (`>= 100` chars, mirroring the sibling `contentStabilityEvaluator` at `arbitrator.ts:441`). (b) REFUSAL applied the output-shaped `isGiveUpAnswer` verbatim to intermediate thoughts, so progress narration (`"I cannot complete step 3 until I compute step 2"`) armed it. The refusal arm now composes that canonical detector with a thought-appropriateness gate: an explicit task-level / no-capability signal is required and step-scoped progress narration is excluded. Pins added (RED-first): the three terse probe pairs do not classify flailing; the step-narration thought does not arm the stand-down; the live impossible-task apology shape still arms it; the impossible-task and deriving pins stay GREEN.

**4.4 — outstanding recitation default-on.** The meta-loop computes outstanding requirements every iteration and nothing recited them, so the model never saw what remained (the live impossible-task trace repeated itself with `outstanding:1` unrecited). When a compiled RunContract exists (every run by default), `assessment.requirements.outstanding` now renders into the F10 volatile tail — the DEFAULT render profile shows the outstanding frame (`CONTRACT_PROFILE`, `showOutstanding: true`), content only. Bounded to 8 items with the existing `(+K more)` overflow marker; duplicate ids dedupe and satisfied ids are excluded. A contractless run keeps the historical `DEFAULT_PROFILE` and is byte-identical.

**4.5 — deterministic escalation.** The default strategy-switch path now walks a fixed ladder (reactive → plan-execute-reflect → reflexion) with ZERO extra LLM call (new pure `kernel/capabilities/reflect/strategy-ladder.ts`); the LLM strategy-evaluator round-trip runs ONLY for multi-candidate configs (an explicitly-supplied candidate set that is not the canonical kernel set). `availableStrategies` is populated from the REAL registered kernel strategies (`KERNEL_STRATEGY_CANDIDATES`, single source; `reactive.ts` no longer hardcodes a literal, and the kernel defaults to the canonical set). The strategy handoff reason carries the ACTUAL loop-pattern id (`pattern=a (repeated-tool-call); …`) instead of a free-text description, closing the live misdiagnosis class. `keyObservations` widened from the fixed last-5 to the requirement-relevant (evidence-bearing, non-meta/non-pseudo) slice, capped at 12.

**W4-live honesty fix — no success verdict on a harness-forced, ungrounded terminal.** The post-W4 close capture (MANIFEST §2) shipped 3/3 runs with FABRICATED success claims ("has been successfully completed" / "successfully sent … 🚀") through the RI dispatcher early-stop: zero substantive evidence (only `recall`, a META tool), an unsatisfied `answer` requirement, yet `success:true`. Root: (1) the give-up honesty gate's harness-forced-terminal set OMITTED `dispatcher-early-stop`, so the terminal-class arm never fired; and (2) the gate was fenced to `completed`, but the dispatcher early-stop leaves the kernel `thinking` → the strategy result is `partial`, which the engine maps to success when the output is substantive. Fix (reusing the existing gate, no new honesty path): `dispatcher-early-stop` is now a recognized harness-forced terminal, and the gate fires for any non-failed result (completed OR partial) with zero grounded evidence. A grounded completion and a plain answer are untouched.

**5.1 — contract coverage into the verdict (the deterministic EVIDENCE net).** Composes with the give-up gate at the terminal mint, one ordering: (1) the give-up/fabrication gate (phrasing + harness-forced terminal + zero grounding → abstained, and now scrubs a fabricated success-claim's output with the honest abstention sentinel instead of shipping the lie); (2) the contract-coverage arm — a run whose DETERMINISTIC contract requirements (requirements with a `spec.condition`) are still unmet cannot claim `completed`; the claim is capped at `partial` via the existing envelope law (`capStatusToEnvelope`), reusing the worst-of join rather than a new scorer. A grounded, requirement-satisfied run and an abstention are unaffected. Also folded in: GH #245 — a no-tool run's DERIVED value no longer hard-fails (the fabrication guard records the finding as advisory `warn` when the evidence corpus is empty and the answer is not benchmark-shaped, leaving the receipt ungrounded); the perf-claim extractor now context-gates bare timing units so derived durations in reasoning prose are not candidates.

**5.2 — completion-judgment citation (ledger-side plumbing, no inversion).** The Phase-D completion-satisfied shadow now returns its judgment-entry reference (`judgment://completion-satisfied`) when it fires; the terminal verify site stamps it on `state.meta.completionJudgmentRef`, and the terminal verdict CITES it (`verdict.judgmentRef`) when present. The judgment never inverts the verdict — this is plumbing only, per the honest-claims law (no generalization on this plan's authority). Absent a `JudgmentService`, nothing is stamped and the verdict is byte-identical.

**5.1 fix (round 1) — coverage cap exempts ledger-satisfied output requirements.** `assess()` cannot mark an `OutputContains` (`output:*`, from `outputShape.mustInclude`) requirement satisfied — it hard-falses that shape — so such a requirement is ALWAYS in the assessment's `outstanding` partition even when the answer contains the section, and the coverage cap falsely degraded a compliant answer to `partial`. The cap now intersects with the ledger path (`conditionMetByLedger`): a requirement the ledger verifies as satisfied is exempt. A run missing a required section still caps.

The reactive-intelligence early stop near the iteration cap no longer ends a run that is still producing evidence. It used to decide "spinning" from the entropy shape alone, which stopped runs at iteration 13 of 14 while they were writing a new file each pass. The kernel now passes `progressedThisPass` (the latest run assessment's `evidenceDelta > 0`) to the controller on every path; the hard `max_iterations` stop is unchanged.

The strategy terminal takes one typed input whose facts are required. `FinalizeExtras` is removed from the public exports. Custom strategies that call `finalizeStrategyResult` directly must now pass `taskId`, `requiredTools` (use `[]` to defer to the task contract), `runLedger` (use `[]` when no tool ran) and `repairCapabilities` (`{ perIteration: true }` for a kernel-backed strategy). A strategy's own delivery decision is passed as `delivery: { runContract, decision }`, so a decision can never be read without its contract.

Runtime and ui-core: a `ContextPressure` stream event (prompt tokens used and remaining per model call) so UIs can show a live context meter. Cortex chat: slash commands (`/compact`, `/clear`, `/fork`, `/rerun`, `/rewind`, `/copy`, `/rename`, `/model`, `/provider`, `/thinking`, `/skills`, `/docs`), skills queued from the `/` menu for the next message only, a context ring with a usage popover, a trace drawer, loading skeletons and entrance animations, per-message provider and model, editable compaction summaries, and fixes so a message starting with a path or typed through an IME is no longer intercepted. Cortex builder: a Thinking control (Auto, On, Off) with per-model support flags, one-click selection of an MCP server's tools, wrapped section pills, and consistent spacing and readable type; thinking is passed through to chat, Lab and gateway agents.

Structured calls now report each native attempt. `completeStructured()` leaves `attempts` (one `StructuredAttemptReport` per attempt: tokens, stop reason, thinking size, parsed or not) on the usage it sets in `StructuredUsageRef`, on success, on parse failure, and when a later attempt's provider call fails after earlier attempts ran. Stop reason comes from every adapter (Ollama `done_reason`, Anthropic `stop_reason`, OpenAI/LiteLLM `finish_reason`, Gemini raw `finishReason`); an unmapped token is reported raw instead of as `end_turn`. Thinking size comes from Ollama `message.thinking`, Anthropic `thinking` blocks and LiteLLM `reasoning_content`; OpenAI Chat Completions and Gemini (no `includeThoughts`) return no reasoning text, so they report none. New exported types: `StructuredCallUsage`, `StructuredAttemptResult`.

`.withHarness()` settings now apply inside plan-execute step kernels. Each step's ReAct pass used to resolve the harness from environment variables and defaults only, so harness switches set on the builder were silently ignored inside plan steps. An explicit per-step harness still wins.

`rax cortex --host <addr>` sets the Cortex listen address. Cortex binds 127.0.0.1 by default; `--host` (or `CORTEX_HOST`) is the explicit opt-in to expose it, which has no authentication, to the network.

Deliverable derivation no longer turns a task's input file into a write requirement. A path named as the source of the data ("every row from the batches pipeline.json lists") now counts as an input, the same as a path after a read verb, so the run contract stops telling the model to "produce" (and overwrite) its own input. Absolute deliverable paths also stay absolute in the contract: `/tmp/out/report.md` is no longer rendered as `.//tmp/out/report.md`.

Reactive Intelligence controller keeps only interventions that act (RI controller census over 966 traces, 2026-11-06).

- Removed six interventions that never changed a run: temperature-adjust (its patch never reached a model call, yet it used up the shared 5-fire budget and suppressed early-stop), context-compression (could never apply; its consumer was deleted), skill-activate and its `.agents/skills` loader (no input was ever wired), tool-inject and stall-detect (never passed their thresholds), and harness-harm (no producer). The kernel's `activate-skill` "queued" acknowledgement, which injected nothing, and the write-only verbosity detector are gone too. `ControllerDecision` is now `early-stop | switch-strategy | tool-failure-redirect`. `controller.contextCompression` still enables the controller layer but no longer has its own effect (deprecated).
- tool-failure-redirect: after its nudge, the run is early-stopped only when the model repeats an identical failing call (same tool, same arguments). Retrying with changed arguments, as the nudge asks, or a turn with no tool calls no longer ends the run.
- The controller decision log (`pulse`, handler re-fire counts) records only decisions that were applied, so a suppressed redirect no longer turns the next one into an early stop.
- switch-strategy is no longer proposed when strategy switching is disabled (the default) or exhausted; such a request used to end the run as `switching_exhausted`.
- When the near-cap early-stop stands down because the run is still producing evidence, a `GuardFiredEmitted` event (`guard: "ri-early-stop"`, `outcome: "block"`) and a `ReactiveDecision` (`early-stop-withheld`) now record it.

Ollama `stream()` now honors `maxTokens` as a hard output cap for thinking models. The stream path used to add a 6,000-token thinking allowance to `num_predict`, so qwen3:4b could stream 13,200 tokens against `maxTokens: 7200`. Ollama counts thinking tokens against `num_predict`, so the stream now stops at the requested cap, and a turn that spends the budget thinking ends with `stopReason: "max_tokens"`. `complete()` and structured output keep the allowance.

New opt-in harness switch `inputCoverage` (default OFF; `HarnessConfig.inputCoverage` or `RA_INPUT_COVERAGE=1`). When a task explicitly lists its inputs (file paths or URLs it does not ask you to write), each input becomes its own requirement. Reading one listed file no longer counts as having read them all. The exit gate lists every unread input ("read the listed input src/b.ts"), and act-or-answer counts each one as outstanding tool work. A read can be any non-write tool call that names the input, including `cat` in a shell command or a fetch of a URL under a listed API base. A failed read also settles the input, so a task whose listed file is missing can still end with an honest abstention. Tasks that list no inputs, and runs with the switch off, compile the same contract as before and send the same requests. Not applied under plan posture, in plan-step sub-kernels, or on a tool surface with no substantive tool.

`attributeFailure` no longer over-blames the model. Fixes six instrument faults from the 2026-11-06 evidence audit: a written file that passed is no longer picked as the failing target; a write or read the repetition guard replaced counts as not run; a dropped call inside a batch is no longer hidden by a sibling call of the same tool; results the projection compressed in the divergence turn count as elided; and tool-gate refusals of evidence reads count as withheld. New reasons: `harness:tool-not-offered`, `harness:refusal-counted-as-repeat`, `harness:evidence-withheld`, `harness:plan-fanout-blob`, `harness:offer-accepted-as-done`, `model:evidence-not-gathered`. `analyzeCause` flags a success with zero tool calls whose task asked for a named tool as `success-with-warning/tool-claim-without-call`.

plan-execute: a composite step now passes the tool results it observed to the steps that depend on it. Before, a dependent step got only the composite step's closing text. When plan repair ran a read step without its path as a composite step, the file content never reached the next step, so the model wrote the deliverable from a guess. A step planned as one tool call now hands on the tool's payload, just like a direct tool step. Other composite steps hand on their text followed by the tool results.

Scaffold front-door fixes (Local-Tier Reliability W0.1 + W0.2). Generated projects now pin `^<this package's own stamped version>` for `reactive-agents` instead of the stale hardcoded `^0.14.0` fallback that scaffolded projects too old to compile the template APIs. This drift is now a release error: `scripts/release.ts` fails on a reintroduced version literal, a missing scaffold stamp target, or a post-stamp version mismatch. A keyless run no longer relies on manual exports either: the generated entry (tsx/Node arm) reads `.env` via `process.loadEnvFile` in a try/catch, and a missing provider key prints a named instructive error pointing at `.env` / `.env.example` and exits 1 instead of crashing. README setup wording updated; bun's automatic `.env` load documented.

Add a `read` builtin toolset alias (`file-read`, `list-directory`, `grep`): a read-only filesystem preset for `.withTools({ builtins: ["read"] })`. Export the `BuiltinToolsetAlias` type and `isBuiltinToolsetAlias()` so callers can derive preset names from the alias table. Alias lookup now matches own keys only, so a token such as `constructor` is treated as a literal tool name instead of hitting `Object.prototype`.

Kernel fixes from the Plan 9 live H3 findings:

- Parallel batches no longer mix up tool results. A repeated read of `b.json` inside a parallel batch could be answered with `a.json`'s content. The duplicate guard paired each action with the step right after it, but a batch records `[actionA, actionB, observationA, observationB]`. Actions and observations now pair by tool-call id (`observationForAction`).
- Text-printed tool calls with a positional argument now bind. The kernel passes the text parser each tool's `requiredParams`, plus `riskLevel` when the schema has it. So `file-read /abs/a.txt` in a bash fence resolves to `file-read {path}` instead of ending at the unresolved-tool-call guard. A call embedded in code, such as `const x = fileRead("/abs/a.txt")`, binds the same way once the tool's schema carries a low `riskLevel`.
- New optional `KernelInput.seedRunContract` and `KernelInput.seedRunLedger` fields let a later kernel pass adopt the first pass's run contract and continue its run ledger. Leave both unset to keep the old behavior.

Deterministic inferred checklist progress: advisory to-do rows can now be shown as done from ledger evidence (`source: "inferred"` plus an `evidence` ref on `ChecklistUpdated` rows, new `ChecklistInferred` event, `checklist-inferred` trace event). Inferred rows render distinctly in Cortex (dashed check with an evidence tooltip) and the terminal status line (`(inferred)`); pending rows after a finished turn read "not marked done". Display-only and advisory: explicit marks win, the model's request is unchanged, and no improvement is claimed.

Cortex chat turns are easier to follow. Each turn's work now reads as numbered steps: one step per model turn, holding its thinking and the tools it called. A finished step collapses to one line (what it set out to do, which tools it used and how many times, failures, and time), and the step still running stays open. A plan-execute turn's plan appears in the turn's checklist card as a "Plan" section that advances live, and plan steps are no longer mixed into the conversation's to-do list.

Canonical chat engine: one `ChatEngine` in `packages/runtime/src/chat/engine.ts` now backs `agent.chat()`, `agent.session()`, and `GatewayChatManager`, fixing seven catalogued chat defects under existing signatures.

- New `session.runStream(message, { density?, signal? })` streams a conversational turn, records it into session history, and persists it when `persist: true`. Returns a `RunHandle`.
- `ChatEngine` is now exported from `@reactive-agents/runtime`.
- Direct-LLM path now applies the agent persona (previously dropped), windowing is on by default (40 turns / 8,000 chars), recording is symmetric across direct and tool paths, and `ChatOptions.maxIterations` is honored on the tool path (was ignored).
- Session and gateway ids are canonical (`sess_agent_*`, `sess_session_*`, `sess_gateway_*`); legacy `gateway-chat-<agentId>-<sender>` keys remain readable via fallback, and new saves switch to canonical without losing loaded turns.
- Configurable direct-path token budget via `ChatEngineOptions.maxDirectTokens` (default 4096); the previous hardcoded 1024 is gone.
- `SessionOptions.persistOnEnd` removed (documented-dead knob); use `persist` + `session.end()`.

Semantics are non-breaking for existing `agent.chat()` / `agent.session()` callers; `SessionOptions.persistOnEnd` consumers must drop the field.

`maxCallsPerTool` now holds inside a single turn. Before, the tool gate counted only calls from earlier turns, so a model that emitted several calls to the same tool in one turn could run past the cap. Calls admitted earlier in the same turn now count too. With `maxCallsPerTool: { x: 1 }`, two `x` calls in one turn run one and refuse the other. The refused call gets a `tool-gate` guard event and an answering `tool_result`, the same as a refusal across turns.

A required tool now counts as done only after a call to it succeeds. Before, the run assessment credited any call, so a failed `file-write` recorded `tool:file-write` as satisfied in the run ledger, and guards and the exit gate treated the work as done. A failed call now leaves the requirement outstanding, and a later successful call satisfies it.

`create-reactive-agent` `with-approval-gates` template now prompts the human via `node:readline` and denies when there is no TTY, instead of auto-approving every gated call. Reasoning: plan-execute no longer double-counts the LLM call of an inline step patch, and the refine-level patch now counts its call (`llmCalls` in result metadata is more accurate). Internal decomposition of `plan-execute.ts`, `event-bus.ts`, and `reactive-agent.ts` into focused modules (no API change).

When a provider rejects a request as too long for the model's context window, the agent now compacts its conversation to half the window and retries once instead of ending the run. A second failure ends the run as before. When a thinking model runs away and exhausts its output budget, the one retry now runs with thinking turned off for that call. Both decisions are recorded as `context-overflow` / `thinking-runaway` trace signals.

GH #239 — nominal stub rows can no longer arbitrate tier. `Capability` gains an optional `nominal: boolean` marker; the `test/test` bench-window static row carries it (its own comment already said "values describe the stub, not a model"). `tierFromRegistry` (W2b registry-first tiering) now refuses ANY nominal row generically, replacing the per-consumer `providerKey === "test"` name carve-out — so Wave 3b's second registry-tier consumer inherits stub-truth from the data instead of duplicating a provider-string special case. Behavior identical for every existing input (the W2b matrix arm stays green); new arms pin that a probe-registered nominal row falls to the provisional regex path while the identical unmarked row stays the arbiter.

One spend rule for structured calls, replan ref events, and a separator in tool-content text.

- Planner spend (plan-execute, blueprint, and the patch/augment replans) now uses the provider-reported usage, including the input/output split. It falls back to the chars/4 estimate only when the provider reported no usage. Before, replans were always estimated. The run budget meter still counts each structured call once.
- Patch and augment replans emit the same `guard-fired{guard:"plan-ref-normalized"}` event as a fresh plan when they rewrite a keyed `{{from_step:sN:key}}` ref. Before, they rewrote it with no event.
- When a `toolContent(...)` result mixes text and media, its observation text joins the text parts with a newline. Text split by an image no longer runs together (`[a, image, c]` gave `"ac"`, now `"a\nc"`). Text-only and plain results are unchanged.

The repetition guard no longer counts calls that never ran. A call the tool gate refused or a guard blocked was counted as a prior call, so the first real read or write of a target could be replaced by "You have already called file-read 13 times" and never execute. Prior-call counts, the distinct-target and distinct-argument carve-outs, and the last-call lookup now read only calls that executed.

Forward each tool's `riskLevel` to the reasoning kernel. The engine now projects registered tool definitions through one helper (`toKernelToolSchema`) that carries `riskLevel` when defined, so the kernel's text tool-call parser can bind embedded low-risk calls in live runs.

When a run writes its own todo list (the opt-in `todo` meta tool), output files named in its items (for example "Read notes-1.txt and write out-1.txt") become required deliverables. The run cannot finish as done until each declared file has actually been written, and the refusal names the missing files. The check reads write evidence, never the item's done/pending mark. Items that name no output file, items carried over from an earlier turn, and sub-agent items declare nothing. Runs without the `todo` tool are unchanged.

Continuing kernel passes (reflexion improve passes seeded with the run's contract and ledger) now count the run's earlier successful tool calls. A required tool that an earlier pass already ran successfully (for example `file-write`) no longer makes the terminal verifier reject the pass at `agent-took-action`, and the think-path required-tool guards no longer nudge the model to call it again. A seeded pass also takes its post-conditions from the adopted run contract instead of re-deriving them from its own improve prompt. Passes without a seed behave as before.

Chat turns that pause on a durable approval gate can now be approved, denied or dismissed from an approval card in the chat thread (or from the desk's pending approvals). The resumed reply lands in the same thread instead of a "Run paused" message, new messages wait until the paused turn is decided, and paused turns survive a server restart. New routes: `GET /api/chat/sessions/:id/approvals` and `POST /api/chat/sessions/:id/approvals/:runId/approve|deny|dismiss`.

Act-or-answer can now pick its mode per model. Set `actOrAnswer: "auto"` in `.withHarness({ ... })` (or `RA_ACT_OR_ANSWER=auto`) and each run uses the mode learned for its model: forced first request (`proactive`), forced retry after a stalled turn (`retry`), or off. With nothing learned yet, Ollama models use retry and other providers stay off. The default is unchanged (off).

Every run now counts, in any mode, the unforced turns sent while tool work was outstanding, how many of them ended without a tool call, the forced tool-call requests sent, and how many forced calls ran and succeeded. The counts are on `result.metadata.extensions.actOrAnswer`; strategies that run several kernel passes (plan-execute steps, reflexion, tree-of-thought) report the sum over all passes. Local calibration learns `actOrAnswer` from them once at least 5 runs carry them. Community profiles (`GET /v1/profiles/:modelId`) can now supply `actOrAnswer` too; the merge order is shipped prior, then community profile, then the locally learned value. A value the client does not know is dropped, not thrown. The stall rate is measured on unforced turns only: with fewer than 10 of them, the learned choice keeps its previous value, so a proactive model whose turns are all forced does not switch itself off. New reasoning exports: `resolveActOrAnswer`, `resolveRunStartHarness`, `actOrAnswerTally`, `sumActOrAnswerTally`.

`activate-skill` now loads the skill instead of acknowledging the request. It takes `{ name, file? }`: `{ name }` returns the skill body (kept through context compaction, "already loaded" on a repeat, refused with a pointer to `file` when over budget); `{ name, file }` reads one file inside that skill's directory only. `makeActivateSkillHandler` and `readSkillFile` are new exports. Removed: `activateSkillHandler` (the stub) and the `get-skill-section` tool, which `file` replaces; `parseSections` and `getSkillSection` remain as deprecated exports for one release.

Trace files no longer contain every event twice when a run is aborted or two flushes overlap. `TraceRecorder.flush` now takes the pending batch atomically before writing and cannot be interrupted mid-write; events emitted during a write stay pending for the next flush instead of being dropped.

`AgentResult.metadata.inputTokens`, `outputTokens` and `llmCalls` now come from the run spend meter, the same source as `tokensUsed` and `cost`. They count every LLM call in the run (planner, synthesis, classifier, quality gate, structured output) and include a delegated sub-agent's calls exactly once. When the provider reports the prompt/completion split, `inputTokens + outputTokens === tokensUsed`. A provider that reports totals only keeps the strategy's own split. `metadata.runBudgetSpend` on budgeted runs also carries `inputTokens`, `outputTokens` and `llmCalls`.

discover-tools no longer answers "No tools registered." when the run's permitted catalog is empty but tools are registered; it says no tools are available in this run and that tools not enabled for the run are not listed (an optional `getUnlistedToolCount` lets callers report the exact count). Host `shell-execute` now kills the whole process group on timeout, so a pipeline member holding stdout cannot keep the call open past the limit, and a timed-out result carries `timedOut: true` and a short `note`. git-cli, gh-cli, gws-cli, code-execute and docker-execute definitions now time out 2s after the handler's own kill, so the handler's result wins the race instead of a bare ToolService timeout.

`.withTools({ disclosure: "discover" })` now loads tools on demand, as documented. The first turn offers only meta tools (including `discover-tools`) and required tools. A permitted domain tool becomes visible and callable only after `discover-tools` surfaces it (or after it has been used). In this mode `allowedTools` and `builtins` bound what may be discovered and run; they no longer make tools visible up front, and the never-zero floor adds no keyword picks. Tier-default disclosure and the `all` / `index` modes are unchanged.

Plan-execute and blueprint now tell an analysis step where its output goes. When a later tool call in the plan uses the step's output through `{{from_step:<id>}}`, the step prompt names that consumer: for example "Your entire reply becomes the content of low-stock.txt … Output only that content — no file names, labels or other files." When the output fills part of a larger argument, the prompt quotes the template and says which slot it fills. Before, an analysis step saw only the overall goal and could answer all of it, so one file received the contents meant for several. Steps whose output no tool argument uses get the same prompt as before.

Images returned by a tool (for example an MCP screenshot or chart tool) now reach the model as images when the tool message carries image blocks.

- Anthropic sends them as `image` blocks inside the `tool_result` content.
- Ollama sends them in the tool message `images` array (unchanged from the previous release).
- OpenAI and LiteLLM tool messages accept text only, and Gemini uses the same approach. These providers move each tool-result image to one user message placed right after the run of tool messages. The user message is labeled `Image output of tool "<name>" (call <id>):`. The tool message keeps a marker where the image was, for example `[image: image/png, 41 KB; attached in the next user message]`.

An image still becomes a text note, and logs a `content-part-degraded` warning, when it cannot be sent. This happens when the model has no image input, and for URL images on Anthropic, Ollama and Gemini, which take inline base64 only. On Anthropic, the same rules now also apply to images in user messages: a URL image or an image sent to a text-only model becomes a note instead of a malformed request. Text-only requests send exactly the same bytes as before.

New Cortex chats keep the `recall` meta-tool on, so the agent can read back the rest of a large tool result instead of losing it. `recall` retrieves results stored during the current run; it is not cross-run memory, which stays off for chats. Chats created earlier keep their saved setting.

Fixed: the chat turn inspector's Run trace **Timeline** view was always empty ("Reasoning 0, LLM calls 0, Tools 0 … No events match the active filters"), even when the Frames view showed the run's loops. The chat trace only fed frames to the trace panel. It now also builds the timeline from the same tracer JSONL, with LLM calls, tool calls, guards, verifier verdicts, the model's text and the final answer grouped by iteration. Each run header in the inspector (main run and sub-agents) now links to that run's page in the run view.

Strategy switching is now opt-in. Before this release it was on unless you passed `enableStrategySwitching: false`. Now it is off unless you pass `.withReasoning({ enableStrategySwitching: true })` (or `reasoning.enableStrategySwitching: true` in an agent config). `.withLeanHarness()` still turns it off when it is set.

Why: the 2026-11-05 lift-gate ablation (`wiki/Research/Ablations/2026-11-05-strategy-switching-ablation.md`) found no measurable accuracy lift. The change was -6.2pp, which is inside the noise. Switching added 28.1% more billed tokens overall and 41% more on rw-7, above the 15% overhead cap. None of the 14 runs that switched in the k=8 follow-up solved its task. The gate verdict was OPT-IN.

The `strategy-switching` CapabilityRegistry entry is now `defaultOn: false` and records this evidence, so `agent.capabilities.audit()` reports no violations. `HarnessProfile.balanced()` no longer includes strategy switching. When progress is flat, the console exporter now suggests a different `defaultStrategy` or a more capable model instead of turning on switching.

`file-write` now saves a `.json` file whose only defect is unescaped double quotes inside string values, for example `{"q": "What is the "component model"?"}`, instead of refusing it. The healing pipeline's value-shape stage inserts a backslash before each inner quote and changes nothing else. It accepts the repair only when the result parses, removing the backslashes gives back the original text, the keys match the keys visible in the original text, and exactly one set of escapes parses. The repair is recorded as a `value-shape` healing action (`content:invalid-json` to `content:json-quotes-escaped(N)`). Any other invalid JSON (trailing commas, prose, truncation, ambiguous quotes) is still refused with the same message as before. Replayed on the benchmark cohorts, 34 of 45 refused `.json` writes now parse, in 17 of 22 runs.

The tools package now has one JSON repair primitive, `healing/json-repair.ts`. The lenient repair used for tool-call arguments in assistant text moved there, with no change in behavior. New exports: `repairJsonQuotes`, `repairJsonLenient`, `isJsonFilePath`, `JSON_FILE_EXTENSIONS`, and the types `JsonRepairResult`, `JsonRepairEdit`, `JsonRepairRefusal`.

GH temp-threading (Wave-4 measurement integrity): a commanded `.withModel({ temperature })` now reaches the LLM request verbatim on the KERNEL routes (reactive + direct), command-first: `config.temperature ?? config.contextProfile?.temperature`, threaded through the ReasoningExecuteRequest, the reactive strategy's KernelInput mapping, and the verification think-retry seam. Previously all three dropped the command, so `think.ts` always stamped the tier-profile temperature (local 0.3 / mid 0.5) and every "temp 0" capture actually sampled at the tier default. An unset command keeps today's behavior (tier/profile default, then strategy-config temperature) exactly. Scope honesty: reflexion, tree-of-thought, plan-execute step-executor, and code-action hard-code temperatures on their internal LLM calls, and blueprint/adaptive's internal calls likewise ignore the command; broader threading is tracked in GH #246.

Every assistant turn now passes through one boundary that records which parts of the reply were consumed as tool calls. Final answers and fallback deliveries read only the unconsumed text, so a tool call the model printed (and the harness already ran) is no longer shipped as the answer. An earlier code block is prepended to a short final answer only when the run contract expects code. Each non-prose turn emits a `tool_call_extracted` guard event.

plan-execute: a plan step whose direct tool call fails (unknown tool, missing argument, tool error) is now recorded as a failed step and the run ends `partial` (the delivery verdict may still lift it), instead of counting the error text as a completed step. A planned `tool_call` step that lacks a required argument (per the tool's schema) now runs as a composite step scoped to that tool, so the model fills the argument instead of the harness dispatching a call that can only fail.

Truthful local-tier adapter guidance. After a tool argument error (missing parameter, wrong type, invalid input), `errorRecovery` now tells the model to fix the arguments and call the same tool again, naming the failing parameter when the error states it. Previously it told the model to "use a different tool to get the information". Only errors that say the tool cannot do the request suggest another tool. `synthesisPrompt` no longer orders "That is enough. Do NOT search again." It states how many results were gathered and asks the model to call the output tool if they cover the task. The same fix covers three more texts. The local `continuationHint` after a search no longer says "Do NOT search again". The local single-tool hint no longer claims "You have all the information you need". The mid and default `synthesisPrompt` no longer claim "Research complete": they say only output tools remain required and ask the model to call the output tool if the results cover the task.

Recall instructions render only when `recall` is on the model's tool surface. This covers the overflow-preview hint, the history-compaction stub and the duplicate-gather nudge. When recall is not offered, the compaction stub names the stored keys without claiming they can be retrieved, and the dedup nudge points at the result the model already has. The code-execute failure text no longer suggests a keyless `recall()`. When the compaction stub does list recall pointers, the recall-overflow gate now treats it like a truncated tool result and keeps recall callable.

A think call made with tools withheld no longer tells the model to call a tool. After two unparseable tool-call replies the next request has no tool schemas, but its `Guidance:` block still carried "REQUIRED tools not yet called … Call these" and the stall nudge ("Required tool quota not met … Continue calling"). The stall nudge also replaced the plain-text instruction, so the model never saw it. That turn now renders only the plain-text instruction, the fact about the last call, and the environment notice. Live verdict: 16 of 18 withheld turns showed a "call X" steer, and 2 runs ended at strike 3.

Probe-version staleness gate on the capability store (qwen3.5 user bug, 2026-10-13). `Capability` gains an optional `probeVersion`; the Ollama probe stamps it with `CURRENT_PROBE_VERSION` (2; rows from the pre-stub-guard era carry none = v1). The store's read choke (`getCapabilityStore`, used by both the probe path and the provider's capabilities()) now reports any persisted `source:"probe"` row whose probeVersion is absent or non-current as a MISS — driving a live re-probe whose write-through self-heals the file (no deletes, no TTL). Motivation: a stale `toolTemplateEmitsTokens:false` row (measured off qwen3.5's 13-char plugin-stub template by a probe predating the #243 stub guard) permanently pinned the native-capable model (live-verified 2/2 parsed tool_calls) onto text-parse. Same discipline as #243's calibration-prior versioning: persisted measurement data stops being trusted when the producer evolves. Injected stores (CalibrationStore) pass through the same gate.

shell-execute now describes its real environment to the model. New `shellExecuteToolFor(config, { runWorkspace })` builds the tool definition from the resolved shell config: where commands run (the run's workspace directory, a configured cwd, a private temp directory under /tmp, or a throwaway Docker container), the allowed commands including opt-ins, the opt-in commands that are not enabled, Docker escalation for inline interpreter code, and the path confinement the handler enforces. Before, the description always said "sandboxed /tmp directory", even when the shell ran in a host workspace. `shellExecuteTool` remains as the default-mode definition.

Harness guidance no longer loses earlier hints. Before this, several harness steps (the required-tools steer, loop and stall recovery, the oracle nudge, the act phase and the think-phase guards) replaced the whole pending guidance record. Whichever ran last won, and the model could lose the hint that explained its last failure, such as "file-read is not enabled for this run". Each step now sets only its own kind of guidance and keeps the rest. A source-level check fails the test suite if any code outside the guidance channel replaces the record. The required-tools steer is no longer sent on a turn where tools are withheld, where "Now call X" contradicted the instruction to answer in prose. When the model prints a call to a known tool that cannot be parsed, the resolver's reparse hint ("Your tool call could not be parsed: ... Call web-search(query) natively ...") now reaches the model on its next turn. Before, that hint was kept only in the run's internal steps.

The assistant-text tool-call parser now reads a whole line of the form `tool-name {json}`, which is the form the embedded-call refusal hint tells the model to use. Before, a model that copied the hint got no tool call and the run looped.

A plan-execute run whose named files all verified no longer ends `partial` just because one plan step's own reasoning loop ended partial for no stated reason (for example, a write that failed once and then succeeded on retry). Steps are exempt from the plan's files, so the plan-level delivery check decides. A step that stopped on budget, abstained, failed, carried a verification warning or returned harness-written output still caps the plan. The decision is recorded as `statusCap` on the `terminal_decision` trace event.

Type tightening, no behavior change. `ReactiveAgent.runtime` is now `ManagedRuntime<unknown, never>` (was `<any, never>`): effects run through it must be requirement-free, which the unsound `any` previously let slip past the compiler. Engine tool definitions (`cachedToolDefs`) are now typed `ToolDefinition`. `@reactive-agents/core`: the `AgentEvent` union is split into domain sub-unions under `types/events/`; `services/event-bus` still re-exports every type, so imports are unchanged.

An answer that ends by asking permission to go on ("Would you like me to proceed with fixing the remaining modules?", "Shall I continue?") is now treated as a continuation, not a delivered answer: the exit gate asks the model once to write the final answer, and the verifier's `output-not-continuation-intent` check rejects it. A trailing courtesy line does not hide the offer. Offers of something extra on finished work ("Would you like me to provide more details?") still count as answers.

Template paths in a task (for example "write out-N.txt for each item", `{i}`, `<n>`) no longer compile into a literal deliverable, so runs that did the work are no longer failed for a file that can never exist.

GH #246 (Wave-4 measurement integrity, remainder): a commanded `.withModel({ temperature })` now reaches the LLM request verbatim on every remaining strategy, command-first (`input.temperature ?? <pass default>`). Threaded through reflexion (generate / synthesis-backfill / improve kernel passes), tree-of-thought (BFS-skip, expansion, phase-2 execute), plan-execute (plan, rationale-retry, single-analysis generation, synthesis, per-step analysis + sub-kernel via a new `StepExecutorInput.temperature`, patch/augment recovery via new `PatchInput`/`AugmentInput.temperature`), blueprint (plan, solve, worker inline analysis via new `BlueprintWorkerContext.temperature`), code-action (plan, repair/retry via new `CodeActionInput.temperature`), and the adaptive LLM classifier (dispatch already forwarded via `...input`). Unset commands keep today's per-pass defaults exactly. Intentionally fixed: tree-of-thought candidate scoring (0.2), reflexion/plan-execute critique-reflect passes (runCritiquePass 0.3) — determinism-sensitive judgments, not generation.
Follow-up: blueprint patch-retry (`patchPlan` recovery) threads the commanded
temperature too (generation seam, previously falling back to 0.3).

Sub-agents now run under the parent's `.withTools({ maxCallsPerTool })` caps. Before this, a delegated child dropped them and could call a capped tool as often as it liked. A child started with `spawn-agent` gets the parent's caps as they are. The model writes the spawn arguments, so it cannot loosen them. A `.withAgentTool()` sub-agent can set its own `maxCallsPerTool`. Its map is merged over the parent's, and its cap wins for the same tool name. A cap that is not a positive integer makes `.withAgentTool()` throw `ToolsOptionError`, the same as `.withTools()`. `createLightRuntime` accepts `maxCallsPerTool` too.

Media summaries and the inline-media redaction rule now live in `@reactive-agents/core`: `summarizePart`, `summarizeParts`, `summarizeWireContent`, `summarizeMediaSource`, `base64DecodedBytes`, `isInlineMediaPart`, `inlineMediaStub` and `redactInlineMedia` (inline base64 image/audio parts become a text stub with kind, MIME type, decoded size and sha256 prefix; URL media, file refs and audio transcripts are kept). The helpers are browser-safe (no `node:` imports). Reasoning's checkpoint codec, trace summaries and `llm-exchange` parts use the core versions; checkpoint output is unchanged.

`maxCallsPerTool` is now counted once per run. The kernel tool gate and the direct-dispatch budget (plan `tool_call` steps, code-action's sandbox bridge) share one count, so a run with several kernel passes cannot go over a cap. Before this, each kernel pass that did not continue an earlier pass started its count at zero. Examples are plan-execute composite steps, a strategy switch and a second strategy run. A 1-call cap then allowed one call per pass. A call now uses the cap when the gate admits it, not only when it succeeds. A sub-agent's run keeps its own count. A strategy function called directly, without `ReasoningService`, now opens its own run scope, so its passes share one run state.

After two unresolvable tool-call replies, tools are now withheld for exactly one think call. Once the model answers that call in prose, the next call offers tools again. Before, the withhold lasted until a tool call succeeded, which could never happen with no tools offered, so the run abstained.

When `code-execute` refuses a shell command, the agent is no longer told to "fix the code". The observation says the command did not run and points to `shell-execute` only when the run offers it; otherwise it says no shell tool is available.

Reflexion's improve passes now continue the run instead of starting over. Each improve pass adopts the run contract the first pass compiled and starts from the run ledger so far. Before, every improve pass compiled its own contract from the harness's improve prompt, which invented requirements the task never asked for (a `create-ticket` action, a malformed `artifact:.//tmp/...` path). It also judged only its own ledger, so a file the first pass already wrote stayed outstanding.

`code-execute` now refuses shell input such as `bun test`, `npm run build`, `ls -la` or `cd src && bun test` before running anything. It returns `{ executed: false, shellCommand: true, error }`, and the error says that the input is a shell command, that code-execute runs JavaScript/TypeScript with Bun and does not run shell commands, and that nothing was executed. Before, the input ran as JavaScript, failed with a syntax or reference error, and the reply told the model to fix its code. The tool does not name a shell tool, because only the caller knows whether one is offered in the run. New export from the module: `isShellInput`.

The terminal gate now checks every file the task names, not only the first. A run that writes 2 of 3 named files is refused with guidance naming the missing file; if it still ends, the outcome names it. Deliverables carry a typed `source` (`task-explicit` today) through one builder.

Tool parameters now keep every field inside the reasoning kernel. `ToolParamSchema` is derived from the tools package's `ToolParameter`, and the function-calling wire schema is built with `toParameterJsonSchema`. The healing pipeline (kernel act and plan-execute/blueprint steps) receives whole schemas, so a `semantic: "file-content"` parameter reaches the value-shape stage. code-action tool bindings now show `enum` choices as string-literal unions. Before this change, each projection copied parameters field by field and silently dropped new fields.

`shell-execute` no longer points `HOME` and `TMPDIR` at a caller-supplied working directory. When the shell runs in a workspace, each call gets a fresh scratch directory outside it (removed when the call ends), so `~`, dotfiles such as `.gitconfig`, and tool caches never land in your project. `HOME` is still never your real home directory. Without a `cwd`, the shell's own throwaway sandbox remains `HOME`, as before.

Meta-tool stores are now run-scoped. The scratchpad (`recall`), checkpoint and discovered-tools stores used to be single process-wide values shared by every agent and run, so `recall` could return another run's tool results and concurrent runs raced. Each reasoning run now gets fresh stores (`withRunToolStores`, applied at `ReasoningService.execute`); sub-agents get their own. New exports from `@reactive-agents/tools`: `withRunToolStores`, `makeRunToolStores`, `RunToolStoresRef`, `currentRunToolStores`, `currentScratchpadStore`, `currentCheckpointStore`, `currentDiscoveredToolsStore`, `defaultRunToolStores`. `scratchpadStoreRef`, `checkpointStoreRef` and `discoveredToolsStoreRef` are deprecated aliases of the default (un-wrapped) stores.

GH #206: honest abstention synthesis on effort exhaustion. A run that stops after effort (iteration/tool budget exhausted, or its terminal was rejected) with no verified answer now ships a deterministic, harness-authored abstention naming what was attempted (tool calls / successes) instead of empty output. `success` stays false; infrastructure faults (`llm_error`/`kernel_error`) are excluded so their real cause is never masked. New canonical sentinel reason `budget_exhausted_no_output`.

`rax-diagnose cause`: aborted runs are labelled from `run-aborted.reason` (`timeout`, `user-stop`, `aborted/<reason>`) instead of generic `incomplete-trace`; `llm-direct.jsonl` direct-chat traces return `direct-chat` and are excluded from cohort totals; successes accepted via `advisory-softfail` or with failed verifier checks are `success-with-warning` instead of `none`; `run-completed.status` contradicting `outcome.success`/`outcome.status` is `terminal-mislabel`; provider sub-class reads `outcome.errorClass` (text regex stays as legacy fallback).

Provider failures now carry a typed classification: `LLMError`, `LLMRateLimitError` and `LLMContextOverflowError` gain optional `errorClass` (`rate_limit | context_overflow | request_too_large | invalid_param | tool_schema_invalid | auth | model_not_found | timeout | network | provider_5xx | content_filter | unknown`), `retryable` and `status`, set at the single provider error-mapping choke point (`classifyProviderError` is exported). Context-overflow and request-too-large failures (400/413 shapes) are now returned as `LLMContextOverflowError` (previously a generic `LLMError`); they are still not retried. Classification only — no retry or recovery behavior changed.

Plan-execute runs now record the tool calls their composite steps make. A composite step runs its own reasoning loop, and before this its tool calls (for example a `file-write`) were missing from `result.metadata.runLedger`, so tool-usage and deliverable receipts did not show them.

Images in messages now reach OpenAI, LiteLLM, Ollama and Gemini models. Before, these providers silently dropped image blocks. Now OpenAI and LiteLLM send them as `image_url` parts, Ollama sends them in the message `images` array, and Gemini sends them as `inlineData`. Anthropic is unchanged.

If a provider or model cannot take an image, the image becomes a short text note instead of disappearing, for example `[image omitted: image/png, 41 KB; model has no image input]`. Each such note also logs a `content-part-degraded` warning with the provider, model, media type, size, role and reason. This happens for models with no vision support in a probe or static capability row, for URL images on Ollama and Gemini, and for images in tool results or assistant turns where the provider has no slot for them.

`ProviderCapabilities` gains an optional `inputModalities` field. The text and image `ContentBlock` variants are now derived from core `TextPart` and `ImagePart`, and `isImageSource` narrows a core `MediaSource` to a wire image source. Tool-role messages accept text and image blocks as well as a string. Trace and replay flattening (`messageContentToString`) renders an image as `[image:<media_type>:<sha256-12>]` instead of an empty string, so two requests that differ only in an image no longer get the same replay key. Text-only requests send exactly the same bytes as before.

The background debrief's LLM call is now attributed to the run: its `LLMRequestCompleted` event carries the run's taskId instead of `llm-direct`. Its spend (input, output, total tokens, cost and `calls`) is readable after the run from `result.debriefRich()` and the run's `DebriefCompleted` event (`debrief.metrics.synthesisTokens`, now declared on the core event type). `tokensUsed` and `llmCalls` count the run up to its result; the run's full billed spend is `tokensUsed + synthesisTokens.total`. The debrief still runs in the background, so results are not delayed.

Plan-execute now recovers once when its plan declares the goal met but a file the task names was never written. The harness adds the missing deliverables to the refinement prompt and runs one more plan pass. If the file is still missing, the run ends `partial` and its answer ends with a harness-written `Unfinished:` list naming what is outstanding. The decision is traced as guard `strategy_delivery_gate` (`block` on the repair, `terminate` on the handoff).

Docker sandbox containers no longer outlive their tool call. Previously a timeout or a cancelled run could leave `rax-sandbox-*` containers behind. A timeout that fired while `docker run` was still creating the container left a never-started container in `Created` state, which `--rm` does not remove. A cancelled `shell-execute`/`code-execute` call also never reached the running container.

Sandbox runs are now two-phase: `docker create`, then `docker start -a`. A forced `docker rm -f` runs on success, failure, timeout and fiber interruption. Tool-call cancellation now propagates into the sandbox. `--rm` is always set: `DockerSandboxConfig.autoRemove` is deprecated and ignored. Every container carries `rax.sandbox=1`, `rax.sandbox.owner` and `rax.sandbox.deadline` labels. A best-effort background reaper removes stale labeled containers (exited, or past their deadline plus 60s) left by crashed processes. It never touches unlabeled containers.

`SkillResolverService.resolve()` now returns `activatable`, a map from skill name to what `activate-skill` needs to load that skill: `body`, `sha256` (of the body), `version` and `source`. A filesystem skill also carries its directory (`dir`) and its bundled `resources`. A learned or promoted skill from the skill store carries its stored instructions as the body and no directory, so `file` reads for it are refused. The map has exactly the same names as `catalog`, because one function (`buildSkillCatalog`, now exported) builds both. Before this, learned and promoted skills were listed in `<available_skills>` but could not be activated. New exports: `buildSkillCatalog` and the type `ActivatableSkill`.

Removed: `injectSkill`, `SKILL_TIER_BUDGETS`, `sortByEvictionPriority`, `isSkillContent`, `extractSkillNames` and the type `InjectionResult`. Nothing in the framework called them; skills are now loaded with `activate-skill`. Also removed: the `catalogOnlyHint` option of `generateCatalogXml`, which was already ignored.

OpenAI: every `gpt-5*` and `o<digit>` model id now sends `max_completion_tokens` (previously only ids listed in the static capability table did, so `gpt-5-mini` and any live-discovered or dated id failed with `400 Unsupported parameter: 'max_tokens'`). These models also reject a non-default `temperature`, so it is omitted for them. groq, xai and litellm are unchanged.

Cortex chat gains user-started `/goal` (propose, accept, pause/resume/cancel/status over a pure goal supervisor), `/plan`, `/loop` and `/schedule`, plus prompt/provider/model chips, a document-failures banner, a per-session URL document cache, and run hierarchy keyed by each run's own `contextRunId`. `@reactive-agents/runtime` exports the goal supervisor; `AgentStarted`/`AgentCompleted` now carry the run's `runId`; a failed child's cost is folded into the parent's cost like a successful one.

Goals change no default and add no model-visible prompt outside a goal the user starts, so no ablation applies. Nothing here is claimed to improve results. A goal verdict of `null` means "not yet decided".

When the kernel withholds tools for one think call (after repeated tool-call text that could not be executed), the outstanding-requirements block in that turn no longer tells the model to "call the `X` tool". It lists the unmet requirement ids under "Requirements not yet satisfied:" with no call directive and no phase steer, so it agrees with the plain-text instruction and the empty tool list.

New trace event `eval-graded` carries a deterministic grader's verdict (score, passed, checks). `rax-diagnose cause` labels a run that ended cleanly but failed its grade as `wrong-answer`, naming the failed checks.

The status renderer prints "⏸ Paused" instead of "✗ Failed" for a run paused at an approval gate or pending interaction. The `completion` log event has an optional `paused` field.

Measurement-only trace fields: `run-started.config` now records the resolved harness configuration (`{ mechanisms, builder, env }`, secret-free and size-bounded) and `run-started.origin` records the caller (`user | gateway | cortex-chat | cortex-utility | subagent | scheduled | eval`; new optional `origin` option on `agent.run()` / `runStream()`). A run that ends by failure, crash or interrupt without `run-completed` now leaves a `run-aborted` sentinel (new core `AgentAborted` event, new trace kind). No behavior change.

Wave 2a — capability probe ladder + derived tool-calling claim.

`Capability` gains two optional probe-ladder fields: `parameterSizeBillions` (parsed from Ollama /api/show `details.parameter_size`, decimals supported: "1.7B" → 1.7) and `toolTemplateEmitsTokens` (tri-state chat-template tool-token emission scan: true/false = measured, undefined = never measured). The deferred S2.4 CalibrationStore write-through lands as `capability-store.ts`: probe results persist per (provider, model) under `~/.reactive-agents/capabilities/`, re-validated through `CapabilitySchema` on read (corrupt rows fall through to a fresh probe); the process-Map probe cache collapses onto the store (memory → store → live probe, write-through to both), and a duck-typed store (e.g. a `CalibrationStore`) can be injected via `setCapabilityStore()` without a reactive-intelligence dependency. The Ollama thinking-probe cache now reads off the same store-backed Capability record instead of re-querying /api/show.

The Ollama `capabilities()` endpoint's `supportsToolCalling` is DERIVED, not constant: template emission ∧ dialect posterior, fail-safe ordered — unmeasured models stay permissive (true, provisional-marked), a measured no-emission template is a strict false (cogito/qwen3-class "advertises tools, template drops them" lie detector).

Tier budgets fixed for D-2026-07-30-H: `CONTEXT_PROFILES.local.toolResultMaxChars` 4000 → 1200 (local ≤ mid) with the `core` mirror `TIER_TOOL_RESULT_PRESERVE` moved in lockstep, guarded by a new whole-table monotone-budget ratchet test.

Review round 1 (2026-10-13): template-emission scan also recognizes `function_call`/`.FunctionCall` (old ChatML/OpenAI-era templates in converted GGUF builds no longer measure a stranding false); store rows are endpoint-scoped (`(provider, model, baseUrl)` key — two Ollama servers publishing the same tag can never cross-serve; legacy baseUrl-less rows are a miss and self-heal); `REACTIVE_AGENTS_CAPABILITY_STORE_DISABLE=1` skips all store reads/writes (in-memory only) as the cross-suite test-contamination seam; store keys sanitized against path escape and writes made atomic (tmp+rename).

Wave 2b — registry-first tiering (plan 2.1, design law #1: ONE capability arbiter). `resolveProfileWithWindow` (the builder's auto-resolution seam) now tiers by the Capability registry — static-table row OR probe row, including cross-process persisted rows re-injected by the builder's `primeCapability` step — BEFORE any model-name regex; the Ollama `/(\d+)b/` size-regex branch in `tierFromModelName` is DELETED, killing its two misclassification classes by removal (any >=4B Ollama tag was forced to `mid` regardless of the registry row — `qwen3:4b → mid` while the arbiter says `local`; and `qwen3:1.7b` matched the substring "7b"). Consequence: builder-constructed local-model agents run local-tier guard budgets/thresholds (per the W2a ladder, local and mid budgets are largely equal — `toolResultMaxChars` 1200 == mid — so the behavioral delta is prompt/tier-adaptive variants, not compression starvation). Registry-miss resolutions (unknown tags, provider-less model strings) fall to the provisional name-regex path and are marked on the returned profile as `provisionalTier: true` — a new optional `ContextProfile` field telling consumers (Wave 3 driver routing) the tier is an UNVERIFIED name guess, not an arbiter verdict; `resolveProfile` itself keeps its pure name-regex semantics for internal callers. The nominal `test/test` static row is carved out of tiering (its own declaration: values describe the stub, not a model). Non-Ollama regex classification (cloud provider patterns, global size hints) is byte-unchanged. Classification matrix pinned in `tests/context/registry-first-tiering.test.ts`.

Cortex utility prompts (chat titles, compaction summaries, goal rubric checks) now run the one-turn `direct` strategy capped at one iteration instead of a full reactive run.

`maxCallsPerTool` (`.withTools({ maxCallsPerTool })`) now holds on every strategy, not only `reactive` and `adaptive`. Before this, `plan-execute-reflect`, `tree-of-thought`, `reflexion`, `blueprint` and `code-action` ignored the cap. The caps now travel on the run envelope (`RunEnvelope.rails.maxCallsPerTool`), so each kernel pass refuses the extra call. Tool calls made outside a kernel are also capped: `tool_call` plan steps in plan-execute and blueprint, and tool calls from code-action's generated code. A refused call is not run. It is answered with "`<tool>` was not run: its per-tool call budget is used up …" and emits a `guard-fired` event with `guard: "tool-gate"`. Strategies no longer take `maxCallsPerTool` as their own input field. Pass it to `ReasoningService.execute` or put it on the envelope.

One spelling for a non-text part shown as text. New core exports `mediaPartLabel(part, why?)` / `mediaLabel(facts, why?)` produce `[<kind>: <media_type>, <size or name>]`, or with a reason `[<kind> omitted: <media_type>, <size or name>; <why>]`, with an audio transcript last (`; transcript: <t>`). Core also exports `sha256Hex`. Text-only runs are byte-identical; only media runs see changed wording:

- Reasoning provider-boundary stubs (`toLLMMessages`): images, audio and files now carry a size or location, and audio keeps its reason next to the transcript. Example: `[image omitted: image/tiff; unsupported image type]` is now `[image omitted: image/tiff, 1 KB; unsupported image type]`, `[audio omitted: audio/wav; transcript: hello]` is now `[audio omitted: audio/wav, 1 KB; no provider input for this part yet; transcript: hello]`, and `[file: report.pdf (application/pdf) at file:///w/report.pdf]` is now `[file omitted: application/pdf, report.pdf at file:///w/report.pdf; no provider input for this part yet]`.
- Tools `toolContentText` / `JSON.stringify(toolContent(...))` markers: `[image: image/png]` is now `[image: image/png, 1 KB]`, `[audio: audio/wav] hello` is now `[audio: audio/wav, 1 KB; transcript: hello]`, and `[file: doc.pdf (application/pdf) https://x/doc.pdf]` is now `[file: application/pdf, doc.pdf at https://x/doc.pdf]`.
- llm-provider degraded-image stubs (`[image omitted: image/png, 41 KB; model has no image input]`) are unchanged; they now come from the core helper. The record stub (`inlineMediaStub`) and replay placeholder (`mediaPlaceholder`) are unchanged.

Structured-output LLM calls (planners, classifiers) now report their token usage on `LLMRequestCompleted` instead of 0, and the run spend meter also tracks input tokens, output tokens and LLM-call count for every call.

Failure-recovery steering only names an alternate tool when that tool can substitute for the failed one: the same kind of work (read, write, execute) on the same kind of target (web, file, or the same service). The model no longer reads "file-read failed. Try an alternate path now: file-write". With no substitute available, the steer asks the model to retry the failed tool with corrected arguments.

`.withTools()` gains explicit tool control. No default changes.

- **`disclosure: "all" | "index" | "discover"`** sets how the permitted tools are shown to the model. It never changes which tools are permitted. `"all"` sends every permitted schema on every turn. `"index"` and `"discover"` use today's pruned modes. Precedence, highest first: `.withTools({ disclosure })`, then the deprecated `.withHarness({ lazyDisclosure, toolDiscovery, toolIndex })` switches, then the `RA_LAZY_TOOLS` / `RA_TOOL_DISCOVERY` / `RA_TOOL_INDEX` env flags, then `contextProfile.toolDisclosureMode`, then the tier default. Every run records the resolved mode and the layer that set it on `run-started.config.disclosure` (`{ mode, source }`). With `disclosure` unset, a run behaves exactly as before.
- **`builtins: "<name>"`** is now accepted as shorthand for `builtins: ["<name>"]`, and both forms give the same permitted set. A name is a toolset from `BUILTIN_TOOLSET_ALIASES` in `@reactive-agents/tools` (for example `"research"` or `"web"`), `"all"`, or a built-in tool name. A single name that matches none of these throws `ToolsOptionError`. Array entries behave as before. To keep file tools inside one directory, set `workspace:` (for example `{ builtins: "read", workspace: "./project" }`).
- **Build notice.** `build()` now logs one warning when a tools-enabled agent ends up with zero capability tools. The warning names the toolsets that would fix it.
- **Docs fix.** The JSDoc no longer says that built-ins you have not opted in stay "callable by name" or discoverable. They are not listed, not discoverable and not callable. The JSDoc for `adaptive` now states that the relevance classifier permits the built-ins it marks relevant.

A run that switches strategy now reports the tokens, cost and LLM calls spent before the switch. The switch rebuilt kernel state with zeroed spend, so switched runs under-reported usage (one measured run reported 11,195 tokens against 20,144 billed). The LLM-call cap also now applies across the whole run, as the iteration cap already did.

Chat sessions can tell the model what changed in its environment between turns (model, thinking, tools, skills, docs, goal, agent-control, user to-do edits). `session()` accepts `environment`, `publishEnvironment`, `initialEnvironment` and `environmentUpdates`; a change publishes one core `EnvironmentChanged` event, mapped to a new `environment-updated` trace event. The notice is attached only on turns where something changed; unchanged turns send identical requests. `environmentUpdates: false` disables it. Cortex chat wires it by default (session config key `environmentUpdates`). Informational only; no answer-quality improvement is claimed.

Ollama `completeStructured()` now defaults thinking off. When neither `request.thinking` nor `LLMConfig.thinking` is set, thinking-capable models (qwen3 family) get `think: false` and `num_predict` equals the caller's `maxTokens`. Before this change, no `think` param was sent and the cap was widened by the 6,000-token thinking allowance. In an H3 recheck, qwen3:4b planner calls emitted up to 13,855 tokens for a plan JSON of about 200-500 tokens. This matches the cloud providers, whose structured paths reserve thinking only on explicit opt-in. To keep thinking, set `thinking: true` on the request or in the config: you get `think: true` plus the allowance, as with `complete()`. A debug log, `structured-thinking-suppressed`, fires when the default turns thinking off. Non-thinking models are unaffected. The thinking helpers moved from `providers/local.ts` to `providers/ollama-thinking.ts`, and `local.ts` still re-exports them.

`discover-tools` now also loads the other tools the task needs. A query answer lists up to 4 extra task-relevant tools under "Also needed for this task (now callable)", ranked by the kernel's task-relevance scorer, so a task that needs two capabilities no longer depends on the model querying for each one. `recall` is no longer offered until a tool that can store a result has run, so models stop spending early turns on a recall that has nothing to return. Required tools are never hidden by these rules.

Cortex chat gets a quick bar for the settings you change most: strategy, tools, shell, workspace and the per-turn step cap sit next to provider and model, each one click (or `/strategy`, `/tools`, `/terminal`, `/workspace`, `/iterations`) away. The tools picker toggles built-in toolsets (research, web, file, code, git, workspace), single tools, MCP servers, or copies a saved agent's toolset, and the current toolset is always shown.

Set a workspace (an absolute, existing directory) on a chat, run or saved agent: file tools work inside it and the shell runs in it, so the shell no longer refuses to start outside /tmp. Cortex checks the path when you set it and refuses one that does not exist.

The builder panel adds shell options (Docker sandbox, shell directory, timeout, output cap, command groups, allow a directory outside the workspace), real guardrail switches (prompt injection, PII, toxicity) with a blocked-phrases list in place of the sliders that had no effect, and the approval mode for approval-gated tools. The advanced framework section now edits list and map options such as `builtins`, `focusedTools`, `maxCallsPerTool`, `riskLevels` and `requiredTools`.

Fixed: chat sessions dropped the advanced framework settings (`rawConfig`, e.g. profile) and durable-run settings; they now reach the agent the same way Lab runs do.

Wave 2e — head-truncation guard (plan 2.5, the Local-Tier Reliability program's sensor→actuator closure). Before every think-phase request goes out on the Ollama wire (the provider whose `num_ctx` enforcement SILENTLY HEAD-TRUNCATES the system prompt — cloud providers reject/handle long prompts server-side, so the guard is provider-scoped like the demand-num_ctx policy beside it), a deterministic pure-arithmetic preflight computes the CORRECTED prompt cost — system + history + the FC `tools:` schema term, which no prior estimate ever carried — plus the gateway's own resolved output budget, against the model's num_ctx ceiling. On overflow it shrinks in a fixed order: (1) the tool surface, least-relevant first (required + classifier-relevant tools protected; documented tail-of-registration drop order when rankings are absent — the 2.6 skip may mean none exist), then (2) history, oldest-first with the newest turn always kept. The system-prompt HEAD is never the resource: an unpayable bill is reported honestly (`stillOverflowing`) instead of silently wiping the agent's identity. Every firing emits a `harness-signal` (origin `head-truncation-guard`, rax-diagnose-visible) and appends a ledger-grammar `harness_signal` step (the existing `harness-signal` RunLedger kind — no new kinds). Non-overflow requests are byte-identical (identity-preserving no-op; fit → same array references). This closes the measured class where chars/4 undercounts dense content (~35%) and a 4,000-token tool array (49% of an 8K window) sails through every existing gate while the model runs lobotomized.

Review round 1 (three Important findings folded): rung 2 now drops history by COHERENT FC EXCHANGES — an assistant tool_use turn travels with the tool results answering it (the assembly-compaction block-model invariant), so a mid-fire shrink can never strand an orphaned tool_result or a dangling tool_use into an invalid provider wire (capacity-fitted test proves the naive per-message slice stranded one). The demand-num_ctx policy (`numCtxPolicy: "demand"`) now sizes its bucket from the guard's own schema-inclusive, family-corrected estimate (prompt + FC tools + output) instead of a schema-blind prompt-only one — no more under-provisioned bucket while the guard reads green. And a provider-default budget intent (`resolveOutputBudget → undefined` = output bounded only by the window) reserves the documented `THINKING_SAFE_MIN_TOKENS` floor instead of 0 — conservative-fire direction (ruling #1), no magic number.

A soft harness guard (loop detection, stall) that fires before the model has written any answer now gets one "write the final answer" nudge instead of failing the run immediately. The guard's failure stands only if it fires again, at the iteration cap, or when no iteration is left. A run with nothing to work from still never gets a synthesized answer.

The note an agent gets when it repeats an identical tool call no longer tells it to give a final answer while work is still outstanding. Before, the note said "Already done — do NOT repeat. Give FINAL ANSWER if all steps are complete." even with declared output files still unwritten. It now lists what is outstanding (required tools not yet called, unmet delivery conditions such as an unwritten file), using the same list the exit gate uses. When nothing is outstanding, the final-answer hint is unchanged.

The run contract is now compiled from the current turn only, so conversation history inlined into the task string (Cortex chat, gateway chat) no longer creates requirements that can never be satisfied. Requirements and deliverables carry typed provenance, and `contract-compiled` records it plus `currentTurn`.

GH #244: contract compiler emits `action-required` requirements for external-effect tasks (new `ActionCapability` vocabulary: `send-message` | `create-ticket` | `schedule-event`), and the runner's iteration-0 satisfiability preflight abstains honestly with a named missing-capability reason (listing available tools) when zero surface tools are relevant and no other path exists. Questions and information tasks are unaffected; unknown/empty surfaces fall back to the zero-evidence stand-down unchanged.

feat: signal consumption edge — every harness signal gets a stable id, a typed
reachability record (did it reach the model's prompt), and a deterministic
effect classification (remediated / ignored / contradicted / ambiguous) on the
following action, aggregated on run-completed and consumed by RI learning and
rax diagnose. Closes the signal gap root cause surfaced by the 2026-10-24
introspective harness loop (I4/I5/I7): emission-side-only telemetry could not
distinguish "signal never landed" from "signal landed and was misused." Adds
SignalRendered + SignalEffect trace events, a kernel signal ledger, a pure
classifier, render stamps in think.ts, run-completed tally, and read-only
consumers. Additive schema only; historical traces still load.

Chat turns that pause on `request_user_input` now show the agent's question in the thread with a reply box (Yes/No, choice buttons, form fields or free text). Answering resumes the run through `respondToInteraction`, and the question, the answer and the reply land in the thread; Dismiss drops the turn. New route: `POST /api/chat/sessions/:id/interactions/:runId/respond|dismiss`. The non-stream chat path now holds approval and question pauses too, instead of saving the "Run paused" text as a reply.

The Cortex server now binds `127.0.0.1` by default, so only this computer can reach it (Cortex has no authentication). Set `CORTEX_HOST=0.0.0.0` (or pass `hostname` to `startCortexServer`) to expose it on purpose; the server logs a warning when it listens beyond loopback. `startCortexServer` now returns `{ hostname, port, stop }`.

The runtime resolves its default trace directory through `resolveTraceDir()` from `@reactive-agents/trace`, the same resolver the trace recorder writes with. Previously the two could disagree (for example under `NODE_ENV=test` with no `REACTIVE_AGENTS_TRACE_DIR`), so a trace file was written but `result.metadata.tracePath` / `runId` were missing. `.withObservability({ tracing: true })` with no `dir` now defaults to `~/.reactive-agents/traces` (or `REACTIVE_AGENTS_TRACE_DIR`) instead of a cwd-relative `.reactive-agents/traces`, matching the docs and where `rax diagnose` looks.

Plan steps no longer write unresolved `{{from_step:…}}` templates into tool arguments. A planner that writes a keyed ref such as `{{from_step:s2:lowstock}}` (outside the `:summary` / `:full` grammar) previously had the literal token written to a file with `ok: true`. plan-execute and blueprint now rewrite keyed refs to the bare `{{from_step:sN}}` ref at plan validation (also on replans) and emit `guard-fired{guard:"plan-ref-normalized"}`. As a safety net, plan-execute strips any leftover `{{from_step:` token before a direct tool call, and blueprint fails such a step instead of running the tool (it previously missed `:full` and keyed refs).

Tool disclosure follows two new rules over the run's permitted tools. First, if pruning would leave no domain tool while some tool is permitted, the model is offered the required tools, the tools the task names, and the top 5 keyword matches. It never gets a tool the run did not permit. Second, `discover-tools` is offered only while a permitted tool is still hidden. Runs where every permitted tool is already offered no longer carry a `discover-tools` schema that could only answer "nothing new".

Fix `rax examples demo` spawning demos from the built CLI and add island-sim thinking-mode passthrough. The demo working directory resolved against the `src` layout, so the bundled `dist/index.js` pointed at a nonexistent directory and `Bun.spawn` surfaced it as `ENOENT posix_spawn 'bun'`. The CLI now probes both `src` and `dist` layouts, spawns via `node:child_process` with the absolute Bun binary, and errors clearly when demo files are absent. Also adds `--minds scripted|judgment|llm` (mapped to `ISLAND_SIM_JUDGMENT` / `ISLAND_SIM_LLM_DECISIONS`, explicit flag wins over ambient env), forwards `demo <name> --help` to the demo process, and teaches the island-sim demo itself to parse `--minds` with matching precedence.

blueprint stops before running any plan step when planning already used up the token budget, like plan-execute does. Before, it still executed every tool step (including side-effecting ones) and could report `completed` over budget. The run now ends as a partial whose output lists the planned steps that did not run.

`.withTools({ maxCallsPerTool })` caps how many times each named tool may run in one agent run, for example `{ "web-search": 3 }`. A call past the cap is not run; the model gets a tool result saying the tool was not run and why. The cap counts the whole run, including several calls in one turn. Unnamed tools have no cap. Each cap must be a positive integer, or `.withTools()` throws `ToolsOptionError`. The option round-trips through `toConfig()` / `AgentConfig` as `tools.maxCallsPerTool`. Every strategy that runs tools enforces it, and spawned sub-agents inherit the parent's caps.

Built-in tool descriptions now state only what the handler actually does (harness truthfulness audit, 2026-11-06). File tools: an absolute path inside the working root is accepted, so the `path` docs say so instead of "absolute paths are refused", and they warn against stripping the leading `/`. code-execute: the description is rendered per sandbox (new `codeExecuteToolFor(config)`). In host mode it says the subprocess is not isolated, the working directory is `/tmp` (not the working root), `fetch()` is available, and TypeScript annotations run. discover-tools: no longer points at a `## Skills` prompt section that may not exist. find: new `findToolFor({ relate, recall })` names `relate`/`recall` only when those tools are registered; the default `findTool` names neither and drops builder API names. web-search: the description and the exhaustion error no longer list API-key env var names to the model. The setup hint stays on the error's `cause` and in a `web-search-providers-exhausted` warning log.

Live checklist on the meta-loop spine. Every run now has a checklist projected from the contract and ledger facts the terminal gate judges: requirement rows carry gate truth, advisory rows (the opt-in `todo` meta-tool) never count toward done. New: `ChecklistUpdated` and `SubAgentActivity` on the full-density `AgentStream`; `observability.checklist` display option (default on, display-only, proven by a request-identity test); TUI checklist; `makeRunTree`, `projectChecklist`, `makeChecklistTracker` in core; one stream scope resolver in runtime; `checklist-item` ledger fact; `ui-core` recursive sub-agent fold.

**Breaking (tools):** removed the legacy `todo` list API — `applyTodoAction`, `parseTodoList`, `renderTodoList`, `TodoItem`, `TodoActionResult`. Use `applyTodoChecklistAction` / `renderTodoChecklist` over ledger-folded `AdvisoryItem`s. The global `_todo` scratchpad list is retired; old checkpoints migrate once on resume. The `todo` tool contract is no longer byte-identical: see the `todo` changes below (action aliases, duplicate-title skipping, new result lines and description).

**Model-visible delta (one):** `brief`'s recall-key list no longer includes `_todo:<taskId>`.

Also: `llm-provider` normalizes tool schemas once for every provider (fixes OpenAI 400s on MCP tools with arrays lacking `items`) and adds live model discovery (`listProviderModels`, `resolveProviderModels`); repetition guard treats identical canonicalized arguments, not tool-name heuristics, as repetition; failed strategies and LLM errors surface a named failure message instead of empty output; URL document sources are fetched and indexed and any failed source emits `DocumentIngestFailed`; HTML ingestion extracts main content; `.withMetaTools({...})` warns when it drops default-on `recall`; sub-agent children no longer leak `TextDelta` to the parent stream.

**`todo` and healing (tools, reasoning):** `todo` accepts a closed table of action aliases (`update`, `set`, ...) and heals drifted calls; `add` skips duplicate titles; results end with a loop-closing line and the tool description carries the lifecycle. `find`, `final-answer`, `brief` and `pulse` heal drifted section values and param names. Healed calls record `healedFrom` / `healingApplied` on the tool-call trace. `@reactive-agents/tools` exports the shared helpers `healEnumArg`, `healParamNames`, `closestValid`.

**Opt-in, experimental:** `.withMetaTools({ todo, todoGuidance: { reminder, systemLine } })` threads `checklistGuidance` to the kernel. Default off; not lift-measured, so it is not recommended as a default and no "Claude-Code-like" behavior is claimed.

**Conversation to-do (runtime, reasoning):** `RunEnvelope` gains `initialAdvisory`; `agent.session({ initialTodo })`, `session.todo()` and `snapshotToTodoSeed` carry a chat's to-do list across turns. Requirement status is scoped to the run's own pass so sub-agent facts cannot shadow the root answer requirement.

**llm-provider:** `gpt-5*` / o-series use `max_completion_tokens` and omit `temperature` (also for LiteLLM reasoning ids); live model discovery (`listProviderModels`, `resolveProviderModels`; 10-minute cache keyed by hashed credential, free-text fallback, groq and xai added; env keys are never sent to caller-named hosts, no redirects); Groq inactive models are skipped; strict tool schemas are capped at OpenAI depth/size limits and fall back to non-strict. **runtime:** URL document fetch blocks private-host targets (`allowPrivateHosts` opts out). **reasoning:** the repetition guard's distinct-argument carve-out also requires distinct results.

**cortex:** sub-agent blocks in chat; persisted turn cost (never a silent $0); Run trace tab and `/export`; Beacon hierarchy via persisted `parentRunId`, deterministic layout with per-browser persisted positions; live pickers with groq/xai and preset fallback; plan card ("Goal checks" and "Agent's to-do"); conversation to-do dock, persisted per session; chat agents get `todo` on by default for new sessions; opt-in "Keep to-do list current" setting (experimental); context-usage ring persists between runs; provider/model link to `/models/<provider>/<model>`.

**Ablation confirmation (V1/V4 PASS, mutation-checked):** ablation-warden confirmed the display-only checklist and the request-identity test (ON/OFF requests identical; the test fails when the identity is deliberately broken). The V5 guidance verdict is still pending, which is why guidance stays opt-in.

Public composable-kernel extension surface (W0.4a): `packages/reasoning/src/index.ts` now exports `makeKernel` (value) plus the types `Phase`, `Guard`, `KernelContext`, `MetaToolHandler`, and `ThoughtKernel` from the package entry. Until now the docs page taught `makeKernel`/`Phase`/`Guard` extension patterns through repo-relative imports because the published barrel exposed only `reactKernel`/`executeReActKernel` — consumers could not actually use the documented capability. No behavior change: exports only. New pin test `tests/kernel-surface-exports.test.ts` guards the surface.

Plan-execute no longer fails a verified delivery because one step's own pass left its `answer` requirement open. When the strategy holds its own delivery verdict, a step pass's outstanding criteria stay step-scoped and are not forwarded to the run result, so the runtime success veto reads only the run's own contract coverage.

The loop detector no longer stops a run right after it writes its deliverables. The "no new evidence for N turns" check read progress measured before the turn's tool calls, so a turn that wrote every required file still counted as stale, and the run ended as a failure even when the model's next answer was correct. The check now re-reads progress after the tool calls; it can only lower the stale count, never raise it.

Plan steps that write a file no longer lose the file's line structure. When a planner set a file-content argument to `{{from_step:sN:summary}}`, the `:summary` form collapsed all whitespace and cut the text at 500 characters, so a multi-line list such as `SKU-003\nSKU-008` was written as `SKU-003 SKU-008` and markdown headings left the start of their lines. plan-execute and blueprint now rewrite that ref to `{{from_step:sN:full}}` at plan validation (also on replans) when the ref is the whole value of an argument and the call names a literal file target. They emit `guard-fired{guard:"plan-ref-normalized"}` with the rewritten argument names in `metadata.normalized[].fullContent`. `:summary` refs in search queries and other arguments are unchanged.

`AgentResult.metadata.tokensUsed` and `cost` now count every LLM call the run made, from one source. Before, they added up what each reasoning pass reported about itself, which missed calls outside a pass's own count, so a plan-execute run could report about half of what it was billed (9,985 reported vs 18,639 billed in one ablation run). The run-scoped spend meter is now armed on every run, with or without `.withBudget()`, and the observable LLM wrapper feeds it on every call (kernel turns, planner, synthesis, classifier, quality gate, structured output). Budget limits still apply only with `.withBudget()`, and `runBudgetSpend` is still present only on budgeted runs. Delegated sub-agents now run with the same observable wrapper: a child's calls appear as `LLMRequestCompleted` events under the child's task id, and its spend folds into the parent's `tokensUsed` once. The post-answer debrief call stays outside the reported spend.

Fixed: `claude-haiku-5-5` calls failed with a 400 "temperature is deprecated for this model", because the Anthropic adapter always sent `temperature`. Capability rows now carry an optional `rejectsTemperature` flag. The adapter omits `temperature` on `complete()`, `stream()` and `completeStructured()` for flagged models. Only `claude-haiku-5-5` is flagged so far.

Added static capability rows for `claude-fable-5-1`, `claude-opus-5-5`, `claude-sonnet-5-5` and `claude-haiku-5-5`. These ids used to fall back to a 2048-token context window, which starved context assembly. The window and output values copy each model's 4.x predecessor. Fable gets a conservative 200K window and 64K output cap. None of these values are confirmed against Anthropic's docs yet.

A templated output path in a task ("for each notes-N.txt, write out-N.txt") now becomes one required file deliverable per item (`out-1.txt` … `out-6.txt`) when the task names the items explicitly, for example "notes-1.txt through notes-6.txt" or a list, with relative or absolute paths. The run can no longer finish as done after writing only some of them, and the refusal names the missing files. A template whose items the task does not enumerate is still not treated as a file to produce.

`result.metadata.reasoningSteps` no longer carries inline media bytes. When a tool returns `toolContent(...)` with a base64 image or audio part, the step's `metadata.contentParts` now holds a short text stub (media type, decoded size, sha256 prefix) in place of the payload. The change applies to `run()` results, `StreamCompleted.metadata` on the stream and SSE wire, the durable `run_events` journal, and chat replies. URL-sourced media and file parts are unchanged. The bytes still reach the model during the run.

A tool call embedded in an assistant reply that ends with `end_turn` (for example `const x = fileRead("/abs")` for a low-risk tool) is now dispatched instead of the run completing on that text, and an unresolved call-shaped reply is no longer delivered as a successful final answer; it goes to the unresolved-call guard.

Loop-detector messages for the repeated-thought and consecutive-thought patterns no longer include builder-config advice (`.withContextProfile(...)`, `.withReasoning(...)`, persona suggestions). These messages reach the model through the strategy-switch handoff, so they now say only what happened and what to do next. The developer advice moved to a new `LoopDetection.devHint` field. It is appended to the run's error when the loop ends the run.

A strategy switch no longer drops the run's contract. Before, when the loop detector switched strategy mid-run, the new strategy started without the compiled run contract, the delivery conditions, or the run budget meter. The exit gate and terminal then accepted a "done" even though named files were never written. For example, a run that wrote out-1.txt of six files was recorded as verified. The switched kernel now keeps these run-level facts, so a premature "done" is redirected with the missing files named, and is handed off as an honest partial once the repair budget is spent.

The local-tier quality check now names the missing file. When the run contract still owes a file and the model answers in chat instead, the hint is no longer the generic "Review your answer ... fix it now", which invited another rewrite. It now names the path and the writing tool (for example, "Your answer above is the content of ./analysis.md, but ./analysis.md is not written yet. Call file-write with path ./analysis.md and that content now."). Runs without a contract keep the adapter text.

Tool evidence is one value per run, derived from the run ledger. A later pass of a multi-pass strategy (reflexion, plan steps that continue a run) no longer forgets tools an earlier pass already ran: it is not redirected to "call a tool first" or pushed to abstain after the work is done. In a scripted reflexion run this removes one LLM call and about 20% of tokens.

Behavior changes:
- `maxCallsPerTool` is now a budget for the whole run, not for each pass.
- `maxCallsPerTool` is now enforced on native function calling. A fallback path re-sent calls the budget had already refused.

`ArbitrationContext` (public) now requires `evidence: ToolEvidence`. `NO_TOOL_EVIDENCE`, `toolEvidence(ledger)` and the `ToolEvidence` type are exported for callers that build one.

Strategies now run on one shared substrate (`runStrategy`): it owns a run's steps, token/cost/call accounting, the durable-pause terminal and the relay of a kernel pass's outcome (terminatedBy, abstention, honesty markers, ledger). `reactive`, `direct` and `tree-of-thought` use it first. Their results are now uniform: `direct` and `tree-of-thought` pick their answer by the same rule as `reactive` (a "let me try again" or unresolved tool-call thought is no longer shipped as the answer) and carry the same metadata (`extensions.signalTally`, `finalAnswerCapture`, `scratchpad`); `tree-of-thought` reports its input/output token split.

Tool calls written as text are parsed by one parser with one argument grammar (`parseAssistantToolCalls`, `parseCallArgs`). Models that print calls like `file-read({ path: "./a.txt" })`, `fileRead(...)`, `key=value` or `--path ./a.txt` in a shell fence now get a correct call instead of a mangled one. A call whose arguments are not plain values (for example `x.toString()`) is never guessed into a string: the model is asked to restate it. A text literal can no longer be healed into a `path` argument. Well-formed native tool calls are unchanged.

Media parts no longer vanish inside the kernel. Context compaction and the projection trace now count each image, audio or file part as a fixed 4,000 chars (`MEDIA_PART_CHARS`, about 1,000 tokens) instead of 0, so a thread with many images can trigger compaction. An assistant turn made of parts is now recorded as a thought. The prompt trace on thought events and the `ContextSynthesized` payload flatten messages the same way the `llm-exchange` trace does, so tool-use blocks show as `[tool_use:<name>]` instead of an empty string. Text-only runs send the same bytes as before.

The run budget meter can now be settled. `settleRunMeter(meter)` marks the run's spend as reported, and every later `applyRunSpend` / `addRunSpend` on that meter is ignored, so LLM work after settlement (such as the forked debrief synthesis) cannot change a total already copied onto the result. `isRunMeterSettled(meter)` reads the flag. `finalizeStrategyResult` is now documented as `@internal`.

Chat sessions, desk runs and saved gateway agents now build agents from the same config.

- **Security:** a chat with tools turned off no longer gets `shell-execute` when its stored config has `terminalTools: true`. The host shell is a tool, so it follows the tools switch like workspace and shell options already did.
- Chat accepts every strategy name and alias the framework registers (read from the capability manifest), so `strategy: "rewoo"` no longer falls back to `reactive`. The run-chat tab lists the framework's strategies instead of a hard-coded five.
- A tools-off chat keeps a configured strategy and iteration cap; it used to drop both.
- Structured output's parse-fail mode (`.withOutputSchema(schema, { onParseFail })`) is now settable in the Lab builder and reaches chat sessions and gateway agents, not only desk runs. "Degrade" (the framework default) keeps the text answer and reports the parse error; "throw" fails the run.
- Editing a saved chat session whose config has an output schema, harness config or documents no longer breaks: the stored objects load back into the builder as JSON text.

Durable tool-effect records (GH #262): a crash after a side-effecting tool succeeds but before the next checkpoint commits is no longer silently at-least-once. `.withDurableRuns()` runs now persist one awaited `run_effects` row per tool call (pre-dispatch `executing` write + terminal outcome write), the kernel records effects through the new `RunControllerLike.onToolEffectStart`/`onToolEffectEnd` seam with framework-minted ids and canonical args identity, and `resumeRun()` consults the store: a recorded-succeeded effect is recovered by injecting its stored result without re-executing the tool, while a terminal-less record replays AND is named `ambiguous-then-replayed` on the trust receipt (`receipt.effects[]`, present only after a crash-window recovery, so ordinary receipts are unchanged).

Durable resume: recovered tool effects are consume-once, consulted before the approval gate, and seeded only from rows at or after the checkpoint iteration. Judgment: the LLM backend rejects prototype-key choices and non-finite self-reports; `jev-primary` guardrail strictness degrades to additive on an uncalibrated backend. Runtime: continuation passes (`withMinIterations`, custom termination, output validators, reflect-revise) fold the prior answer and the instruction into one goal instead of restarting blind, so tool calls are no longer repeated; `ToolCallCompleted` stream events carry args/result/error and a new `ThinkingEmitted` event carries provider thinking. ui-core: shared `foldTurnTrace` turn-trace fold. Tools: the `<|tool_call>call:NAME{...}<tool_call|>` dialect is parsed, and unparsed tool-call markup is never accepted as a final answer. Cortex: persisted, inspectable thinking and tool calls; chat fork / rewind / rerun / clear / compact; chat auto-naming; Tools on/off switch; per-chat memory (off by default; clear rotates agent identity); raw JSONL trace download; rerun for any agent; Frames-first trace tab with bounded rendering of large results; superseded paused runs no longer stack approval toasts; Signal image pins signal-cli 0.14.9.

`rax eval gate --activations <n>`: pass how many candidate runs the mechanism under test actually acted in. `0` books the ledger entry `void` (an A/A comparison measures nothing) and exits 2 instead of failing as a reject.

Set an agent's working directory with `.withTools({ workspace: "/abs/path" })`, and override it for one run with `agent.run(task, { workspace })` (also `runStream()` and `runEffect()`). File tools resolve relative paths against the workspace and refuse paths outside it. The built-in `shell-execute` tool (`terminal: true`) runs in it; a `terminal.cwd` resolves inside the workspace and is refused if it escapes, unless `terminal.allowUnsafeCwd` is set. Sub-agents inherit it. The workspace must be an existing directory: `.withTools()` throws `ToolsOptionError`, `run()` rejects and `runStream()` ends with a `StreamError` otherwise. Precedence: run option, builder option, ambient `withFileRoot()`, none. Round-trips through `toConfig()` as `tools.workspace`.

Behavior change: with an ambient `withFileRoot()` root active and `terminal` on, `shell-execute` now runs in that root too (it used a /tmp sandbox dir before), so file tools and the shell agree on one directory.

fix: 2026-10-23/24 introspective harness-loop batch (bonsai-2:27b self-report x trace cross-check)

- llm-provider: honor explicit `thinking:false` on Ollama default-think models via tri-state `think` param (off-switch now reaches the wire; no more paying the +6000 thinking widening for a disabled feature)
- tools: MCP namespaced tool names resolve from the provider-sanitized form (token-sequence match; fixes the umami_get_website_stats vs get_event_stats last-token collision that dead-looped native FC)
- tools: tool-service honors handler-reported failures (`{success:false}` payloads now produce failed observations - trace ok=false, recovery guidance, honest durable effect records); shell-execute policy denials carry the flag
- tools: denial messages made actionable (allowlist named on unlisted-command denial, dedicated `cd` reason naming the sandbox root, honest `rm` reason)
- tools: file-write payloads document/return the resolved absolute path
- reasoning+runtime: an explicit `.withReasoning({maxIterations})` cap always wins over the tier context-profile hint (was silently min()'d to 8 on local tier); clamp emits a visible structured signal
- reasoning: recovery steering no longer advises alternate tools for policy-blocked failures (block/allowlist/sandbox/path-traversal refusals re-surface the tool's own remedy instead)

Cortex: `/plan <task>` now sends the task unwrapped with run posture `plan` (the harness restricts the turn to planning) instead of a prompt wrapper. The chat routes accept an optional `posture` (`"execute"` or `"plan"`, other values return 400) and pass it to the session turn. New `/go` command proceeds with the plan; a "Planning mode" badge shows until the next execute turn.

W3c parser-coverage fix: `TextParseDriver` tier-1 is now wrapper-tolerant. Real
no-FC models do not always emit the wrapper the driver teaches.
Measured on `qwen2.5-coder:14b` (committed W3c traces, `fixtures/post-w3`, 10/10
runs): at temp 0 the coder emits the taught `tool: <name>` + param lines but
drops BOTH wrapper tags, so the wrapped-only regex parsed 0 calls and the model
burned maxIterations (shadow would-have-executed 0/5; act 0/5 executed). Tier-1
now falls back to a bare-block scanner that accepts the SAME taught grammar
minus the wrapper: a block must open with a `tool: <name>` line and carry at
least one `key: value` param line. It is tolerant of prose, `---` rules, code
fences and a leading prose line BETWEEN blocks, and of YAML block-scalar param
values WITHIN a block (`|` literal and `>` folded, with `-`/`+` chomping).
Wrapped blocks still win when present and the wrapped path is byte-unchanged.
Coder:14b measured 0/10 -> 10/10 parseable, all parsed names in the run's
callable surface.

Hardening (review round 1) closes three corruption paths on the bare path:
1. **Indent symmetry** - the tool line and param lines now accept/normalize
   leading indentation symmetrically, so a block nested in an explanation parses
   WITH its params instead of opening an empty-args call.
2. **Prose tolerance scoped** - tolerance is BETWEEN blocks, not within a param
   list: a mid-param interjection (a later `content:` after prose) is DROPPED
   loudly rather than re-attached, because genuine in-list skipping would absorb
   data-sample lines (`ProductA: 100`) that real emissions embed between blocks
   (measured), attaching wrong args. A bare block now REQUIRES >=1 param, so a
   lone `tool:` line in prose can never dispatch an empty-args call.
3. **Block-scalar forms interpreted, not half-accepted** - `>` folding (single
   breaks to spaces, blank lines to paragraph breaks) and `|`/`>` chomping
   (`-` strip, `+` keep, default clip) are implemented to exact values instead
   of preserving the literal header. GH #243 pin preserved: same builder-taught
   grammar, no guessed format, verified by a builder-derived test.

Delimiter collision fix (W3c round 2, live user-facing bug): the taught wrapper
moves from `<tool_call>` to `<tool_use>`. `<tool_call>` is the host runtime's
OWN qwen tool-call trigger: when a text-parse model emitted it, Ollama's
qwen35.go / qwen3coder.go parsers intercepted the output, failed to JSON-decode
the `tool: <name>` body, and poisoned the stream (journal: `qwen3.5 tool call
parsing failed` / `qwen tool call parsing failed`, error=EOF) so the framework
saw `EOF` and the run died at iteration 0. Measured against the Ollama 0.35.0
binary: `<tool_call>` appears 15x and `</tool_call>` 14x (template + parsers);
`<tool_use>` and `</tool_use>` appear 0x, so neither parser can match it. The
new delimiter stays a lone `<name>` tag line so the reasoning-side structural
shape reader (GH #243 pin) is unchanged. Back-compat is additive: the legacy
`<tool_call>` wrapped form, the bare `tool:` block, JSON tiers and block scalars
all still parse; only TEACHING changed.

Prose file writes no longer land as one line of literal `\n`. When a model sends `file-write` content for a `.md`, `.markdown`, `.txt`, `.rst` or `.csv` path that has no real newline and at least two literal `\n` sequences (it escaped `\\n` in the tool-call arguments), the healing pipeline's value-shape stage turns `\r\n` and `\n` into line breaks and `\t` into tabs, and records a `value-shape` heal action (`content:literal-newlines` to `content:newlines-unescaped(N)`). An escaped backslash and every other backslash are kept. Code files, JSON files, and content that already has a real newline are never changed. Witness: on the lh-1 bench task, all 5 gpt-4o-mini failures and 2 llama3.2:3b runs wrote `report.md` / `sources.md` this way, which fused the URLs the grader looks for.

Debug log lines (for example "Direct strategy completed (1 iter cap)") no longer print to the console on a default run. They are still recorded for subscribers and the run summary, and print live when you ask for debug output with `logging.minLevel: "debug"` or debug verbosity. This matches the documented `minLevel` default of `info`.

W0.5 result→trace linkage (Lift Protocol plumbing): every `agent.run()` result now carries `metadata.runId` (the ULID trace run id, equal to the engine `taskId`) and `metadata.tracePath` (absolute `<traceDir>/<runId>.jsonl`) when tracing recorded the run. The pair is minted at the single execution-engine finalize seam after a settle-flush of the run's buffered trace events, and is emitted ONLY when the file is verified to exist: disabled tracing yields honest absence, never a phantom path. Consumers (`rax diagnose replay <tracePath>`, per-wave Lift captures) no longer need directory-mtime guessing to find a run's trace.

Wave 5.4 budget inheritance pinned + fixed: a delegated child's LLM spend now folds into the PARENT's run-scoped budget meter (dynamic spawn-agent and local-agent-tools paths). Before this, child spend landed on neither the parent's meter nor its accumulator, so `.withBudget()` under-enforced on delegating runs (measured: parent meter 508 while the child added 224). `run-budget-arm.ts` header comment corrected to the real invariant (ONE meter per ROOT run — "sub-agents get their own" was comment-to-code drift). New `metadata.runBudgetSpend` ({ tokens, cost }) exposes the live meter total at terminal on budgeted runs (absent when un-budgeted), giving cost consumers the true run spend that `tokensUsed` (this agent's own calls) never carried.

`.withHarness({ actOrAnswer: "auto" })` picks forcing per model.

- `"auto"` resolves once at run start: the model's learned `calibration.actOrAnswer` when the run has one, else retry on Ollama and off on every other provider. Still opt-in; the default stays off.
- `run-started.config` records the mode the run uses as `mechanisms.actOrAnswer` (never `"auto"`) and where it came from as `mechanisms.actOrAnswerSource` (`"explicit"`, `"calibration"` or `"default"`). Calibration is now resolved before `AgentStarted`, from the same value the kernel receives.
- Each run's act-or-answer counts (`noCallStallTurns`, `unforcedToolWorkTurns`, `forcedCalls`, `forcedCallsCalled`, `forcedCallsSucceeded`) now reach the local run observation calibration learns from and the community telemetry report. Runs with no tally leave the fields out.
- `.withOutputSchema(schema, { onParseFail: "throw" })`: a parse failure now rejects `run()` with the parse error and a remediation hint, instead of "Unexpected error: An error has occurred". `StructuredOutputError.message` names the issues.
- The generated config reference lists union field types (for example `boolean | "proactive" | "auto"`) instead of `unknown`.

W3b (plan 3.3): dialect-live routing + triad pin + nominal survival. `selectToolCallingDriver` now CONSUMES its previously-dead dialect parameter per the Stage-B design's end state (spec 2026-06-03-tool-calling-driver-redesign.md §4/§5: "Calibration *refines within* native … it does not *downgrade*"; text-parse routes **by capability**): the capability claim remains the sole routing arbiter, while a validated dialect claim rides on the selected driver (`ToolCallingDriver.dialectClaim`) so a wrong route is *visible* on the run context, not silent (spec §3 source-tagged provenance). Input outside the closed vocabulary (`"native-fc" | "text-parse" | "none"`) is never defaulted into a claim (GH #243). The kernel runner reads the claim exclusively through `loadDialectPriorClaim` (explicit-presence reader, now exported from `@reactive-agents/llm-provider`) instead of the schema-defaulted `ModelCalibration.toolCallDialect` (absent → `"none"` — the phantom re-entry class). New end-to-end mutation-pin (`reasoning/tests/kernel/loop/tool-routing-triad.test.ts`) drives the REAL runner wiring and goes red if any triad leg diverges — derivation floor, driver selection, resolver injection (the 482c11e4 class); it also pins the W2b keep-obligation (a registry-provisional tier is never a routing input) and verifies the text-parse meta-tool sentinel exemption in think.ts post-W3a (holds; pinned, not re-forked). Core's canonical `Capability` contract gains optional `nominal` mirroring the provider schema (265ec7001), and the canonical resolver's `toCanonical`/`adaptCache` round-trip carries it so a nominal stub row cannot silently re-enter tier arbitration through the cache.

Bookkeeping tool calls no longer count toward the stall guard. A turn whose only tool calls are meta tools (`todo`, `brief`, `pulse`, `checkpoint`, `recall`, `find`, and similar) now leaves the stall counter unchanged instead of advancing it, so a run that updates its to-do list between real work is no longer ended early as stalled. Turns with no tool call, and turns that call `final-answer` or `task-complete`, still count. The stall guard's trace record now reports how many meta calls it excluded (`metaCallsExcluded`).

Security fix: a `.withAgentTool()` sub-agent now runs under the parent's approval policy, task contract, fabrication guard and grounding, as the docs already said. Before, only dynamic `spawn-agent` children got these. A `.withAgentTool()` child could call a tool the parent's `.withApprovalPolicy()` gates and run it without approval. The child's policy is coerced to block mode (deny by default, `onApprove` honored), the same as `spawn-agent` children. Both kinds now share one mapping (`inheritedSafetyRails`).

`rax-diagnose cause`: a stall-guard terminate now outranks the weak `wrong-tool-arg` inference, and an abstained, uncapped run is no longer labelled `budget-cap`.

Chat goals take progress from the run, not a Cortex heuristic. Each goal segment passes `run: goalRunOf(...)` to the supervisor: progress is the sum of the turn's root-run `AssessmentEmitted.evidenceDelta`, so meta-tool-only turns (for example to-do ticks) and failed tool calls no longer count as progress. A segment whose run reports `goalAchieved: false` or outstanding requirements is never marked achieved. Ordinary chat turns (`session.chat()`) do not expose that exit-gate verdict yet, so the veto applies once the runtime reports it.

The remaining per-run values move into the run scope, bound once by the run entry. Removed from `@reactive-agents/core`'s public exports: `StreamingTextCallback`, `CurrentRunContext`, `CurrentRunContextRef`, `RunControllerRef`, `ResumeStateRef`, `ModelOverrideRef`, `ApprovalDecisionRef`, `InteractionResponseRef` and `RecoveredToolEffectsRef`. Code that bound them with `Effect.locally` should use the public agent APIs that set them: `agent.runStream()` (stream text and the pause/stop controller), `agent.fork({ model })` (model override), `agent.resume()`, `agent.approveRun()` / `agent.denyRun()` and `agent.respondToInteraction()` (resume state and the human's answer), and `.withDurableRuns()` crash recovery (recovered tool effects).

Behavior changes for sub-agents, which now get a fresh value instead of inheriting the parent's: a sub-agent never resumes its parent's checkpoint or applies its parent's approval decision, interaction answer or `fork({ model })` override, and never reuses its parent's recovered tool effects. A sub-agent still stops when its parent's run is stopped. `RunContext` gains an optional `taskId` (read with `runTaskId`), so a sub-agent's LLM calls correlate to its own task.

Wave 7.2: new `CapabilityRegistry.recordLiftEvidence` write path (future
default-on promotions read measurements, not folklore); eval CI lane
re-enabled on PR + nightly (keyless-proven steps only); regression-gate
nightly skips cleanly without secrets; gate scenarios can now drive
non-default strategies (`ScenarioConfig.strategy`).

The exit gate's record of a model answer now names the same reason the run ends with. For a termination-oracle exit on `content_stable` or `entropy_converged`, the gate step and the `exit_gate` guard event recorded `content_stable` / `entropy_converged`, while the Arbitrator ended the run as `llm_end_turn`. Both now come from one mapping, so the gate record, the event and `terminatedBy` agree. A strict-dependency tool-gate block no longer adds its own system observation; each refused call's `tool_result` already says why it did not run.

Wave 7.4 verification collapse: the `VerifierTier` ladder is deleted (it had
no consumer — nothing outside the policy compiler read it). Tier-1
pure-compute checks (semantic entropy, NLI) now serve the single result
boundary as recorded-but-never-enforced shadow checks, so the verification
package feeds the one gate instead of a parallel stack.

Plan-execute no longer makes its reflect model call when the outcome is already decided. That happens when every plan step completed and the run contract's checks (files written, required tools called) all pass. In that case the reflect call could only answer SATISFIED, so the run goes straight to synthesis and records "[REFLECT n] skipped — every step completed and delivery verified (…)" in its steps. The reflect call still runs when any step failed, when a contract check is unmet (including an answer-content check that synthesis has not satisfied yet), or when the task has no such checks beyond producing an answer. Typical saving: one model call per plan, and more when a scripted or confused reflection would otherwise have sent the plan around a refine loop.

Goal supervisor reads the run's own verdict. `GoalSegmentResult` gains an optional `run` field (`GoalRunOutcome`), built with the new `goalRunOf(agentResult, events?)`. When it is set, `evaluateGoal`/`pursueGoal` never call a goal achieved if the run's exit gate denied completion (`goalAchieved: false`) or RunContract requirements stayed outstanding. Progress then comes from the summed `RunAssessment.evidenceDelta` (`AssessmentEmitted` events), so a turn that used only meta tools does not count as progress. `progressed` is now optional and acts only as a fallback when `run.evidenceDelta` is absent. Callers that do not set `run` see no change.

The inline-media stub now reads `[image omitted from record: ...]` (was `omitted from checkpoint`), since it also appears in run results and the stream. `redactInlineMedia` also accepts untyped lists.

`rax-diagnose attribute` and `attributeFailure` share one failure taxonomy with `rax-diagnose cause`. When no turn-level rule fires, a failed run is attributed through its failure cause's owner (`CAUSE_ATTRIBUTION`, reported `probable`, with the cause in `cause` / `from-cause`), so a run the cause classifier already explained (an abort, a provider error, a model that never called a tool, a loop after the work was done) no longer reads `unattributed`. On a local corpus of real traces, unattributed failures dropped from 95 of 97 to 22.

- New verdict `environment` (`environment:{run-aborted, provider-error, budget-cap, tool-failure}`): failures outside both the harness and the model. `AttributionTally.byVerdict` gains `environment`.
- New reason `model:fabrication-vetoed`: the run's own fabrication check refused the model's answer. It was reported as `harness:false-veto` whenever a grader passed only part of the task.
- New reason `harness:subpass-abstained`: a kernel pass abstained before its first LLM call and the run kept going on top of it.
- `loadTrace` keeps one copy of an event written twice (same run and `seq`), as a timed-out run's sink can do; sums over events no longer double-count.

Wave 6 enforcement truth (6.1 + 6.2): gateway `policies.requireApprovalFor`
unions into the kernel approval policy at build time (order-independent; the
field previously had zero consumers), and `GuardrailService.checkOutput`
screens the final answer at the engine post-arm (fail closed on violations
with an event; fail open with an event on service errors — never silent).
Per-tool-result scanning stays structural (trust quarantine) by explicit
decision recorded at the observation choke point.

6.3 additions: e2e builder→kernel proof per killswitch (trace terminal
carries the reason); `requireApprovalFor` reads normalized pending calls
(text + native) instead of native-only; before-act hooks fire on the
single-call path (previously batch-only, silently approving the common
reactive path). No verify-phase call site added deliberately: no killswitch
registers verify hooks, so it would be a dead seam.

6.4 additions: config-field census test (gateway policies both mirrors,
plan-execute fields, RunLedger kinds each name a non-test consumer or a
justified allowlist); the documented-but-never-declared `patchStrategy`
option deleted from the reasoning guide.
6.5 (behavioral): capability registry memory row now agrees with the
stateless-default builder behavior (`defaultOn: false`; GH #122 history kept
in the rationale). Bare builds stay stateless; `.withMemory()` /
`HarnessProfile.balanced()` / `.intelligent()` opt in explicitly.
6.6: no new `.withAutonomy()` wither — only 2 of 5 modes could map onto
existing machinery and even those would invent policy, so the package is
doc-scoped as direct service use (a fictional `.withInteraction()` example
and phantom README rows removed; enforced gates live in
`.withApprovalPolicy()` / `.withUserInteraction()`).
6.7: new `.withOpenInference()` composes the OpenInference tracer layer
(destination stays process-global via `setupOpenInferenceExporter()` /
`OTEL_EXPORTER_OTLP_ENDPOINT`); identity flagged direct-use (full
`AuditLogger` wiring deferred). Note: the 6.2 output screen and the 6.5
memory posture are opt-in-gated (`enableGuardrails`, `.withMemory()`) —
ships dark unless enabled, same as their input-phase counterparts.

Tool calls the kernel refuses are no longer dropped silently. The think-phase tool gate keeps a call out of a turn when its `maxCallsPerTool` budget is used up, when required-tool steering runs only the calls toward a missing required tool, when a call is outside the relevant tools, when only one exploratory call may run, in single-step mode and in strict dependency mode. Each refused call now emits a `guard-fired` event (`guard: "tool-gate"`, `outcome: "block"`, metadata `{ toolName, toolCallId, kind }`). It also gets a harness-authored guard observation (never counted as tool evidence) and a `tool_result` in the conversation that says "<tool> was not run: <reason>", so the model sees the reason on its next turn. A turn whose every call is refused goes back to thinking with those answers instead of falling through to the termination oracle.

Skills resolve per run at the run's workspace. `.withSkills()` no longer requires `paths`: with no arguments it discovers `<root>/.agents/skills` (plus `<root>/.<agentId>/skills` and `<root>/.claude/skills`), where `<root>` is the run's `workspace`, else `.withTools({ workspace })`, else an ambient `withFileRoot()`, else `process.cwd()`. Relative `paths` now resolve against that root instead of `process.cwd()` (the same thing when no workspace is bound). New `run(task, { skills: { activate: [...] } })` pins skills for one run, merged with `.withSkills({ activate })`. Each skills-enabled run records `run-started.config.skills = { roots, catalog: [{ name, sha256 }], pinned }`; runs without `.withSkills()` have no `skills` key.

**Breaking:** the user-global skill directories `~/.agents/skills` and `~/.reactive-agents/skills` are now opt-in. To keep loading them, add `global: true`: `.withSkills({ global: true })`. `discoverSkills` now takes `(root, paths, { global?, agentId? })`, and the resolver config's `skipGlobalPaths` is replaced by `includeGlobal` (default `false`).

`rax-diagnose attribute` blames cut-off evidence (`harness:evidence-truncated`, `harness:evidence-missing`) only when a URL the run delivered was really hidden from the turn that wrote it. New reason `harness:unrepaired-content`: a text deliverable was written with literal `\n` sequences instead of newlines, which a repair at the write boundary would have fixed.

A model turn that hits the output-token limit while only thinking (no answer text, no tool call) is no longer retried with a much larger output budget. That retry let a runaway think for minutes more. It now gets one retry at the same budget with a recovery prompt, and a second runaway ends the run as failed with a clear "thinking runaway" error. A turn cut off mid-answer still gets the larger budget. Each decision is recorded as a `thinking-runaway` harness signal in the trace.

Plan 9 item 2b: a final answer the model writes is now a proposal the exit gate decides, not an accept on its own. The think stage used to end a run through three shortcuts: the end_turn fast path, the resolver's final answer, and the promotion of an answer-shaped thought (which checked required tools plus a lexical "looks like a final answer" test). All three now hand the answer to the exit gate as `ExitProposal{proposedBy: "model"}`. The gate checks what is still outstanding: required tools missing from the run's tool evidence, unmet delivery conditions (for example a declared file that was never written), and whether a real answer draft exists. When nothing is outstanding, the Arbitrator gives the terminal verdict as before. When work is outstanding, the run continues with the outstanding items as guidance. A model claim never triggers a handoff and never uses up the one deny-once nudge that stall and loop guards get. The iteration cap bounds it. Lexical checks now only mark text as a draft. On a task with no required tools and no delivery conditions, a plain answer still ends the run. Two cases stay with the Arbitrator: an exceeded budget (always a failure) and the F1 ungrounded terminal (required tools declared with no successful tool call yet: one grounding redirect, then an honest abstention).

A verified, accepted answer is no longer failed by a forwarded `answer` outstanding criterion (reflexion and plan-execute). `adaptive` now relays the selected sub-strategy's terminal outcome and kernel iteration, so its `run-completed.outcome` is populated.

`repetitionGuard` no longer blocks a corrective write. The converging-retry exception now reads the last call to the same target (path, URL, id), not the last call to the tool. A failed `by-region.json` write followed by a successful `report.md` write no longer blocks the corrected `by-region.json`. A rewrite of an already-written target with different content also runs when another tool returned new evidence since the last write to that target (write `out-2.txt` = 34, read `notes-2.txt`, rewrite `out-2.txt` = 84). This holds under an exhausted stalled requirement too. A rewrite with no new evidence in between, or with the same content, is still blocked.

`CompletionRequest` accepts an optional `thinking?: boolean` that overrides `LLMConfig.thinking` for one call. `false` turns thinking off for that call (Ollama `think: false`, Anthropic without a thinking block, Gemini `thinkingBudget: 0`, OpenAI and LiteLLM without `reasoning_effort`; models that always reason keep the server default). `true` turns it on where the model supports it. Leaving the field out keeps today's request exactly as it was.

plan-execute: a composite step limited to a few tools (`toolHints`) is now held only to the required tools it can see. Before, it inherited every required tool of the whole run, gave up before its first call, and was still recorded as done, so the next step worked from nothing and invented data. A step whose sub-agent gives up or hits an LLM error is now reported as failed, so the plan repairs it or skips the steps that depend on it.

Tokenizer-aware estimation (local-tier reliability program W2c / plan 2.3). `estimateTokenCount(messages, tokenizerFamily?)` gains an optional Capability-registry family argument and applies a MEASURED dense-regime correction: structural JSON (tool results, tool_use inputs) on llama-family BPE vocabularies costs 1.03–1.16× the chars/3 heuristic (live `/api/chat` prompt_eval_count) and 1.245× on committed FC-prompt traces — the shipped llama dense factor is 1.25 (the plan's unmeasured 1.35 seed reconciled downward; arithmetic in the W2c report). Prose/mixed branches are untouched: measurement showed the heuristic already OVER-counts prose (0.77–0.89×), and shrinking it would push budget gates toward the unsafe direction. Unknown family, unmeasured families (claude/gemini/tiktoken — those providers count via real APIs), and omitted arg ⇒ factor 1.0, byte-identical legacy behavior.

Factors ship as `calibrations/tokenizer-factors.json` (beside the per-model calibrations convention, same package `files` path) with a mirrored in-code fallback pinned by a lockstep test. First consumer of the previously zero-consumer `tokenizerFamily` registry field: the Ollama provider's `countTokens`. Probe `tokenizerFamily` mapping extended so qwen-family GGUFs resolve to the `llama` bucket (matching the static-table convention) instead of `unknown`. All 14 existing call sites (13 in llm-provider + the kernel's demand-num_ctx estimate in reasoning) inherit without signature changes; census + flagged sites (rate-limiter, prompt-manager, think.ts) in the W2c report.

MCP tool results now keep their images, audio and resources. Before, `callTool` kept only the text items and dropped the rest: a result with text and an image returned only the text, and an image-only result returned the raw MCP object. Now image and audio items become typed image and audio parts (base64 plus MIME type), and `resource` and `resource_link` items become file parts that reference the URI, MIME type and name. The value is wrapped with the new `toolContent(parts)` helper. Text-only MCP results return exactly the same string as before.

Custom tools can return `toolContent(parts)` with core `ContentPart`s too. `isToolContent(value)` tells whether a value is typed content. If code that does not know about typed parts calls `JSON.stringify` on the value, it gets a text view (the text plus a short marker per media part, such as `[image: image/png]`), never the base64 bytes. The agent loop does not read typed parts yet: until a later change, the model sees this text view.

New opt-in harness switch `actOrAnswer` (`.withHarness({ actOrAnswer: true })` or `RA_ACT_OR_ANSWER=1`; default off). On native function calling, when a think turn ends in plain text while tool work is still outstanding (a required tool not yet called, or an unmet delivery condition that only a tool can satisfy), the kernel asks the model once more in the same turn with `toolChoice: "required"` over the turn's callable tools, plus `final-answer` when that tool is offered. If the retry returns a call, the turn runs it through the normal act path. If not, the original reply is handled as before. The retry runs once per stall. The next one can only happen after a tool has run. Each retry is recorded as a `guard-fired` event (`guard: "act-or-answer"`, `metadata.result`: `called`, `answered` or `no-call`) and as an intervention on the run receipt. The token usage of both calls is counted. With the switch off, requests are unchanged.

A plan-execute run now streams its plan as live checklist rows, with no `todo` tool call. Each plan step appears as an advisory row (`source: "plan"`) that moves from pending to in progress to done as the harness runs it, on the same `ChecklistUpdated` stream the `todo` checklist uses (so Cortex shows the plan as it runs). Plan rows are never marked done by evidence inference and never decide whether the run is complete; requirement rows still do. Plan-execute and blueprint tool calls also reach the live stream now, not only the final result.

`completeStructured()` exchanges now show what happened inside the call. When the provider reports it, the `llm-exchange` trace event carries `response.attempts`: one entry per native attempt with input and output tokens, stop reason, thinking size and whether it parsed. The exchange also gets the final attempt's `stopReason` and the summed `thinkingChars`. A thinking runaway, a parse retry and real output no longer look the same. Old traces load unchanged; the field is optional (`StructuredAttemptReport` in `@reactive-agents/core`).

Structured spend is now counted from the provider's reported usage:

- A failed `completeStructured()` call that billed tokens now counts toward the run budget, and its error exchange records the tokens and attempts.
- `extractStructuredOutput()` returns real `usage` on the native path. A failed native call's usage is added to the prompt-mode fallback total.
- The plan-execute and blueprint planners account their spend from that usage. They estimate from text length only when the provider reported none.

Providers report attempts by attaching `attempts` to the usage they leave on `StructuredUsageRef`.

Plan-execute and blueprint analysis steps now see the full data earlier tool steps returned, not the compressed preview. Before, a step asked to summarize a 46-row file saw 3 rows plus "...43 more lines" and wrote its report from those. Prior results stay whole newest-first within the same recency budget the kernel uses for its latest tool result (about 35% of the context window); older results beyond it keep their preview.

A tool call the harness did not run is no longer counted as a failed tool call. When a required tool was still missing, a refused call used to look like a tool failure. Several refusals in one turn could set off the repeated-failure redirect and end a correct run early. Failure counters now skip refusals: the reactive controller's tool-failure streak, the run assessment's failure health, the final-answer error check and the "a tool call failed" nudge. The model still sees each refusal as an error result.

Required-tool calls are also no longer deferred. If a required tool is still missing and the model calls it several times in one turn (for example six `file-write` calls), all of those calls now run that turn, in order. Calls that are not parallel-safe run one at a time. Before, only the first batch ran and the rest were refused until the next turn. Calls to other tools are still refused until the required tool has run. `maxCallsPerTool` still caps each tool.

The native-FC tool-call resolver now returns its reprompt hint for an unresolved call (unparseable call text, or a tool name that is not on the surface) in a typed `hint` field on the `thinking` result. Read `hint` instead of splitting `content`. For one release `content` still carries the raw reply and the hint joined by a blank line, so existing consumers keep working; after that, `content` will be the raw reply alone.

File tools now stay inside the caller's file root for the whole run. `run()`, `runStream()` (and `chat()` through it), `runEffect()`, durable runs, and the approve/deny/resume facades bind the `withFileRoot(...)` root onto the run fiber when the run starts. Before, a relative `file-write` could resolve against `process.cwd()` once Effect's scheduler lost the AsyncLocalStorage root.

A tool-path `ChatReply` now reports a durable pause.

- `agent.chat(msg, { useTools: true })` and `session.chat(...)` return `status`, `pendingApproval` and `pendingInteraction` from the run, the same shape as a paused `StreamCompleted`. A run paused at an approval gate gives `status: "awaiting-approval"` and `pendingApproval: { runId, gateId, toolName, args }`. Before this, the reply had no way to tell a pause from a final answer.
- The engine completion log now says `Task paused awaiting approval (<tool>)` or `Task paused awaiting interaction (<kind>)` for a paused run. Before this, it said `Task failed`. The run's `success` value does not change. The completion log event now carries `paused: true` for such a run, so the status renderer shows "Paused" instead of "Failed".

W3a Stage B: flag-gated text-parse think→acting transition. Behind the default-off three-state flag `REACTIVE_AGENTS_TEXT_PARSE` (`off`|`shadow`|`act`), models routed to the `TextParseDriver` (`supportsToolCalling === false`) now get a working dispatch path for the `<tool_call>` markup the driver already teaches. `shadow` parses and records a parse-diff diagnostic (`HarnessSignalInjectedEmitted`, origin `text-parse-shadow`) without acting; `act` transitions parsed calls through the SAME required-tools batch gate the native branch runs (per-tool budgets, dependency-chain blocking, single-step) and dispatches the GATED set into the same acting pipeline native-fc uses — guard chain, tool-policy choke point, HealingPipeline, ledger seam (existing kinds only). Markup that fails to parse loops back with a deterministic observation-shaped message — quoting the driver's live taught example block (single grammar source, GH #243) — instead of silently burning maxIterations. The conversation thread is never a dispatch source at acting entry (stale-turn re-parse prevention); a degenerate resume records a harness-signal instead. Flag `off` (the default) and every native-fc path are byte-unchanged.

`file-write` now accepts a JSON value as `content` as well as a string. The healing pipeline has a new value-shape stage that serializes an object, array, number or boolean sent to a `file-content` parameter as `JSON.stringify(value, null, 2)` plus a newline, and records a `value-shape` HealingAction. This means a model no longer has to double-escape a `.json` document inside its tool arguments. String content is unchanged byte-for-byte, and `null` is still a missing-parameter error.

New: `ToolParameter.semantic` (optional, `"file-content"`) and `toParameterJsonSchema(p)`, the one projection from a `ToolParameter` to its wire JSON schema. `toFunctionCallingTool` and `ToolRegistry.toFunctionCallingFormat` now use it, so `enum`, `items` and `additionalProperties` reach the function-calling schema. Before this change they were dropped.

plan-execute and blueprint: when one analysis step's whole output is written to two or more different files (`content: "{{from_step:sN}}"` on each write), the plan now gets one copy of that step per file, and each write reads its own copy. Before this, the single step was told "your entire reply becomes the content of X" once per file, so the first file received every file's text. The split happens once, at plan validation, and emits `guard-fired{guard:"plan-fanout-split"}` with the producer, the new step ids and the target files. Steps are renumbered `s1..sN` and every reference is rewritten; tool-call producers, single-target plans and plans with a reference to a missing step are left unchanged.

Stream-drop `EOF` is now classified transient and retried. A live run died at iteration 0 with `ollama request failed: EOF` (trace 01M4V5GH4H43KJDCA3EC0JGVZW; same class killed 6/8 phi4 attempts in the W3c capture window) — Ollama's Go transport surfaces a server-side stream drop (model load/evict race) as a bare `EOF` / `unexpected EOF` read error, which was missing from the NETWORK_FAULT vocabulary, so the classifier sent it down the generic PERMANENT branch and the pre-first-emission stream retry (EH-1 guard) never engaged. One vocabulary addition converts the hard run-failure into a transparent backoff-retry: `retryStreamBeforeFirstEmission` re-attempts an EOF dropped BEFORE any delta; the emittedAny latch keeps mid-stream drops surfacing unretried (no duplicated output), and 401/404/400 permanents are pinned unchanged. `context canceled`/`aborted` deliberately excluded — user-initiated termination must never auto-retry.

Thread explicit `.withModel({numCtx})` into the kernel guard window (GH #241). `createRuntime` (and the light-runtime config) now seeds `contextProfile.explicitNumCtx`, so the head-truncation guard and demand-bucket cap enforce against the override Ollama actually uses instead of the capability recommendation. No-override behavior unchanged.

New `terminatedBy` value `"guard_stop"`: a failed run stopped by a harness guard (loop detection, stall, low progress, oracle force, strategy-switch exhaustion) before the iteration cap now reports `guard_stop` instead of `max_iterations`, which wrongly suggested raising `maxIterations`. Behavior is otherwise unchanged: `goalAchieved` is `false`, the run outcome is `partial`, and a bare builder still throws, exactly as for `max_iterations`. True cap and budget exits keep `max_iterations`. If you switch exhaustively on `TerminatedBy`, add the new case.

The finish gate now holds a run to every file its task names, the same list the run contract shows. Before, the gate used a separate single-file guess: a task naming several files was held to one, and a task saying "save it to solution.ts" (no word "file") could be held to none, though the contract and the trust receipt listed them. Plan-execute sub-steps are exempt explicitly (`deliveryScope: "step"`), so a step is never held to the whole plan's files. A call such as `console.log(` in task text is no longer mistaken for a file name.

Cortex exposes the framework's tool disclosure setting. The chat `/tools` picker gains "Show tools: all / index / discover / tier default" rows (`.withTools({ disclosure })`), the run view shows the resolved disclosure mode and the layer that decided it, and the Lab `tools.builtins` field suggests the framework's toolset names (now including `read`) instead of a hand-copied list.

Wave 1 (Local-Tier Reliability) thinking channel, provider half: the public `StreamEvent` union gains a `thinking_delta` variant and an optional `thinking` field on `content_complete` (strictly additive, rollback-tolerant). The local (Ollama) stream loop now accumulates and forwards `message.thinking` chunks in the same pass as content, gated by the existing thinking-capability seam; the Anthropic adapter's extended-thinking deltas route through the same event, gated by `resolveThinkingEnabled`. Non-thinking models emit zero `thinking_delta`. ui-core records (comment) why provider thinking is deliberately not mirrored onto the UI wire protocol; a three-binding parity test (react/svelte/vue) pins the #188 divergence class. Kernel consumption + forensics (W1.3/W1.4, this release): the reactive kernel's stream accumulator now consumes `thinking_delta` / `content_complete.thinking` and sets `thinking` on the per-iteration LLM response, activating the PRE-EXISTING `providerThinking` → `rescueFromThinking` → `lastThinking` final-answer machinery with zero new parsing logic. Thinking presence is treated as always-possible on capable models, never as consent (W1.2 ruling) — rescue/FA-check paths key on thinking CONTENT only. This fixes the S2-baseline thinking-starve class (4-char visible content vs 1.8-2.6K thinking tokens per run): an answer riding the thinking channel is now recovered instead of lost; no-thinking streams are byte-identical to previous behavior (golden-pinned). The `llm-exchange` trace event's `response` gains two strictly additive optional forensics fields — `thinkingChars` (full length of the provider's internal reasoning for the exchange) and `thinkingPreview` (prefix capped at the existing PREVIEW_MAX trace-budget constant, never the full text) — so `rax diagnose replay` shows what the model actually produced. Fields are emitted only when thinking was received; `isTraceEvent`'s per-kind required-field set did NOT grow and pre-existing traces load unchanged (pinned).

Terse-answer rescue guard (W1.5-defect fix, this release): activating the thinking channel made the `rescueFromThinking` UNLABELED-PROSE fallback (branch 4) reachable for the first time, and the post-W1 S2 capture measured it destroying correct terse answers — 5/5 runs shipped 525-1,915-char mid-sentence reasoning tails over the model's visible `'3052'` at a natural end_turn stop. Deterministic gate: branch 4 may now override non-empty visible content only when the exchange's stop reason indicates truncation (`max_tokens`/`stop_sequence`, computed from the provider-reported stop reason — no LLM judgment); the empty-visible-content starved shape and the structured marker branches (FINAL ANSWER / ACTION / code block, which carry the model's own explicit answer declarations) are unchanged. Correct short visible answers survive; answers that genuinely live only in a cut exchange's thinking are still rescued (pinned in both directions).

New `dockerExecuteToolFor(config)` builds the docker-execute definition from the same sandbox config as `makeDockerExecuteHandler(config)`. The description states the resolved network mode, whether the filesystem is read-only, the memory limit and the kill timeout. The definition timeout follows `config.timeoutMs`, so a sandbox timeout above 30s is no longer cut at 30s by ToolService. `dockerExecuteTool` is `dockerExecuteToolFor()` (default config) and only gains the memory, timeout and read-only filesystem facts in its text.

A model that calls a tool which is not on its surface (a builtin left out by the `withTools()` opt-in default, a name outside an allowlist, a contract-forbidden tool, or a made-up name) is now told so on its next turn, with or without `requiredTools`. The `Guidance:` block names the tool, says whether it is not enabled for this run or does not exist, lists the tools the model can call, and states that the action was not performed. Before this, the resolver's hint was kept only in the run's internal steps and never reached the model. After two such calls the tools are withheld as before. The prose instruction now also says none of the attempted calls ran and that the answer must not claim them. The hint is a new guidance kind (`toolUnavailable`), and the required-tools (ICS) steer keeps it when it replaces the guidance record.

Host `code-execute` now kills the whole process group on timeout, so a child process the code started cannot keep the call open past the limit. A timed-out run returns `executed: false`, `timedOut: true`, an error naming the limit, and the console output printed before the kill. `CodeExecuteConfig` gains `timeoutMs` (default 30s; the definition timeout follows it) and `recall`. The description and the "storage key, not code" refusal tell the model to call `recall` only when `recall: true` says it is registered; otherwise they tell it to inline the text.

File tools now keep their sandbox root across Effect fiber scheduling. The root lived only in AsyncLocalStorage, which Effect's scheduler can lose after a yield, so a relative `file-write` path inside `withFileRoot(dir, …)` could resolve against `process.cwd()` and escape the run's directory. A `FileRootRef` FiberRef now carries the root (`bindFileRoot(effect)` pins it), and `getFileRoot()` reads it first. New exports: `FileRootRef`, `bindFileRoot`, `currentFileRoot`.

Harness-vs-model failure attribution (zero tokens). New `attributeFailure(trace)` in `@reactive-agents/trace` answers "is it my harness configuration or the model?" for any recorded trace, with or without an `eval-graded` grader verdict. It locates the divergence turn (the `llm-exchange` that produced the failing file or answer), checks whether the tool results the run obtained were in that turn's projected request, and returns a verdict (`harness` / `model` / `unattributed` / `not-failed`), a reason (`harness:false-veto`, `harness:tool-surface`, `harness:tool-call-dropped`, `harness:tool-call-corrupted`, `harness:premature-stop`, `harness:evidence-truncated`, `harness:evidence-missing`, `harness:misleading-guidance`, `model:ignored-guidance`, `model:had-evidence-wrong-output`), a confidence, `eventKind#seq` evidence and the missing signals. New CLI `rax diagnose attribute <runId|path> [--json]` and `attribute --all <dir>` (counts by verdict and reason); `rax diagnose cause --json` gains an `attribution` field.

A sub-agent that crashes now adds its full spend to the parent run (tokens, cost, input and output tokens, and LLM calls, including spend inside the phase that failed). Before, only tokens and cost were folded, and spend in the failing phase was lost. `AgentResultMetadata` now declares `llmCalls`, the number of LLM calls the run made (the value was already reported).

W0.3 front-door truth: `build()` and `buildEffect()` now warn prominently when the provider silently defaults to `"test"` because the user never expressed provider intent. A bare `ReactiveAgents.create().build()` used to return canned output and report success without ever calling a model (silent fake green). The check lives in one private method invoked from `buildEffect()`'s Effect.gen; `build()` is covered transitively via its `Effect.runPromise(this.buildEffect())` delegation, keeping exactly-once-per-build on both terminals. Explicit arms stay silent: `.withProvider(...)` (including `"test"`), `.withTestScenario(...)`, and `.withReplayLLM(...)`; `quick()`/`fromConfig()` route through `.withProvider()` so they never fire. Signal only: no throw, no default change.

The plan-execute-reflect strategy now runs on the shared strategy run substrate, like direct, reactive, tree-of-thought and reflexion. One run ledger collects its direct tool calls, its plan checklist and every step kernel's own ledger. Before, each step's ledger was rebuilt from its steps. One spend meter counts every model call. Reported `llmCalls` is now complete: the single-analysis generation and the rationale retry were previously not counted. Tool evidence from composite steps now appears in the result's steps. Abstention, budget stops and approval pauses end the run through the same terminal as the other strategies. A grounded abstention, a budget stop and a paused approval produce the same results as before.

Fix contract compiler minting task input files as deliverables (GH #251). `deriveDeliverablePaths` no longer admits paths on the deliverable-list intro alone: no-verb candidates now require a write verb before the token, no existential inventory framing ("there are N files"), and no forward read verb consuming the token. A task that names input files then reads them (S3 shape) now compiles only its real output artifact instead of failing runs that did correct work.

W0.8 Replay-as-CI surfaced. New `tests/replay-ci-lane.test.ts` executes the cookbook's "Deterministic testing" flow end-to-end against a committed fixture recorded by the real trace recorder (`tests/fixtures/ci-lane-run.jsonl`, regenerable via `tests/fixtures/regenerate-fixture.ts`): record → commit → `loadRecordedRun` + `buildSequentialLLMTable` + `makeReplayLLMLayer` → `.withReplayLLM` → byte-identical output with no API keys. No `src/` behavior changed; the patch bump carries the test lane + fixture that pin the documented surface, alongside the cookbook section and the snapshot-replay page's badge correction (experimental → stable, matching `reference/stability.md`'s own v0.12 list and the page's existing @stable claim). Known quirk surfaced by the lane, not fixed here: the live recorder stamps `run-started.task` as `""` (packages/trace normalize), so the CI lane passes the task explicitly and the `replay()` orchestrator replays an empty task on fresh recordings.

Cortex chat gains opt-in agent session control. Turn it on per chat with `/agent on` ("Let the agent manage this chat"); it is off by default and stored as `agentControl` in the session config. When on, the agent can propose goal, loop/schedule and config changes. Each proposal shows inline in the chat as a card with Apply and Dismiss; nothing changes until you click Apply, and a failed Apply leaves the proposal pending with its error. Applying refreshes the goal bar, schedules and session config. No claim is made that small local models propose correctly or reliably; this is unmeasured.

Reactive intelligence's tool-failure redirect no longer ends runs that have changed approach. Before this fix, every first fire was an early-stop: the handler counted its own log entry as a prior fire, so the redirect nudge never ran. That covered 30 of 30 fires in the recorded long-horizon and H3 traces. The first fire is now the nudge. The nudge no longer says the tool is "unavailable" or orders a final answer. It asks the model to stop retrying the failing call and change approach. A run is stopped only when the model's next batch still calls the failing tool. A batch that has switched tools (for example, file-writes after a failed file-read) now runs. The failure streak counts batches, not results, so two parallel failures in one batch count as one. The kernel passes the pending batch's tool names to the controller as `pendingToolNames`.

Cortex builder follow-ups. `POST /api/runs` now validates the loosely-typed body fields before launch: malformed `agentTools` entries and nameless `variables` are dropped, and `modelRouting.tierModels` keeps only the `haiku`/`sonnet`/`opus` keys (previously the body was forwarded untyped). A durable store `dir` in a saved or chat config is no longer silently dropped. The docs page now covers the chat quick bar and the Lab shell, workspace, guardrail and approval-mode controls, and notes that a chat turn paused by an approval-gated tool cannot yet be approved from Cortex.

The agent can load a skill with `activate-skill` (skills spec step 4).

- When a run has skills to load (`KernelInput.skillsContext.skills`), the kernel offers `activate-skill` on the tool surface and runs it inline. Runs without skills get the same tool array and system prompt as before.
- `activate-skill({ name })` returns the skill's `<skill_content>` envelope as a tool result. The result is protected from compaction, so it stays in context for the rest of the run, and the activation is recorded as a `skill-activated` ledger fact (`name`, `sha256`, `source`, `via`, `tokens`). A second call for the same skill, or for a skill already pinned in the system prompt, returns "already loaded".
- Budget: one skill body may take at most `min(5,000 tokens, 10% of the context window)`, and all loaded skill bodies together at most 20% of the window. Over the limit, the call is refused with a message that points to `activate-skill({ name, file })`.
- `activate-skill({ name, file })` reads one file inside the skill's directory. It is an ordinary tool result: compressed like any other, not protected, no ledger fact.
- The skills section of the system prompt now starts "Skills: call `activate-skill` to load one before you start that kind of work." when the run can load skills. The old "do NOT call them as tools" line is gone.
- reactive-intelligence: the skill catalog no longer appends a `get_skill_section(...)` hint, because that tool no longer exists. `generateCatalogXml`'s `catalogOnlyHint` option is deprecated and has no effect.

Scaffolder unification (Local-Tier Reliability W0.6): `rax init` now delegates project generation to the `create-reactive-agent` template engine instead of apps/cli's private duplicate generator. Template names come from the engine's `listTemplates()` (minimal, with-tools, streaming, with-structured-output, with-approval-gates, with-memory, cloudflare-worker); the old `standard`/`full` names are removed with no compat aliases (rax init is pre-1.0). Invalid `--template` values error with the real names. Generated projects inherit the engine's W0.1 own-version pin and W0.2 `.env` guard for free. The duplicated `src/generators/project-generator.ts` is deleted; `apps/cli/src/templates/*` (deploy-file templates, consumed by `rax deploy`) are untouched.

## [0.17.0] — 2026-10-11

Entropy-observer failures are now published as `ErrorSwallowed` events instead of vanishing silently. All eight bare swallow sites in the reactive observer, including the entropy-sensor scoring path that silently degraded the Reactive Controller and calibration/drift detection, route through `emitErrorSwallowed`. The never-error, not-fatal semantics are unchanged: the helper never throws and no-ops without an ambient `EventBus`.

Add `rax examples` to run the example suite, list standalone demos, and launch
demos such as Island Survival with provider, model, and port options.

Reactive Agents can now connect as an OAuth 2.1 client to remote MCP servers over
`streamable-http`/`sse`. Add an `auth` config to `.withMCP()`:

```ts
.withMCP({
  name: "billing",
  transport: "streamable-http",
  endpoint: "https://mcp.example.com/mcp",
  auth: {
    type: "client_credentials",
    clientId: process.env.MCP_CLIENT_ID!,
    clientSecret: process.env.MCP_CLIENT_SECRET!,
  },
})
```

- Grants: `client_credentials` and `private_key_jwt` for unattended/production agents
  (no browser, no human); `authorization_code` for delegating to a specific user's own
  account, driven ahead of time with the new `rax mcp login|logout|status` CLI.
- Tokens persist to a permission-locked file store (`~/.reactive-agents/mcp-auth`,
  `0700`/`0600`) by default; pass your own `tokenStore` (e.g. `createMemoryTokenStore()`)
  for tests/CI or alternative storage.
- `interactive` defaults to `false` — an unattended run never unexpectedly opens a
  browser or binds a local port; only `rax mcp login` or an explicit `interactive: true`
  triggers the interactive flow.
- Hardened against known attack classes on top of the MCP SDK's own OAuth support:
  authorization-server issuer mix-up, HTTPS downgrade, and secret-echoing error
  messages are all closed, with no unauthenticated fallback on any auth failure.
- `stdio`-transport servers are unaffected — they take credentials via `env`, and
  setting `auth` on a `stdio` config is a startup error, not a silent no-op.

Not included (tracked as follow-ups): OS keychain-backed token storage, RFC 8693
token exchange for sub-agent delegation, and tool-description pinning/re-consent on
server-side mutation.

Fixes found live-testing against a real third-party OAuth-protected MCP server
(Google Home MCP, Early Access):
- The interactive login retry now also covers a 401 raised by a request AFTER the
  initial connect (e.g. a server, like Google's, that accepts an unauthenticated
  `initialize` but challenges the very next request) — previously only a 401 on the
  first connect attempt triggered the browser-login flow.
- The authorization-server issuer-match check no longer false-positives on a
  trailing-slash-only difference between the issuer an authorization server
  publishes and the URL it was discovered from (Google's real issuer omits the
  trailing slash; a naive string comparison refused every server shaped that way).
- MCP tools whose JSON Schema uses the `"integer"` type (distinct from `"number"`)
  now register correctly instead of failing with a schema-validation error.
- `rax mcp login` gained `--client-secret` and `--redirect-port`, for authorization
  servers that issue a confidential-client secret and/or validate `redirect_uri` by
  exact match rather than accepting any loopback port.

Two root-cause fixes surfaced by the StackBlitz playground demos, both
pinned red-before-green.

**Adaptive sub-strategy relay (`runtime`).** `AgentResult.metadata.strategyUsed`
reported `"adaptive"` on every adaptive run instead of the sub-strategy the
router dispatched. `normalizeReasoningResult` (engine/util.ts) rebuilds
strategy metadata from a whitelist and never copied `selectedStrategy`, even
though the same type declares it - the declare-but-drop drift class DEBT-REGISTER
Section 3 tracks for runLedger/verdict/scratchpad. The key now passes through,
so `reasoning-think.ts`'s existing relay chain resolves to the real sub-strategy
and `strategyUsed` (and the engine's AgentCompleted event) report what actually
ran. Tests: `packages/runtime/tests/normalize-reasoning-result-selected-strategy.test.ts`.

**Run-level budget enforcement for plan-execute-reflect (`reasoning`).**
`.withBudget({ tokenLimit })` could be overshot arbitrarily by
plan-execute-reflect: the kernel's Arbitrator pre-intent guard counts spend
SINCE ITS OWN KERNEL START, and plan-execute threaded the same FULL limit
into every step sub-kernel while its outer plan/analysis/reflect/synthesis
LLM calls were never guarded at all (live: 25,675 tokens past a 20,000 cap).
New shared helper `strategies/budget/remaining-budget.ts` gives the strategy
layer run-scoped accounting: each wave's step kernels receive the REMAINING
budget, and once cumulative spend crosses the limit the strategy stops
launching any new work (step waves, reflect, refinement, synthesis, quality
gate), terminating honestly as `status: "partial"` with
`budgetTerminalPartial`/`harnessAuthoredOutput` markers and a
`rawTerminatedBy: budget-limit:tokens:<spent>/<limit>` reason shaped like the
compose killswitch. Overshoot is now bounded to the in-flight wave. The
per-kernel-invocation Arbitrator semantics are unchanged; reflexion and
tree-of-thought share the multi-kernel gap (audit-only, follow-on work) and
can adopt the same pure helper. Tests:
`packages/reasoning/src/strategies/budget/remaining-budget.test.ts`,
`packages/reasoning/src/strategies/plan-execute-cumulative-budget.integration.test.ts`
(deterministic TestLLMService, no network).

Fix `completeStructured()` sending a corrupted output schema on all 5 providers (local, openai, gemini, anthropic, litellm). Each built the schema via `Schema.encodedSchema(outputSchema)`, which returns another Effect `Schema` instance rather than a JSON-serializable object — `JSON.stringify()` on it evaluates to `undefined`. On local/openai/gemini this crashed with `SyntaxError: JSON Parse error: Unexpected identifier undefined`; on anthropic/litellm it degraded silently, sending the model the literal text `"undefined"` in place of the real schema. Fixed by using `JSONSchema.make()` instead.

Fix Gemini provider selection and provider guidance in `rax demo`.

Apply the Ollama per-call timeout while the streaming request is being set up,
including the wait for the first response chunk. The timeout now aborts the
underlying SDK fetch instead of leaving a cold or stalled request unbounded.

New public judgment primitives on the agent facade, and re-exports so their types are reachable through the `reactive-agents` package (not just `@reactive-agents/runtime`):

- **`agent.listJudgmentModels()`** — lists the configured `JudgmentService` backend's available models (`jev`: live TypeSafe catalog; `llm`: rejects, since it has no catalog endpoint). Throws immediately if `.withJudgment()` was never called, same contract as `agent.judge()`. Named `listJudgmentModels` (not `listModels`) — it's scoped to the judgment backend, not the LLM provider models `.withModel()` selects from.
- **`agent.judgeRank(candidates, question, opts?)`** — batched Score-based candidate re-ranking: judges every candidate against one shared question in as few `JudgmentService.ask()` calls as possible (`opts.chunkCap`, default 30), instead of the one-round-trip-per-candidate cost of hand-rolling `Promise.all(candidates.map(c => agent.judge(...)))`. Returns candidates sorted best-first; ties keep input order.
- **`includeContext`** on `agent.judge()` is now `boolean | JudgeContextConfig`: `true` folds every context layer (recent messages, tool results, and the full reasoning-step trace — thoughts/actions, not just tool observations) with its own default window; an object form (`{ messages?, toolResults?, reasoningSteps? }`) opts into only the named layers, each independently windowable/type-filterable.
- `reactive-agents` (the umbrella facade package) now re-exports `JudgeInput`, `JudgeRankCandidate`, `JudgeRankOptions`, `JudgeRankQuestion`, `JudgeRankResult`, `DEFAULT_JUDGE_RANK_CHUNK_CAP` (from `@reactive-agents/runtime`) and `JudgmentModel`, `JudgmentUnsupported` (from `@reactive-agents/judgment`) — these were already exported from `@reactive-agents/runtime` but were missing from the `reactive-agents` facade, so `import type { JudgeInput } from "reactive-agents"` did not compile.

`judgeRank()` now rejects loudly (instead of hanging) when `opts.chunkCap` is non-positive or non-finite, and rejects duplicate candidate ids up front rather than silently letting the last duplicate overwrite an earlier one.

New `.withJudgment(options?)` builder method wires an opt-in `JudgmentService`
(Choice/Score/Noul over `jev`/`llm`) into any agent, alongside a new public
composable primitive: `agent.judge({ state, questions })` — calibrated typed
judgments callable directly from user code, outside any run. Throws loudly
if `.withJudgment()` was never called (a caller mistake, not a silent no-op).

Every internal harness site this release touches is either **shadow-only**
(computes a judgment answer and compares it against the existing
heuristic/LLM decision for later ablation, but never changes what actually
ships) or **additive** (can only add a signal on top of what already passes,
never remove one, unless an explicit stricter opt-in is set):

- **Strategy selection** (`@reactive-agents/reasoning`) and **complexity
  routing** (`@reactive-agents/cost`) — shadow-only judgment classification
  alongside the existing regex/keyword heuristics. Emits `JudgmentShadow`
  events for agreement analysis; the heuristic decides exactly as before.
- **Task comprehension** (`@reactive-agents/reasoning`'s kernel) — shadow-only
  judgment fan-out reproducing the regex-derived task classification signals.
- **Guardrails** (`@reactive-agents/guardrails`) — new opt-in judgment battery
  (`enableJudgmentBattery`) runs parallel to the existing regex detectors.
  Default `judgmentStrictness: "additive"` can only add a violation or
  escalate severity (a strict superset of today's regex-only behavior);
  `"jev-primary"` is an explicit opt-in that can also unblock a regex hit the
  battery disagrees with. New opt-in `screenOutputs` runs the same battery
  over replies, observability-only (`GuardrailOutputFlagged`, never blocks).
- **Autonomy/approval confidence** (`@reactive-agents/interaction`) — the
  highest-blast-radius shadow site in this release: `PreferenceLearner`'s
  existing confidence/occurrences/cost-threshold auto-approve gate decides
  exactly as today; a judgment shadow runs in parallel for future ablation,
  never feeding back into the decision.
- **Tool-call healing** (`@reactive-agents/tools`) — new `runJudgmentHealing`
  escalation, additive over the existing synchronous fuzzy-match healer. Only
  fires when the sync healer's edit-distance/alias match misses; heals only
  above a 0.8 confidence floor, otherwise degrades to the original call
  unchanged. The existing synchronous healing pipeline is unmodified.

Every site above degrades cleanly (never fails, never blocks) when
`JudgmentService` is unconfigured, when the backend errors or times out, or
when a judgment answer doesn't clear its confidence floor — behavior for any
agent that never calls `.withJudgment()` is byte-for-byte unchanged.

No default-on behavior changes for existing agents. Several sites' exit
gates (inverting a shadow into a real decision) need real production shadow
data before that follow-up work is justified — tracked in the implementation
plan (`wiki/Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer.md`),
not shipped speculatively here.

`agent.judge()` gains an opt-in `includeContext` auto-context merge:
`agent.judge({ questions, includeContext: true })` folds the agent's own
recent message history and tool observations into `state` automatically,
instead of requiring the caller to hand-assemble it. `messageWindow` and
`includeToolResults` tune what gets folded in; an explicit `state` field
always wins on key collision. Zero cost and byte-identical behavior when
`includeContext` is omitted.

`state` is now only optional when `includeContext: true` supplies it — a
discriminated-union type change on `agent.judge()`'s options. Every existing
call site that already passes `state` (including `state: null`) is
unaffected; `agent.judge({ questions })` with neither `state` nor
`includeContext` was previously a silent-`undefined` type hole and is now a
compile-time error.

Two new shadow-only judgment sites in the reasoning kernel: a
completion/termination Noul alongside the Verifier's existing terminal
checks, and a grounding/fabrication Noul alongside the deterministic
content-containment check `assembleDeliverable` already runs. Both are
observation-only — they emit `JudgmentShadow` events for later agreement
analysis and never alter what the heuristic actually decides. Degrades
cleanly (no-op) when `.withJudgment()` was never called.

`@reactive-agents/reasoning` also exports `compressToolResult` and
`CompressResult` (previously internal) from its package root, used by
`agent.judge({ includeContext })`'s tool-observation folding.

File tools now fail helpfully instead of just refusing. A path that escapes the working root is still refused every time, but the rejection names the working root, states the relative-path rule, and suggests the deepest in-root suffix match when one exists, so the next call can be the right one instead of another guess (previously a hallucinating model could burn several rejected calls per run). `confinePath()` is now the single confinement point for file-read, file-write, and directory listing, and the file tool schemas say relative-to-root outright.

Default `generateAgentCard`'s `capabilities.streaming` to `false`. Real SSE
streaming was never implemented — `handleMessageStream` awaits full task
completion and joins the events into one response body, and the prior
`createSSEStream` stub never enqueued anything onto its `ReadableStream` — so
advertising `streaming: true` let a client rely on a capability that did not
exist. A caller with real streaming wired can still opt in via
`generateAgentCard({ capabilities: { streaming: true } })`.

Wired `A2AOptions.basePath` (previously silently dropped): `.withA2A({ basePath })`
now prefixes all three A2A routes (JSON-RPC, `/agent/card`,
`/.well-known/agent.json`) via `createA2AHttpServer`'s new third argument and
`ReactiveAgent.serveA2A({ basePath })`.

Breaking, dead-code removal: `A2AServer`'s `setMessageHandler` (always
discarded its argument; `serveA2A()` now supplies the real executor through
`createA2AHttpServer`), the unused `generateId` helper in `a2a-server.ts`,
the unused-and-drifted `JsonRpcMethod` type in `http-server.ts`, the stubbed
`createSSEStream` in `streaming.ts`, and the zero-consumer `A2AService`/
`A2AServiceLive` (`a2a-service.ts`, not even exercised by its own test file)
are all removed. None had any non-test caller in the monorepo.

Breaking, more dead-code removal (final-review pass): `createA2AServerLayer`
and `A2AServerLive` (`runtime.ts`) built `createA2AHttpServer` with NO
executor. Their only caller, `A2aExtraLayer`, was deleted in Task 2 of this
same plan, leaving both exported with zero non-test callers anywhere in the
monorepo. Removed from `runtime.ts` and from `@reactive-agents/a2a`'s and
`@reactive-agents/reactive-agents`'s public exports. `createA2AClientLayer`/
`A2AClientLive` are unaffected and remain exported.

Fixed alongside: without an executor, `message/send` used to silently accept
the task and leave it stuck in `submitted` forever with no error — now it
fails immediately with an `INTERNAL_ERROR` A2AError ("No executor configured
for this A2A server"). `createA2AHttpServer`'s `executor` parameter stays
optional (a card-only/discovery server is still a legitimate configuration),
but any real task-submitting call against one now surfaces the misconfiguration
instead of hanging silently.

Add `setupLangfuseExporter` — a preset that ships OpenInference-attributed agent traces to Langfuse over OTLP.

- `setupLangfuseExporter(config?)` computes Langfuse's `/api/public/otel` endpoint and the HTTP Basic auth header from `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_HOST` (or explicit config), and sets `x-langfuse-ingestion-version: 4` for real-time ingestion. Returns an `ExporterHandle`.
- `buildLangfuseConfig(config?)` exposes the pure endpoint/auth builder for advanced wiring and testing.
- New `LangfuseExporterConfig` type: `{ publicKey?, secretKey?, host?, serviceName?, headers? }`.

Because it builds on `setupOpenInferenceExporter`, spans arrive with LLM semantic attributes and render as agent/LLM/tool traces in the Langfuse UI. Regional and self-hosted hosts (EU/US/JP/custom) are supported via `host`.

**Run-scoped budget enforcement (Issue #231 / DEBT D-2026-10-05-P).**
`.withBudget({ tokenLimit, costLimit })` was enforced per kernel invocation,
not per agent run: the Arbitrator's pre-intent guard read `state.tokens`, which
`initialKernelState` resets to 0 at every kernel start. Multi-kernel strategies
that also make direct LLM calls between kernels (plan-execute-reflect, reflexion,
tree-of-thought, blueprint) therefore handed each kernel a fresh pool, and their
direct calls entered no guard at all (live: 25,675 tokens past a 20,000 cap).

The observable LLM wrapper is the one chokepoint on every call path, so it now
feeds a run-scoped `RunBudgetMeter` carried on the ambient `CurrentRunBudget`
FiberRef. `ReasoningService.execute` arms one meter per reasoning execution when
budget limits are declared; the kernel runner stores the live reference on
`state.meta.runBudgetMeter`; the pure+sync Arbitrator reads cumulative run spend
(`Math.max(meter, state.tokens)`) instead of the per-kernel reset value, so all
strategies inherit run-level enforcement by construction. The meter is a plain
mutable object because `arbitrationContextFromState` is synchronous; numeric
`+=` is atomic in single-threaded JS. Crash-resume max-seeds the fresh meter from
the persisted numbers.

Runs without `.withBudget()` are byte-identical (no meter armed, no new
`state.meta` field). New exports: `CurrentRunBudget`, `makeRunBudgetMeter`,
`addRunSpend`, `withRunBudgetMeter`, types `RunBudgetMeter`/`RunBudgetSpend`.

The meter carries the **run-scoped original limits** too (`CurrentRunBudgetLimits`
→ `state.meta.runBudgetLimits`), and the Arbitrator uses them when the meter is
present. Without this, run-total spend would be compared against the *reduced*
per-kernel limit plan-execute hands its step sub-kernels (`withSpentBudget`),
halting a run early by up to the prior spend (e.g. run total 65 vs true limit
100 halted because the reduced limit was 60).

**Structured calls are metered too (`llm-provider`).** `runStructuredParseWithRetry`
now surfaces the provider's real (retry-summed) usage on the exported
`StructuredUsageRef` FiberRef; the observable wrapper reads it after
`completeStructured` and feeds the meter. `completeStructured`'s public return
type is unchanged (`A`). This closes the plan-generation/extraction accounting gap.

**The meter is now WHOLE-RUN scoped (`runtime`, #232 Gap 2).** It used to be
armed per `ReasoningService.execute`, so auxiliary passes that call `execute`
without `budgetLimits` — the verification THINK retry and the post-think
continuation hooks — armed no meter and were unbudgeted (a run could exceed its
cap by a full auxiliary pass). The runtime now arms ONE meter at the
once-per-run `ExecutionEngine.execute` boundary (`engine/run-budget-arm.ts`);
`ReasoningService.execute` reuses that ambient meter when present (and only
creates its own for direct callers/tests outside the engine). Every LLM call a
run makes — main pass, auxiliary passes, memory/debrief phases — feeds the same
accumulator, and each kernel inherits the run limits via the runner's
`state.meta.runBudgetLimits` seed, so an auxiliary-pass kernel enforces the run
budget even though it declares none.

Tests: `kernel/run-budget.test.ts` (primitive, wrapper feed incl. structured,
Arbitrator consume, runner seed, resume max-seed, codec round-trip),
`kernel/run-budget-strategies.test.ts` (reactive / plan-execute-reflect /
reflexion / tree-of-thought / blueprint halt on a crossed limit; auxiliary pass
with no `budgetLimits` halts on the ambient run limit),
`services/reasoning-service-run-budget.test.ts` (production wiring + ambient
meter reuse), `runtime/tests/run-budget-arm.test.ts` (runtime arming seam),
`llm-provider/tests/structured-usage-ref.test.ts` (usage surfaced).

**Strategy gates unified on the meter (#234).** Direct LLM calls between kernels
never enter the Arbitrator, so the per-strategy gates remain the direct-call
enforcement complement (full removal is premise-falsified). Their duplicated
accounting is gone: `strategies/budget/run-budget-spend.ts` `resolveRunSpend()`
reads the run meter and maxes it over the strategy's local figure, so
plan-execute's quality-gate/wave/reflect gates and blueprint's SOLVE gate agree
with the Arbitrator on the boundary.

The `write_result_to_file` hint appended to overflowing tool-result previews is now gated on that tool actually being offered to the model (`offersWriteByRef(schemas)`). Previously the hint was unconditional, so the default harness (where `write_result_to_file` is not registered unless `RA_OVERHAUL=1`) instructed models to call a tool that does not exist. Live bench measurement (rw-4, claude-haiku-4-5, n=3): the hint appeared on 13/13 overflow events before this fix and 0/13 after.

Terminal scaffold-leak no longer hard-fails the run on sight, it gets ONE
bounded corrective synthesis pass first.

When a model's final answer echoed framework scaffolding
(`[STORED: _tool_result_N]`, "compressed preview", "full text is stored")
instead of the tool data, the always-on scaffold-leak guard rejected it and
the run died with `ExecutionError: Verifier rejected output: final-answer:
failed at scaffold-leak`, zero repair attempts, even though the real answer
sat in the scratchpad the whole time. The existing repair machinery
(`enforceQualityGate` DATA→FORMAT synthesis, the arbitrator's
`synthesisQualityRetry`) only covers reflexion/plan-execute terminals and
text-protocol `final-answer` intents; native-FC runs never offer the
`final-answer` tool, so the terminal verifier gate was their only checkpoint.

The runner's terminal gate now mirrors the Phase D1 cap-then-degrade
precedent for grounding: on a scaffold-leak rejection it attempts exactly ONE
corrective synthesis pass from the validated, scratchpad-resolved
observations, re-verifies against the same terminal context, and ships the
repaired answer with honest `harness_synthesis` provenance when clean. If
the repair still leaks, the previous behavior is unchanged, the run fails
honestly, and the specific scaffold-leak reason still surfaces on the
result/receipt (`verifierVerdict: "reject"`). The guard itself is NOT
weakened: scaffolding dumps can still never ship as an answer.

Regression coverage: `packages/reasoning/src/kernel/loop/scaffold-leak-terminal-repair.test.ts`
(deterministic, TestLLMServiceLayer, no network) +
`packages/runtime/tests/scaffold-leak-repair-e2e.test.ts` (public `agent.run()` boundary).

Read provider API keys from the environment at build time; refuse to send a missing groq/xai key's OpenAI fallback to a third-party host.

Judgments can now run completely local and private. `.withJudgment({ backend: "ollama" })`
points the Choice/Score/Noul primitive at Ollama's System One decision API
(`ollama pull nimble`, or Cloudflare's `clef` / `clef-flash` for vision), with
calibrated distributions, no API key, and no outbound network.

```ts
const agent = await ReactiveAgents.create()
    .withProvider('anthropic')
    .withJudgment({ backend: 'ollama' })
    .build()
```

The Ollama backend is one descriptor in a shared System One protocol engine
(`makeSystemOneHttpBackend`), so a second System One provider (hosted or
local) is a descriptor file plus tests, not a new backend module. A provider
outside the System One family still plugs in through the existing
`JudgmentBackend` interface.

Capability negotiation: backends now declare `JudgmentCapabilities`
(`maxQuestions`, `supportedKinds`, `distributions`, `calibrated`, `images`,
`modelCatalog`) and consumers adapt automatically: `judgeRank()` and the
comprehension chunker clamp to the backend's real ceiling instead of a
hardcoded constant. Read them with `capabilitiesOf(service)`; a service that
predates the field gets the safe defaults.

`agent.judge()` accepts an optional `images: string[]` channel (base64 only,
vision model required, 32 MiB ceiling) for screenshot- and UI-state-style
questions:

```ts
const { passes } = await agent.judge({
    state: { task: 'Check the checkout page for layout breakage' },
    questions: { passes: { type: 'noul', instructions: 'Is the page visually broken?' } },
    images: [base64Png],
})
```

`.withJudgment({ backend: 'ollama', ollama: { keepAlive: '10m' } })` keeps the
decision model warm between calls. The `jev` and `llm` backends are unchanged.

`AgentStream.collect(agent.runStream(...))` now reports the same terminal outcome as `agent.run(...)`: `success`, `terminatedBy`, and `goalAchieved` are read off `StreamCompleted` (which now carries them) instead of `collect()` hardcoding `success: true` and silently dropping the other two, and `metadata.toolCalls` is derived on the stream path the same way `run()` derives it (both now share `deriveMetadataToolCalls` in `engine/finalize/derive-outcome.ts`). A failed or abstained streamed run no longer collects as a success with no tool calls.

A2A serving now actually works. Previously `.withA2A()` composed a server layer
at runtime-construction time — before the agent existed — so it bound no port
and reached no executor; an agent configured for A2A silently served nothing.

Serving is now an explicit call that binds before it returns:

```ts
const handle = await agent.serveA2A({ port: 3000 });
// ... other agents can now reach it at /.well-known/agent.json
await handle.stop();
```

`.withA2A({ port, basePath })` still configures the defaults `serveA2A()` falls
back to when the caller omits them. `rax serve` now uses this same server
implementation instead of its own hand-rolled copy.

Protocol fixes:
- `message/send` returns a spec-shaped `A2ATask` (`id`, `status`, `artifacts`,
  …) instead of a bespoke `{ taskId }`.
- JSON-RPC responses echo the request `id` instead of a hardcoded value.
- `configuration.blocking` is honored: a non-blocking send returns immediately
  in `submitted`/`working` state and the caller polls `tasks/get`.
- `tasks/cancel` now finds the task it's asked to cancel — it previously read
  from a different task store than `message/send` wrote to and always
  reported `TASK_NOT_FOUND`. This fixes lookup only: canceling a task
  currently marks it `canceled` in the store without yet interrupting the
  underlying agent run; the forked run completes in the background
  regardless. Full cancellation (retaining a fiber handle to interrupt) is a
  separate, out-of-scope follow-up.

Client fixes: both `@reactive-agents/a2a`'s `A2AClient` and the runtime's
`.withRemoteAgent()` / `.withAgentTool()` now read the real `A2ATask` shape
(`task.status.state`, `task.artifacts`) instead of the old bespoke response
shape they previously (and incorrectly) assumed.

Env var rename: `rax serve`'s bind-hostname and auth-token env vars are now
`RA_A2A_HOST`/`RA_A2A_TOKEN` (previously `RA_SERVE_HOST`/`RA_SERVE_TOKEN`),
matching the name `agent.serveA2A()` / `@reactive-agents/a2a`'s HTTP server
already read directly. The old names still work as a deprecated fallback
(with a one-line stderr warning) — not dropped, since existing deployments
may set them.

Strategy switches now mint a typed `handoff` ledger fact (rendered by the standing frame, protected by compaction) instead of string-folding the switch summary into `priorContext`. Fixes a real data-loss bug found while characterizing the switch path: `initialKernelState` was resetting the run ledger to empty on every strategy switch, silently dropping all prior tool-invocation, artifact, and requirement facts recorded before the switch. The prior ledger is now carried forward across the switch, with carried tool-result observations de-duplicated against the projection chokepoint so a carried call does not mint a second `tool-result` fact.

`run-completed` trace events now carry the real run cost (`totalCostUsd`) and raw termination reason (`terminatedBy`) instead of hardcoding cost to 0 and dropping the reason entirely. `AgentCompleted` gains an optional `totalCostUsd` field forwarded from `result.metadata.cost` at finalize; `RunCompletedEvent` gains an optional `terminatedBy` field mapped from `AgentCompleted.terminationReason`.

New `@reactive-agents/judgment` package: a calibrated typed-judgment primitive
(Choice/Score/Noul with probabilities) over a provider-abstracted
`JudgmentBackend` — `jev` (TypeSafe's System One model, `@typesafe-ai/sdk`)
and `llm` (structured-output emulation over your existing `LLMService`, no
TypeSafe key required). Every judgment call emits `JudgmentEvaluated`/
`JudgmentFailed` EventBus events.

`@reactive-agents/eval` now scores the four LLM-judged dimensions
(accuracy/relevance/completeness/safety) via the `jev` engine by **default**
— one batched request per case instead of four separate float-prompt LLM
calls, with real calibrated `confidence` (was: `parseFloat(...) || 0.5`, a
silent 0.5 on any parse failure). The original LLM-judge path is unchanged
and selectable via `judgeEngine: "llm"`; with no `JudgmentService` wired at
all, behavior is byte-for-byte identical to before this release.
`EvalConfig.repeats` (default 1) enables repeated-scoring runs whose
variance now drives `checkRegression`/`compare` via a statistically-derived
minimum-detectable-effect instead of a flat ±0.02/±0.05 epsilon — the same
flat fallback still applies to `repeats:1` runs.

`@reactive-agents/judge-server`'s `/judge` endpoint gains a `judgeEngine:
"jev"` option (default remains `"llm"`) that answers `passed`/`overallScore`/
`recommendation` from one batched Noul+Score+Choice request instead of a
text prompt parsed with `indexOf("{")`/`JSON.parse`.

No default-runtime-path behavior changes for existing agents — this release
is the measurement-tooling layer (Phase B of the judgment-primitive plan,
`wiki/Planning/Implementation-Plans/2026-09-20-typesafe-judgment-layer.md`).
The runtime `.withJudgment()` opt-in tier (Phase C) ships separately.

Add opt-in demand-driven `num_ctx` for local Ollama models (`.withHarness({ numCtxPolicy: "demand" })`). Sizes `num_ctx` to the assembled prompt each turn instead of a fixed per-model value, monotone-growing within a run to avoid unnecessary Ollama model reloads. Default remains `"fixed"` (byte-identical to today's behavior); ships opt-in pending broader measurement.

Add a `file-edit` builtin tool that replaces an exact block of text inside an
existing file, instead of overwriting the whole file like `file-write`. Agents
editing a large file no longer need to re-emit its entire contents, which cuts
token cost and removes a class of accidental-truncation bugs.

`file-edit` refuses ambiguous edits: if `oldText` is missing from the file, or
appears more than once without `replaceAll: true`, the call fails and the file
is left untouched. It declares the same `requiresApproval: true` /
`riskLevel: "high"` posture as `file-write`, so it cannot be used to bypass an
approval gate.

Telemetry's `SAFE_TOOL_NAMES` list previously named two tools that don't exist
(`file-list`, `http-request`) and was missing two real builtins
(`list-directory`, `http-get`), which were being silently stripped from
emitted telemetry — those two builtins now correctly appear in it.

The tool-result cache's default uncacheable list now also covers the
`write-file`, `fs-write`, and `writefile` aliases (previously only
`file-write` itself), so a tool registered under any of those alias names is
correctly treated as non-cacheable.

Fix phantom entropy divergence on healthy runs (FM-C3). Gate event-driven
entropy scoring to strategies without kernel-inline coverage so kernel
thoughts are scored exactly once; fix the inverted structural source,
unify short-run/normal composite weights, use semantic novelty instead of
the constant-zero task alignment, and make the console dashboard recompute
trajectory shape from deduplicated points with confidence-gated grades
and alerts.

Add a `cloudflare-worker` template: scaffolds a deployable Cloudflare Worker (edge) agent.

- `wrangler.toml` with `compatibility_flags = ["nodejs_compat"]` (required for the framework's Node built-ins on workerd) and a `.dev.vars` secret stub
- Worker `fetch` handler wired to OpenAI, with the API key injected from the Worker env binding (no `process.env` on the edge)
- `dev` / `deploy` scripts (`wrangler dev` / `wrangler deploy`) and the `wrangler` devDependency
- Provider is pinned to OpenAI for this template (fetch-based, edge-safe); persistent memory and shell/filesystem tools are unavailable on the edge

Templates can now supply `extraDevDependencies`, `extraScripts`, and `gitignoreLines`, and template-specific files override shared ones at the same path.

Removed three experimental harness mechanisms that the 2026-09-15 ablation-warden pass (`wiki/Decisions/2026-09-15-experimental-flag-verdicts.md`) found INERT on the golden corpus with no accuracy lift on the one live tier measured, and — for two of them — a large live token cost: `RA_OVERHAUL` (the `write_result_to_file` meta-tool), `RA_THOUGHT_CONTINUITY` (replaying the model's own prior thought on assistant turns), and `RA_TOOL_OBSERVE_SYMMETRY` (attaching a `VerificationResult` to the single-tool-call observation path). Each was default OFF and never promoted; this deletes the dead opt-in surface rather than leaving it unmeasured.

Breaking for direct importers of `@reactive-agents/reasoning`'s `overhaulEnabled`, `thoughtContinuityEnabled`, and `toolObserveSymmetryEnabled`, and of `@reactive-agents/tools`'s `writeResultToFileTool` / `makeWriteResultToFileHandler` — all five exports are removed. `HarnessConfig`/`ResolvedHarness` lose the `thoughtContinuity` and `toolObserveSymmetry` fields. No default behavior changes: every mechanism was already OFF by default.

`RA_TOOL_INDEX` and `RA_RATIONALE_AUDIT` were also assessed in the same pass and verdicted KEEP-OPT-IN (insufficient measurement power / non-accuracy audit purpose respectively) — no code change, only a JSDoc pointer to the decision doc.

## [0.16.0] — 2026-09-05

Fix a set of answer-quality regressions found in live-model QA: the fabrication guard now catches invented named entities, not just fabricated numbers; a raw tool-scaffolded dump no longer ships as the answer when output-gate synthesis fails; a no-tool-needed conversational reply is now auto-promoted instead of being forced through tool-output framing; and the output gate no longer forces file-shaped formatting onto plain chat replies. Behavioral-contract enforcement (`.withContract()`), previously silently dead on the kernel execution path, is now wired.

Fix three lifecycle-hook gaps found in a hook-firing audit: the kernel's `bootstrap`-`after` hook was never fired, `think` hooks incorrectly fired on tool-execution passes (not just reasoning passes), and the kernel's own `observe` hook was missing entirely. Fix a post-condition steer that could re-loop a tool-free chat turn. Move harness guidance text (required-tool reminders, nudges, hints) out of the system prompt and into the message tail, restoring the Anthropic prompt-cache breakpoint that guidance text was invalidating on every iteration.

Fix a skill-evolution crash in Cortex, and sync skill activation state with the fabrication guard so the two no longer disagree about a skill's status.

Wire the Thompson Sampling bandit into the strategy-selector seam (opt-in, off by default) and fix the calibration-drift and calibration feedback loops, both previously fully dead. Add `NoticesManager` with a notice-suppression mechanism (`REACTIVE_AGENTS_SUPPRESS_NOTICES`) for quieting repeated one-time warnings.

Remove the `alternatives-considered` trace event end to end (emitter, `AgentEvent` union member, debrief rendering): it had zero live emitters and was dead weight in every consumer. Fix plan-execute's ledger to record the healed (post-repair) tool-call arguments instead of the pre-heal ones, so the ledger matches the trace it's compared against during replay. Fix `isTraceEvent` to validate required fields per event kind instead of a single shared shape, and fix `rax diagnose` to search both known trace directories instead of only one.

Emit detailed code-action progress events for planning, sandbox execution, tool results, retries, and verification so verbose users can follow the strategy live.

Add a `grep` builtin tool and named toolset alias shortcuts (`defineToolset`), both opt-in. Add a `relate` tool for the memory graph, give `find` real memory-entry ids, and fix a second FTS5 crash site plus four dead field-name branches in tool-result compression.

Add a small tool-authoring toolkit for custom tools: `fetchJsonTool` (standard HTTP adapter with retry and empty-result handling), `boundedMap` (concurrency-capped fan-out), `searchThenFetch`/`resolveThenRetrieve` (research orchestration primitives), `withToolObservability`/`withToolRetry` (envelope helpers), and `testTool`/`mockFetchOnce` (turnkey test helpers). `defineTool` now accepts an output schema, validated at runtime. Fix MCP client connection state being isolated per-process instead of per-instance, which could cross-contaminate state across multiple MCP clients in the same process. Fix `codeExecuteHandler` to accept `config.sandbox` like its sibling handlers, and factory-shape the config surface for the `http-get` tool and A2A egress guards for consistency with the rest of the tool config API.

Remove nine `AgentEvent` tags that were exported on the EventBus but had no producer anywhere in the codebase (a "dead signal" audit; a new gate now asserts every consumed tag has a real producer). Fix `BudgetExhausted` specifically: it does have real consumers, and is now actually published when a budget killswitch aborts a run, instead of the abort happening silently.

Dedupe each binding's `AgentStreamEvent` type onto `ui-core`'s canonical `UiStreamEvent`, removing three divergent copies of the same wire-event shape.

Fix `LLMRequestCompleted` never having a producer, which silently starved nine downstream consumers (OTel LLM spans, cost accounting, cache-hit reporting). Surface `cacheReadInputTokens` in Gemini, OpenAI, and LiteLLM usage (previously Anthropic-only), switch Anthropic to automatic prompt caching, and correct Haiku's documented prompt-cache minimum (2048 → 4096). Billed tokens and cache reads now carry through to `result` and the benchmark cost/ablation gate, instead of silently reporting 0 when the event never fired.

Add `.withHarness({...})`, a typed, per-agent control surface for the harness's internal mechanisms (tool disclosure, tool discovery, tool index, verbose rules, context budgets, and more). Config passed to `.withHarness()` now takes precedence over `RA_*` environment variables, which take precedence over the default, and the resolved config is inherited by sub-agents. `ContextProfile.toolDisclosureMode` is wired through to the resolved harness, so a tier's disclosure preset actually changes tool-visibility behavior instead of being computed and discarded.

Fix a default `dbPath` mismatch between memory and runtime that left core memory tables unindexed, and fix embedding/content/consolidation corruption caused by it. Screen memory writes for injection and PII before persisting, matching the guardrails already applied to LLM input.

Plan-Execute's composite steps now recite the titles of other pending/in-progress plan steps to their sub-kernel as `remainingGoals`, closing a gap where the `goal_state` event had a full rendering path (`volatileTailStage`'s "Remaining steps: ..." recitation) but no producer anywhere in the codebase. Opt-in by construction: absent or empty, behavior is byte-identical to before.

Preserve tool return contracts through runtime schema preparation and expose them to the code-action strategy so generated code can use retrieved values in subsequent tool calls.

Add `.withToolIntent()` for agent-level tool-routing overrides in `chat()`, a `verifyCitations` option on `ChatOptions`, and an `onOverflow` history-overflow-summarize hook on `AgentSession`, so a long-running chat session can summarize older turns instead of silently dropping them.

Add a lightweight tool index (opt-in, off by default): a compact, listed-only view of available tools for large tool catalogs, controlled via `ContextProfile.toolDisclosureMode` and `RA_TOOL_INDEX_MAX_ENTRIES`. Fix two bugs found while building it: tool-index-listed tools are now promoted into the real function-calling callable set (they were previously listed but not actually callable), and the discover-tools catalog dump no longer gets silently truncated and re-paraphrased by the model.

## [Unreleased]

### Fixed
- `rax demo` now passes the supported `gemini` provider name when it detects a
  Google API key, and its no-key guidance includes Gemini and Ollama. The demo's
  provider value is typed against the builder's `ProviderName` union, removing
  the cast that had hidden the invalid `"google"` value.
- Memory's default SQLite location no longer depends on which API enabled it
  or which directory the process ran from. `defaultMemoryConfig()` (used by
  `createMemoryLayer()` and the `rax skills` CLI) and `defaultUserMemoryPath()`
  (used by the builder's auto-enabled memory) previously resolved to two
  different paths — one cwd-relative, one `$HOME`-anchored — so a second
  process reading the same agent's memory from a different directory would
  silently find nothing. Both now resolve to the same
  `~/.reactive-agents/memory/<agentId>/memory.db`. See `packages/memory/README.md#storage-location`.
- The `memory.md` human-readable projection was written to a hardcoded
  cwd-relative path regardless of where the actual SQLite `dbPath` lived —
  splitting the source of truth and its projection across two unrelated
  directories whenever auto-enabled memory (the default-on path) was in
  play. `memory.md` now always co-locates with `memory.db`.
- `MemoryConsolidatorService`'s `consolidation_state` table used a single
  hardcoded row (`id='singleton'`) instead of one row per agent. Any two
  agents sharing one `memory.db` (a supported configuration — every
  consolidation query is agent-scoped) would stomp each other's
  `last_run` timestamp, silently undercounting or skipping the other
  agent's next `replay()`. Now keyed `PRIMARY KEY(agent_id)`, with an
  in-place migration for existing databases.
- Embeddings read back from SQLite in Tier 2 (vector) mode were silently
  corrupted: `bun:sqlite` returns BLOB columns as `Uint8Array`, not
  `ArrayBuffer`, and `new Float32Array(uint8array)` doesn't reinterpret the
  bytes — it coerces each byte into its own float, producing 4x too many
  garbage values. Affected every entry's `embedding` field returned from
  `SemanticMemoryService` and `MemorySearchService`.
- Episodic memory logged via the reasoning-strategy path
  (`task-completed` / `strategy-outcome` events) recorded `content` as
  literal `"Task: [object Object] → ..."` whenever the task input or model
  output was a structured object rather than a string — `String(obj)`
  instead of the existing `extractTaskText()` helper. Corrupted content
  fed directly into the FTS5 index, so episodic recall/search returned
  `[object Object]` noise for any structured-input or structured-output
  run.
- `semantic_memory`, `episodic_log`, `session_snapshots`,
  `procedural_memory`, and `zettel_links` had no indexes beyond their
  primary key — every `agent_id`-scoped lookup (bootstrap, flush, recall,
  consolidation decay/prune) full-table-scanned, growing linearly with an
  agent's history. Added 6 indexes; verified with `EXPLAIN QUERY PLAN`
  that all affected queries now use them.
- `LLMRequestCompleted` was declared and consumed in nine places but published
  by nothing, leaving the per-call LLM token/cost stream dead across the
  benchmark runner, both observability collectors, the trace tracer and the
  Cortex live readouts. It is now published from the kernel's single
  LLM-exchange emission site.
- `LLMRequestStarted` had zero producers anywhere in the codebase, and
  `packages/observe/src/tracer.ts` only populates its span map on that
  event's handler arm — so every LLM call's OTel span tree was silently
  empty (RA emitted tool spans but never LLM spans, the primary reason to
  trace an agent at all). It is now emitted at the three LLM pre-call sites
  in `packages/reasoning/src/kernel/observable-llm.ts`. This is the other
  half of spec finding F-1 (2026-08-24), whose `LLMRequestCompleted` half is
  the entry above.

### Added
- `.withHarness({...})` — typed, per-agent configuration for all 14 harness
  mechanisms (tool disclosure, discovery, tool index, verbose rules, stable
  tool surface, context budgets, thought continuity, observe symmetry,
  rationale audit, ToT explore budget). Precedence: config > `RA_*` env var >
  default. Inherited by sub-agents. Previously these were reachable only
  through process-global environment variables, so two agents in one process
  could not differ and no sub-agent inherited anything.
- `ContextProfile.toolDisclosureMode` is now derivable via
  `fromDisclosureMode()` (`"full" | "discover" | "index" | "hybrid"`), with
  per-tier defaults set (local=index, mid=hybrid, large=discover,
  frontier=discover) — pending a live consumer in a follow-up. Those tier
  defaults are declarations of intent, not measured verdicts.
- `BudgetExhausted` now has a producer — a token or cost budget killswitch
  abort publishes it (`packages/compose/src/killswitches/budget-limit.ts`,
  `packages/reasoning/src/kernel/loop/iterate-pass.ts`). `PhaseHookFn`'s
  abort return type (`packages/core/src/services/harness-types.ts`) gained
  an additive, optional `meta?: { budgetType, limit, used }` field to carry
  the structured budget figures through.
- Prompt-cache accounting reaches the benchmark gate. Both benchmark
  measurement paths — the bench runner (`runTask`) and the gate/ablation
  session path (`runInternal`) — now subscribe to `LLMRequestCompleted` and
  accumulate `billedTokens` / `cacheReadTokens` per call, which roll up to
  `meanBilledTokens` / `meanCacheReadTokens` on benchmark reports. The event
  stream is the source; `AgentResult.metadata` does NOT yet carry these fields
  (that wiring, in `packages/runtime/src/execution-engine.ts`, is a deferred
  fast-follow) and is read only as a fallback for when no event fired.
- `promptPrefixHash` and `toolSurfaceHash` on every LLM exchange, so a
  prompt-cache miss is attributable to a named prefix segment.

### Changed
- The lift gate's cost leg now scores **billed** input tokens
  (`input − cacheRead`) rather than raw tokens, configurable via
  `LiftPolicy.tokenLeg`. Raw overhead is still computed and printed on every
  receipt. The leg remains denominated in tokens, not USD.
- **Breaking type change:** `LLMRequestStarted`'s `contextSize` field
  narrowed from a required `number` to an optional `number`
  (`packages/core/src/services/event-bus.ts`), because no honest
  measurement exists at every call site — no call site fabricates a
  char/4 estimate just to satisfy the field. Any consumer that read
  `event.contextSize` as a guaranteed `number` (e.g. calling `.toFixed()`
  on it, or passing it to a `number` parameter without a null check) will
  now fail to typecheck, or see `undefined` at runtime, until it adds a
  null check. This is a bigger public-API break than the tag deletions
  below.

### Removed
- Nine never-emitted `AgentEvent` tags: `EventsMerged`, `GatewayStopped`,
  `MemorySnapshotSaved`, `MessageSent`, `PolicyDecisionMade`, `SessionCreated`,
  `SessionEnded`, `TextDeltaReceived`, `CompressionApplied`. None had a
  producer. Streaming text has always arrived on the `StreamEvent` channel as
  `TextDelta`, which is unchanged. `CompressionApplied` was removed rather
  than wired up because the apply-side curator that would produce it — the
  other half of the recommendation→application compaction flow — does not
  exist in the codebase yet; building it is a missing feature, not a wiring
  fix. Two candidates from the original sweep, `ExecutionLoopIteration` and
  `GatewayStarted`, were retained: each has a non-declaration hit (a test
  file that publishes/subscribes to it as a fixture), so the safety gate
  says leave them alone.

## [0.15.0] — 2026-08-16

Behavior change — the path-healing pipeline no longer silently rescues an out-of-root absolute path (F9)

`resolvePaths` used to rewrite an out-of-root absolute path argument to
`<root>/<basename>` BEFORE `file-write`/`file-read` ran, so the tool always
succeeded at the rewritten path while terminal verification — checking the
path the model originally referenced — reported the run FAILED next to a
file that had actually been written correctly. Live-confirmed on gpt-4o-mini
and qwen3:14b: both produced `outcome=REMAPPED, run.success=false`.
`file-operations.ts`'s own `Path traversal detected:` throw was the intended
single confinement authority, but the healer's silent rewrite ran first and
made that throw effectively dead for any caller going through the normal
healing path. The remap branch is now deleted (tilde expansion and
relative→root resolution are unaffected — those are genuine healing, not
the bug); an out-of-root absolute path now passes through unchanged and the
tool's existing throw fires. This is a deliberate behavior change, not a
silent bugfix: any caller that relied on a model's hallucinated absolute
path being silently saved to a plausible in-root location will now see an
honest, recoverable error instead.

Fixed — repetition guard no longer blocks legitimate multi-file work

`repetitionGuard`'s call ceiling on `file-write` used to trip on the 3rd call
regardless of target path, hard-stopping any task that needed to edit 3+
files with "Stop repeating this tool." It now passes calls whose target
argument (`path`/`file`/`target`/`url`/`id`) differs from every prior call to
the same tool, so legitimate multi-file work is never penalized while
same-target thrashing still hits the ceiling.

Fixed — Groq default model swapped off deprecated `llama-3.3-70b-versatile`

Groq shut down `llama-3.3-70b-versatile` and `llama-3.1-8b-instant` on
2026-08-16. The Groq provider's default/fallback model (used when no
`.withModel()` is given) and the `create-reactive-agent` scaffold default
now point to `openai/gpt-oss-120b`, Groq's recommended replacement — same
131K context window, native tool calling, lower cost. Callers who already
pass an explicit model are unaffected.

Fixed — the harness no longer discards a model's correct answer for a redundant reconstruction

The single biggest source of unnecessary "the model didn't produce a final
answer itself" warnings: a post-loop step fired unconditionally whenever a
run ended in a non-final-answer termination (`end_turn` and similar) with
any tool artifact present — without ever checking whether the model had
already written a real answer. For native function-calling models, ending a
turn with substantive text and no further tool calls is the *normal*
completion shape (no `final-answer` tool is even offered to them), so this
was overfiring on the common path, not an edge case. Traced live: a
correct, complete, model-authored answer was being thrown away and
replaced with a raw tool-artifact reconstruction, then mislabeled
"harness-authored" — costing an extra LLM resynthesis call and a false
honesty warning for content that was already right.

Now only falls back to reconstruction when the model's own output is empty
or reads as a genuine non-answer (a short apology/incapability statement).
Live-verified: the exact repro scenario now completes ~2.5x faster with
zero warnings.

Also: the proactive "you may finish now" nudge (added earlier this
release) now also fires when a task declares no `requiredTools` contract
at all, as long as at least one tool call has succeeded — previously it
only fired when a formal tools contract existed.

Fixed — a failed tool call inside a parallel batch showed no error message

Found via live-model QA: when the kernel dispatches multiple tool calls in
parallel (a model requesting more than one tool in the same turn) and one
fails, the terminal/verbose log printed a bare `✗ tool 0.00s` with nothing
after it — the error text was there in the result, it just never made it
into the log event at this one call site. Sequential tool calls always
showed their error; parallel ones silently didn't. Now consistent.

Improved — sub-agent dispatch logging is followable

- A sub-agent's log lines now carry a **depth- and name-tagged prefix** (one
  `│ ` per nesting level plus the child's name, e.g. `  │ researcher · `)
  instead of a flat `  │ ` for every child at every depth. Parallel and nested
  sub-agents no longer collapse into one indistinct, unattributable stream — you
  can tell which child, and how deep, every line came from.
- Each delegation is **framed with delimiters** — `▶ delegate → <name>: <task>`
  on dispatch and `◀ <name> ✓/✗ — <tokens> tok, <ms>ms` on completion — so a
  child's block has a clear start and end.
- The prefix now applies to **all** log levels: a sub-agent's `warn`/`error`
  lines were previously unprefixed and appeared at the parent's indent level,
  reading as the parent failing. They now indent and attribute like the rest.

Added — sub-agents inherit the parent's judgment + safety constraints

- A delegated sub-agent (`.withAgentTool()` / `.withDynamicSubAgents()` /
  `spawn-agent`) now runs under the parent's **`taskContract`**,
  **`fabricationGuard`**, **`grounding`**, and **`approvalPolicy`** — a true
  sub-agent, not a rubber-stamped one. Its answer is judged against the same
  contract and fabrication guard, its claims are grounded, and a
  `requiresApproval` tool it calls is refused rather than executed unattended.
  Previously a child inherited none of these: it could fabricate freely and
  execute gated tools with no decision.
- **Approval is coerced to block/deny-by-default in sub-agents.** A sub-agent has
  no durable store, so it cannot pause for cross-process (`detach`) approval —
  it decides in process and denies by default. A `detach` parent policy no
  longer strands a child at a gate; the child denies the gated tool instead. The
  same auto-feed folds the child's `requiresApproval` built-ins into the gate.

Fixed — status renderer no longer breaks a host app's readline (arrow-key history)

The status renderer's keyboard handler unconditionally took over stdin raw
mode, with no awareness that a host script's own `readline.createInterface()`
might already own it. That left arrow-key history printing a literal
`^[[A` after any run. It now defers entirely when stdin already has a
listener attached.

Improved — verifier rejection warnings are plain-English

The terminal status line used to print the verifier's internal check-id and
diagnostic phrasing verbatim (e.g. `output-is-model-authored`). It now shows
a plain-English sentence, with the raw diagnostic still available to
verbose/debug log consumers via the event's `context` field.

Improved — status renderer glyphs are now colorized (✓ green, ✗ red, ⚠
yellow, ℹ cyan), respecting `NO_COLOR`.

Fixed — `agent.run()` errors now include a remediation suggestion

Errors thrown from `agent.run()`, `resumeRun()`, `approveRun()`, and
`denyRun()` now carry a one-line "→ suggestion" for known error types
(e.g. `BudgetExceededError` → "wire `.withCostTracking()`"). The helper
that builds this already existed but was never actually called from any
`agent.run()` catch path, so no user ever saw it.

Fixed — scratchpad disk-spill correctness and robustness (pre-release health sweep)

The scratchpad disk-spill feature (this release) had 3 read sites that
bypassed its marker-resolution helper — most notably the deterministic-
grounding guard, which could inject the literal `[SPILLED_TO_DISK:...]`
marker string into the model-facing evidence prompt instead of the real
content once the spill threshold triggered. Fixed at all 3 sites.

Also: `setScratchpadBounded`'s disk write and the `code-action` sandbox
Worker's message-listener teardown could each turn a recoverable condition
(a disk write failure, a termination race) into a crashed fiber or an
unhandled promise rejection. Both now degrade gracefully instead.

Fixed — `ToolDefinitionError` gets a proper remediation suggestion

A malformed custom tool definition's error now names the tool and the
offending field consistently with every other builder-surfaced error,
instead of falling through to a generic "Unexpected error" message.

Fixed — a paused run is no longer served back as a cached answer

The semantic cache could serve a paused run's sentinel content back to
`approveRun()` as if it were the completed answer. Paused runs are now
excluded from the cache-hit path.

Fixed — status line no longer prints `Done`/`Failed` twice per run

Every reasoning strategy fired its own `completion` event in addition to
the authoritative one the runtime fires at true run end, so the terminal
status renderer always printed two summary lines (and stopped its elapsed
timer early, before the run actually finished). Also fixed a status-line
tool-error message that could cut off mid-word with no indication it was
truncated.

Added — bounded scratchpad with disk spill (#47)

Tool-result auto-store (`ResultCompressionConfig`'s `autoStore`) writes overflow
into the run's in-memory scratchpad, which had no aggregate size cap and no
disk persistence — a long run accumulating many/large auto-stored tool
results grew it unbounded, and content was lost if the process died without
a durable checkpoint. Writes past a configurable aggregate byte threshold
(default 5MB) now spill to `~/.reactive-agents/spill/<namespace>/<key>.txt`;
reads (the `recall` tool, deliverable assembly, evidence grounding) resolve
spilled entries back to their full content transparently. Namespaced by
session/agent ID so concurrent runs' identically-named keys never collide.

Fixed — tool definitions are validated at registration, not silently accepted (#57)

`ToolService.register()` accepted any object typed `ToolDefinition` with zero
runtime check — a raw object literal, an `as any` cast, or a definition
assembled dynamically from an MCP server's advertised schema could all carry
a malformed shape (missing description, a parameter with no name) that was
silently stored and only failed much later, deep in execution, with no
indication the definition itself was the problem. Registration now runs the
definition through `Schema.decode` and fails immediately with a typed
`ToolDefinitionError` naming the tool and the field.

Fixed — a custom tool returning `undefined` or a circular reference fails clearly (#58)

A custom tool's return value was serialized with a bare `JSON.stringify` and
no error handling: `undefined` silently stringifies to the JS value
`undefined` (not the string `"undefined"`), turning the tool's observation
content into a non-string that broke downstream string operations far from
the actual cause; a circular reference threw an uncaught generic `TypeError`
with no tool-name context. Both now produce a clear, named tool-execution
failure at the point of cause instead.

Added — dynamic OpenAI-compatible provider config (#198)

- `.withProvider(provider, { baseUrl, apiKey, headers })` now accepts a
  runtime endpoint override for the whole OpenAI-compatible provider family —
  `openai`, `groq`, `xai`, and `litellm` all speak the same Chat Completions
  wire protocol. Point any of them at a llama.cpp server's `/v1` API,
  Deepseek, a LiteLLM proxy on a non-default host, or any other
  OpenAI-compatible endpoint at runtime, without predefining
  `LITELLM_BASE_URL`/`OPENAI_API_KEY`/etc as env vars.
- Custom headers now flow through: the raw-fetch header merge `litellm`
  already had, and the openai-node SDK's `defaultHeaders` option for
  `openai`/`groq`/`xai`.
- An inline `apiKey` supplied this way now also satisfies
  `.withStrictValidation()`'s missing-key check — previously it only read the
  provider's env var, so a fully-configured custom endpoint with no matching
  env var incorrectly failed strict validation.
- Not propagated to `.withFallbacks()`-configured fallback providers — a
  fallback is a different provider/endpoint by definition.

RunLedger convergence (Wave C.1): all 8 reasoning strategies now forward `runLedger`
across the result boundary (reflexion projects it from merged steps for completeness
rather than dropping it), so a run's ledger is complete regardless of which strategy
produced it. Receipt tool-call and deliverable evidence are re-based onto ledger queries
first, with the prior steps-derived scan kept as a fallback for paths that have no
ledger. A new `LedgerEntryAppended` live tap publishes ledger batches onto the EventBus
as they're minted, feeding the public `stream(density: "full")` chunk stream and the
`run_events` journal — previously these only existed retrospectively at run completion.
An equivalence invariant (ledger ≡ projection of `steps[]`) is now pinned red-on-cut,
and `steps[]` mutation is gated to a single chokepoint.

Fixed — Ollama `OLLAMA_HOST` honored

The capability-resolution probe only read `OLLAMA_ENDPOINT`, so `OLLAMA_HOST`
(Ollama's own standard env var) was silently ignored, producing conservative
2048-token fallback defaults against a live server. Both env vars are now
honored, and an explicit `numCtx` the caller already supplied is no longer
overridden by the fallback.

Fixed — a plain script (no readline) could hang forever after `agent.run()` returned

On a TTY, the status renderer's stdin cleanup called `resume()` on exit
regardless of whether a host `readline` interface was still using stdin.
For a bare script with no readline of its own, that left stdin actively
flowing with nothing left to consume it — keeping the process alive
indefinitely instead of exiting after the run completed.

Fixed — `.withApprovalPolicy({ mode: "block" })` now enforces (security)

- **`mode: "block"` was an inert safety switch.** Every approval gate keyed on
  `mode === "detach"`; nothing read `"block"`, so a `requiresApproval` tool
  executed with no human decision — and `"block"` is the mode you get from
  `.withApprovalPolicy(...)` when `.withDurableRuns()` is not set (the common
  case). Block mode now decides each gated call **in process** and **denies by
  default**: without an `onApprove` handler, a gated call is refused (the tool
  does not run) rather than silently executed.
- **New `onApprove` option** on `.withApprovalPolicy()` — a synchronous or async
  callback `({ toolName, args, iteration }) => boolean | { approve, reason }`
  that decides each gated call in block mode. A throw/rejection denies
  (fail-closed). Distinct from `run()`'s detach-mode `onApproval`.
- **Behavior change:** a run using block mode (or the default without durable
  runs) with a gated tool and no `onApprove` will now REFUSE that tool where it
  previously executed it. Supply `onApprove`, or use `mode: "detach"` +
  `.withDurableRuns()` for durable cross-process approval. `code-action` refuses
  the run outright under any gating policy (its tools run past every gate).
- The durable HITL approval gate now also applies uniformly across every
  reasoning strategy (Blueprint, Reflexion, Plan-Execute, Tree-of-Thought,
  Adaptive, Direct) — it was previously wired into `reactive` only, so a gated
  tool could run unattended under any other strategy.

Fixed — calling a nonexistent tool now suggests the tools you actually have

When a model called a tool name that doesn't exist, the recovery hint used
to narrow its suggestion to whichever available tools had "search"/"fetch"/
"get"/"browse" in their name — even when those tools had nothing to do with
what the model needed. Found via a live-model QA pass: a model hallucinating
a `typescript-checker` tool got steered toward `web-search`/`http-get`
instead of being told about `code-execute`, which it actually had, and
burned its whole retry budget re-hallucinating tool names with no way to
recover. Now always names the real available tools.

Improved — verbose tool-call log lines no longer misread as a numbering bug

`call N` labeled the kernel loop's iteration index, not a per-call sequence
— two tools called in the same iteration both printed `call 0`. Relabeled
to `iter N`.

Fixed — deterministic evidence grounding, corrected

The harness's deliverable assembly (`assembleDeliverable`) now grounds a
model's terminal thought against unread stored tool evidence instead of
trusting a long thought outright — closing a fabrication path where a
plausible-sounding synthesis off a compressed tool-output preview could win
over already-resolved tool observations, across every termination path
(`end_turn`, `dispatcher-early-stop`, `low_delta_guard`,
`controller_early_stop`).

**Follow-up correction:** the initial version of this check discarded a
thought whenever ANY tool evidence was formally unconsumed, even when the
thought demonstrably reproduced that evidence verbatim (e.g. transcribing a
large table back in full). It now only overrides the thought when the
thought does NOT already contain the unread evidence's content — a thought
that provably grounds the evidence is trusted regardless of whether the
harness saw an explicit `recall()` call.

Added — `prompt.guidance` compose tag

Of the 9 harness-authored "Guidance:" text channels folded into the system
prompt each turn (required-tools reminders, oracle/ICS nudges, error-
recovery hints, the finish nudge, quality-gate hints, evidence-gap
redirects), only one had any override point before this. `.compose(h =>
h.on('prompt.guidance', (text, ctx) => ...))` can now inspect, replace, or
suppress the entire rendered guidance block — the same level of control
`prompt.system` already gives over your own base prompt, now extended to
what the harness itself says on top of it.

Fixed — corrected `withEnvironment()`'s docs, which incorrectly claimed the
auto-injected `Environment:` block was reachable via the `prompt.system`
compose hook. It isn't (assembled in a separate channel) — documented
honestly rather than left misleading.

Improved — agents finish more reliably once their required tools are satisfied

Previously, once a task's required tools were all satisfied, the harness
only proactively told the model it could finish when a tool needed to be
called more than once. In the common single-call case it said nothing —
smaller/local models frequently satisfied their required tools and then
just stopped without calling `final-answer`, forcing the harness to
reconstruct an answer from raw tool output instead of the model's own
synthesis. Now sends a soft, informational nudge ("if you have what you
need, give your final answer now") the first time this happens, without
overriding the model's judgment on whether more research is needed.

Fixed — LLM-level failures (bad model, connection refused, provider
rejection) are now visible in the terminal/status output. Previously the
diagnostic message was computed but only published to a programmatic
event-bus channel — a run failing this way showed "Task failed" with no
indication of why.

Added — skill activation (auto + explicit)

`.withSkills({ paths: [...], activate: [...] })`'s `activate` option now
injects a named skill's full instructions into context at bootstrap, with
task-relevance-based auto-activation on top — skills were previously only
shown in a discoverable catalog, never actually loaded into the model's
context.

Fixed — code-action's sandbox Worker now actually stops on run cancellation (#35)

`code-action`'s sandbox runs generated code in a real `node:worker_threads`
Worker; the host-side function bridging it to Effect returned a bare
`Promise`. Interrupting the run's fiber (cancellation, kill switch, a lost
timeout race) abandoned *awaiting* that promise, but the underlying Worker —
a real OS thread — and any tool call it had already dispatched kept running
unsupervised. A cancelled run could leave a side-effecting tool call
(`shell-execute`, `file-write`) completing its work after the run was
supposed to have stopped. The sandbox now returns a proper `Effect` whose
interrupt finalizer terminates the Worker, so cancelling a `code-action` run
actually stops it.

Fixed — repetition guard blocked a genuinely new CLI subcommand

`repetitionGuard`'s distinct-target carve-out only recognized `path`,
`file`, `target`, `url`, and `id` arguments. Tools whose entire call is one
opaque `command` string (`gh-cli`, `git-cli`, `gws-cli`) never matched, so a
second, completely different subcommand (e.g. `gh log ...` after `gh repo
view ...`) was treated as pure repetition and blocked at the ceiling — the
agent could establish the default branch but never actually fetch commits.
`command` args are now compared by their leading subcommand tokens (`repo
view` vs `repo log`) rather than key presence alone, so a new subcommand
passes while same-subcommand churn (`keep notes get x` → `keep notes get
y`) still hits the ceiling as intended.

## [0.14.0] — 2026-07-22

### Removed — dead built-in tools (v0.14)

- Removed the unregistered dead built-in tools `task-complete` and `rag-search` (public exports of `@reactive-agents/tools`); neither was ever registered as callable — `final-answer` is the sole terminator and `find` the unified retrieval tool, superseding them respectively.

### Breaking — packages and no-op surface removed (v0.14)

- **`@reactive-agents/orchestration` is no longer published** and the
  `reactive-agents/orchestration` subpath is removed. The package was only
  reachable through the removed no-op `.withOrchestration()` and had zero
  consumers. Multi-agent composition lives on the sub-agent rails
  (`.withAgentTool()` / `spawn-agent`), which this release made first-class
  (see below).
- **`@reactive-agents/scenarios` is no longer published.** Its five scenario
  fixtures moved into the framework's own test suite; it was never a
  user-facing API.
- **`.withCacheTimeout()` removed.** It was a no-op: the tool-result cache
  never accepted a timeout, so the value was written and never read.
- Dead run-ledger kinds `checkpoint-marker`, `deliverable-commit`, and
  `contract-amended` (plus the never-invoked `amendContract()` helper) are
  removed from the ledger vocabulary — no writer ever minted them.

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

### Fixed — enforcement and run integrity

- **Tool policy is enforced, not suggested.** `allowedTools` / `forbiddenTools`
  and the `.withContract` deny-list are now enforced at the shared tool-execution
  choke point on **every** strategy — including tools arriving via planned steps
  (plan-execute, blueprint), hallucinated tool names, and `code-action`'s
  sandbox, where LLM-generated code previously called tools with no policy
  check at all. A blocked call is recorded honestly and never executes.
- **Sub-agents are part of the run.** Spawned sub-agents (`.withAgentTool()` and
  the `spawn-agent` tool) now fork into the parent's fiber tree instead of a
  detached runtime: `agent.terminate()` interrupts in-flight children (no
  orphaned workers), a failed child returns a truthful `success: false` result,
  child events reach the parent's EventBus tagged with `parentAgentId`, and
  traces correlate across the tree via `rootRunId` + depth. The recursion cap is
  live — sub-agents may sub-delegate only below an explicit
  `maxRecursionDepth`, and a refusal is observable instead of silent.
- **Phase events reach the public stream.** `PhaseStarted` / `PhaseCompleted`
  chunks (stream density `"full"`) are now actually emitted — they were
  advertised in the streaming docs and `ui-core` types but had zero writers.
- **The requirement lifecycle is real.** Run-ledger `requirement` entries are
  minted when the run contract compiles and transition at the verification
  gate, so run assessment and the meta-loop see declared/satisfied/blocked
  requirements instead of a permanently empty list — and a requirement for one
  entity is no longer satisfied by touching a different one.
- **Kernel-path tool results reach memory extraction.** The kernel execution
  path now feeds real tool observations (not the tool-call text) into
  memory-flush extraction, matching the classic path.
- **Transient provider failures are retried.** 5xx / 529-overload / network
  faults (ECONNRESET, socket hang-up, fetch failed …) are now classified as
  retryable and go through the exponential-backoff schedule; previously only
  429 retried and a single provider blip failed the whole call. Permanent 4xx
  errors still fail fast.
- **A critique/reflect failure no longer kills the run.** If the critique pass
  (reflexion, plan-execute reflect) hits an LLM error, the run degrades
  gracefully — it proceeds with the answer it already has and records an honest
  `[CRITIQUE skipped]` marker — instead of discarding completed work.

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
