---
type: implementation-plan
status: draft
created: 2026-10-28
tags: [implementation-plan, cortex, sub-agents, beacon, stream, ui-core, cost, traces, export]
---

# Cortex Run Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.
>
> **Owner: <warden>** tasks go through that warden with a MissionBrief and are logged in the pilot log. **Owner: main** tasks are done by the dispatcher or a general subagent.

**Goal:** In Cortex chat and on the Beacon grid you can see:
- what each run and each sub-agent is doing, live and as a hierarchy;
- what it cost;
- its real JSONL trace;
- an export of the whole conversation.

**Architecture:** Everything builds on what already exists:
- **Run tree:** one core resolver, `makeRunTree`, built on the existing `rootRunId`/`parentRunId` correlation.
- **Stream:**
  - The runtime's 9 hand-copied stream filters collapse into one scope resolver.
  - Descendant activity reaches the parent `AgentStream` through the existing projections, wrapped once as `SubAgentActivity`.
  - `ui-core` folds that activity with its existing turn fold, applied recursively.
- **Cortex:**
  - Chat renders Claude-Code-style sub-agent blocks.
  - Beacon is keyed by run ids and receives chat-spawned runs.
  - Cost is persisted on top of the existing sub-agent budget fold.
  - Traces reuse the Lab trace endpoint and `TracePanel`.

**Tech Stack:** TypeScript, Effect-TS, Bun test, Elysia, SvelteKit.

**Plan family:** this plan is 2 of 3. Plan 1 is [[2026-10-28-cortex-reliability-and-providers]] (run it first). Plan 3 is [[2026-10-28-plan-and-goal-primitives]]. Plan 3 consumes this plan's Task 1 (`makeRunTree`) and Task 2 (stream scope resolver), so this plan must land before plan 3.

## Global Constraints

- **Types.** No `any`, no `as any`, no new `as unknown as`. Every new public export gets JSDoc.
- **Effect-TS.** Follow `CODING_STANDARDS.md` and `effect-ts-patterns`: no `throw` in new code, tagged errors, and every new service gets tests.
- **Domain wardens (AGENTS.md table).** A task inside a warden's domain is dispatched to that warden with a MissionBrief and logged in `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`. Parent-marked rows are done by the dispatcher.
- **Ratchets.** The `with*` method count stays at or below its ceiling (`builder-wither-ratchet.test.ts`). File-size ceilings in `scripts/check-file-size.sh` are exact, and wardens never edit `scripts/`. `check-cross-cutting.sh` and `check-ledger-writes.sh` must stay green.
- **Commits.** No `Co-Authored-By` trailer (`.githooks/commit-msg` rejects it). Use Conventional Commits, one concern per commit, and keep the workspace typecheck green after every commit.
- **Tests.** Run scoped tests with `bun test <path> --timeout 15000`. CI has no API keys and no Ollama, so tests use the test provider or an injected `fetch`. New test files require `bun run --cwd apps/docs metrics` and `metrics:sync-readme` in the same commit.
- **Cortex** imports packages from `dist`. Run `bunx turbo run build --filter=<pkg>...` before running Cortex tests.
- **Execution.** Use subagent-driven development: a fresh implementer per task, then a fresh reviewer, then a whole-branch review at the end. Apply the dispatcher FSM, and never re-prompt a warden to review its own work.

## Review Focus

1. **Root-only runs are byte-identical on `AgentStream`** after the scope-resolver refactor. Pinned against a fixture recorded before the change (Task 2).
2. **Parallel and nested sub-agents never mix.**
   - Each child's events fold only into its own block.
   - Grandchildren nest under their parent.
   - Foreign runs on a shared bus never appear.

   Pinned in Tasks 1, 2, 3 and 4.
3. **Reloads keep everything.** Sub-agent blocks, per-turn cost and the run id survive a page reload. Turns stored before the migration load unchanged. Pinned in Tasks 3, 4, 6 and 7.
4. **Cost is never silently understated.** Pricing that is unknown, or a failed child (whose cost the existing budget fold does not count), is flagged, not shown as $0. Pinned in Task 6.
5. **Untrusted ids never touch the filesystem.** Malformed run ids are rejected before any path is built (the `SAFE_RUN_ID` guard), and export filenames are safe slugs. Pinned in Task 7.

