---
type: research
status: complete
created: 2026-11-14
tags: [chat, run, parity, audit, runtime, telegram, channels]
---

# Chat path vs run() parity audit (2026-11-14)

Question: does the Telegram/Cortex chat path (`session.chat()` / `session.runStream()` via the channel router) lose capabilities that `agent.run()` has, for the SAME agent config?

Evidence base: code read (file:line below) plus a zero-token A/B on a scripted agent (`withTestScenario`, `withObservability({tracing:{dir}})`): `session.chat` x2, `session.chat` then `session.runStream`, `run(task,{history})`, `run(task)`, each with and without `.withTools()`. Probe files were temporary and deleted.

## Headline

The tool-loop chat path IS `run()`. Every chat turn that takes the tool path calls `ReactiveAgent.run()` (`agent/chat-capabilities.ts:189`, `reactive-agent.ts:1606`) or `runStream()` (`:209`). The kernel, harness mechanisms, strategy, verification, memory, maxIterations, system prompt and termination are the same object. The A/B `run-started.config.mechanisms` blocks are byte-identical across all arms (leanHarness/adaptiveHarness/strategySwitching/verification/grounding/contract/actOrAnswer/inputCoverage all false, lazyDisclosure true, disclosure hybrid). So the "everything off" config the owner saw in the XRP trace is the agent's build config, not something chat strips. Chat does not lose a mechanism run() has.

What does differ is (1) how the task string is built, (2) which turns bypass the loop entirely, (3) one hardcoded sampling parameter (fixed here), and (4) a chat-only context block.

## Divergence table

Class: EQ = equivalent, INT = intentional, GAP = quality gap, FIX = defect fixed here.

| # | Aspect | Chat path | run() | file:line | Class |
|---|---|---|---|---|---|
| 1 | Kernel entry | tool path -> `run()`/`runStream()` | run() | chat-capabilities.ts:189,200 | EQ |
| 2 | Mechanism config, strategy, maxIterations (agent default), memory, verification, grounding | identical `run-started.config` (A/B) | same | A/B | EQ |
| 3 | History | flattened into the task string: `--- Conversation history ---` block + `--- Current message ---` (run(task,{history}) does the same) | no history unless caller passes it | agent/history-block.ts:16, reactive-agent.ts:742,1258 | INT (documented: structured prior assistant turns made the model re-run tools); see GAP 4 for the cost |
| 4 | Current-turn awareness | only `extractCurrentTurn` (contract compile + derive-conditions) strips history. 14+ runtime consumers read `extractTaskText(task.input)` = history + message: literal-mention required-tool fallback, tool-relevance filter, output-format intent, `classifyTask`, strategy select, cost-route complexity, skill/memory query, guardrail input, task-category telemetry | n/a (task is the ask) | engine/phases/agent-loop/setup/classifier.ts:140,230; setup/tool-schemas.ts:198,257; reasoning-think.ts:238; strategy-select.ts:36; cost-route.ts:51; guardrail.ts:31; reasoning reasoning/kernel/contract/current-turn.ts:62 | GAP (see below) |
| 5 | Tool-intent routing | `useTools ?? withToolIntent() ?? hasCapabilityTools`; an agent with NO capability tools (including bare `.withTools()` with no custom/MCP/permitted built-in) answers on the DIRECT path: no kernel, no harness (A/B: `chat-tools` arm emitted only 2 `llm-exchange` events, no run-started) | always kernel | chat-capabilities.ts:137, builder/contract-tool-set.ts:130, engine.ts:361 | INT; surprising for bare `.withTools()` agents |
| 6 | Direct path temperature | was hardcoded 0.7, overriding configured temperature (0.1 in the trace agent) | configured default | chat-capabilities.ts:58 | FIX (pinned) |
| 7 | Direct path budget / persona | budget 4096, persona = `config.systemPrompt` only, context = taskContext + last-run block; no harness | kernel prompt assembly | engine.ts:29,635 | INT |
| 8 | Chat-only context block on tool path: `contextSummary` = taskContext + last run's debrief + last run's tool results (3000 chars) + "Reference specific data from tool results when answering" is prepended to the task of `session.chat()` turns | not present | not present | engine.ts:369-370, chat.ts:295-343, reactive-agent.ts:1563,1672 | GAP (two parts, below) |
| 9 | `session.chat` vs `session.runStream` inconsistency | `streamTurn` does NOT build `contextSummary` (task = history + message only) | n/a | engine.ts:448-506 vs 369 | GAP: the same agent builds two different tasks depending on whether the router has `onProgress` (channel-router-resolver.ts:127) |
| 10 | Per-turn `maxIterations` | `turn()` forwards it; `streamTurn`/`session.runStream` cannot take it (not in the options type) | run() takes it | engine.ts:374 vs 476; chat.ts:475; chat doc says "Default: 5" which is stale (agent default applies) | GAP (low) |
| 11 | Stream task prep | no `bareBuilderFailure` rethrow, no output-schema steering, no `driveApprovals` | run() has them | reactive-agent.ts:775 vs 1269 | INT (stream failures are terminal events) |
| 12 | History window | 40 turns / 8000 chars drop-oldest, optional overflow summary | caller-supplied | engine.ts:21-23,554 | INT |
| 13 | Contract compile with history | `currentTurn {offset, historyStripped:true}` (A/B: offset 85/99) so prior-turn requirements do not stay outstanding | n/a | reasoning current-turn.ts | EQ (works) |
| 14 | Termination, finalize, verification gate | shared path | shared | n/a | EQ |
| 15 | Ack fallback | `makeAcknowledge(agent.complete)` side completion outside the turn gate; independent of the answer | n/a | channel-router-resolver.ts:151 | INT; the ack falling back on GPU contention does not touch answer quality |

