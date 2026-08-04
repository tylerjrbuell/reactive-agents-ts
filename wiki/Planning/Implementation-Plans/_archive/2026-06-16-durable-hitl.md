# Durable Human-in-the-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An approval gate that survives process death — a run pauses on a flagged action, persists `awaiting-approval`, returns control; a human approves/denies from any process; the run resumes from its checkpoint to completion.

**Architecture:** Reuse the v0.12 crash-resume infra. The pause is a new `terminatedBy="awaiting-approval"` kernel reason that the engine persists to the SQLite `RunStore`; the resume is `resumeRun` seeded with a decision carried via a new `ApprovalDecisionRef` FiberRef (mirroring `ResumeStateRef`). One gate decision point fed by three sources (tool flag, builder policy, compose killswitch). SQLite is the cross-process rendezvous — no IPC/polling.

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS, Bun test, `@reactive-agents/runtime-shim` SQLite, Turborepo monorepo.

**Spec:** `wiki/Architecture/Design-Specs/2026-06-16-durable-hitl-design.md`

**Branch:** `feat/durable-hitl-2026-06-16` (already created; spec committed).

**Conventions reminders:**
- No `any`. Use `unknown` + guards or proper types.
- No `Co-Authored-By` trailers in commits.
- Workspace packages run from `src/` under Bun — no rebuild needed for tests/probes.
- Governance ceilings (`console.warn`, `as-unknown-as`): do not trip; if a bump is unavoidable, justify + raise per documented discipline (no metric-gaming).
- Run a single test file with: `bun test <path>` from repo root.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/runtime/src/services/run-store.ts` | + `run_approvals` table + `putApproval`/`getPendingApproval`/`decideApproval` + `ApprovalRecord` type |
| `packages/runtime/src/errors.ts` | + `ApprovalStateError` |
| `packages/core/src/streaming.ts` + `packages/core/src/index.ts` | + `ApprovalDecision` type + `ApprovalDecisionRef` FiberRef + export |
| `packages/reasoning/src/kernel/state/kernel-state.ts` | + `KernelMeta.awaitingApprovalFor` + `KernelInput.approvalDecision` |
| `packages/reasoning/src/kernel/loop/terminate.ts` | register `"awaiting-approval"` as a non-failure terminal reason |
| `packages/reasoning/src/kernel/capabilities/act/tool-gating.ts` | `shouldGate` + pause-on-flagged-pending-call |
| `packages/reasoning/src/kernel/loop/runner.ts` | resume re-entry: approved→act, denied→observe |
| `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts` | read `ApprovalDecisionRef` → forward `approvalDecision` into `KernelInput` |
| `packages/runtime/src/engine/durable-resume.ts` | `decideAndResume` helper |
| `packages/runtime/src/engine/execute-stream.ts` | persist pause when `terminatedBy="awaiting-approval"` |
| `packages/runtime/src/reactive-agent.ts` | `approveRun`/`denyRun`/`listPendingApprovals` + seed `ApprovalDecisionRef` |
| `packages/runtime/src/builder.ts` + `packages/runtime/src/builder/types.ts` | `.withApprovalPolicy(...)` + build guard + thread config |
| `packages/runtime/src/types.ts` (AgentResult) | `status` + `pendingApproval` fields |

Build order is dependency-bottom-up: store → core ref → kernel types → kernel gate → runner → engine forward → engine persist → result surface → builder → agent API → integration → e2e → docs.

---

## Task 1: RunStore — durable approval records

**Files:**
- Modify: `packages/runtime/src/services/run-store.ts`
- Test: `packages/runtime/tests/services/run-store.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing `describe("RunStoreService", ...)` block)

```ts
  it("putApproval then getPendingApproval returns the pending row", async () => {
    const prog = Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.createRun({ runId: "ap1", agentId: "a", task: "t", configHash: "h" });
      yield* store.putApproval({
        runId: "ap1", gateId: "g1", toolName: "shell-execution",
        argsJson: '{"cmd":"rm -rf /tmp/x"}',
      });
      return yield* store.getPendingApproval("ap1");
    });
    const rec = await Effect.runPromise(prog.pipe(Effect.provide(inMem)));
    expect(rec?.gateId).toBe("g1");
    expect(rec?.toolName).toBe("shell-execution");
    expect(rec?.status).toBe("pending");
  });

  it("decideApproval flips a pending row and blocks double-decide", async () => {
    const prog = Effect.gen(function* () {
      const store = yield* RunStoreService;
      yield* store.createRun({ runId: "ap2", agentId: "a", task: "t", configHash: "h" });
      yield* store.putApproval({ runId: "ap2", gateId: "g2", toolName: "docker", argsJson: "{}" });
      const first = yield* store.decideApproval("ap2", "g2", "approved");
      const pendingAfter = yield* store.getPendingApproval("ap2");
      const second = yield* store.decideApproval("ap2", "g2", "denied", "too late");
      return { first, pendingAfter, second };
    });
    const { first, pendingAfter, second } = await Effect.runPromise(prog.pipe(Effect.provide(inMem)));
    expect(first).toBe(true);
    expect(pendingAfter).toBeUndefined(); // no longer pending
    expect(second).toBe(false); // already decided
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/tests/services/run-store.test.ts`
Expected: FAIL — `store.putApproval is not a function`.

- [ ] **Step 3: Add the `ApprovalRecord` type + interface methods**

In `run-store.ts`, after the `CheckpointRecord` interface (~line 66) add:

```ts
export interface ApprovalRecord {
  readonly runId: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly argsJson: string;
  readonly status: "pending" | "approved" | "denied";
  readonly reason?: string;
}
```

In the `RunStore` interface (after `listRuns`, ~line 102) add:

```ts
  /** Insert a pending approval row for a paused run. */
  readonly putApproval: (r: {
    runId: string;
    gateId: string;
    toolName: string;
    argsJson: string;
  }) => Effect.Effect<void, never>;
  /** The single pending approval for a run, or undefined if none pending. */
  readonly getPendingApproval: (
    runId: string,
  ) => Effect.Effect<ApprovalRecord | undefined, never>;
  /** Flip a pending approval to approved/denied. Returns false if no pending row matched. */
  readonly decideApproval: (
    runId: string,
    gateId: string,
    status: "approved" | "denied",
    reason?: string,
  ) => Effect.Effect<boolean, never>;
```