## Order

| Task | Owner | Depends on |
|---|---|---|
| 1. `makeRunTree` (core) | main | — |
| 2. Sub-agent activity on the parent stream | runtime-warden | 1 |
| 3. `ui-core` recursive fold | main | 2 |
| 4. Chat sub-agent blocks | main | 3 |
| 5. Beacon hierarchy + chat-spawned runs | main | 1 |
| 6. Chat cost accounting | main | — |
| 7. Real run traces + export | main | 1 |

Tasks 5, 6 and 7 can run in parallel with Tasks 2–4.

---

### Task 1: `makeRunTree` — the one delegation-tree resolver (core)

**Owner:** main

**Why:** Sub-agent visibility in the stream, the TUI, the Beacon grid and chat, and the checklist in plan 3, all need to answer one question: "is this event mine, a descendant's, or a foreign run's?" Today each consumer filters on `taskId` by hand, and none of them understands descendants. This task builds the answer once, on the correlation that already exists: `AgentStarted`/`AgentCompleted` carry `rootRunId`, `parentRunId`, depth and `agentDisplayName` (`packages/core/src/types/events/core-events.ts:358-368`, `:439-442`).

**Files:**
- Create: `packages/core/src/run-tree.ts`
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/__tests__/run-tree.test.ts`

**Interfaces** (exported from `@reactive-agents/core`):
- `interface RunNode { readonly taskId: string; readonly runId: string; readonly parentRunId?: string; readonly depth: number; readonly name: string; readonly status: "running" | "done" | "failed"; readonly startedAt: number; readonly endedAt?: number }`
- `type RunScope = { readonly kind: "root" } | { readonly kind: "descendant"; readonly node: RunNode } | { readonly kind: "foreign" }`
- `interface RunTree { observe(event: { readonly _tag: string } & Readonly<Record<string, unknown>>): void; scopeOf(taskId: string): RunScope; nodes(): readonly RunNode[]; childrenOf(runId: string): readonly RunNode[] }`
- `makeRunTree(rootTaskId: string): RunTree`
  - It is pure and synchronous, and it accepts plain JSON events, so ui-side ingest records work too.
  - It ignores events outside its root's tree.
  - An `AgentStarted` without `rootRunId` (a legacy or hand-rolled event) is treated as foreign unless its `parentRunId` is already known. This mirrors the trace normalizer's fallback.

- [ ] **Step 1: Write the failing tests:**

```ts
const started = (taskId: string, parentRunId: string, name: string) =>
  ({ _tag: "AgentStarted", taskId, rootRunId: "root", parentRunId, agentDisplayName: name, timestamp: 1 });

test("classifies root, nested descendants, and foreign runs", () => {
  const t = makeRunTree("root");
  t.observe(started("c1", "root", "a"));
  t.observe(started("g1", "c1", "b"));
  expect(t.scopeOf("root").kind).toBe("root");
  expect(t.scopeOf("g1")).toMatchObject({ kind: "descendant", node: { depth: 2, parentRunId: "c1", name: "b" } });
  expect(t.scopeOf("zzz").kind).toBe("foreign");
});

test("parallel siblings and completion status", () => {
  const t = makeRunTree("root");
  t.observe(started("c1", "root", "a"));
  t.observe(started("c2", "root", "b"));
  t.observe({ _tag: "AgentCompleted", taskId: "c1", rootRunId: "root", success: true });
  t.observe({ _tag: "AgentCompleted", taskId: "c2", rootRunId: "root", success: false });
  expect(t.childrenOf("root").map((n) => [n.name, n.status])).toEqual([["a", "done"], ["b", "failed"]]);
});

