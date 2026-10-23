// Quality program Task 11 (D1 bridge family 4, run-task): seam pins for
// `buildRunTaskEffect` — the deepest call path of the agent facade families.
// The module's public seam has returned an Effect since the #217 extraction;
// these pins lock the rejection-identity contract of that boundary and the
// value flow of the two debrief-fiber Promise sections that Task 11 routed
// through the shared shell bridge (`agent/run-facade-effect.ts`), plus the
// wrapper identity the shell's PRESERVED runPromise delegates (`run()` —
// killswitch signal; `runDurable` — the boundary family 3 pins for its
// consumers) keep delivering to callers. Constructed with a MINIMAL deps
// stub object WITHOUT instantiating ReactiveAgent. Zero casts, zero counted
// literals (ratchet law: never write the growth-metric literals on new lines).

import { describe, it, expect } from "bun:test";
import { Context, Effect, Fiber, Layer, ManagedRuntime, Schema } from "effect";
import { AgentId, TaskId, type Task, type TaskResult } from "@reactive-agents/core";
import { buildRunTaskEffect, type RunTaskDeps } from "../src/agent/run-task-effect.js";
import { runFacadeEffect } from "../src/agent/run-facade-effect.js";
import { ExecutionError } from "../src/errors.js";
import type { AgentDebrief } from "../src/debrief.js";

// Unrelated dummy service so the executor runtime is REAL and its type lines
// up with the `ManagedRuntime<any, never>` deps field without casts (the
// skills/durable seam precedent: ManagedRuntime's R is contravariant).
const SeamDummyTag = Context.GenericTag<{ readonly unused: true }>("SeamDummyService");

type SeamRuntime = ManagedRuntime.ManagedRuntime<any, never>;

type DebriefFiber = Fiber.RuntimeFiber<
    { debrief?: AgentDebrief; tokensUsed: number },
    never
>;

function makeRuntime(): SeamRuntime {
    return ManagedRuntime.make(Layer.succeed(SeamDummyTag, { unused: true }));
}

function makeDebrief(summary: string): AgentDebrief {
    return {
        outcome: "success",
        summary,
        keyFindings: [],
        errorsEncountered: [],
        lessonsLearned: [],
        confidence: "high",
        toolsUsed: [],
        metrics: { tokens: 0, duration: 0, iterations: 0, cost: 0 },
        rationale: [],
        markdown: summary,
    };
}

function makeTaskResult(): TaskResult {
    return {
        taskId: Schema.decodeSync(TaskId)("seam-run-task-result"),
        agentId: Schema.decodeSync(AgentId)("seam-run-task-agent"),
        output: "seam answer",
        success: true,
        metadata: { duration: 0, cost: 0, tokensUsed: 0 },
        completedAt: new Date(),
    };
}

/** Deps stub whose engine fails with `failure` (everything else inert). */
function failingDeps(runtime: SeamRuntime, failure: ExecutionError): RunTaskDeps {
    return {
        agentId: "seam-run-task-agent",
        engine: { execute: (_task: Task) => Effect.fail(failure) },
        runtime,
        config: {},
        enableTools: false,
        pendingDebriefs: new Set<DebriefFiber>(),
        setLastDebrief: () => {},
        setLastRunObservations: () => {},
        setLastReasoningSteps: () => {},
        buildSchemaSteering: () => "",
    };
}

/** Deps stub whose engine succeeds, carrying `syncDebrief` + `fiber`. */
function succeedingDeps(
    runtime: SeamRuntime,
    syncDebrief: AgentDebrief,
    fiber: DebriefFiber,
): { readonly deps: RunTaskDeps; readonly debriefs: AgentDebrief[]; readonly pending: Set<DebriefFiber> } {
    const debriefs: AgentDebrief[] = [];
    const pending = new Set<DebriefFiber>();
    // Non-fresh extension: the module reads the fiber + debrief off the
    // result through its documented cast pattern; the seam adds the fields
    // here structurally (no casts).
    const resultWithExtras = { ...makeTaskResult(), debrief: syncDebrief, _debriefFiber: fiber };
    const deps: RunTaskDeps = {
        agentId: "seam-run-task-agent",
        engine: { execute: (_task: Task) => Effect.succeed(resultWithExtras) },
        runtime,
        config: {},
        enableTools: false,
        pendingDebriefs: pending,
        setLastDebrief: (debrief) => {
            debriefs.push(debrief);
        },
        setLastRunObservations: () => {},
        setLastReasoningSteps: () => {},
        buildSchemaSteering: () => "",
    };
    return { deps, debriefs, pending };
}

async function captureRejection<A>(promise: Promise<A>): Promise<unknown> {
    return promise.then(
        () => null,
        (err: unknown) => err,
    );
}