- [ ] **Step 4: Add the table DDL + a row interface**

Add a row interface near `RunRow` (~line 123):

```ts
interface ApprovalRow {
  run_id: string;
  gate_id: string;
  tool_name: string;
  args_json: string;
  status: string;
  reason: string | null;
}
```

Inside `RunStoreLive`, after the `run_checkpoints` `db.exec(...)` (~line 151) add:

```ts
    db.exec(
      `CREATE TABLE IF NOT EXISTS run_approvals (
        run_id     TEXT NOT NULL,
        gate_id    TEXT NOT NULL,
        tool_name  TEXT NOT NULL,
        args_json  TEXT NOT NULL,
        status     TEXT NOT NULL,
        reason     TEXT,
        created_at INTEGER NOT NULL,
        decided_at INTEGER,
        PRIMARY KEY (run_id, gate_id)
      )`,
    );
```

- [ ] **Step 5: Implement the three methods** (in the returned object, after `listRuns`)

```ts
      putApproval: ({ runId, gateId, toolName, argsJson }) =>
        Effect.sync(() => {
          db.prepare(
            `INSERT OR REPLACE INTO run_approvals
               (run_id, gate_id, tool_name, args_json, status, reason, created_at, decided_at)
             VALUES (?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
          ).run(runId, gateId, toolName, argsJson, now());
        }),

      getPendingApproval: (runId) =>
        Effect.sync(() => {
          const row = db
            .prepare(
              `SELECT run_id, gate_id, tool_name, args_json, status, reason
                 FROM run_approvals
                WHERE run_id = ? AND status = 'pending'
             ORDER BY created_at DESC
                LIMIT 1`,
            )
            .get(runId) as ApprovalRow | undefined;
          return row
            ? {
                runId: row.run_id,
                gateId: row.gate_id,
                toolName: row.tool_name,
                argsJson: row.args_json,
                status: row.status as ApprovalRecord["status"],
                reason: row.reason ?? undefined,
              }
            : undefined;
        }),

      decideApproval: (runId, gateId, status, reason) =>
        Effect.sync(() => {
          const res = db
            .prepare(
              `UPDATE run_approvals
                  SET status = ?, reason = ?, decided_at = ?
                WHERE run_id = ? AND gate_id = ? AND status = 'pending'`,
            )
            .run(status, reason ?? null, now(), runId, gateId);
          // runtime-shim Database.run returns { changes }; >0 means a pending row matched.
          return (res as { changes?: number }).changes ? true : false;
        }),
```

> Note: verify `db.prepare(...).run(...)` returns a `{ changes }` shape in `packages/runtime-shim/src/database.ts`. If it does not expose `changes`, fall back to a read-then-write: `getPendingApproval` first, return `false` when undefined, else `UPDATE`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/services/run-store.test.ts`
Expected: PASS (all prior + 2 new).

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/services/run-store.ts packages/runtime/tests/services/run-store.test.ts
git commit -m "feat(runtime): durable run_approvals store (putApproval/getPendingApproval/decideApproval)"
```

---

## Task 2: ApprovalStateError + ApprovalDecision type + ApprovalDecisionRef

**Files:**
- Modify: `packages/runtime/src/errors.ts`
- Modify: `packages/core/src/streaming.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/streaming-refs.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/tests/streaming-refs.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { Effect, FiberRef } from "effect";
import { ApprovalDecisionRef } from "../src/index.js";

