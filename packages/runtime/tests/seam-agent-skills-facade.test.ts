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

function facadeWithStore(
    listAll: (agentId: string) => Effect.Effect<readonly SkillRecord[], unknown>,
    calls: string[],
    agentId: string,
) {
    const spy: SkillStoreLike = {
        listAll: (id: string) =>
            Effect.sync(() => {
                calls.push(id);
            }).pipe(Effect.flatMap(() => listAll(id))),
    };
    const runtime = ManagedRuntime.make(Layer.succeed(SkillStoreTag, spy));
    return makeSkillsFacade({ agentId, runtime });
}

function facadeWithoutStore(agentId: string) {
    // ManagedRuntime's R is contravariant (runPromise accepts Effect<_,_,R>),
    // so a never-providing runtime is NOT assignable to the deps'
    // ManagedRuntime<any, never>. Provide an unrelated dummy service: the
    // runtime is real, SkillStoreService remains absent (the None path under
    // test), and R lines up without casts.
    const DummyTag = Context.GenericTag<{ readonly unused: true }>("SeamDummyService");
    const runtime = ManagedRuntime.make(Layer.succeed(DummyTag, { unused: true }));
    return makeSkillsFacade({ agentId, runtime });
}

describe("agent-family seam — makeSkillsFacade (direct, no ReactiveAgent)", () => {
    it("skills() returns [] when no SkillStoreService is configured (None path)", async () => {
        const facade = facadeWithoutStore("seam-agent");
        expect(await facade.skills()).toEqual([]);
    });

    it("skills() calls the store's listAll with the facade's agentId and passes the EXACT array through", async () => {
        const stored: readonly SkillRecord[] = Object.freeze([]);
        const calls: string[] = [];
        const facade = facadeWithStore(() => Effect.succeed<readonly SkillRecord[]>(stored), calls, "seam-agent");
        const result = await facade.skills();
        expect(calls).toEqual(["seam-agent"]);
        // Identity, not emptiness: proves this came from the store, not a [] fallback.
        expect(result === stored).toBe(true);
    });

    it("skills() swallows a store failure and still returns [] (documented resilience)", async () => {
        const calls: string[] = [];
        const facade = facadeWithStore(
            () => Effect.fail(new Error("store down")),
            calls,
            "seam-agent",
        );
        expect(await facade.skills()).toEqual([]);
        expect(calls).toEqual(["seam-agent"]);
    });
});
