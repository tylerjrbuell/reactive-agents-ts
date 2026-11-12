---
type: research
status: draft
created: 2026-11-12
tags: [harness-report, gateway, telegram, cortex, channels, trace-diagnosis]
---

# Telegram gateway real-traffic trace diagnosis (2026-11-12)

Source: 4 recorded runs in `~/.reactive-agents/traces/` (13:xx-14:41 local), model `mimo-v2.6:latest` (ollama), strategy `reactive`, maxIterations 10. User id redacted (`<uid>`); channel adapter id `ch-d6d3de1f`. Read-only: `rax-diagnose cause`, jq over trace JSONL. Cortex DB (`apps/cortex/.cortex/cortex.db`, `~/.cortex/cortex.db`) holds NO run or event rows for this window, so the Cortex side of these runs is not recorded there (itself a gap, G6).

## Runs

| # | runId | user msg | status | cause | wall | outcome |
|---|---|---|---|---|---|---|
| 1 | 01M78M3WEQMD1PSYQYCGSQX6MK | `/start` | failure | never-engaged, abstained | 22.3s | no reply |
| 2 | 01M78M4J93MA32GD2ZA06Y5AYH | `Hello` | success (end_turn) | none | 19.3s | apology text, nothing sent |
| 3 | 01M78M556YNFTH9B97VJHQPPDD | `Can you fetch the price of xrp` | success (end_turn) | none | 22.5s | correct XRP answer, nothing sent |
| 4 | 01M78MBX06DMJG14YEHZJMCTP3 | same xrp question again | failure | wrong-tool-arg, max_iterations | 103s | no reply |

Net: 0 of 4 turns delivered a Telegram message from the agent run.

## Ranked gaps

### G1 (critical): reply delivery depends on an MCP tool that does not exist
- Evidence: every run's task ends with `channelOutboundToolGuidance`: "Choose a tool whose name starts with `ch-d6d3de1f/`". `tool-surface-resolved` in all 4 runs lists only `web-search` (+ `recall`, `final-answer`); run-started `config.builder.tools.allowedNames` = context-status, final-answer, task-complete, web-search. No `ch-*/` tool is ever visible. Run 2 iter 5: model guessed `ch-d6d3de1f/telegram_send` (not in `toolSchemaNames`) and then wrote "I'm unable to send messages through the channel tool".
- Cause: `packages/channels/src/routing/engine.ts:166` publishes `ChannelMessageReceived` with `mcpServer: adapterId`. The legacy subscriber `packages/runtime/src/agent/gateway-driver.ts:~84-126` and `packages/runtime/src/gateway-context-formatting.ts:117-132` (`channelOutboundToolGuidance`) then assume the adapter is an MCP server exposing a send tool. Native `ChannelAdapter.send` adapters (new channels package) expose no such tool, and the chat path (`gateway-context-formatting.ts` `handleMessage` -> `engine.turn`) never takes the run's final text and calls `adapter.send` itself.
- Impact: bot is mute. Docs/commits claim router + channels work; real traffic contradicts.
- Owner: gateway-warden (engine.ts) + runtime-warden (gateway-driver.ts, gateway-context-formatting.ts). Fix: boundary-first. Deliver the run's final answer through the adapter (`ChannelService.send` / receipts) in the shared path; drop the "must call an MCP tool" prompt when the channel is adapter-backed (keep only for true MCP channels).

### G2 (high): two inbound consumers on one event (legacy gateway-driver subscriber plus router)
- Evidence: the router's `handleEnvelope` publishes `ChannelMessageReceived` (`engine.ts:157-172`); the gateway-driver subscriber consumes the same event and starts its own chat run, independent of any (route, role) narrowed agent. All 4 traces are the legacy chat-turn shape (`You are in a live conversation with ...` task), none the router's narrowed-agent shape. Router access decision, per-route meter and trigger lifecycle are bypassed or run beside it. Risk of double reply once G1 is fixed.
- Owner: gateway-warden + runtime-warden. Fix: one consumer; the router owns dispatch and the bus event is observability only (or the driver ignores events whose `adapterId` is router-managed).

### G3 (high): run reports `success` / `verified` though the required action (outbound send) never happened
- Evidence: run 2 `run-completed status=success terminatedBy=end_turn; deliverable_decision=pass (verified)`. Earlier in the same run `final-answer` was rejected by the exit gate: "actually complete the requested action — no successful tool call has made it take effect yet". The model then wrote an apology and the gate let `end_turn` through as success. Run 3 same: success with zero send. `rax-diagnose cause` says "Finished normally" for both. Honest-claims law violation: a failed delivery is reported as success.
- Owner: kernel-warden (terminate / terminal verify gate; AGENTS pitfall 12 shared path), possibly runtime-warden for the channel-turn contract. Fix: treat the channel-delivery requirement as a hard requirement of the run; end_turn with outstanding requirement = failure.