## The XRP turn

The price was tool-sourced ($0.969877 from `crypto-price`, within 0.2% of CoinGecko), so the tool loop worked and nothing in chat prevented it. For that agent the evidence says chat ran the kernel with the agent's own config. The owner's perception "not on par with other reasoning paths" is most plausibly: (a) the agent's build config has every quality mechanism off (verification, grounding, contract, fabricationGuard) so run() would behave the same; (b) the task text carrying history (GAP 4); (c) small-model sensitivity to the history block. Chat did not drop a guard.

## GAP details and recommendations

GAP 4 (history-in-task contaminates intent consumers). Systemic defect class: the "one place that knows the history marker" (`extractCurrentTurn`) lives in `packages/reasoning` and is used by 2 consumers, while runtime has 14+ raw-task readers. Concretely: a turn "thanks" after a turn that named a tool gets `literalMentionRequired` over the whole history (adaptive/classifier paths, opt-in), the relevance filter and `classifyTask` score the full conversation, strategy selection and complexity routing see the whole transcript. Not fixed here: needs `extractCurrentTurn` exported from reasoning (reasoning-warden, `dist` rebuild) and then a single `extractIntentText(task.input)` in `engine/util.ts` used by the intent consumers (classifier, tool-schemas, think classify, strategy-select, cost-route). Better boundary: make `withHistoryBlock` carry the current-turn offset as typed metadata (`task.metadata.context.currentTurn`) so no consumer re-parses markers. Dispatch: reasoning-warden (export) then runtime-warden (consumers).

GAP 8a (stale tool results steer the next turn). The tool path prepends the previous run's tool results with "Reference specific data from tool results when answering". For a follow-up like "price now?" this invites answering from the previous tool output instead of re-calling the tool. `streamTurn` does not do this (GAP 9), so Telegram turns with `onProgress` are unaffected and turns without are. Recommended: drop the last-run block from the tool path (history already carries the prior answers; the direct path, which has no history of tool calls, is where it belongs). `engine-tool-turn.test.ts` pins the current composition, so this is a decision, not a silent edit.

GAP 8b (cross-conversation leak). `_lastDebrief` / `_lastRunObservations` are agent-level (reactive-agent.ts:334,344,1177). The channel resolver caches ONE agent per (route, role) and opens one session per conversation (channel-router-resolver.ts:86,106), so conversation B's first `session.chat` tool turn receives conversation A's last debrief and tool results in its task. Same issue for taskContext duplication: `taskContext` is already injected by the engine on `run()`, and chat also prepends it (A/B task text: `## Task / session grounding ...`). Same fix as 8a for the tool path removes both. For the direct path, scope the block to the session that produced it. Needs an owner decision (privacy-relevant; behavior change for run()-then-chat flows).

GAP 5 (bare `.withTools()` agent chats without tools). Worth a build-time notice parity check: `noCapabilityToolsNotice` already warns at build; confirm it names chat as the consequence.

GAP 10: forward `maxIterations` through `session.runStream` -> `runStream` -> `turnCarryMetadata` (add `maxIterations` to `TurnCarryOption`), and fix the "Default: 5" doc. Low value (no caller passes it); not done.

## Fix shipped

FIX 6: `makeChatComplete` no longer hardcodes `temperature: 0.7`. The provider applies `defaultTemperature` (from `.withModel({temperature})`) when the request omits it, matching run(). Unconfigured agents still get the provider default 0.7. Pin: `packages/runtime/tests/seam-chat-direct-temperature.test.ts`, failing first (received 0.7), green after. Changeset: `.changeset/runtime-chat-run-parity.md`.

## Ablation candidates (not flipped, for ablation-warden)

The owner's trace agent runs with: verification false, grounding false, fabricationGuard off, contract false, actOrAnswer false, inputCoverage false, strategySwitching false. These are the agent's configuration and are identical on run(), so they explain "not on par" only relative to a differently-configured agent. If chat/Telegram agents are expected to be more guarded by default: candidates are `contract` (compiles `currentTurn`-scoped requirements, already history-safe), `verification`, `fabricationGuard`. None changed.

## Out-of-scope needs

- packages/reasoning: export `extractCurrentTurn` (or a typed `currentTurn` field) for GAP 4.
- apps/cortex: confirm it does not rely on the tool-path last-run block before GAP 8 is changed.
