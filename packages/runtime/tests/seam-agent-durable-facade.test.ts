// Quality program Task 10 (D1 bridge family 3, durable facade): shell-path
// identity pins for `makeDurableFacade` converted per the Task 6/8 template
// (PRs #274 / #276). Constructed with a MINIMAL deps object (a tiny
// ManagedRuntime + temp-dir durableResume), exercised through the REAL shell
// path (`agent/run-facade-effect.ts`) - the same bridge every ReactiveAgent
// delegate uses - WITHOUT instantiating ReactiveAgent. Zero casts, zero
// counted literals.
//
// What each pin guards (the two identity classes of the template):
//   1. deliberate guard arm → the RAW Error instance and byte-identical
//      message reach callers (E-channel + bridge either-fold);
//   2. preserved inner runPromise boundary → callers receive the boundary's
//      FiberFailure WRAPPER, not the raw tagged cause: the wrapper carries
//      the cause identity in its name and does NOT carry the cause's `_tag`
//      - folding the site would flip that identity, so this is the
//      preserved-inner-runPromise tripwire for the mixed-boundary family;
//   3. the sync accessor that deliberately did NOT get bridged (a pure
//      function of deps; bridging it would change the class signature from
//      sync value to Promise) - None/empty outcome pinned.

import { describe, it, expect } from "bun:test";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeDurableFacade } from "../src/agent/durable-facade.js";
import { runFacadeEffect } from "../src/agent/run-facade-effect.js";

// Unrelated dummy service: a REAL ManagedRuntime whose requirements line up
// with the `ManagedRuntime<any, never>` deps field without casts (the skills
// seam precedent: ManagedRuntime's R is contravariant, so a never-providing
// runtime is NOT assignable to the deps type - a dummy one is). The facade
// methods are R=never; this runtime is only the shell bridge's executor.
const SeamDummyTag = Context.GenericTag<{ readonly unused: true }>("SeamDummyService");

type FacadeAndRuntime = {
    readonly facade: ReturnType<typeof makeDurableFacade>;
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>;
};

function facadeWithoutDurable(): FacadeAndRuntime {
    const runtime = ManagedRuntime.make(
        Layer.succeed(SeamDummyTag, { unused: true }),
    );
    return {
        facade: makeDurableFacade({
            agentId: "seam-durable-agent",
            runtime,
            buildRunTaskEffect: () => Effect.die("unreachable-in-this-pin"),
            runDurable: () => Promise.reject("unreachable-in-this-pin"),
        }),
        runtime,
    };
}

function facadeWithEmptyDurableDir(): FacadeAndRuntime & { readonly dir: string } {
    const dir = mkdtempSync(join(tmpdir(), "ra-seam-durable-"));
    const runtime = ManagedRuntime.make(
        Layer.succeed(SeamDummyTag, { unused: true }),
    );
    return {
        facade: makeDurableFacade({
            durableResume: { dir, configHash: "seam-hash" },
            agentId: "seam-durable-agent",
            runtime,
            buildRunTaskEffect: () => Effect.die("unreachable-in-this-pin"),
            runDurable: () => Promise.reject("unreachable-in-this-pin"),
        }),
        runtime,
        dir,
    };
}

async function captureRejection<A>(promise: Promise<A>): Promise<unknown> {
    return promise.then(
        () => null,
        (err: unknown) => err,
    );
}

describe("agent-family seam - makeDurableFacade through the shell bridge (Task 10)", () => {
    it("resumeRun without .withDurableRuns rejects with the RAW guard Error and byte-identical message (deliberate-arm pin)", async () => {
        const { facade, runtime } = facadeWithoutDurable();
        const rejection = await captureRejection(
            runFacadeEffect(runtime, facade.resumeRun("any-run-id")),
        );
        expect(rejection).not.toBeNull();
        if (typeof rejection !== "object" || rejection === null) return;
        expect(Object.getPrototypeOf(rejection)?.constructor).toBe(Error);
        expect(Reflect.get(rejection, "message")).toBe(
            "resumeRun() requires .withDurableRuns() — this agent has no durable run store.",
        );
    });

    it("resumeRun on an unknown run rejects with the preserved inner-boundary wrapper, not the raw tagged cause (wrapper-identity pin)", async () => {
        const { facade, runtime, dir } = facadeWithEmptyDurableDir();
        try {
            const rejection = await captureRejection(
                runFacadeEffect(runtime, facade.resumeRun("no-such-run")),
            );
            expect(rejection).not.toBeNull();
            if (typeof rejection !== "object" || rejection === null) return;
            // The global Effect.runPromise boundary is preserved inside
            // Effect.promise: callers observe THAT call's FiberFailure
            // wrapper. Empirically (effect@3.19) the wrapper carries the
            // cause identity in its `name` ("(FiberFailure) <Tag>") and a
            // generic `message`; `String(err)` (what every durable consumer
            // test matches) is byte-identical to the pre-bridge await.
            expect(String(Reflect.get(rejection, "name"))).toContain(
                "(FiberFailure)",
            );
            expect(String(rejection)).toContain("DurableRunNotFound");
            // ...but is NOT the tagged error itself: folding the site would
            // deliver the raw cause, which DOES carry `_tag`. Absent `_tag`
            // here is the proof the boundary stayed a boundary.
            expect(Reflect.get(rejection, "_tag")).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it("getDurableInfo stays synchronous: undefined without .withDurableRuns, exact dbPath/agentId with it (sync-accessor pin)", () => {
        const bare = facadeWithoutDurable();
        expect(bare.facade.getDurableInfo()).toBeUndefined();
        const { facade, dir } = facadeWithEmptyDurableDir();
        try {
            const info = facade.getDurableInfo();
            expect(info).toBeDefined();
            expect(info?.dbPath).toBe(join(dir, "runs.db"));
            expect(info?.agentId).toBe("seam-durable-agent");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
