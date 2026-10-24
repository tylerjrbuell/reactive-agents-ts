---
type: design-spec
status: implemented
created: 2026-10-23
authored-by: OpenCode
related: "[[Implementation-Plans/2026-10-23-canonical-chat-engine|implementation plan]]"
tags: [chat, runtime, engine, streaming, jem, design-spec]
---

# Canonical Chat Engine — Harmonizing All Chat Surfaces

**Status:** implemented (commits e3b866d5e..38109bd75, docs/changeset/index truth in this Task 9 commit). Implementation plan: `wiki/Planning/Implementation-Plans/2026-10-23-canonical-chat-engine.md` (status: completed).
**Scope:** `packages/runtime/src/chat/**`, `gateway-context-formatting.ts` (chat-facade
portions), reactive-agent chat/session methods. **Consumer this unlocks:** `apps/jem`.

---

## 0. Purpose and motivated gap

Reactive Agents has five chat surfaces with divergent semantics for the same job.
The motivating consumer (Jem, a terminal assistant app, spec below) needs exactly
one primitive: **a chat turn with full conversation history, tools, reasoning,
persistence, and streaming**. Today no surface has all five properties at once.

Five surfaces surveyed (code-verified 2026-10-23):

| Surface | History source | Windowing | Persistence | Streaming | Persona |
|---|---|---|---|---|---|
| `agent.chat()` (no session) | agent-level `_chatHistory`, records **only on direct path** | **none, unbounded** | none | no | **ignored** |
| `agent.session().chat()` | session via `SessionStoreService`, unbounded accum | only with `onOverflow`; else unbounded | yes (`persist: true`) | no | ignored |
| `agent.run(input, {history})` | caller-supplied | 40 turns / 8k chars, drop-oldest | none | no | yes |
| `agent.runStream(input, {history})` | caller-supplied | same window, no summary | none | yes (RunHandle) | yes |
| `GatewayChatManager` | per-sender map | windowed, drop-oldest | yes + episodic log | no | yes |

## 1. Defect catalog (each verified in code)

1. **Persona ignored on chat direct path** — `chat.ts:directChat` hardcodes
   `"You are a helpful AI assistant..."`; builder persona never reaches conversational turns.
2. **Unbounded prompt context** — session/agent chat with no `onOverflow` sends the entire
   history to the LLM on every turn; session history grows unbounded in prompt.
3. **Asymmetric turn recording** — agent-level `_chatHistory` (reactive-agent.ts) records
   turns only on the direct-LLM path; the tool path returns after `run()` without appending,
   so bare-chat history silently diverges from the real conversation.
4. **Three session-id conventions** — `sess_<ts>_<rand>` (session) / `chat_<ts>` (bare chat)
   / `gateway-chat-<agentId>-<sender>` (gateway); ChatTurn events additionally carry the
   literal `taskId: "chat"`. No cross-surface observability correlation.
5. **Dead public knobs** — `SessionOptions.persistOnEnd` documented "NOT WIRED";
   `ChatOptions.maxIterations` documented "Default: 5" but never passed to `run()`.
6. **Hardcoded direct reply budget** — `directChat` `budgetTokens: 1024`, not configurable.
7. **No canonical streaming chat** — no public primitive combines streaming + history +
   recording + persistence (`session.chat` buffers; `runStream` leaves bookkeeping to caller).

## 2. Ratified decisions

| # | Decision | Choice |
|---|---|---|
| A1 | Compatibility bar | **Non-breaking**: signatures preserved; buggy semantics fixed; engine added underneath |
| A2 | Harmony scope | **All five surfaces** delegate to one engine (gateway keeps its channel instruction stack) |
| A3 | Streaming | **Included**: canonical engine gains a streaming entry point (closes gap 7) |
| A4 | Architecture | **Approach 1**: extract a canonical `ChatEngine` module; every surface becomes a thin facade. Gateways-manager shape generalized (pure helpers + manager class with injected async deps, no Effect inside) |
| A5 | Elegance rule | Engine composes existing single-responsibility pieces; adds no rendering, no windowing math, no summarization prompt of its own |
| A6 | Public API delta | Add `session.runStream()`; remove dead `persistOnEnd`; one canonical session-id format with legacy-key load fallback |
| A7 | **Improvement inheritance** | All chat mechanics live solely in the engine. Facades/hosts may only wire capabilities + delegate, never carry chat logic. Engine-optional capabilities (`systemPrompt`, `contextSummary`, window caps, budget) carry working engine defaults, so any future engine improvement (better windowing strategy, summary mechanics, turn policy) reaches agent.chat, session, gateway, AND external consumers (playground, cortex, UI kits) automatically with zero downstream edits. Hosts override only what they specialize. |