### G4 (high): model reasoning leaks into stored conversation history
- Evidence: run 3 and 4 history block shows `Assistant: The user says /start. There's a Telegram channel tool. I need to send a message. But I have no tool listed ... Hmm. Maybe there's a hidden tool. Let me recall ...`. That is the thinking text of the failed run 1 stored as the assistant turn (`thinkingPreview` in run 1 llm-exchange matches). Next turns then re-read the model's own confusion and the "send a tool" instruction pile.
- Cause area: `GatewayChatManager.handleMessage` (`gateway-context-formatting.ts:~286-330`) stores `engine.history()`; abstention/failed runs push their internal text as the assistant message. Also the history is embedded INSIDE the task string (`--- Conversation history ---`), so each turn grows the goal text, and the `contract/current-turn.ts` GATEWAY_MARKER has to cut it back.
- Owner: runtime-warden (chat manager). Fix: record only delivered replies; record nothing (or a marker) on failed runs; keep history in `messages`, not the task string.

### G5 (medium): wasted iterations and external leak chasing a nonexistent tool
- Evidence: run 4 (8 iterations, 7 tool calls, 103s): `web-search` with missing `query` (iter 0, wrong-tool-arg); then web-searches for "send message telegram tool" returning `NousResearch/hermes-agent send_message_tool.py` repo hits (3x), a `recall` of that, `repetition guard` message ("already called web-search 4 times"), and `recall`/`telegram_channel`/`telegram-send` lookups in runs 2, 3. Last LLM exchange: 75.6s, 7,024 tokens out (the final synthesis after max_iterations). The agent searched the public web for how to send a message, i.e. user chat context leaves the box as a query.
- Owner: falls out of G1; plus kernel-warden for the "required action is not a visible tool" case. The tool-surface should flag at iter 0 that the named required tool is absent (diagnostic: `reasons` has no entry for any `ch-*` tool) and abstain fast or ask the router for the send path rather than search.

### G6 (medium): no channel-level events in the recorded trace; Cortex DB has nothing for these runs
- Evidence: kind histogram of all four traces has no inbound, access decision, outbound, receipt or error-swallowed events (only kernel/ledger/guard kinds). `cortex_runs`, `cortex_events` rows since 2026-11-12 ~13:30: empty in both DB files. Run-level cost/tokens are `null` in `run-completed` (`totalTokens`/`totalCostUsd` present as keys but tokens/cost read null in the outcome fields; llm-exchange has per-call tokens). So latency/cost for the whole turn (Telegram receive -> reply) cannot be reconstructed.
- Owner: gateway-warden (emit `ChannelMessageReceived`/delivery receipt into the run trace, correlate by runId) + cortex-warden (persist gateway channel runs to `cortex_runs`/`cortex_events`).

### G7 (medium): latency
- Evidence: 19-22s for a "Hello"/"/start" turn (4-7 LLM exchanges, 2 iterations of 2.8-3.3s each plus thinking 925-1001 chars/exchange), 103s on the xrp retry. A trivial greeting should be 1 LLM call. No typing indicator anywhere in trace (cannot confirm the adapter sends `sendChatAction`; no event exists), so the user waits 20-100s in silence.
- Owner: gateway-warden (typing/ack on inbound), kernel-warden (single-shot path for conversational turns with no tool need). Model choice (`mimo-v2.6`, thinking on) is a probe variable, not the root.

### G8 (low / unverified): formatting
- Evidence: run 3 final text is a Markdown table with `**bold**` and `|---|` rows. Never reached Telegram, so MarkdownV2 escape/fallback behavior is UNVERIFIED. Telegram does not render tables. When G1 is fixed, check the adapter's escape path (`packages/channels` telegram adapter send) against this payload.
- Owner: gateway-warden. Add a channel-capability hint (no tables / plain markdown) to the channel-turn prompt.

### G9 (low): `/start` handled as chat text
- Evidence: run 1 task `User: /start` sent through the full reasoning loop (abstained after 22s). Bot commands could be answered deterministically (welcome text from config), zero tokens per AGENTS golden rule 5.
- Owner: gateway-warden.

## Not seen / could not assess
- Access-control decisions (allow/deny) and per-route meters: no events recorded.
- Duplicate replies: none sent at all, so not observable; G2 predicts them post-fix.
- Cost: provider is local ollama (costUsd 0) so no cost signal.
- Markdown fallback, receipts, swallowed errors (`ErrorSwallowed` from `engine.ts` process): not present in traces; check `~/.cortex/logs`/gateway log if the owner wants them.

## Dispatch order
1. gateway-warden + runtime-warden: G1 and G2 together (one coordinated fix: single consumer, deliver final answer via adapter, no MCP-tool prompt for native adapters).
2. kernel-warden: G3 (channel delivery as hard requirement), G5 follow-on.
3. runtime-warden: G4 history hygiene.
4. gateway-warden + cortex-warden: G6, G7, G8, G9.
After G1-G2 land, re-run the same four messages and diff with `rax-diagnose cause` (expect success with a `send` receipt per turn).
