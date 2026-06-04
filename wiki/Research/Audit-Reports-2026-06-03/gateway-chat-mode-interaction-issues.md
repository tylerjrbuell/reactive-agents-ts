---
title: Gateway Chat-Mode Agent↔User Interaction Issues
date: 2026-06-03
source: live Signal gateway run (test.ts, gemini-2.5-flash, reactive strategy, chat mode)
log: /tmp/gateway-run.log
status: findings
---

# Gateway Chat-Mode Interaction Issues

Live run of `test.ts`: Gemini gateway agent on Signal, `reactive` strategy, `mode: chat`,
`persistMemoryAcrossRuns: true`. Four real user turns observed.

| # | User message | Outcome | Tokens | Wall |
|---|---|---|---|---|
| 1 | "fetch the price of XRP" | **Real answer BLOCKED** — user got only "fetching now…" ack | 7,111 | 18.7s |
| 2 | "Help me research crypto markets" | Clarifying question sent (good), then 2 idle iters | 8,006 | 13.4s |
| 3 | "Price of XRP and Bitcoin" | Answer delivered, then out-of-order "fetching now…" spam + 2 blocked re-sends | 13,032 | 21.5s |
| 4 | "search camping tents for families, send a list" | **Real answer (tent list) BLOCKED** — user got only "give me a moment…" ack | 10,101 | 13.4s |

## P0 — `sideEffectGuard` blocks the conversational reply tool (correctness failure)

**The agent's actual answer never reaches the user in 2 of 4 turns.**

**Confirmed via the MCP outbound wire log** (`[signal-mcp] [info] send_message_to_user …` =
what the channel actually transmitted). Everything the user received:

| Turn | On the wire | Real answer delivered? |
|---|---|---|
| 1 (XRP price) | only "…fetching the current price of XRP now." | ❌ price never sent |
| 2 (research)  | "…What specifically are you interested in?" | ✅ (clarifying question) |
| 3 (XRP+BTC)   | "Fetching… now…" **+** "XRP $1.20 and Bitcoin $63,681.00" | ✅ but out-of-order spam |
| 4 (tents)     | only "…please give me a moment to search…" | ❌ tent list never sent |

The stalled-deliverable assembly (`harness-deliverable: Assembling output…` on turn 1) is
**internal-only** — it does not auto-deliver to the channel. `send_message_to_user` is the **only**
delivery path, so a guard-blocked answer is silently lost. This is a correctness failure, not
inefficiency.

Root cause: `packages/reasoning/src/kernel/capabilities/act/guard.ts:148-170`.

```ts
const SIDE_EFFECT_PREFIXES = ["send", "create", "delete", "push", "merge", "fork", "update", "assign", "remove"];
const isSideEffectTool = SIDE_EFFECT_PREFIXES.some((p) => tc.name.toLowerCase().includes(p));
```

`signal/send_message_to_user` contains `"send"` → classified as a once-only irreversible
side-effect, same bucket as `delete`/`merge`/`push`. After the agent sends **any** message,
every subsequent `send_message_to_user` is blocked with:

> ⚠️ signal/send_message_to_user already executed successfully with different parameters.
> Side-effect tools must NOT be called twice.

In chat mode the reply tool is the primary conversational channel — sending more than one
message (ack, then answer; or a multi-part answer) is **normal and required**, not a bug.

Observed failure sequence (turns 1 & 4):
1. iter0 → `send_message_to_user("give me a moment / fetching now…")` ✓ sent
2. iter1 → `find(query)` ✓
3. iter2 → `send_message_to_user(<the real answer>)` → **BLOCKED by guard, never sent**
4. loop stalls → terminates. User is left with a filler ack and no answer.

Turn 3 only "worked" by luck: the model happened to send the real answer at iter1 *before*
the filler ack at iter2 — so the answer got through and the filler got blocked (still produced
out-of-order "fetching now…" UX after the answer).

### Fix direction
- Exclude conversational reply tools from `sideEffectGuard` (the gateway/channel reply tool is
  idempotent-by-intent, not a mutation). Either: (a) maintain an allowlist of "conversational"
  tools that the guard skips, or (b) gate `sideEffectGuard` on a tool-capability flag
  (`conversational: true` / `repeatable: true`) rather than a substring match on the name.
- Substring `includes("send")` is too broad regardless — it also catches `send_message_to_group`,
  any `*send*` MCP tool, etc. Prefer explicit capability metadata over prefix-matching.

## P1 — No "replied to user = turn complete" terminal recognition

Even when the answer gets through, the reactive loop does not recognize that **replying to the
user is the terminal act of a chat turn**. It keeps looping (re-fetching, re-sending) until either
`end_turn` (model voluntarily stops) or stall-forced deliverable assembly.

- Turn 3: answer delivered at iter1, then 11 more reasoning steps — re-fetched `crypto-price`,
  re-sent the answer twice (both blocked), emitted a backwards "Fetching now…" message **after**
  already answering. 13K tokens to answer a two-coin price lookup (~2K of real work).
- Turn 1: 4 stalled iterations → `harness-deliverable: Assembling output from 1 tool artifacts`.

In `mode: chat`, a successful `send_message_to_user` carrying the answer should be a strong
terminal signal — the kernel termination oracle should treat it as task-complete (or at least
heavily bias toward FINAL ANSWER) rather than continuing to reason.

## P2 — Filler "working on it" acks are an anti-pattern here

