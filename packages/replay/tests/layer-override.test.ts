import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { ToolService, ToolServiceLive } from "@reactive-agents/tools"
import { EventBusLive } from "@reactive-agents/core"
import { makeReplayToolLayer } from "../src/replay-tool-layer.js"
import { makeReplayController } from "../src/replay-controller.js"
import { computeArgsHash } from "../src/tool-table.js"
import type { RecordedToolResult } from "../src/types.js"

/**
 * Gate test for the .withLayers() override pattern.
 *
 * Production wiring: `Layer.merge(runtime, options.extraLayers)` at
 * runtime.ts:1625. This test simulates the same merge and verifies that
 * the replay layer wins for ToolService.execute. If this test ever fails,
 * the merge order in runtime.ts is wrong and replay would silently call
 * the live tool.
 */
describe("Layer.merge override semantics — gate", () => {
    test("replay layer wins ToolService.execute over ToolServiceLive", async () => {
        const h = computeArgsHash({ q: "x" })
        const table = new Map<string, RecordedToolResult[]>([
            [`search::${h}`, [
                { toolName: "search", argsHash: h, args: { q: "x" }, result: "REPLAY_WINS", ok: true, durationMs: 0, iter: 0, seq: 0 },
            ]],
        ])
        const ctrl = makeReplayController(table)
        const replayLayer = makeReplayToolLayer(ctrl, "strict")

        // Production order: live first, replay merged in second (extraLayers position).
        const liveWithDeps = Layer.provide(ToolServiceLive, EventBusLive)
        const merged = Layer.merge(liveWithDeps, replayLayer)

        const program = Effect.gen(function* () {
            const ts = yield* ToolService
            return yield* ts.execute({
                toolName: "search",
                arguments: { q: "x" },
                agentId: "a",
                sessionId: "s",
            } as never)
        })

        const result = (await Effect.runPromise(Effect.provide(program, merged))) as { result: unknown; success: boolean }
        expect(result.success).toBe(true)
        expect(result.result).toBe("REPLAY_WINS")
    })
})
