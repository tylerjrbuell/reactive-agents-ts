// Quality program Task 8 (D1 bridge, family 2) seam pin for the judgment
// facade (GH #217 decomposition; Task 6 template reused). Proves
// `makeJudgmentFacade` is a real, standalone seam: constructed with a MINIMAL
// deps object (agentId + a tiny ManagedRuntime + empty history/step arrays),
// WITHOUT instantiating ReactiveAgent, and driven through the REAL shell path
// (`runFacadeEffect` — the exact bridge every `reactive-agent.ts` delegate
// uses), it pins the two rejection-VALUE classes the Task 8 conversion
// promises:
//   (1) the DELIBERATE "requires .withJudgment()" rejections ride the E
//       channel and arrive as the exact Error instances the facade
//       constructs (prototype constructor + message identity — the Task 6
//       template pin), including the auto-shadow branch firing FIRST; and
//   (2) BACKEND failures keep arriving as the PRESERVED inner
//       `deps.runtime.runPromise` boundary's `FiberFailure` wrapper — NOT a
//       raw tagged error. That distinction is load-bearing:
//       `agent-list-judgment-models.test.ts` pin (c) depends on the wrapper
//       shape (a raw tagged error would carry `_tag`). Pin (2) below is the
//       family's inner-boundary tripwire.
// Zero casts; assertions read rejection values via Reflect.get / String /
// prototype inspection.

import { describe, it, expect } from "bun:test";
import { Effect, Context, Layer, ManagedRuntime } from "effect";
import { JudgmentService, JudgmentUnsupported } from "@reactive-agents/judgment";
import type { QuestionSpecs } from "@reactive-agents/judgment";
import { makeJudgmentFacade } from "../src/agent/judgment-facade.js";
import { runFacadeEffect } from "../src/agent/run-facade-effect.js";

const noulQuestions: QuestionSpecs = {
    q: { type: "noul", instructions: "Is this destructive?" },
};

// The helpers return the runtime widened to `ManagedRuntime<any, never>` —
// exactly the `JudgmentFacadeDeps.runtime` type the facade accepts — so the
// pin can hand the SAME runtime to `runFacadeEffect` and to the facade's
// preserved inner boundary, with zero casts (skills-facade seam precedent).
type FacadeAndRuntime = {
    readonly facade: ReturnType<typeof makeJudgmentFacade>;
    readonly runtime: ManagedRuntime.ManagedRuntime<any, never>;
};

function facadeWith(
    runtime: ManagedRuntime.ManagedRuntime<any, never>,
    judgmentAutoShadow: boolean,
): FacadeAndRuntime {
    const facade = makeJudgmentFacade({
        agentId: "seam-judgment-agent",
        runtime,
        judgmentAutoShadow,
        chatHistory: [],
        lastReasoningSteps: [],
    });
    return { facade, runtime };
}

function runtimeWithoutJudgment(): ManagedRuntime.ManagedRuntime<any, never> {
    // ManagedRuntime's R is contravariant (runPromise accepts Effect<_,_,R>),
    // so a never-providing runtime is NOT assignable to the deps'
    // ManagedRuntime<any, never>. Provide an unrelated dummy service: the
    // runtime is real, JudgmentService remains absent (the None path under
    // test), and R lines up without casts.
    const DummyTag = Context.GenericTag<{ readonly unused: true }>("SeamJudgmentDummyService");
    return ManagedRuntime.make(Layer.succeed(DummyTag, { unused: true }));
}

function runtimeWithFailingCatalog(): ManagedRuntime.ManagedRuntime<any, never> {
    // A real (present) JudgmentService whose listModels() fails with the
    // tagged JudgmentUnsupported the `llm` backend actually rejects with —
    // exercising the facade's PRESERVED inner runPromise boundary, not the
    // deliberate None arms.
    const failingService: JudgmentService["Type"] = {
        ask: () => Effect.fail(new JudgmentUnsupported({ message: "seam: ask must not run" })),
        listModels: () =>
            Effect.fail(
                new JudgmentUnsupported({ message: 'Backend "seam" has no model catalog' }),
            ),
    };
    return ManagedRuntime.make(Layer.succeed(JudgmentService, failingService));
}

describe("agent-family seam — makeJudgmentFacade (direct, no ReactiveAgent)", () => {
    it("judge() without JudgmentService rejects with the exact deliberate Error through the shell bridge (Task 8 pin)", async () => {
        const { facade, runtime } = facadeWith(runtimeWithoutJudgment(), false);
        const rejection = await runFacadeEffect(
            runtime,
            facade.judge({ state: null, questions: noulQuestions }),
        ).then(
            () => null,
            (err: unknown) => err,
        );
        expect(rejection).not.toBeNull();
        if (typeof rejection !== "object" || rejection === null) return;
        expect(Object.getPrototypeOf(rejection)?.constructor).toBe(Error);
        expect(Reflect.get(rejection, "message")).toContain(
            "agent.judge() requires .withJudgment()",
        );
    });

    it("judge() on an auto-shadow-only agent names auto-shadow sampling, not the None arm (branch-order pin)", async () => {
        // The runtime ALSO lacks JudgmentService here; the autoShadowed arm
        // must fire FIRST, so the message distinguishes the two deliberate
        // sites (pre-bridge ordering preserved).
        const { facade, runtime } = facadeWith(runtimeWithoutJudgment(), true);
        const rejection = await runFacadeEffect(
            runtime,
            facade.judge({ state: null, questions: noulQuestions }),
        ).then(
            () => null,
            (err: unknown) => err,
        );
        expect(rejection).not.toBeNull();
        if (typeof rejection !== "object" || rejection === null) return;
        expect(Object.getPrototypeOf(rejection)?.constructor).toBe(Error);
        expect(Reflect.get(rejection, "message")).toContain("auto-shadow sampling");
    });

    it("judgeRank() without JudgmentService rejects with the exact deliberate Error through the shell bridge (Task 8 pin)", async () => {
        const { facade, runtime } = facadeWith(runtimeWithoutJudgment(), false);
        const rejection = await runFacadeEffect(
            runtime,
            facade.judgeRank([{ id: "c0", state: { text: "draft" } }], {
                instructions: "How well does this answer the question?",
                criteria: ["poor", "excellent"],
            }),
        ).then(
            () => null,
            (err: unknown) => err,
        );
        expect(rejection).not.toBeNull();
        if (typeof rejection !== "object" || rejection === null) return;
        expect(Object.getPrototypeOf(rejection)?.constructor).toBe(Error);
        expect(Reflect.get(rejection, "message")).toContain(
            "agent.judgeRank() requires .withJudgment()",
        );
    });

    it("listJudgmentModels() backend catalog failures stay FiberFailure-wrapped via the preserved inner boundary (Task 8 pin)", async () => {
        const { facade, runtime } = facadeWith(runtimeWithFailingCatalog(), false);
        const rejection = await runFacadeEffect(
            runtime,
            facade.listJudgmentModels(),
        ).then(
            () => null,
            (err: unknown) => err,
        );
        expect(rejection).not.toBeNull();
        if (typeof rejection !== "object" || rejection === null) return;
        // A raw tagged error would carry `_tag`. It must NOT arrive here —
        // pre-bridge (and post-Task 8) callers observe the inner
        // runPromise boundary's wrapper, and agent-list-judgment-models
        // pin (c) depends on exactly that shape.
        expect(Reflect.get(rejection, "_tag")).toBe(undefined);
        expect(String(rejection)).toContain("has no model catalog");
    });
});