Rejected alternatives (recorded for the debrief): Approach 2 (elevate `AgentSession`
itself — lowest pattern compliance, gateway muxing corrupts a clean class, run/runStream
never converge) and Approach 3 (formal public `ChatPolicy` type — one real consumer today,
YAGNI; gateway instruction stacking needs an escape hatch anyway).

## 3. Engine design

**Location:** `packages/runtime/src/chat/engine.ts` (coexists with `chat.ts`, which keeps
`ChatMessage` / `ChatReply` / `ChatOptions` and the pure helpers).

**Shape** (A4): class with injected plain-async capabilities; Effect lives at the host's
edge exactly as `AgentSession` does today.

```ts
export interface ChatEngineCapabilities {
  /** Agentic execution (tools + reasoning loop). Backed by ReactiveAgent.run(). */
  readonly runTask?: (input: string, opts: { history: readonly ChatMessage[] }) =>
      Promise<AgentResult>
  /** Agentic streaming. Backed by ReactiveAgent.runStream(). Enables streamTurn(). */
  readonly runStreamTask?: (input: string, opts: {
      history: readonly ChatMessage[]
      density?: StreamDensity
      signal?: AbortSignal
  }) => RunHandle
  /** Plain conversational completion, no tools. Backed by LLMService via gatewayComplete. */
  readonly complete: (params: {
      messages: readonly { role: 'user' | 'assistant'; content: string }[]
      systemPrompt: string
  }) => Promise<{ message: string; tokens?: number; cost?: number }>
  /** ChatTurn event publication. Backed by EventBus. Optional. */
  readonly publishTurn?: (turn: ChatTurnEvent) => Promise<void>
  /** Session-history persistence. Backed by SessionStoreService. Optional. */
  readonly saveHistory?: (sessionId: string, messages: readonly ChatMessage[]) => Promise<void>
  readonly loadHistory?: (sessionId: string) => Promise<readonly ChatMessage[]>
  /** Persona/identity resolution for the direct path. Host supplies binding. */
  readonly systemPrompt?: (message: string) => string
  /** "Context from prior run" block (debrief + observations + taskContext). */
  readonly contextSummary?: (message: string) => string
}

export interface ChatEngineOptions {
  /** Canonical session id (see §1 fix 4). */
  readonly sessionId: string
  /** Window caps; defaults preserve 40 turns / 8k chars. */
  readonly maxWindowTurns?: number
  readonly maxWindowChars?: number
  /** Existing HistoryOverflowHandler type, unchanged semantics. */
  readonly onOverflow?: HistoryOverflowHandler
  /** Direct-path reply budget. Default raised above today's hardcoded 1024. */
  readonly maxDirectTokens?: number
}

export interface TurnOptions extends ChatOptions {
  /** Record different user-turn content than what is sent (gateway enriched-instruction case). */
  readonly recordUserText?: string
  /** Stream controls (streamTurn only); forwarded to runStreamTask. */
  readonly density?: StreamDensity
  readonly signal?: AbortSignal
}

export class ChatEngine {
  constructor(deps: ChatEngineCapabilities, options?: ChatEngineOptions) {}
  /** Buffered turn. Single entry for agent.chat / session.chat / gateway. */
  turn(message: string, options?: TurnOptions): Promise<ChatReply> {}
  /** Streaming turn; requires runStreamTask, typed rejection otherwise. */
  streamTurn(message: string, options?: TurnOptions): RunHandle {}
  history(): ChatMessage[] {}
  end(): Promise<void> {}
}
```

`runTask` / `runStreamTask` are optional (gateway has no need of a session-scoped stream
today); asking for `streamTurn()` without the capability is a typed error, not a runtime
surprise.

### Division of labor (A5)