test("other trees on a shared bus are ignored", () => {
  const t = makeRunTree("root");
  t.observe({ ...started("x1", "other", "x"), rootRunId: "other" });
  expect(t.nodes()).toHaveLength(0);
});
```

- [ ] **Step 2: Run** `bun test packages/core/src/__tests__/run-tree.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.** Before coding, verify how `runId` relates to `taskId` on the real events (`RunContext`). Match `rootRunId`/`parentRunId` against the id the events actually carry, and record that finding in the JSDoc.
- [ ] **Step 4: Run** the test and `bunx turbo run typecheck --filter=@reactive-agents/core`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): makeRunTree — one delegation-tree resolver for runs and sub-agents`.

---

### Task 2: Sub-agent activity on the parent `AgentStream` (one scope resolver)

**Owner:** runtime-warden. Needs Task 1 (`makeRunTree`).

**Problem:**
- Each of the 9 bus subscriptions in `engine/execute-stream.ts` (`:169`, `:203`, `:245`, `:271`, `:311`, `:351`, `:416`, `:446`, `:501`) repeats its own root-`taskId` filter.
- Descendant runs share the parent's bus (`sub-agent-executor.ts:39-40`), but none of their activity reaches the parent stream. A chat cannot show a sub-agent working.

**Design:**
- The 9 copies collapse into ONE resolver: `makeRunTree(task.id).scopeOf(event.taskId)`.
- Root events project exactly as today.
- Descendant events go through the **same** existing projection functions, and the result is wrapped once as a full-density variant:

  `{ readonly _tag: "SubAgentActivity"; readonly run: { readonly runId: string; readonly parentRunId?: string; readonly depth: number; readonly name: string }; readonly event: AgentStreamEvent }`

- Lifecycle uses the same wrapper:
  - a child's `AgentStarted` becomes `event: { _tag: "PhaseStarted", phase: "sub-agent" }`;
  - its `AgentCompleted` becomes a wrapped `StreamCompleted`, carrying the child's output, `success`, tokens and cost.
- No per-kind child event types are added.
- Foreign runs are dropped. Children run non-streaming, so there are no child `TextDelta`s. The preview comes from the child's thoughts, tool calls and final output, which matches how Claude Code previews a sub-agent.

**Files:**
- Modify `engine/execute-stream.ts`. Each subscription body calls one helper, `routeScoped(tree, event, project, offer)`, in a new `engine/stream-scope.ts`. Net LOC must shrink; the warden reports the delta.
- Modify `stream-types.ts`, adding the variant.
- Test: `packages/runtime/tests/sub-agent-stream.test.ts`

- [ ] **Step 1: Write the failing tests.** All use the test provider with `.withDynamicSubAgents()`.
  - **Parallel children:** `spawn-agents` with two children in parallel produces wrapped `PhaseStarted(sub-agent)` ×2, interleaved wrapped `ToolCallStarted`/`Completed` per child, and wrapped `StreamCompleted` ×2 (with child output), all before the root `StreamCompleted`.
  - **Nesting:** a grandchild carries `depth: 2` and `parentRunId` equal to the child's run id.
  - **Isolation:** a concurrent unrelated run on the same bus never appears.
  - **Byte-identical root:** root-only runs produce the same chunk sequence as before. Pin this against a recorded fixture taken before the change.
  - **Density:** `"tokens"` emits no `SubAgentActivity`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test packages/runtime/tests --timeout 15000`, typecheck, `bash scripts/check-file-size.sh`, and the metrics sync. Expected: PASS.
- [ ] **Step 5: Commit** `feat(runtime): one stream scope resolver; sub-agent activity projected onto the parent AgentStream`. Log the warden task.

---

### Task 3: `ui-core` folds sub-agent activity with the same turn fold

**Owner:** main. Needs Task 2.

**Files:**
- `packages/ui-core/src/protocol/events.ts`: add the `SubAgentActivity` wire variant.
- `state/turn-trace.ts`:
  - `TurnTraceState.subAgents: Readonly<Record<string, SubAgentTrace>>`, where `SubAgentTrace = { run: …; status: "running" | "done" | "failed"; trace: TurnTraceState; output?: string; tokens?: number; costUsd?: number; startedAt; endedAt? }`.
  - The child's `trace` is built by recursively applying the **same** `foldTurnTrace` to the unwrapped event. There is no second fold.
  - `TurnTrace.subAgents` is persisted (capped like tool results), so reloads show children.