/** Let the bridge-wrapped fiber joins + their .then/.catch/.finally
 *  microtask chains settle (no timers of our own; the Effect fiber's own
 *  scheduler settles the join, then the promise continuations drain). */
async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) {
        await Effect.runPromise(Effect.yieldNow());
    }
}

describe("run-task-family seam - buildRunTaskEffect boundary identity (Task 11)", () => {
    it("the module boundary carries the engine failure as the raw tagged instance through the shell bridge (E-channel pin)", async () => {
        const runtime = makeRuntime();
        const failure = new ExecutionError({
            message: "seam engine failure",
            taskId: "seam-run-task-1",
            phase: "think",
        });
        const rejection = await captureRejection(
            runFacadeEffect(runtime, buildRunTaskEffect(failingDeps(runtime, failure), "seam input")),
        );
        // The mapError identity check passes an Error cause through
        // untouched, and the bridge's either-fold re-raises that same
        // instance: identity, byte-for-byte, exactly the program's
        // deliberate-fail contract.
        expect(rejection).toBe(failure);
    });

    it("a preserved shell-boundary await of the same boundary delivers the FiberFailure wrapper, not the raw instance (wrapper-identity pin)", async () => {
        const runtime = makeRuntime();
        const failure = new ExecutionError({
            message: "seam engine failure",
            taskId: "seam-run-task-2",
            phase: "think",
        });
        const rejection = await captureRejection(
            runtime.runPromise(buildRunTaskEffect(failingDeps(runtime, failure), "seam input")),
        );
        // Empirics (effect@3.19, template point 2): ManagedRuntime.runPromise
        // wraps typed failures in a FiberFailure whose `name` carries the
        // cause identity. That wrapper — not the raw tagged instance — is
        // what the PRESERVED `run()` / `runDurable` delegates keep delivering
        // today; folding those sites would flip this identity, so this is
        // the kept-boundary tripwire for the family.
        expect(rejection).not.toBeNull();
        expect(rejection).not.toBe(failure);
        if (typeof rejection !== "object" || rejection === null) return;
        expect(String(Reflect.get(rejection, "name"))).toContain("(FiberFailure)");
        expect(String(rejection)).toContain("ExecutionError");
        // The wrapper is NOT the tagged cause itself (the cause carries
        // `_tag`; the wrapper does not).
        expect(Reflect.get(rejection, "_tag")).toBeUndefined();
    });

    it("debriefRich resolves the fiber's rich debrief by identity and the tracker upgrades _lastDebrief + deregisters the fiber (shared-bridge success pin)", async () => {
        const runtime = makeRuntime();
        const syncDebrief = makeDebrief("sync fallback");
        const richDebrief = makeDebrief("rich debrief");
        const fiber: DebriefFiber = runtime.runFork(
            Effect.succeed({ debrief: richDebrief, tokensUsed: 7 }),
        );
        const { deps, debriefs, pending } = succeedingDeps(runtime, syncDebrief, fiber);
        const result = await runFacadeEffect(
            runtime,
            buildRunTaskEffect(deps, "seam input"),
        );
        expect(typeof result.debriefRich).toBe("function");
        if (!result.debriefRich) return;
        // Value identity through the bridge-routed closure.
        expect(await result.debriefRich()).toBe(richDebrief);
        // Synchronous capture happened first (fallback debrief), the
        // fire-and-forget tracker upgrades it to the rich version.
        await settle();
        expect(debriefs[0]).toBe(syncDebrief);
        expect(debriefs[debriefs.length - 1]).toBe(richDebrief);
        expect(pending.size).toBe(0);
    });

    it("a failed debrief fiber makes debriefRich RESOLVE with the synchronous debrief, never reject (discarded-rejection pin)", async () => {
        const runtime = makeRuntime();
        const syncDebrief = makeDebrief("sync fallback");
        const fiber: DebriefFiber = runtime.runFork(Effect.die("seam-debrief-defect"));
        const { deps, debriefs, pending } = succeedingDeps(runtime, syncDebrief, fiber);
        const result = await runFacadeEffect(
            runtime,
            buildRunTaskEffect(deps, "seam input"),
        );
        expect(typeof result.debriefRich).toBe("function");
        if (!result.debriefRich) return;
        // Both the pre-conversion raw runPromise boundary and the bridge
        // route discard this rejection (their catch arms never inspect it):
        // raw-vs-wrapper identity is unobservable here — the provable half
        // of the Task 11 conversion.
        expect(await result.debriefRich()).toBe(syncDebrief);
        await settle();
        expect(debriefs).toEqual([syncDebrief]);
        expect(pending.size).toBe(0);
    });
});
