// Quality program Task 5 (seam seeds, GH #260): direct-import behavioral pin
// for the agent facade family (#217). Proves `makeSkillsFacade` is a real,
// standalone seam: constructed with a MINIMAL deps object (agentId + a tiny
// ManagedRuntime), it wires the documented `skills()` contract WITHOUT
// instantiating ReactiveAgent — service absent => [] (None path), service
// present => store.listAll called with deps.agentId and its exact array
// returned (identity, so the pass-through arm is distinguishable from the
// fresh-[] fallback arms), failing store => [] (documented resilience catch).
// The store tag is the same key the facade resolves through (GenericTag
// interning by key). Zero casts.
//
// Task 6 (D1 bridge) call-shape update: `skills()` now returns
// `Effect<A, never, R>` (precise E — the resilience catch folded the failure
// and defect channels into the [] fallback), so the pin runs it through the
// SAME runtime the facade was constructed with — the identical resolution
// path the pre-bridge internal `deps.runtime.runPromise` took. Assertions
// are semantically unchanged.

import { describe, it, expect } from "bun:test";
import { Effect, Context, Layer, ManagedRuntime } from "effect";
import type { SkillRecord } from "@reactive-agents/core";
import { makeSkillsFacade } from "../src/agent/skills-facade.js";
import { runFacadeEffect } from "../src/agent/run-facade-effect.js";

type SkillStoreLike = {
    readonly listAll: (
        agentId: string,
    ) => Effect.Effect<readonly SkillRecord[], unknown>;
};

const SkillStoreTag = Context.GenericTag<SkillStoreLike>("SkillStoreService");

// The helpers return the runtime widened to `ManagedRuntime<any, never>` —
// exactly the `SkillsFacadeDeps.runtime` type the facade accepts — so the
// pin can call `runtime.runPromise(facade.skills())` for an effect whose R
// is the facade's (module-local) store-tag type, with zero casts.
type FacadeAndRuntime = {
    readonly facade: ReturnType<typeof makeSkillsFacade>;
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>;
};

function facadeWithStore(
    listAll: (agentId: string) => Effect.Effect<readonly SkillRecord[], unknown>,
    calls: string[],
    agentId: string,
): FacadeAndRuntime {
    const spy: SkillStoreLike = {
        listAll: (id: string) =>
            Effect.sync(() => {
                calls.push(id);
            }).pipe(Effect.flatMap(() => listAll(id))),
    };
    const runtime = ManagedRuntime.make(Layer.succeed(SkillStoreTag, spy));
    return { facade: makeSkillsFacade({ agentId, runtime }), runtime };
}

function facadeWithoutStore(agentId: string): FacadeAndRuntime {
    // ManagedRuntime's R is contravariant (runPromise accepts Effect<_,_,R>),
    // so a never-providing runtime is NOT assignable to the deps'
    // ManagedRuntime<any, never>. Provide an unrelated dummy service: the
    // runtime is real, SkillStoreService remains absent (the None path under
    // test), and R lines up without casts.
    const DummyTag = Context.GenericTag<{ readonly unused: true }>("SeamDummyService");
    const runtime = ManagedRuntime.make(Layer.succeed(DummyTag, { unused: true }));
    return { facade: makeSkillsFacade({ agentId, runtime }), runtime };
}

describe("agent-family seam — makeSkillsFacade (direct, no ReactiveAgent)", () => {
    it("skills() returns [] when no SkillStoreService is configured (None path)", async () => {
        const { facade, runtime } = facadeWithoutStore("seam-agent");
        expect(await runtime.runPromise(facade.skills())).toEqual([]);
    });

    it("skills() calls the store's listAll with the facade's agentId and passes the EXACT array through", async () => {
        const stored: readonly SkillRecord[] = Object.freeze([]);
        const calls: string[] = [];
        const { facade, runtime } = facadeWithStore(() => Effect.succeed<readonly SkillRecord[]>(stored), calls, "seam-agent");
        const result = await runtime.runPromise(facade.skills());
        expect(calls).toEqual(["seam-agent"]);
        // Identity, not emptiness: proves this came from the store, not a [] fallback.
        expect(result === stored).toBe(true);
    });

    it("skills() swallows a store failure and still returns [] (documented resilience)", async () => {
        const calls: string[] = [];
        const { facade, runtime } = facadeWithStore(
            () => Effect.fail(new Error("store down")),
            calls,
            "seam-agent",
        );
        expect(await runtime.runPromise(facade.skills())).toEqual([]);
        expect(calls).toEqual(["seam-agent"]);
    });

    // ── Task 6 (D1 bridge) identity pins ─────────────────────────────────────
    // These run through the REAL shell path (agent/run-facade-effect.ts) — the
    // same bridge every ReactiveAgent delegate uses — and assert the rejection
    // VALUE itself: incidental fs failures reject with the raw ErrnoException
    // (`code` survives: a Cause- or string-wrap would lose it) and deliberate
    // not-found rejections reject with the exact Error instance and message
    // the pre-bridge async methods produced. Defect folding (Effect.sync /
    // Effect.promise) plus the bridge's either-fold is what makes this work;
    // families 2-4 reuse this pin shape, so this is their shared tripwire.

    it("exportSkill rejects unknown skills with the raw Error instance through the shell bridge (Task 6 pin)", async () => {
        const { facade, runtime } = facadeWithoutStore("seam-agent");
        const rejection = await runFacadeEffect(
            runtime,
            facade.exportSkill("missing-skill"),
        ).then(
            () => null,
            (err: unknown) => err,
        );
        expect(rejection).not.toBeNull();
        if (typeof rejection !== "object" || rejection === null) return;
        expect(Object.getPrototypeOf(rejection)?.constructor).toBe(Error);
        expect(Reflect.get(rejection, "message")).toBe(
            'Skill "missing-skill" not found',
        );
    });

    it("loadSkill rejects fs failures with the raw ErrnoException through the shell bridge (Task 6 pin)", async () => {
        const { facade, runtime } = facadeWithoutStore("seam-agent");
        const rejection = await runFacadeEffect(
            runtime,
            facade.loadSkill("/nonexistent-skill-path-qp-t6"),
        ).then(
            () => null,
            (err: unknown) => err,
        );
        expect(rejection).not.toBeNull();
        if (typeof rejection !== "object" || rejection === null) return;
        expect(Reflect.get(rejection, "code")).toBe("ENOENT");
    });
});