- `state/run-machine.ts`: `RunState.subAgents` gets the same recursive fold.
- Test: `packages/ui-core/tests/sub-agent-fold.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - Two parallel children fold into two independent traces, each with its own tool calls.
  - A grandchild nests under its parent.
  - A finished child is `done`, with output and cost.
  - Persisted trace round-trip.
  - Turns without sub-agents finish exactly as before.
- [ ] **Step 2: Run** `bun test packages/ui-core --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the ui-core tests and the bindings tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-core): sub-agent activity folds recursively into turn and run state`.

---

### Task 4: Cortex chat — Claude-Code-style sub-agent blocks with live preview

**Owner:** main. Needs Task 3. Load `frontend-design:frontend-design`.

**Files:**
- Create `apps/cortex/ui/src/lib/components/ChatSubAgentBlock.svelte` and `apps/cortex/ui/src/lib/sub-agent-view.ts`.
- `sub-agent-view.ts` holds the pure view model: `subAgentView(t: SubAgentTrace): { title; status; elapsedLabel; toolCount; costLabel; previewLines: readonly string[]; children }`. `previewLines` holds the last 3 lines of thought or tool activity while the child is running, and the first line of output once it is done.
- Behaviour:
  - Collapsed, the block is one row: name, status dot, `3 tools · 12s · $0.004`, plus the live preview lines while running.
  - Expanded, it shows the child's full transcript, rendered by the **existing** chat turn components (thoughts, tool chips, answer) recursively, with grandchildren nested.
  - Parallel children stack in start order and update independently.
  - Each block links to its run trace (Task 7) and, once plan 3 ships, to its checklist group.
- Modify `stores/chat-stream.ts` (fold `SubAgentActivity`), `chat-store.ts` (`hydrateTurn` restores `subAgents`), `ChatPanel.svelte` (mount the blocks in the turn timeline at the iteration where each child started), and `ChatTraceDrawer.svelte` (children nested).
- Test: `apps/cortex/ui/src/lib/sub-agent-view.test.ts`, `apps/cortex/ui/src/lib/stores/chat-stream.subagents.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - The preview shows the last 3 activity lines while running and switches to the output line when done.
  - The counts and labels are correct.
  - Two parallel children fold independently.
  - A reloaded turn restores its children.
  - An old turn without sub-agents renders unchanged.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test apps/cortex/ui --timeout 15000` and `bun run --cwd apps/cortex/ui check`. Then check in the browser:
  - a chat that spawns two parallel sub-agents shows both blocks streaming;
  - expanding a block shows its tools and answer;
  - the blocks survive a reload;
  - take screenshots in both themes.
- [ ] **Step 5: Commit** `feat(cortex): live sub-agent blocks in chat with expandable transcripts`.

---

### Task 5: Beacon grid shows the real agent hierarchy, including chat-spawned children

**Owner:** main. Needs Task 1.

**Problems:**
- `stores/agent-store.ts:310-313` writes `parentAgentId` (an **agent** id) into `parentRunId`. `BeaconCanvas.svelte:123` and `AgentGrid.svelte:12-20` key edges by **run** id, so parent→child edges mostly fail to connect.
- The store ignores `rootRunId` and `depth`.
- Chat sessions build agents without Cortex event reporting, so sub-agents spawned in chat never reach the ingest path (`server/services/ingest-service.ts`) and never appear on the grid. The executor confirms this before fixing it.

**Files:**
- `apps/cortex/ui/src/lib/stores/agent-store.ts`: read `parentRunId`, `rootRunId` and depth from `AgentStarted`, with no `parentAgentId` fallback into a run-id field.
- `AgentGrid.svelte` and `BeaconCanvas.svelte`: build the hierarchy with core's `makeRunTree` semantics. Ingest events are plain JSON, so feed them to the tree, giving one hierarchy rule.
  - Draw edges by run id.
  - Group each delegation tree visually, with collapsible subtrees and depth indentation in the grid.
  - Show parallel siblings side by side.
  - Show live status on every node.
- `apps/cortex/server/services/chat-session-service.ts` / `build-cortex-agent.ts`: chat agents feed the same ingest path that Lab and gateway runs use, in-process, with no HTTP self-call if an in-process sink exists. Root chat runs are tagged with their session, so a node links back to its chat.
- Test: `apps/cortex/ui/src/lib/stores/agent-store.hierarchy.test.ts`, `apps/cortex/server/tests/chat-ingest.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - From an `AgentStarted` sequence with root, two parallel children and a grandchild, the store yields edges root→c1, root→c2 and c1→g1. The pre-fix behaviour, where `parentAgentId` was mistaken for a run id, produces no false edge.
  - A chat turn that spawns a sub-agent produces ingest records for both runs, carrying the parent/child correlation.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test apps/cortex --timeout 15000` and the UI check. Then check in the browser that a chat spawning parallel sub-agents shows the tree live on the Beacon grid, with edges, and links back to the chat.
- [ ] **Step 5: Commit** `fix(cortex): beacon hierarchy keyed by run ids; chat-spawned sub-agents appear on the grid`.

---

### Task 6: Chat cost accounting — per turn and per conversation

**Owner:** main. Can run in parallel with Tasks 1–5.

**Problem:**
- `ChatPanel.svelte:48` derives `sessionCostTotal` from the in-memory `costUsd`/`liveCost`, but cost is never persisted. `cortex_chat_turns` has no cost column (`server/db/schema.ts:108`, `chat-queries.ts:132`), so a reload shows $0.
- The total only appears inside the context-meter tooltip (`ChatContextMeter.svelte:38`).
- The direct-LLM chat path (`chat-session-service.ts:~391-445`) may not report cost at all.

**Files:**
- `apps/cortex/server/db/schema.ts`: add an additive migration for `cortex_chat_turns.cost_usd REAL NOT NULL DEFAULT 0`, using the same mechanism that added `trace_json`/`provider`/`model`.
- `apps/cortex/server/db/chat-queries.ts`: the insert, select, fork copy and rewrite paths carry `cost_usd`.
- `apps/cortex/server/services/chat-session-service.ts`: `persistTurn` gains `costUsd`, taken from `StreamCompleted.metadata.cost` (engine path) and from the direct path's completion usage, priced via `@reactive-agents/llm-provider` pricing. Unknown pricing persists `0` and is flagged in the turn's `meta` as `costKnown: false`.
- `GET /api/chat/sessions/:id`: return `totals: { tokens, costUsd, costKnown }` computed in SQL. One source, not a UI reduction.
- `apps/cortex/ui/src/lib/stores/chat-store.ts`: `hydrateTurn` restores `costUsd`, and the session holds `totals`.
- `ChatContextMeter.svelte` / `ChatPanel.svelte`: show a compact session cost (`$0.0123`) beside the context wheel, always visible when > 0. The tooltip keeps the breakdown.
- `ChatTraceDrawer.svelte`: add a per-turn row with tokens (in/out where known), cost, duration and model.
- Test: `apps/cortex/server/tests/chat-cost.test.ts`, `apps/cortex/ui/src/lib/stores/chat-cost.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - **Persistence:** a streamed turn with `metadata.cost = 0.0042` persists `cost_usd = 0.0042`.
  - **Totals:** the session endpoint returns `totals.costUsd` summed across turns. Fork and rewrite keep or zero cost exactly as they do tokens.
  - **Unknown pricing:** a model with no pricing gives `costKnown: false`, and the UI renders "—", not "$0".
  - **Sub-agents:** a turn that spawns sub-agents persists the parent cost **including** successful children. This builds on the existing ambient budget fold at `sub-agent-executor.ts:670-676` and adds no second accumulator.
  - **Failed children:** a failed child's cost is not folded today (a disclosed gap, `:663-664`). In that case the turn persists `costKnown: false`, and the UI shows "≥ $x", so the total is never understated silently. Closing the fold gap belongs in runtime: if it is pursued, it becomes a runtime-warden follow-up and is not patched in Cortex.
  - **Trace drawer breakdown:** the per-turn cost shows its children, read from each child's `AgentCompleted` cost on the bus, which is already emitted.
  - **Pre-migration rows:** these load with cost 0 and nothing breaks.
  - **UI totals:** the session total equals the server totals plus the live cost of a streaming turn.
