# Cortex Chat ⇄ Builder Tool Parity — Design Spec

**Date:** 2026-06-09
**Status:** Approved (brainstorm), pending implementation plan
**Scope:** `apps/cortex` only — no framework (`packages/**`) changes
**Branch (proposed):** `feat/cortex-chat-tool-parity`

## Goal

Main chat sessions should be able to use the **same tools as the Lab builder** —
built-in tools, **MCP server tools**, **dynamic sub-agents**, and custom/code
tools (`agentTools`) — configured either inline (full config panel) or by
reusing a saved Lab agent.

Today a chat session can only enable built-in `tools` (a string array) plus the
host shell. MCP, sub-agents, and custom tools are unreachable from chat even
though the underlying build path (`buildCortexAgent`) already supports them.

## Non-goals

- No new framework capabilities — `buildCortexAgent` / `BuildCortexAgentParams`
  already accept `mcpConfigs`, `agentTools`, `dynamicSubAgents`, etc.
- No change to how the Lab builder works.
- No multi-agent chat orchestration beyond what `dynamicSubAgents` already does.
- Not redesigning chat history, streaming, or run-linking.

## Current state (the gap)

Build path (already shared with the Lab):
`agentConfig` → `ChatSessionService.buildChatAgentParams()` → `buildCortexAgent(params)`.

`buildChatAgentParams` (`chat-session-service.ts` ~L284–460) currently forwards,
when `enableTools`:
- `tools: mergedTools` (built-in IDs via `mergeCortexAllowedTools`)
- `terminalTools`, `terminalShellAdditionalCommands`, `terminalShellAllowedCommands`
- persona, reasoning strategy, verification, guardrails, contextSynthesis, taskContext

It does **NOT** forward: `mcpServerIds` (→ `mcpConfigs`), `agentTools`,
`dynamicSubAgents`, `additionalToolNames`, `skills`.

API body `ChatSessionConfigBody` (`chat.ts` ~L5) does not accept those fields.

UI config lives in `ChatSessionList.svelte` (provider/model/`enableTools` +
built-in tool picker) — a chat-specific form, **not** the builder's
`AgentConfigPanel`. Store glue: `chat-store.ts` (`ChatSessionConfigInput`,
`createSession`, `updateSessionConfig`).

**Lifecycle hazard introduced by this feature:** `ChatSessionService` caches one
`AgentSession` per session in `this.sessions` (Map). `buildSession()` builds
`const agent = await buildCortexAgent(params)` and wraps it in
`new AgentSession((msg,hist,opts)=>agent.chat(...), …)` — the `agent` ref (which
owns MCP docker containers and exposes `.dispose()`) is captured in a closure and
**not retained**. On `updateSessionConfig` / `deleteSession` the code only does
`this.sessions.delete(sessionId)` — it never disposes the agent. `AgentSession.end()`
only flushes history; it does not dispose the agent. Today this leaks nothing
(no MCP); once MCP is wired, **every config change / closed session leaks a
container** unless we dispose the agent.

## Architecture

Four coordinated pieces, all in `apps/cortex`:

### 1. Server — config schema accepts the builder's tool fields

Extend `ChatSessionConfigBody` (and the `updateSessionConfig` patch body) in
`server/api/chat.ts` to accept the missing fields:
`mcpServerIds: string[]`, `agentTools: unknown[]`, `dynamicSubAgents: {enabled, maxIterations?}`,
`additionalToolNames: string`, `terminalTools`/`terminalShell*` (already partly),
`skills`. The session already persists a permissive `agentConfig` blob and
`normalizeCortexAgentConfig` preserves unknown keys, so storage needs no schema
change — only the typed API surface + the param threading below.

A `server/tests/chat-config-parity.test.ts` pins that the chat body accepts and
round-trips these fields (mirrors the existing `config-parity.test.ts` pattern).

### 2. Server — `buildChatAgentParams` threads them

When `enableTools`, forward into `BuildCortexAgentParams`:
- **MCP:** resolve `mcpServerIds` → `mcpConfigs` using the **same** store call the
  Lab run path uses: `store.getMcpServerConfigsByIds(ids)`
  (`runner-service.ts` L132; the chat service already holds `this.db` / store
  access). Pass `mcpConfigs` to `buildCortexAgent`.
- `agentTools` (custom/code tools) — forward as-is (same shape the Lab sends).
- `dynamicSubAgents` — forward `{ enabled, maxIterations? }`.
- `additionalToolNames` — merge into the allowed-tools set like the Lab.

