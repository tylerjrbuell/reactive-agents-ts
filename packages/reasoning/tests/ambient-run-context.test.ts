import { describe, expect, test } from "bun:test"
import { Effect, FiberRef } from "effect"
import { CurrentRunContext } from "@reactive-agents/core"

// Adaptive-harness wave 1 (2026-07-07): ambient run correlation. The
// dispatch point (reasoning-service) sets CurrentRunContext via
// Effect.locally; observable-llm's exchange emitter falls back to it when a
// call site did not thread request.traceContext. These tests pin the FiberRef
// semantics the fallback relies on.
describe("CurrentRunContext ambient correlation", () => {
    test("defaults to null (placeholder behavior preserved)", async () => {
        const v = await Effect.runPromise(FiberRef.get(CurrentRunContext))
        expect(v).toBeNull()
    })

    test("Effect.locally scopes the taskId to the fiber subtree", async () => {
        const inner = FiberRef.get(CurrentRunContext)
        const scoped = inner.pipe(
            Effect.locally(CurrentRunContext, { taskId: "run-42" }),
        )
        const [insideValue, outsideValue] = await Effect.runPromise(
            Effect.all([scoped, FiberRef.get(CurrentRunContext)]),
        )
        expect(insideValue?.taskId).toBe("run-42")
        expect(outsideValue).toBeNull()
    })

    test("nested locally wins innermost (sub-kernel correlation)", async () => {
        const program = FiberRef.get(CurrentRunContext).pipe(
            Effect.locally(CurrentRunContext, { taskId: "sub" }),
            Effect.locally(CurrentRunContext, { taskId: "outer" }),
        )
        const v = await Effect.runPromise(program)
        expect(v?.taskId).toBe("sub")
    })
})