| Concern | Owner |
|---|---|
| Which turns exist: load, record (both roles, both paths), splice-on-overflow, persist | `ChatEngine` |
| Rendering history into task text | `withHistoryBlock` (existing; stays the ONLY renderer) |
| Trimming/window math | `applyHistoryWindow` (existing) |
| Overflow summary content | caller's `HistoryOverflowHandler` (framework stays prompt-free) |
| Persona/identity | host's `systemPrompt` capability |
| Prior-run context block | host's `contextSummary` capability |
| Channel instruction program (episodic + outbound tool guidance) | `GatewayChatManager` (unchanged) |

**Inheritance law (A7):** the engine is the only home of chat mechanics. Facades contain
nothing but capability wiring + delegation; this is enforced by the removal ledger's
facade-mechanics census (§5 R-item check). Every optional capability and option carries an
engine default (persona fallback via the generic prompt when no `systemPrompt` capability
is wired, 40/8k windows, budget default) so consumers inherit engine improvements by
default instead of pinning old behavior at construction time. When a future improvement
lands (a better window policy, summary mechanics, turn policy), the change is one file;
`agent.chat`, `session.chat`, `session.runStream`, and the gateway inherit in the same
commit with no edits anywhere else.

### Turn flow

`turn(m, o)`:
1. Resolve history: in-memory session state; first miss loads via `loadHistory`.
2. Resolve routing: `o.useTools` > host classifier > `requiresTools` heuristic (unchanged).
3. Direct path: `complete` with full/windowed history + `systemPrompt(m)` + `contextSummary(m)` + `o.extraContext`; budget from `maxDirectTokens`.
4. Tool path: `runTask(systemSummaryPrefixed(m), { history })`; run path's own `withHistoryBlock` renders.
5. Record both turns (user: `o.recordUserText ?? m`; assistant: reply message).
6. Persist via `saveHistory` when capability present.
7. Publish `ChatTurn` events via `publishTurn` with canonical sessionId and `routedVia`.

`streamTurn(m, o)`: same resolution, then `runStreamTask` with spliced history; append
turns on completion; persist; publish. Yields `AgentStreamEvent` as today; RunHandle verbs
forwarded unchanged.

## 4. Facade rewiring

| Surface | Change |
|---|---|
| `agent.chat()` | Lazy agent-scoped default `ChatEngine` (`sess_agent_<agentId>`). `_chatHistory` dies; engine state replaces it. Gains: persona on direct path, symmetric recording, honored `maxIterations` |
| `agent.session({persist, id, onOverflow, maxAgeDays})` | Returns `AgentSession` (public type preserved) but the class is a ~30-line facade over one per-session `ChatEngine`. `.chat()` / `.history()` / `.end()` delegate 1:1. `persistOnEnd` removed from `SessionOptions`. **New: `.runStream(density?, signal?)`** — streams, records, persists if `persist` |
| `agent.run(input, {history})` | Not an engine: recodified as the stateless building block. Engine tool path implemented ON it. No behavior change beyond existing semantics |
| `agent.runStream(input, {history, ...})` | Same as run; engine stream path implemented on it; all RunHandle verbs unchanged |
| `GatewayChatManager` | Keeps channel program (episodic block, outbound guidance, enriched instruction). History state, windowing, turn recording, persistence delegate to per-sender `ChatEngine`s. SessionId canonical `sess_gateway_<agentId>_<sender>`; `loadHistory` falls back to legacy `gateway-chat-...` key on read; saves use canonical. `recordUserText` records the raw user message while the enriched instruction is what runs |

## 5. Removal ledger (wire-or-delete accounting)

Refactor law: the engine lands by **relocation, not duplication**. Every chat mechanism
that moves gets one disposition — `deleted` outright, `relocated` (old copy deleted,
logic lives in exactly one place), or `retained` (still single-caller, verified) — and
each carries a mechanical deletion proof. No orphaned code may survive the rewire.