- [ ] **Step 2: Run** `bun test apps/cortex/server/tests/chat-cost.test.ts apps/cortex/ui/src/lib/stores/chat-cost.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test apps/cortex --timeout 15000` and `bun run --cwd apps/cortex/ui check`. Then check in the browser:
  - the cost next to the wheel survives a reload;
  - the per-turn cost shows in the trace drawer.
- [ ] **Step 5: Commit** `feat(cortex): persist chat turn cost; show conversation and per-run cost`.

---

### Task 7: Chat shows the real run trace; copy/download JSONL; export the transcript

**Owner:** main. Needs Task 1 for descendant traces; pairs with Task 6.

**Problem:**
- The chat trace drawer shows only the ui-core turn fold (thoughts and tool calls).
- The framework's real run trace exists for Lab runs (`server/services/run-trace-file.ts`, `GET /api/runs/:runId/trace` at `runs.ts:443`, and `TracePanel.svelte` / `TraceFrameCard.svelte`). Chat turns have none of this:
  - they persist no run id;
  - chat agents are not built with JSONL tracing;
  - there is no export.

**Files:**
- Server:
  - `build-cortex-agent.ts`: chat sessions enable the framework tracer (`.withObservability({ tracing: { dir } })`), with `dir` set to the first entry of `traceDirs()`. Gate it on a Cortex setting `chat.traceRuns`, default `true`.
  - `schema.ts`: add an additive migration for `cortex_chat_turns.run_id TEXT`.
  - `chat-queries.ts` and `chat-session-service.ts`: persist `StreamCompleted.taskId` as `run_id`. This is the id the tracer names its file by. Verify that with a test, not an assumption.
  - `api/chat.ts`:
    - `GET /api/chat/sessions/:id/turns/:turnId/trace` reuses `readRunTraceFile(run_id)`, with the same headers and `x-trace-source` fallback semantics as `runs.ts:443`.
    - `GET /api/chat/sessions/:id/export?format=md|json|jsonl`:
      - `md` is a readable transcript: roles, answers, tool calls, per-turn model and cost.
      - `json` is the session plus turns plus traces.
      - `jsonl` concatenates every turn's run trace, each line tagged with `turnId`.

    The route sends `content-disposition` with a slugified session name.
