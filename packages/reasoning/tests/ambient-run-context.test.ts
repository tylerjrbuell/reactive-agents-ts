import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { childContext, rootContext, runTaskId } from "@reactive-agents/core"
import { childRunScope, currentRunContext, withRunScope } from "@reactive-agents/core/internal/run-scope"

// Ambient run correlation: observable-llm's exchange emitter falls back to the
// run scope's RunContext (its task id) when a call site did not thread
// request.traceContext. These tests pin the semantics the fallback relies on.
describe("ambient run correlation through the run scope", () => {
    test("outside any run there is no context (placeholder behavior preserved)", async () => {
        expect(await Effect.runPromise(currentRunContext)).toBeNull()
    })

    test("a root run's task id is its run id, scoped to the run", async () => {
        const [inside, outside] = await Effect.runPromise(
            Effect.all([currentRunContext.pipe(withRunScope(rootContext("run-42", "agent"))), currentRunContext]),
        )
        expect(inside && runTaskId(inside)).toBe("run-42")
        expect(outside).toBeNull()
    })

    test("a sub-agent correlates to its own task, not the parent's", async () => {
        const root = rootContext("outer", "agent")
        const v = await Effect.runPromise(
            currentRunContext.pipe(childRunScope({ ...childContext(root, "sub"), taskId: "sub-task" }), withRunScope(root)),
        )
        expect(v && runTaskId(v)).toBe("sub-task")
        expect(v?.parentRunId).toBe("outer")
    })
})
