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
    // The delegate-side bridge (reactive-agent.ts `runSkillsFacade`:
    // catchAllDefect -> either -> Promise.reject(Left)) preserves whatever
    // VALUE enters the E channel; Promise.reject semantics are language-
    // guaranteed. These pins secure the OTHER half — that the values entering
    // E are the RAW instances (message and identity intact, never Cause-
    // wrapped or stringified). Reading E via Effect.either resolves instead
    // of rejecting, so the exact Left value is observable. If a future edit
    // swaps Effect.fail(new Error(...)) for a wrapper or breaks the
    // preserveError pass-through, these go red — the template families 2-4
    // reuse this pattern, so this is their shared tripwire.

    it("exportSkill's not-found rejection enters E as the raw Error instance (Task 6 identity pin)", async () => {
        const { facade, runtime } = facadeWithoutStore("seam-agent");
        const either = await runtime.runPromise(
            Effect.either(facade.exportSkill("missing-skill")),
        );
        expect(either._tag).toBe("Left");
        if (either._tag !== "Left") return;
        // Exact instance semantics: own constructor is Error (not a
        // FiberFailure wrapper), message byte-identical to the pre-bridge throw.
        expect(either.left.constructor).toBe(Error);
        expect(either.left.message).toBe('Skill "missing-skill" not found');
    });

    it("loadSkill's fs failure enters E as the raw ErrnoException (preserveError identity, Task 6 pin)", async () => {
        const { facade, runtime } = facadeWithoutStore("seam-agent");
        const either = await runtime.runPromise(
            Effect.either(facade.loadSkill("/nonexistent-skill-path-qp-t6")),
        );
        expect(either._tag).toBe("Left");
        if (either._tag !== "Left") return;
        // Node's ENOENT carries `code` — a Cause- or string-wrap would lose it.
        // Reflect.get keeps this cast-free (the E channel's static type is Error).
        expect(Reflect.get(either.left, "code")).toBe("ENOENT");
    });
});