Prefer extracting the Lab's config→params field mapping into a shared helper if
one does not already exist, so chat and runs cannot drift; otherwise mirror the
runner's field handling exactly and cover it with the unit test below.

### 3. Server — session lifecycle (dispose MCP)

Change the session cache to retain a disposer. Cache value becomes
`{ session: AgentSession; agent: { dispose(): Promise<void> } }` (or a
`dispose` thunk). In `buildSession`, return both; store both.

- `updateSessionConfig(sessionId, …)`: `await cached.agent.dispose()` **before**
  `this.sessions.delete(sessionId)` (config change rebuilds next turn).
- `deleteSession(sessionId)`: same — dispose then delete.
- Best-effort: wrap dispose in try/catch + log; a dispose failure must not block
  the config update or delete.

Session-scoped containers stay up across turns (the cache already persists the
session between turns); they are torn down on config-change and on close.

### 4. UI — two entry points ("both")

- **Full config panel:** embed `AgentConfigPanel` in the chat session config,
  bound to the session's `agentConfig`. Edits flow through `updateSessionConfig`
  (which now disposes + rebuilds). This is the existing shared component used in
  the Lab + Beacon bar, so chat gets MCP / sub-agents / custom tools / persona /
  reasoning with zero drift. The lightweight `ChatSessionList` form is replaced
  by (or gains a path to) the panel.
- **Start from saved agent:** a picker in the new-session flow lists saved Lab
  agents; choosing one **snapshots** that agent's `config` into the new session's
  `agentConfig` (copy, not live-link — the session owns its config thereafter,
  mirroring the Lab's `useConfigInBuilder` snapshot). Editing the session config
  afterward does not affect the saved agent.

## Data flow (one chat turn, tools on)

1. Session created with `agentConfig` (from the panel or a saved-agent snapshot),
   `enableTools: true`, plus `mcpServerIds` / `agentTools` / `dynamicSubAgents`.
2. First turn: `buildSession` → `buildChatAgentParams` resolves
   `mcpServerIds → mcpConfigs`, forwards `agentTools` / `dynamicSubAgents` →
   `buildCortexAgent` spins up MCP containers + registers tools/sub-agents →
   cached as `{ session, agent }`.
3. Subsequent turns reuse the cached session (containers stay up).
4. Config edit → dispose agent (containers down) + drop cache → next turn rebuilds.
5. Session delete → dispose agent + drop cache.

## Error handling

- Unknown / unresolved `mcpServerId` → resolve to empty config + surface a
  non-fatal warning (don't crash the turn); same posture as the Lab.
- MCP container start failure → the framework already reports tool-unavailable;
  chat shows the turn error, session stays alive.
- Dispose failure on eviction → logged, swallowed; never blocks update/delete.

## Testing

- **Unit:** `buildChatAgentParams` forwards `mcpConfigs` (resolved),
  `agentTools`, `dynamicSubAgents`, `additionalToolNames` when `enableTools`, and
  omits them when tools are off.
- **Server:** chat-config-parity test (body accepts + round-trips the new fields);
  lifecycle test asserting `agent.dispose()` is invoked on `updateSessionConfig`
  and `deleteSession` (spy/fake agent).
- **UI:** Playwright spot-check — create a chat session with an MCP server enabled
  (e.g. an already-configured MCP from the Tools tab), send a turn that triggers
  the MCP tool, confirm `toolsUsed` includes it. Also confirm "start from saved
  agent" snapshots config.

## Risks / open items (resolve in the plan)

- **MCP container cost in interactive chat.** Containers live for the session;
  acceptable, but a long-idle session holds a container. Out of scope to add idle
  eviction now — note as a follow-up (a TTL sweep could dispose idle sessions).
- **Shared mapper vs mirror.** Whether a reusable Lab config→params mapper exists
  to share (preferred) or chat must mirror runner field handling — pin during
  planning by reading `runner-service.ts` start().
- **`AgentConfigPanel` in chat** changes the chat config UX substantially (full
  panel). Confirm placement (modal / side panel) during UI implementation; the
  panel already supports `compact` mode if a denser layout is wanted.

## Phasing

1. Server threading + lifecycle (pieces 1–3) + server tests — the functional core.
2. UI: embed `AgentConfigPanel` in chat config (piece 4a).
3. UI: saved-agent snapshot picker (piece 4b).
4. Playwright verification.