describe("ApprovalDecisionRef", () => {
  it("defaults to null and is locally overridable", async () => {
    const prog = Effect.gen(function* () {
      const base = yield* FiberRef.get(ApprovalDecisionRef);
      const scoped = yield* FiberRef.get(ApprovalDecisionRef).pipe(
        Effect.locally(ApprovalDecisionRef, {
          gateId: "g1",
          status: "approved" as const,
        }),
      );
      return { base, scoped };
    });
    const { base, scoped } = await Effect.runPromise(prog);
    expect(base).toBeNull();
    expect(scoped?.gateId).toBe("g1");
    expect(scoped?.status).toBe("approved");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/core/tests/streaming-refs.test.ts`
Expected: FAIL — `ApprovalDecisionRef` is not exported.

- [ ] **Step 3: Define the ref in `packages/core/src/streaming.ts`** (after `ResumeStateRef`, line 72)

```ts
/**
 * A human's approval decision for a paused durable run, carried into a resumed
 * pipeline by `ReactiveAgent.approveRun`/`denyRun` via `Effect.locally`. Read in
 * `reasoning-think.ts` and forwarded as `KernelInput.approvalDecision`. Null on
 * every normal run (zero cost). Mirrors `ResumeStateRef`.
 */
export interface ApprovalDecision {
  readonly gateId: string;
  readonly status: "approved" | "denied";
  readonly reason?: string;
}

export const ApprovalDecisionRef = FiberRef.unsafeMake<ApprovalDecision | null>(
  null,
);
```

- [ ] **Step 4: Export from `packages/core/src/index.ts`** (extend the existing streaming re-export, line 202)

```ts
export {
  StreamingTextCallback,
  RunControllerRef,
  ResumeStateRef,
  ApprovalDecisionRef,
} from "./streaming.js";
export type { ApprovalDecision } from "./streaming.js";
```

- [ ] **Step 5: Add `ApprovalStateError` to `packages/runtime/src/errors.ts`** (after `DurableConfigMismatchError`, ~line 164)

```ts
/**
 * Thrown by `agent.approveRun`/`denyRun` when the target run is not awaiting an
 * approval decision (no pending approval row) — e.g. already decided, already
 * completed, or never paused. Durable HITL (Phase D).
 */
export class ApprovalStateError extends Data.TaggedError("ApprovalStateError")<{
  /** The run id whose approval could not be applied. */
  readonly runId: string;
  /** Human-readable reason (e.g. "no pending approval"). */
  readonly detail: string;
}> {}
```

Add `ApprovalStateError` to the `RuntimeErrors` union (~line 172).

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/core/tests/streaming-refs.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/streaming.ts packages/core/src/index.ts packages/core/tests/streaming-refs.test.ts packages/runtime/src/errors.ts
git commit -m "feat(core): ApprovalDecisionRef + ApprovalStateError for durable HITL"
```

---

## Task 3: Kernel state fields + terminate reason

**Files:**
- Modify: `packages/reasoning/src/kernel/state/kernel-state.ts`
- Modify: `packages/reasoning/src/kernel/loop/terminate.ts`
- Test: `packages/reasoning/tests/kernel/terminate-awaiting-approval.test.ts` (create)

- [ ] **Step 1: Add `awaitingApprovalFor` to `KernelMeta`**

Locate the `KernelMeta` interface in `kernel-state.ts` (search `terminatedBy` to find it). Add:

```ts
  /**
   * Set when the act capability gates a flagged pending tool call in durable
   * detach mode. Serialized into the checkpoint so the paused call survives a
   * crash; consumed by the runner's resume re-entry. Durable HITL (Phase D).
   */
  readonly awaitingApprovalFor?: {
    readonly gateId: string;
    readonly toolName: string;
    readonly args: unknown;
  };
```

- [ ] **Step 2: Add `approvalDecision` to `KernelInput`** (next to `resumeState`, ~line 550)

```ts
  /**
   * A human's approval decision threaded in on a resumed run. Read by the runner
   * at loop top together with `state.meta.awaitingApprovalFor`. Durable HITL.
   */
  readonly approvalDecision?: {
    readonly gateId: string;
    readonly status: "approved" | "denied";
    readonly reason?: string;
  };
```

- [ ] **Step 3: Write the failing test**

Create `packages/reasoning/tests/kernel/terminate-awaiting-approval.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { isTerminalReason } from "../../src/kernel/loop/terminate.js";

describe("terminate awaiting-approval reason", () => {
  it("recognizes awaiting-approval as a non-failure terminal reason", () => {
    expect(isTerminalReason("awaiting-approval")).toBe(true);
  });
});
```

> If `terminate.ts` has no exported `isTerminalReason`, instead assert the reason
> is accepted by the existing terminate helper: import the function that builds a
> terminal state and assert it does not throw / sets `status` to a terminal value
> for `reason: "awaiting-approval"`. Adjust the test to the real exported surface
> discovered in Step 4.

- [ ] **Step 4: Run to verify it fails**

Run: `bun test packages/reasoning/tests/kernel/terminate-awaiting-approval.test.ts`
Expected: FAIL — symbol not found OR reason not recognized.

- [ ] **Step 5: Register the reason in `terminate.ts`**

Read `terminate.ts`. It distinguishes a `"done"` terminal from failure terminals. Add `"awaiting-approval"` to the set/union of accepted `terminatedBy` reasons, classified as **non-failure** (it must NOT be treated as an error, and must NOT trip the post-condition hard-stop — a paused run has intentionally not met its post-conditions). Export a small predicate if one does not exist:

```ts
/** Reasons that end the loop without it being a failure. */
export const NON_FAILURE_TERMINAL_REASONS = new Set<string>([
  "done",
  "awaiting-approval",
]);

export function isTerminalReason(reason: string): boolean {
  return NON_FAILURE_TERMINAL_REASONS.has(reason);
}
```

Wire `terminate(...)`'s post-condition guard (around line 125 `Post-condition(s) unmet`) to skip the unmet-postcondition warning/escalation when `opts.reason === "awaiting-approval"`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test packages/reasoning/tests/kernel/terminate-awaiting-approval.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/kernel/state/kernel-state.ts packages/reasoning/src/kernel/loop/terminate.ts packages/reasoning/tests/kernel/terminate-awaiting-approval.test.ts
git commit -m "feat(kernel): awaiting-approval terminate reason + approval state fields"
```

---

## Task 4: Gate check in act capability

**Files:**
- Modify: `packages/reasoning/src/kernel/capabilities/act/tool-gating.ts`
- Test: `packages/reasoning/tests/kernel/approval-gate-shouldgate.test.ts` (create)

**Context:** The act capability iterates parsed pending tool calls
(`state.meta.pendingNativeToolCalls`, shape `{ name?: string; arguments?: unknown }[]`).
Before a flagged call executes, in durable detach mode, it must instead set
`awaitingApprovalFor` and request termination. The gate config arrives on
`KernelInput` (added in Task 9 wiring) as `approvalPolicy?: { mode: "detach" | "block"; tools: ReadonlySet<string>; requireFor?: (ctx) => boolean }`.

- [ ] **Step 1: Write the failing test** for the pure `shouldGate` helper

Create `packages/reasoning/tests/kernel/approval-gate-shouldgate.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { shouldGate } from "../../src/kernel/capabilities/act/tool-gating.js";

const ctx = { iteration: 1 };

describe("shouldGate", () => {
  it("gates when the tool definition flag is set", () => {
    expect(
      shouldGate(
        { name: "docker", requiresApproval: true },
        { tools: new Set<string>(), requireFor: undefined },
        ctx,
      ),
    ).toBe(true);
  });

  it("gates when the policy tool set contains the name", () => {
    expect(
      shouldGate(
        { name: "file-write", requiresApproval: false },
        { tools: new Set(["file-write"]), requireFor: undefined },
        ctx,
      ),
    ).toBe(true);
  });

  it("gates when the policy predicate returns true", () => {
    expect(
      shouldGate(
        { name: "web-search", requiresApproval: false },
        { tools: new Set<string>(), requireFor: () => true },
        ctx,
      ),
    ).toBe(true);
  });

  it("does not gate when no feeder matches", () => {
    expect(
      shouldGate(
        { name: "web-search", requiresApproval: false },
        { tools: new Set<string>(), requireFor: () => false },
        ctx,
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/reasoning/tests/kernel/approval-gate-shouldgate.test.ts`
Expected: FAIL — `shouldGate` not exported.

- [ ] **Step 3: Implement `shouldGate`** in `tool-gating.ts`

```ts
export interface ApprovalGateConfig {
  readonly tools: ReadonlySet<string>;
  readonly requireFor?: (ctx: { toolName: string; iteration: number }) => boolean;
}

/**
 * True when a pending tool call should pause for human approval. ORs three
 * independent feeders: the per-tool `requiresApproval` flag, the policy tool
 * set, and the policy predicate. Pure — no Effect, no IO.
 */
export function shouldGate(
  call: { name: string; requiresApproval?: boolean },
  policy: ApprovalGateConfig,
  ctx: { iteration: number },
): boolean {
  if (call.requiresApproval === true) return true;
  if (policy.tools.has(call.name)) return true;
  if (policy.requireFor?.({ toolName: call.name, iteration: ctx.iteration })) return true;
  return false;
}
```

- [ ] **Step 4: Wire the gate into the act flow** (same file, where pending calls are dispatched)

Find where the capability resolves each pending call's tool definition and executes it. Before execution, when `input.approvalPolicy?.mode === "detach"` and `shouldGate(...)` is true, short-circuit:

```ts
  // Durable HITL: pause instead of executing a flagged call.
  if (
    input.approvalPolicy?.mode === "detach" &&
    shouldGate(
      { name: call.name, requiresApproval: toolDef?.requiresApproval },
      { tools: input.approvalPolicy.tools, requireFor: input.approvalPolicy.requireFor },
      { iteration: state.iteration },
    )
  ) {
    const gateId = crypto.randomUUID();
    const paused = transitionState(state, {
      meta: {
        ...state.meta,
        awaitingApprovalFor: { gateId, toolName: call.name, args: call.arguments },
      },
    });
    return terminate(paused, { reason: "awaiting-approval" });
  }
```

> The exact `transitionState`/`terminate` call shape must match how this file
> already returns terminal states (read the surrounding code). Gate on the FIRST
> flagged pending call; remaining calls re-surface on resume (per spec §7).

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/reasoning/tests/kernel/approval-gate-shouldgate.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the reasoning suite to check no regressions**

Run: `bun test packages/reasoning/tests/kernel/`
Expected: PASS (no behavior change when `approvalPolicy` is undefined — the default).

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/kernel/capabilities/act/tool-gating.ts packages/reasoning/tests/kernel/approval-gate-shouldgate.test.ts
git commit -m "feat(kernel): shouldGate + pause flagged pending call in detach mode"
```

---

## Task 5: Runner resume re-entry

**Files:**
- Modify: `packages/reasoning/src/kernel/loop/runner.ts`
- Test: `packages/reasoning/tests/kernel/approval-resume-reentry.test.ts` (create)

**Context:** On resume, `resumeState` is restored verbatim (runner.ts:224) with
`state.meta.awaitingApprovalFor` set. At loop top, before `think`, the runner must
consult `effectiveInput.approvalDecision`:
- **approved** → clear `awaitingApprovalFor`, execute the stored call via the act
  path (NO `think`), continue.
- **denied** → clear `awaitingApprovalFor`, append a denial observation step,
  continue to `think`.

- [ ] **Step 1: Write the failing test** — a focused unit on the re-entry helper

Create `packages/reasoning/tests/kernel/approval-resume-reentry.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { resolveApprovalReentry } from "../../src/kernel/loop/runner.js";

const gate = { gateId: "g1", toolName: "docker", args: { image: "alpine" } };

describe("resolveApprovalReentry", () => {
  it("approved → run the stored call, clear the gate", () => {
    const r = resolveApprovalReentry(gate, { gateId: "g1", status: "approved" });
    expect(r.action).toBe("execute");
    expect(r.call).toEqual({ name: "docker", arguments: { image: "alpine" } });
  });

  it("denied → observe denial, clear the gate", () => {
    const r = resolveApprovalReentry(gate, {
      gateId: "g1", status: "denied", reason: "unsafe",
    });
    expect(r.action).toBe("observe");
    expect(r.observation).toContain("docker");
    expect(r.observation).toContain("unsafe");
  });

  it("gateId mismatch → no-op (proceed to think)", () => {
    const r = resolveApprovalReentry(gate, { gateId: "other", status: "approved" });
    expect(r.action).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/reasoning/tests/kernel/approval-resume-reentry.test.ts`
Expected: FAIL — `resolveApprovalReentry` not exported.

- [ ] **Step 3: Implement the pure helper** in `runner.ts` (module scope, above the runner function)

```ts
export interface ApprovalReentry {
  readonly action: "execute" | "observe" | "none";
  readonly call?: { readonly name: string; readonly arguments: unknown };
  readonly observation?: string;
}

/**
 * Decide how a resumed run re-enters at a pending approval gate. Pure: maps the
 * stored gate + the human's decision to an execute / observe / none action.
 */
export function resolveApprovalReentry(
  gate: { gateId: string; toolName: string; args: unknown },
  decision: { gateId: string; status: "approved" | "denied"; reason?: string } | undefined,
): ApprovalReentry {
  if (!decision || decision.gateId !== gate.gateId) return { action: "none" };
  if (decision.status === "approved") {
    return { action: "execute", call: { name: gate.toolName, arguments: gate.args } };
  }
  return {
    action: "observe",
    observation: `Action ${gate.toolName} was denied by a human${
      decision.reason ? `: ${decision.reason}` : ""
    }.`,
  };
}
```

- [ ] **Step 4: Wire it at the loop top** (in the main loop, before the `think` call)

```ts
    // Durable HITL resume re-entry: when restoring a checkpoint paused at an
    // approval gate, apply the human's decision instead of re-thinking.
    if (state.meta.awaitingApprovalFor && effectiveInput.approvalDecision) {
      const reentry = resolveApprovalReentry(
        state.meta.awaitingApprovalFor,
        effectiveInput.approvalDecision,
      );
      // Clear the gate marker regardless of branch so we never loop on it.
      state = transitionState(state, {
        meta: { ...state.meta, awaitingApprovalFor: undefined },
      });
      if (reentry.action === "execute" && reentry.call) {
        // Seed the approved call as the pending native call and route to act,
        // skipping think for this iteration.
        state = transitionState(state, {
          meta: { ...state.meta, pendingNativeToolCalls: [reentry.call] },
        });
        // <execute via the same act path the loop uses for pendingNativeToolCalls>
      } else if (reentry.action === "observe" && reentry.observation) {
        state = transitionState(state, {
          steps: [...state.steps, makeObservationStep(reentry.observation)],
        });
      }
      // action === "none" falls through to normal think.
    }
```

> Match `makeObservationStep` / the act-dispatch to the runner's existing helpers
> (read how the loop builds observation steps and how it invokes act on
> `pendingNativeToolCalls`). The execute branch should reuse the SAME dispatch the
> normal loop uses — do not duplicate tool-execution logic.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/reasoning/tests/kernel/approval-resume-reentry.test.ts`
Expected: PASS.

- [ ] **Step 6: Reasoning loop regression check**

Run: `bun test packages/reasoning/tests/kernel/`
Expected: PASS (re-entry block is inert when `awaitingApprovalFor`/`approvalDecision` absent).

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/kernel/loop/runner.ts packages/reasoning/tests/kernel/approval-resume-reentry.test.ts
git commit -m "feat(kernel): runner resume re-entry for approval gates"
```

---

## Task 6: Forward the decision from FiberRef into KernelInput

**Files:**
- Modify: `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts`
- Test: covered by Task 11 integration (no isolated test — this is a 2-line forward).

- [ ] **Step 1: Import the ref** (extend the existing core import at line 15)

```ts
import { emitErrorSwallowed, errorTag, ResumeStateRef, ApprovalDecisionRef } from "@reactive-agents/core";
```

- [ ] **Step 2: Read it next to the resume read** (~line 193)

```ts
    const approvalDecision = (yield* FiberRef.get(ApprovalDecisionRef)) ?? undefined;
```

- [ ] **Step 3: Forward it on `executeRequest`** (next to `resumeState`, ~line 228)

```ts
      resumeState,
      approvalDecision,
```

- [ ] **Step 4: Typecheck the package builds**

Run: `bunx turbo run build --filter=@reactive-agents/runtime`
Expected: build OK (DTS clean).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts
git commit -m "feat(runtime): forward ApprovalDecisionRef into KernelInput"
```

---

## Task 7: Persist the pause in the engine

**Files:**
- Modify: `packages/runtime/src/engine/execute-stream.ts`
- Test: `packages/runtime/tests/durable-approval-persist.test.ts` (create) — but easier to assert at the integration layer; this task's unit test asserts the helper.

**Context:** The durable block (lines 165–214) already owns `runId`, `dbPath`,
`runStoreLayer`. Extend it so that when the executed task result carries
`terminatedBy === "awaiting-approval"` and `meta.awaitingApprovalFor`, it writes
the approval row + flips status, instead of `durableFinish(true)`.

- [ ] **Step 1: Extract a small writer helper** at module scope in `execute-stream.ts`

```ts
/** Persist a paused run: status → awaiting-approval + pending approval row. */
const persistApprovalPause = (params: {
  runStoreLayer: Layer.Layer<RunStoreService>;
  runId: string;
  gate: { gateId: string; toolName: string; args: unknown };
}): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    yield* store.setStatus(params.runId, "awaiting-approval");
    yield* store.putApproval({
      runId: params.runId,
      gateId: params.gate.gateId,
      toolName: params.gate.toolName,
      argsJson: JSON.stringify(params.gate.args ?? null),
    });
  }).pipe(
    Effect.provide(params.runStoreLayer),
    Effect.catchAllCause((cause) =>
      emitErrorSwallowed({
        site: "runtime/src/engine/execute-stream.ts:persistApprovalPause",
        tag: errorTag(cause),
      }),
    ),
  );
```

- [ ] **Step 2: Branch in the result `.tap`** (inside the `execute(task).pipe(Effect.tap(...))` success handler, ~line 217)

```ts
        .tap((taskResult) => {
          const meta = (taskResult as { metadata?: { terminatedBy?: string; awaitingApprovalFor?: { gateId: string; toolName: string; args: unknown } } }).metadata;
          const gate = meta?.awaitingApprovalFor;
          if (durableFinish && config.durableRuns && options?.runController && meta?.terminatedBy === "awaiting-approval" && gate && runStoreCtx) {
            return persistApprovalPause({
              runStoreLayer: runStoreCtx.runStoreLayer,
              runId: runStoreCtx.runId,
              gate,
            });
          }
          durableFinish?.(true);
          // ... existing completed-event emission ...
        })
```

> `runStoreCtx` = lift `runId` + `runStoreLayer` out of the `if (config.durableRuns ...)`
> block (line 173) into an outer `let runStoreCtx: { runId: string; runStoreLayer: Layer.Layer<RunStoreService> } | undefined` so the result handler can read them. The
> exact field path for `terminatedBy`/`awaitingApprovalFor` on the result must match
> how the kernel surfaces `meta` to `TaskResult` — confirm by reading how
> `terminatedBy` already reaches the runtime (react-kernel.ts forwards `rawTerminatedBy`).

- [ ] **Step 3: Ensure the stream still emits a terminal event** so `run()` returns

The paused result must still flow a `StreamCompleted` (with the paused metadata) so
`run()` resolves with `status:"awaiting-approval"` rather than hanging. Keep the
existing `completedEvent` emission after the persist (the persist is additive, not a
replacement for completing the stream).

- [ ] **Step 4: Run the durable suite**

Run: `bun test packages/runtime/tests/durable-runs-write.test.ts packages/runtime/tests/durable-resume.test.ts`
Expected: PASS (no regression to existing durable write/resume).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/engine/execute-stream.ts
git commit -m "feat(runtime): persist awaiting-approval pause to RunStore"
```

---

## Task 8: AgentResult status + pendingApproval surface

**Files:**
- Modify: `packages/runtime/src/types.ts` (the `AgentResult` interface)
- Test: covered by Task 11 (integration asserts the populated fields).

- [ ] **Step 1: Add fields to `AgentResult`** (find the interface; it already has `success`, `output`, `metadata`)

```ts
  /**
   * Lifecycle status. Defaults to `"completed"` for the normal path. Set to
   * `"awaiting-approval"` when a durable run paused for human approval, or
   * `"failed"` on error. Durable HITL (Phase D).
   */
  readonly status?: "completed" | "awaiting-approval" | "failed";
  /** Present only when `status === "awaiting-approval"`. */
  readonly pendingApproval?: {
    readonly runId: string;
    readonly gateId: string;
    readonly toolName: string;
    readonly args: unknown;
  };
```

- [ ] **Step 2: Populate it where the engine maps `TaskResult → AgentResult`**

In `reactive-agent.ts` `buildRunTaskEffect` (the `.flatMap((result) => ...)` at ~line 864) read `terminatedBy`/`awaitingApprovalFor` off the result metadata and set `status`/`pendingApproval` on the returned `AgentResult`. When not paused, leave `status` undefined (callers treat undefined as `"completed"`).

```ts
        const meta = (result as { metadata?: { terminatedBy?: string; awaitingApprovalFor?: { gateId: string; toolName: string; args: unknown } } }).metadata;
        const paused = meta?.terminatedBy === "awaiting-approval" ? meta?.awaitingApprovalFor : undefined;
        // ... in the constructed AgentResult object:
        ...(paused
          ? {
              status: "awaiting-approval" as const,
              pendingApproval: {
                runId: taskId, // the durable runId is derived from agent+task+start; see note
                gateId: paused.gateId,
                toolName: paused.toolName,
                args: paused.args,
              },
            }
          : {}),
```

> The durable `runId` is a hash of `agentId:taskId:startMs` (execute-stream.ts:183),
> NOT the `taskId`. To surface the real `runId`, thread it out: have the durable
> block stash `runId` on the result metadata (`meta.durableRunId`) when it persists
> the pause, and read THAT here. Add `durableRunId` to the metadata write in Task 7
> Step 1's helper path. Confirm the field name is consistent between Task 7 and here.

- [ ] **Step 3: Build + typecheck**

Run: `bunx turbo run build --filter=@reactive-agents/runtime`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add packages/runtime/src/types.ts packages/runtime/src/reactive-agent.ts
git commit -m "feat(runtime): AgentResult.status + pendingApproval surface"
```

---

## Task 9: Builder `.withApprovalPolicy()` + config threading

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Modify: `packages/runtime/src/builder/types.ts`
- Test: `packages/runtime/tests/builder-approval-policy.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/runtime/tests/builder-approval-policy.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder.js";

describe(".withApprovalPolicy", () => {
  it("detach mode requires .withDurableRuns()", () => {
    expect(() =>
      new ReactiveAgentBuilder()
        .withProvider("test")
        .withApprovalPolicy({ tools: ["docker"], mode: "detach" })
        .build(),
    ).toThrow(/withDurableRuns/);
  });

  it("detach mode builds when durable runs are enabled", async () => {
    const agent = new ReactiveAgentBuilder()
      .withProvider("test")
      .withDurableRuns({ dir: "/tmp/ra-test-approval" })
      .withApprovalPolicy({ tools: ["docker"], mode: "detach" })
      .build();
    expect(agent).toBeDefined();
  });
});
```

> Match the real builder construction idiom (e.g. `ReactiveAgents.create()` /
> `createReactiveAgent()` / `new ReactiveAgentBuilder()`) by reading the top of
> `builder.ts`. Use whatever `.withProvider`/test-provider call other builder tests
> use so `build()` succeeds without API keys.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/runtime/tests/builder-approval-policy.test.ts`
Expected: FAIL — `withApprovalPolicy` not a function.

- [ ] **Step 3: Add the policy type to `builder/types.ts`**

```ts
export interface ApprovalPolicyConfig {
  readonly tools?: readonly string[];
  readonly requireFor?: (ctx: { toolName: string; iteration: number }) => boolean;
  readonly mode?: "detach" | "block";
}
```

Add to the runtime config interface a field `readonly approvalPolicy?: ApprovalPolicyConfig` (alongside `durableRuns`).

- [ ] **Step 4: Add the builder method + private field** in `builder.ts` (near `withInteraction`, ~line 1322)

```ts
  private _approvalPolicy?: ApprovalPolicyConfig;

  /**
   * Configure durable human-in-the-loop approval gates. In `mode: "detach"`
   * (default when `.withDurableRuns()` is set), a flagged tool call pauses the
   * run, persists `awaiting-approval`, and returns control so a human can
   * approve/deny from any process via `agent.approveRun`/`denyRun`. In
   * `mode: "block"` it falls back to the in-process approval gate.
   *
   * @returns `this` for chaining
   */
  withApprovalPolicy(policy: ApprovalPolicyConfig): this {
    this._approvalPolicy = policy;
    return this;
  }
```

- [ ] **Step 5: Build guard + config emission** (in the `build()` path where config is assembled)

```ts
    const approvalMode = this._approvalPolicy?.mode
      ?? (this._durableRuns ? "detach" : "block");
    if (approvalMode === "detach" && !this._durableRuns) {
      throw new Error(
        ".withApprovalPolicy({ mode: 'detach' }) requires .withDurableRuns() — " +
          "detached approval pauses need a durable store to persist them.",
      );
    }
    // include in the assembled config:
    //   approvalPolicy: this._approvalPolicy
    //     ? { tools: this._approvalPolicy.tools ?? [], requireFor: this._approvalPolicy.requireFor, mode: approvalMode }
    //     : undefined,
```

- [ ] **Step 6: Thread config → KernelInput** in `reasoning-think.ts` (where `executeRequest` is built, Task 6 area)

```ts
      approvalPolicy: config.approvalPolicy
        ? {
            mode: config.approvalPolicy.mode,
            tools: new Set(config.approvalPolicy.tools),
            requireFor: config.approvalPolicy.requireFor,
          }
        : undefined,
```

Add `approvalPolicy?` to `KernelInput` in `kernel-state.ts` with the
`{ mode: "detach" | "block"; tools: ReadonlySet<string>; requireFor?: (...) => boolean }`
shape used by Task 4.

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/builder-approval-policy.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/builder/types.ts packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts packages/reasoning/src/kernel/state/kernel-state.ts packages/runtime/tests/builder-approval-policy.test.ts
git commit -m "feat(runtime): .withApprovalPolicy builder + KernelInput threading"
```

---

## Task 10: Agent API — approveRun / denyRun / listPendingApprovals

**Files:**
- Modify: `packages/runtime/src/engine/durable-resume.ts`
- Modify: `packages/runtime/src/reactive-agent.ts`
- Test: `packages/runtime/tests/approve-deny-resume.test.ts` (create) — single-process.

- [ ] **Step 1: Add `decideAndResume` to `durable-resume.ts`**

```ts
import { ApprovalStateError } from "../errors.js";

/** Record a human decision on a paused run's pending approval. */
export const decideApprovalRecord = (params: {
  readonly dbPath: string;
  readonly runId: string;
  readonly status: "approved" | "denied";
  readonly reason?: string;
}): Effect.Effect<{ gateId: string }, ApprovalStateError> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    const pending = yield* store.getPendingApproval(params.runId);
    if (!pending) {
      return yield* Effect.fail(
        new ApprovalStateError({ runId: params.runId, detail: "no pending approval" }),
      );
    }
    yield* store.decideApproval(params.runId, pending.gateId, params.status, params.reason);
    return { gateId: pending.gateId };
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));
```

- [ ] **Step 2: Write the failing test**

Create `packages/runtime/tests/approve-deny-resume.test.ts`. Use the deterministic
`test` provider so a flagged tool is requested. Mirror the setup in
`durable-resume.test.ts`.

```ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgentBuilder } from "../src/builder.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ra-hitl-"));

describe("durable HITL approve/deny", () => {
  it("run pauses awaiting approval, approveRun completes it", async () => {
    const agent = buildFlaggedAgent(dir); // helper: test provider scripted to call a requiresApproval tool
    const first = await agent.run("do the risky thing");
    expect(first.status).toBe("awaiting-approval");
    expect(first.pendingApproval?.toolName).toBeDefined();

    const runId = first.pendingApproval!.runId;
    const pending = await agent.listPendingApprovals();
    expect(pending.map((p) => p.runId)).toContain(runId);

    const resumed = await agent.approveRun(runId);
    expect(resumed.status ?? "completed").toBe("completed");
  });

  it("denyRun completes without executing the tool", async () => {
    const agent = buildFlaggedAgent(dir);
    const first = await agent.run("do the risky thing");
    const runId = first.pendingApproval!.runId;
    const resumed = await agent.denyRun(runId, "not allowed");
    expect(resumed.status ?? "completed").toBe("completed");
    expect(resumed.output.toLowerCase()).not.toContain("risky-tool-side-effect");
  });
});
```

> Write `buildFlaggedAgent(dir)` using the test provider scripted to emit one
> tool call to a tool registered with `requiresApproval: true` (or use
> `.withApprovalPolicy({ tools: [<existing test tool>], mode: "detach" })`).
> Model it on how `durable-resume.test.ts` builds + scripts the test provider.

- [ ] **Step 3: Run to verify it fails**

Run: `bun test packages/runtime/tests/approve-deny-resume.test.ts`
Expected: FAIL — `approveRun`/`denyRun`/`listPendingApprovals` not functions.

- [ ] **Step 4: Implement the three methods in `reactive-agent.ts`** (after `resumeRun`, ~line 782)

```ts
  /** Approve a paused run and resume it to completion. Requires `.withDurableRuns()`. */
  async approveRun(runId: string, opts?: { reason?: string }): Promise<AgentResult> {
    return this.decideAndResumeRun(runId, { status: "approved", reason: opts?.reason });
  }

  /** Deny a paused run's action and resume it to completion. Requires `.withDurableRuns()`. */
  async denyRun(runId: string, reason: string): Promise<AgentResult> {
    return this.decideAndResumeRun(runId, { status: "denied", reason });
  }

  private async decideAndResumeRun(
    runId: string,
    decision: { status: "approved" | "denied"; reason?: string },
  ): Promise<AgentResult> {
    if (!this._durableResume) {
      throw new Error(
        "approveRun()/denyRun() requires .withDurableRuns() — this agent has no durable run store.",
      );
    }
    const { dir, configHash } = this._durableResume;
    const dbPath = join(dir, "runs.db");
    const { gateId } = await Effect.runPromise(
      decideApprovalRecord({ dbPath, runId, status: decision.status, reason: decision.reason }),
    );
    const payload = await Effect.runPromise(
      loadResumePayload({ runId, dbPath, currentConfigHash: configHash }),
    );
    const pipeline = this.buildRunTaskEffect(payload.run.task, { taskId: runId });
    try {
      const result = await this.runtime.runPromise(
        pipeline.pipe(
          Effect.locally(ResumeStateRef, payload.stateJson),
          Effect.locally(ApprovalDecisionRef, { gateId, status: decision.status, reason: decision.reason }),
        ),
      );
      await Effect.runPromise(markRunStatus({ dbPath, runId, status: "completed" }));
      return result;
    } catch (e) {
      await Effect.runPromise(markRunStatus({ dbPath, runId, status: "failed" }));
      throw unwrapError(e);
    }
  }

  /** List runs paused awaiting a human decision, with the pending action. Requires `.withDurableRuns()`. */
  async listPendingApprovals(): Promise<
    readonly { runId: string; gateId: string; toolName: string; args: unknown; task: string; updatedAt: number }[]
  > {
    if (!this._durableResume) {
      throw new Error("listPendingApprovals() requires .withDurableRuns().");
    }
    const dbPath = join(this._durableResume.dir, "runs.db");
    const runs = await Effect.runPromise(listDurableRuns({ dbPath, status: "awaiting-approval" }));
    const out: { runId: string; gateId: string; toolName: string; args: unknown; task: string; updatedAt: number }[] = [];
    for (const run of runs) {
      const pending = await Effect.runPromise(getPendingApprovalAt({ dbPath, runId: run.runId }));
      if (pending) {
        out.push({
          runId: run.runId, gateId: pending.gateId, toolName: pending.toolName,
          args: safeParseJson(pending.argsJson), task: run.task, updatedAt: run.updatedAt,
        });
      }
    }
    return out;
  }
```

Add the imports (`decideApprovalRecord`, a `getPendingApprovalAt` helper in
`durable-resume.ts` mirroring `markRunStatus`, `ApprovalDecisionRef` from
`@reactive-agents/core`) and a `safeParseJson` local:

```ts
const safeParseJson = (s: string): unknown => {
  try { return JSON.parse(s); } catch { return s; }
};
```

`getPendingApprovalAt` in `durable-resume.ts`:

```ts
export const getPendingApprovalAt = (params: { dbPath: string; runId: string }) =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    return yield* store.getPendingApproval(params.runId);
  }).pipe(Effect.provide(RunStoreLive(params.dbPath)));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/runtime/tests/approve-deny-resume.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/engine/durable-resume.ts packages/runtime/src/reactive-agent.ts packages/runtime/tests/approve-deny-resume.test.ts
git commit -m "feat(runtime): approveRun/denyRun/listPendingApprovals durable HITL API"
```

---

## Task 11: Cross-process e2e

**Files:**
- Test: `packages/runtime/tests/durable-hitl-crossproc-e2e.test.ts` (create)
- Helper scripts: `packages/runtime/tests/fixtures/hitl-run-then-exit.ts`, `packages/runtime/tests/fixtures/hitl-approve.ts` (create)

**Context:** Mirror `packages/runtime/tests/durable-crash-e2e.test.ts` exactly — it
already spawns subprocesses with the test provider and a shared `dir`. Reuse its
spawn/asserts; swap the crash for an intentional pause.

- [ ] **Step 1: Write the run-then-exit fixture** `hitl-run-then-exit.ts`

```ts
// Spawned process A: build a durable agent whose flagged tool gates, run once,
// print the runId, exit 0 (process dies while awaiting approval).
import { buildFlaggedAgent } from "./hitl-shared.js";
const dir = process.argv[2];
const agent = buildFlaggedAgent(dir);
const r = await agent.run("do the risky thing");
process.stdout.write(JSON.stringify({ status: r.status, runId: r.pendingApproval?.runId }));
process.exit(0);
```

- [ ] **Step 2: Write the approve fixture** `hitl-approve.ts`

```ts
// Spawned process B (fresh): approve the paused run by id, print final status.
import { buildFlaggedAgent } from "./hitl-shared.js";
const [, , dir, runId] = process.argv;
const agent = buildFlaggedAgent(dir);
const r = await agent.approveRun(runId);
process.stdout.write(JSON.stringify({ status: r.status ?? "completed", output: r.output }));
process.exit(0);
```

Factor `buildFlaggedAgent(dir)` into `hitl-shared.ts` (same builder used in Task 10).

- [ ] **Step 3: Write the e2e test**

```ts
import { describe, it, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = async (script: string, args: string[]) => {
  const proc = Bun.spawn(["bun", join(import.meta.dir, "fixtures", script), ...args], {
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return JSON.parse(out);
};

describe("durable HITL cross-process", () => {
  it("process A pauses + exits; fresh process B approves + completes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-hitl-e2e-"));
    const a = await run("hitl-run-then-exit.ts", [dir]);
    expect(a.status).toBe("awaiting-approval");
    expect(a.runId).toBeTruthy();

    const b = await run("hitl-approve.ts", [dir, a.runId]);
    expect(b.status).toBe("completed");
  });
});
```

- [ ] **Step 4: Run the e2e**

Run: `bun test packages/runtime/tests/durable-hitl-crossproc-e2e.test.ts`
Expected: PASS — A returns `awaiting-approval` then exits; B (fresh process) approves and completes.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/tests/durable-hitl-crossproc-e2e.test.ts packages/runtime/tests/fixtures/hitl-run-then-exit.ts packages/runtime/tests/fixtures/hitl-approve.ts packages/runtime/tests/fixtures/hitl-shared.ts
git commit -m "test(runtime): durable HITL cross-process e2e (pause→exit→approve→complete)"
```

---

## Task 12: Full-suite + governance gate

**Files:** none (verification task).

- [ ] **Step 1: Build all packages**

Run: `bunx turbo run build`
Expected: all packages build, DTS clean.

- [ ] **Step 2: Run the full test suite**

Run: `bun test`
Expected: 0 failures. Note the new pass count vs the prior 6463.

- [ ] **Step 3: Governance ceilings**

Run: `bun test packages/observability/tests/console-ceiling.test.ts packages/runtime/test/as-unknown-as-ceiling.test.ts`
Expected: PASS. If a ceiling must rise (e.g. a justified `as unknown as` for a
runtime-shim `{ changes }` cast), bump it WITH a dated rationale comment in the
ceiling test — no metric-gaming.

- [ ] **Step 4: Commit any ceiling bump**

```bash
git add -A
git commit -m "chore(governance): justified ceiling bump for durable HITL"
```

---

## Task 13: Docs + memory

**Files:**
- Modify: `apps/docs/src/content/docs/reference/builder-api.md`
- Modify: `apps/docs/src/content/docs/guides/faq.mdx`
- Modify: `apps/docs/src/content/docs/guides/whats-new.mdx`
- Create: `apps/docs/src/content/docs/guides/durable-hitl.md`
- Modify: `.agents/MEMORY.md` + Claude memory

- [ ] **Step 1: New guide** `durable-hitl.md` — `.withDurableRuns()` + `.withApprovalPolicy()`, the `awaiting-approval` result shape, `approveRun`/`denyRun`/`listPendingApprovals`, and the cross-process flow. Include a runnable example mirroring the e2e fixtures.

- [ ] **Step 2: builder-api.md** — add `.withApprovalPolicy(policy)` row + `approveRun`/`denyRun`/`listPendingApprovals` runtime-method rows.

- [ ] **Step 3: faq.mdx** — update the "What's not done yet?" entry (line 89): durable HITL now SHIPS; remove it from the gap list (or move to "shipped in v0.12").

- [ ] **Step 4: whats-new.mdx** — add a v0.12 "Durable human-in-the-loop" bullet under the durable-execution section.

- [ ] **Step 5: Build docs**

Run: `cd apps/docs && bun run build`
Expected: build OK, links clean.

- [ ] **Step 6: Update memory** — flip the v0.12 lever-status line: durable HITL Phase D MERGED; mark the `interaction-manager.ts:125` gap RESOLVED (now durable via RunStore). Sync `.agents/MEMORY.md` + Claude memory.

- [ ] **Step 7: Commit**

```bash
git add apps/docs .agents/MEMORY.md
git commit -m "docs: durable HITL guide + builder-api/faq/whats-new + memory sync"
```

---

## Final review (after all tasks)

- [ ] Dispatch a final code reviewer over the whole branch diff.
- [ ] Use `superpowers:finishing-a-development-branch` to merge `feat/durable-hitl-2026-06-16` to local main (project workflow: merge-to-local-main + tag-publish; do NOT push without user direction).
- [ ] Confirm v0.12 functional gates all closed; surface to user for the v0.12.0 tag decision.

---

## Notes / known adaptation points for the implementer

These are real seams the code blocks point at; the implementer must read the
surrounding code to match exact shapes (NOT placeholders — the logic is specified,
only the local idiom needs matching):

1. **Task 1 Step 5** — confirm `runtime-shim` `Database.run` returns `{ changes }`; fallback specified.
2. **Task 4 Step 4** — match the act file's existing `transitionState`/`terminate` return idiom; gate the FIRST flagged pending call only.
3. **Task 5 Step 4** — reuse the runner's existing act-dispatch + observation-step helpers; do not duplicate tool execution.
4. **Task 7 Step 2** — lift `runId`/`runStoreLayer` to an outer scope; confirm the `terminatedBy`/`awaitingApprovalFor` path onto `TaskResult.metadata` (follow how `rawTerminatedBy` already reaches the runtime via react-kernel.ts:120).
5. **Task 8 Step 2** — surface the real durable `runId` (hash of agent+task+start), not the taskId; stash it on result metadata as `durableRunId` in Task 7 and read it here. Keep the field name consistent.
6. **Task 9 Step 1** — match the real builder construction idiom + test provider used by sibling builder tests.
