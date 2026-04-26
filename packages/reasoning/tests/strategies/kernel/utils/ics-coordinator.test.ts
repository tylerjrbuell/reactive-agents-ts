import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { coordinateICS } from "../../../../src/kernel/utils/ics-coordinator.js"
import { initialKernelState } from "../../../../src/kernel/state/kernel-state.js"

const baseState = initialKernelState({
  taskId: "t1",
  strategy: "reactive",
  kernelType: "react",
  maxIterations: 10,
})

describe("coordinateICS steeringNudge", () => {
  it("returns steeringNudge when tools missing (local tier)", async () => {
    const result = await Effect.runPromise(
      coordinateICS(baseState, {
        task: "Lookup Effect-Ts docs",
        requiredTools: ["resolve-library-id", "get-library-docs"],
        toolsUsed: new Set(),
        availableTools: [
          { name: "resolve-library-id", description: "Resolve library", parameters: [] },
          { name: "get-library-docs", description: "Get docs", parameters: [] },
        ],
        tier: "local",
        iteration: 1,
        maxIterations: 10,
        lastErrors: [],
      })
    )
    expect(typeof result.steeringNudge).toBe("string")
    expect(result.steeringNudge).toContain("resolve-library-id")
  })

  it("returns undefined when no required tools", async () => {
    const result = await Effect.runPromise(
      coordinateICS(baseState, {
        task: "Simple task",
        requiredTools: [],
        toolsUsed: new Set(),
        availableTools: [],
        tier: "local",
        iteration: 1,
        maxIterations: 10,
        lastErrors: [],
      })
    )
    expect(result.steeringNudge).toBeUndefined()
  })

  it("returns undefined for frontier tier not near budget", async () => {
    const result = await Effect.runPromise(
      coordinateICS(baseState, {
        task: "Task",
        requiredTools: ["some-tool"],
        toolsUsed: new Set(),
        availableTools: [],
        tier: "frontier",
        iteration: 2,
        maxIterations: 10,
        lastErrors: [],
      })
    )
    // iteration 2 < 7 (70% of 10) → no nudge for frontier
    expect(result.steeringNudge).toBeUndefined()
  })

  it("includes completed tools and error context", async () => {
    const result = await Effect.runPromise(
      coordinateICS(baseState, {
        task: "Task",
        requiredTools: ["tool-a", "tool-b"],
        toolsUsed: new Set(["tool-a"]),
        availableTools: [],
        tier: "local",
        iteration: 1,
        maxIterations: 10,
        lastErrors: ["tool-x failed: timeout"],
      })
    )
    expect(result.steeringNudge).toContain("tool-a ✓")
    expect(result.steeringNudge).toContain("tool-x failed: timeout")
    expect(result.steeringNudge).toContain("tool-b")
  })
})