| # | Removed / made redundant | Location | Disposition | Deletion proof |
|---|---|---|---|---|
| R1 | `ReactiveAgent._chatHistory` field + manual direct-path accumulation block | reactive-agent.ts (`_chatHistory` decl + pushes in `chat()`) | relocated (engine per-session state is the history owner) | `grep -c _chatHistory` = 0 after |
| R2 | Tool-path/history window branch + `_historyLoader`/`_historyLoaded` bookkeeping in `AgentSession.chat()` | chat.ts AgentSession class | relocated (engine owns resolution + window + splice) | AgentSession collapses to facade; file-LOC drop in ledger |
| R3 | `SessionOptions.persistOnEnd` | chat.ts | **deleted** (documented-dead knob) | type surface gone; changeset note |
| R4 | agent.chat inline orchestration: dual-path branches, `enrichedMessage` prepending, `publishChatTurns` closure, `toolsUsed` fallback chain | reactive-agent.ts `chat()` | relocated into one engine `turn()` implementation | `chat()` body is a delegate one-liner |
| R5 | "Context from prior run" inline enrichment string | reactive-agent.ts tool path | relocated (host `contextSummary` capability, composed in engine) | grep literal absent from reactive-agent.ts |
| R6 | `directChat()` free function | chat.ts | **deleted** — its system-prompt/history/messages logic folds into the engine's direct path; the host's `complete` capability wraps `gatewayComplete` directly | symbol gone; engine direct path covered by unit tests |
| R7 | `GatewayChatManager.histories` Map + `getOrLoadHistory` + inline history push/save in `handleMessage` | gateway-context-formatting.ts | relocated (per-sender engines own state) | map field gone from class |
| R8 | `buildChatTurnEvents` / `publishChatTurnEvents` | chat.ts | retain only if the host's `publishTurn` wiring still calls them; delete if orphaned | caller census: zero orphan exports in chat.ts |
| R9 | `buildChatSystemContext` / `buildContextSummary` / `formatTaskContextForChat` | chat.ts | retained as the single implementation behind the host `contextSummary` capability; each must have ≥1 caller post-rewire | caller census per export |
| R10 | SessionId format duplication (`sess_...` / `chat_...` / `gateway-chat-...` literals scattered) | surfaces | consolidated into one generator used by all three | grep shows one canonical site + documented legacy fallback |

Hard gates, riding existing repo law:
- **Orphan-export census**: after the rewire, every export in `chat.ts` / `engine.ts` has
  a live caller; census command in the debrief.
- **Error pools**: `new Error(` (post-tranche-1 ceiling 287) and `instanceof *Error` (129)
  must not rise; new failures ride `errors.ts` tagged conventions.
- **File-size ceiling ledger**: engine file registered; `reactive-agent.ts` expected to
  shrink further below its 2,344 ceiling (chat mechanics extraction).
- **LOC account (honest target, not a promise)**: engine file lands ~300-400 lines with
  docs; R1-R7 removals are expected to offset a large share within the same package. The
  debrief reports the actual net diff; net-positive-additions triggers a debrief review
  question rather than a silent acceptance.
- Any item that turns out inline-unverifiable or its premise stale during implementation
  (R8/R9 style plausible) is resolved **delete-with-evidence**, not kept-by-default.

## 6. Capability parity matrix (superset guarantee)

| Feature | Today lives in | Engine home |
|---|---|---|
| Tool-intent routing | agent.chat | `turn()` routing |
| Direct-LLM path | chat.ts directChat | `complete` call |
| Reasoning loop + tools | run() | `runTask` call |
| Streaming + RunHandle verbs | runStream() | `runStreamTask` call |
| History text rendering | withHistoryBlock | unchanged |
| Window math | applyHistoryWindow | unchanged |
| Overflow splice | AgentSession | engine option per host |
| Persistence save/load | AgentSession + gateway deps | capabilities |
| Unbounded accumulation + history() + end() | AgentSession | engine state |
| ChatTurn events | agent.chat | `publishTurn` |
| Persona on direct path | missing (defect) | `systemPrompt` capability |
| Prior-run context | agent.chat inline | `contextSummary` capability |
| verifyCitations + reasoningSteps + scratchpad reply fields | agent.chat tool path | `turn()` reply assembly |
| extraContext (direct only) | ChatOptions | TurnOptions, same semantics |
| Direct budget 1024 hardcoded | chat.ts | `maxDirectTokens` option |
| Episodic block / outbound guidance / TTL cleanup | gateway only | unchanged (channel program + gateway lifecycle) |
| density / signal / onRunId / identity | runStream | unchanged; forwarded via capabilities |
| Session ids (3 formats) | surfaces | one canonical format (§1 fix 4) |