The model frequently sends a "give me a moment / fetching now…" message **before** doing the work.
Combined with P0 this is actively harmful (consumes the one-shot send budget, blocks the answer).
Even with P0 fixed it produces chatty, out-of-order UX. The system prompt ("Acknowledging the
user's request immediately is good practice in a live conversation") is *training* this behavior —
reconsider that guidance for chat mode, or make acks free (not counted/blocked).

## P3 — Per-iteration full context re-injection (token blow-up)

Every iteration re-dumps the entire system preamble + full tool catalog + tool-usage tutorial
(`find()`/`recall()`/`brief()` explainer, rationale-block rules) into the prompt. A 4-iteration
turn re-sends that boilerplate 4×. This is the bulk of the 7–13K tokens per simple turn.
The static tutorial portion should be cached / sent once, not re-rendered each think pass.

## P4 — Misleading diagnostics (false positives)

The metrics summary flags "Model stalled — entropy didn't decrease", "High step count suggests
task complexity or model confusion", "9 reasoning steps (complex reasoning)" on turns that are
really *termination/guard* failures, not model confusion. Turn 2 terminated cleanly via `end_turn`
yet still showed "model confusion." The alerts point at the model when the defect is in the
kernel's guard + termination logic. Reclassify these signals or they will mislead future triage.

## P5 — signal-cli config-lock contention (operational)

Boot logged `SignalAccount - Config file is in use by another instance, waiting…` before acquiring
the lock ~15s later. A stale/concurrent signal-cli holder delays first-message handling. Ensure
single-owner of the signal-data config, or surface the wait as an explicit gateway readiness gate.

## P6 — Tool routing: `find` for prices yields conflicting data; `crypto-price` was demoted

Turn 1 used `find("current price of XRP")` → three conflicting web snippets (£0.910 / $1.295 /
$1.22625). Turn 3 used the dedicated `crypto-price` tool → clean structured `$1.20` from coingecko.
The classifier **demoted** `crypto-price` to "relevant" on turn 1 ("no literal mention") and the
model fell back to `find`. A price intent should route to `crypto-price`, not generic web search.
Secondary to P0, but it's a data-quality gap.

## Priority order
1. **P0 + P1 together** — P0 alone (unblock repeat sends) without P1 makes turn-3-style spam
   *worse*: removing the block resurfaces the duplicate re-sends while the loop still doesn't know
   it's done. Either ship them as a pair, or have P0's fix itself treat a successful user-reply as
   a strong terminal bias toward FINAL ANSWER.
2. **P3** — static-preamble caching (largest token lever).
3. **P2 / P4 / P5 / P6** — UX guidance, diagnostic honesty, ops lock, tool-routing.

---

# Update 2026-06-03 (live replay + deeper root-cause)

P0 fixed + committed on branch `fix/gateway-chat-interaction` (worktree), commit
`bb8b9e02`: `isConversationalReplyTool()` classifier; `sideEffectGuard` exempts the
channel reply tool (duplicateGuard still blocks identical re-sends). reasoning 1565 +
runtime 740 green. **P0 live wire-log proof on gemini still outstanding** — the replay
the user ran was on ollama/cogito:14b, which cannot exercise P0 (see Root B).

A live replay on **cogito:14b** surfaced two roots deeper than the guard. The earlier
gemini run *refutes* "the rationale mandate suppresses tool calls" as the cross-model
root — gemini emits calls with the identical mandate present.

## Root B (P0-severity, local models): dialect="none" misroutes to NativeFCDriver

`packages/llm-provider/src/calibrations/cogito-14b.json` → `"toolCallDialect": "none"`
(ollama did not advertise a `tools` capability for this model). The driver selector
`packages/reasoning/src/kernel/loop/runner.ts:174-177` only diverts to `TextParseDriver`
on an **explicit** `"text-parse"`; `"none"` falls through to `NativeFCDriver`. So a model
the calibration says has *no* reliable tool-call dialect is handed native function-calling
anyway. ollama ignores the native `tools`, cogito emits prose (the mandatory rationale
block) with no call, the kernel nudges "you still need to call signal/send_message_to_user",
and it stalls for 21 iterations (16k tokens, success:false) **delivering nothing to the user.**

Evidence (live): 0 `[action]` lines, 0 `tool_use_start/tool_use_delta/tool_calls` in the
stream, 24× `model-io:direct-llm:stream:unknown/unknown`.

Fix direction: route `toolCallDialect === "none"` to `TextParseDriver` (give the weak model
a *text* format it can emit, which `TextParseDriver.extractCalls` parses) rather than native
FC it cannot use — OR re-probe. Touches calibration/driver routing (bench history); needs a
cross-tier check, not a blind flip.

Secondary smell: `direct-llm:stream:unknown/unknown` — the streaming FC path renders
provider/model as unknown; confirm it is only the stream logger and not missing provider
context to the driver.

## Root A (the consistent cross-model prompt/context issue the user flagged)

Visible in every prompt dump, model-independent:
1. **Triplicated channel wrapper.** The ~600-token enriched instruction
   ("You are in a live conversation… You MUST deliver your reply… If you need multiple
   steps, call it first with a brief acknowledgement, then again…") appears in the system
   `Goal:` block AND again as the thread `[USER]` message. The actual user content ("Hello!")
   is buried inside that wrapper, twice. The model never cleanly sees "the user said Hello."
   Source: `packages/runtime/src/gateway-context-formatting.ts:buildEnrichedInstruction` +
   the task seeding messages[0] with the same text.
2. **Tool forced on a greeting.** The classifier marks `signal/send_message_to_user`
   *required* even for "Hello", and the prompt says "Do not end your turn without such a tool
   call." Reasonable for a request; heavy-handed for a greeting, and it interacts badly with
   Root B (forces a tool the local model can't emit).
3. **Per-iteration preamble re-injection (P3 above)** compounds the bloat.

Fix direction: deduplicate the channel wrapper (carry it once — system OR first user message,
not both), and let trivial conversational turns satisfy completion with a single reply rather
than a hard required-tool gate.