- UI:
  - `ChatTraceDrawer.svelte`: add a "Run trace" tab rendering the real JSONL through the existing `TracePanel`/`TraceFrameCard`, without forking them. Add "Copy JSONL" and "Download .jsonl" actions, plus a clear empty state when no trace exists ("tracing was off for this turn").
  - `chat-commands.ts`: add an `/export [md|json|jsonl]` command, with `md` as the default. Also add a session menu entry "Export conversation".
- Test: `apps/cortex/server/tests/chat-trace-export.test.ts`, `apps/cortex/ui/src/lib/chat-commands.test.ts` (extend), `apps/cortex/ui/src/lib/chat-export.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - **Trace persistence:** a streamed chat turn persists a `run_id` equal to the tracer's file name, and `GET …/trace` returns that JSONL with `x-trace-source: tracer`.
  - **Delegation tree:** a turn that spawned sub-agents returns the root trace plus each descendant's trace, ordered root first and then by start time. The descendants are found through `rootRunId`, which the tracer already stamps for exactly this ("Lets a JSONL filter group a run with all it spawned", `core-events.ts:362-365`). The drawer renders the children as nested, collapsible runs.
  - **Missing trace:** a turn without a trace file falls back or returns 404 exactly as the runs route does.
  - **Run id hygiene:** a malformed run id never touches the filesystem; reuse the `SAFE_RUN_ID` guard.
  - **Export, md:** contains every turn in order, with model and cost.
  - **Export, jsonl:** every line parses and carries a `turnId`.
  - **Download headers:** `content-disposition` is a safe slug.
  - **Commands:** `parseSlash("/export json")` resolves to `export` with arg `json`, and `/export` defaults to `md`.
  - **Matching:** add `export` to the expectations in the existing matching test.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test apps/cortex --timeout 15000` and `bun run --cwd apps/cortex/ui check`. Then check in the browser:
  - the drawer's "Run trace" tab shows real frames, and copy and download work;
  - `/export` downloads all three formats;
  - a pre-migration turn shows the empty state.
- [ ] **Step 5: Commit** `feat(cortex): real run traces in chat with JSONL copy/download; conversation export`.

---