Parity law: **no surface loses a feature; the engine matches or exceeds the union.**

## 7. Testing and compatibility pins

New tests (Bun runner, `packages/runtime/tests/`, every test with timeout):

1. **Engine unit tests** (`chat/engine.test.ts`, fake capabilities): windowing default
   (40/8k), overflow splice when handler provided, symmetric recording on both paths,
   per-turn persistence invocation, canonical sessionId generation, `recordUserText`
   override, typed rejection of `streamTurn` without `runStreamTask`, budget option honored.
2. **Facade parity pins:**
   - direct path persona reaches `complete` (previously hardcoded; red-on-cut)
   - session history trimmed in prompt but preserved in storage over 40-turn boundary
   - tool path records the assistant turn (red-on-cut: recording never fires pre-fix)
   - gateway enriched-instruction block **byte-identical** pre/post refactor (golden pin)
   - legacy gateway session key still loads (fallback)
3. **Equivalence pins (the harmony guarantee, mechanical):**
   - `engine.turn()` tool path == manual `run(input, { windowed history })` task text
   - `engine.streamTurn()` == `runStream` with pre-spliced history
4. **Regression sweeps:** existing `builder-with-session-persistence.test.ts` and
   chat-related runtime tests stay green.

Gates: `bun test packages/runtime` at 0 new failures; workspace typecheck 68/68;
file added to the file-size ceiling ledger per the quality program's shrink-only law;
any new errors ride `packages/runtime/src/errors.ts` conventions (no raw `new Error`).

## 8. Process

- **Warden routing:** implement through `runtime-warden` (MissionBrief-in /
  UpwardReport-out per the standing team-ownership contract). Parent runs verifier
  (typecheck + targeted tests) on receipt. File-scope: `packages/runtime/src/**` chat
  files + gateway-context-formatting.ts only.
- **Changeset:** minor. New public API (`session.runStream()`, `ChatEngine` export),
  semantic fixes under existing signatures, `SessionOptions.persistOnEnd` removal (goes
  into the changeset's breaking-adjacent note since it is a public type field).
- **Docs sync:** `features/streaming.md` (session.runStream), org docs for chat surfaces
  (`reference/builder-api.md` ChatOptions corrections), gateway docs (canonical ids),
  README quickstart chat note if warranted; metrics workflow for test-count drift.
- **Debrief:** post-completion debrief in `wiki/Research/Debriefs/` recording the defect
  catalog → fix mapping and any residual gaps for DEBT-REGISTER.

## 9. Non-goals and deferred work

- No new summarization prompt or LLM call baked into the framework (unchanged law).
- No public `ChatPolicy` type (deferred until a second policy consumer exists).
- No changes to `run()`/`runStream()` signatures beyond none; they are deliberately
  stateless so kernel-adjacent behavior stays untouched.
- Chat-adjacent improvements surfaced by Jem later (see below) are filed, not folded here.

## 10. Downstream consumer: Jem (phase 2 of this initiative)

`apps/jem` (private app package, dogfood consumer) is built AFTER this lands:
`jem` bin via `bun link`, provider/model via `JEM_PROVIDER` / `JEM_MODEL` env
(ollama local default), loop built on `agent.session({...}).runStream()` +
`.turn()` (the engine surface), terminal + MCP tools, dynamic subagents, crafted
domain agents as `defineTool()` tools, killswitches. Every framework gap Jem hits
is recorded in `apps/jem/FINDINGS.md` and promoted to wiki at milestones. Design brief decisions already ratified for Jem live in this conversation: the
non-streaming approach was rejected in favor of the engine stream surface so Jem
runs on the same primitive this spec ships; Jem stays a composition consumer
(no framework surface changes for its sake).

## 11. Alignment with active programs

- Continues the reactive-agent decomposition trajectory (reactive-agent.ts ceiling
  2,344): chat mechanics extraction shrinks the largest runtime file further.
- Honors the file-size ceiling ledger (new engine file must be registered, shrink-only
  law respected).
- Compatible with Effect-Facade Modernization Phase 2: engine is plain-async per the
  gateway precedent; if Phase 2 P2 decisions later mandate Effect-native seams for
  facade families, the engine's capability ports are the natural swap surface and this
  spec does not preempt that ruling.
