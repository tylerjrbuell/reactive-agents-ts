import { Effect, Layer } from "effect"
import { ToolService } from "@reactive-agents/tools"
import type { ReplayResultProvider } from "./replay-controller.js"

const die = (m: string): Effect.Effect<never, never, never> =>
    Effect.die(new Error(`replay: ToolService.${m} not supported during replay`))

export function makeReplayToolLayer(
    provider: ReplayResultProvider,
    mode: "strict" | "lenient" = "strict",
): Layer.Layer<ToolService, never, never> {
    return Layer.succeed(
        ToolService,
        ToolService.of({
            execute: ((input: { toolName: string; arguments?: unknown }) =>
                Effect.gen(function* () {
                    const hit = provider.next(input.toolName, input.arguments)
                    const started = Date.now()
                    if (!hit.hit) {
                        if (mode === "strict") {
                            return yield* Effect.die(
                                new Error(
                                    `replay: unrecorded tool call ${input.toolName} (strict mode); switch to onMissingToolResult:"lenient" or extend the recording`,
                                ),
                            )
                        }
                        return {
                            toolName: input.toolName,
                            success: false,
                            error: "replay: no recording for this call (lenient mode)",
                            executionTimeMs: Date.now() - started,
                        }
                    }
                    if (!hit.ok) {
                        return {
                            toolName: input.toolName,
                            success: false,
                            error: hit.error ?? "replay: recorded error",
                            executionTimeMs: Date.now() - started,
                        }
                    }
                    if (hit.truncated && mode === "strict") {
                        return yield* Effect.die(
                            new Error(
                                `replay: recorded tool result for ${input.toolName} was truncated; live re-execution may diverge. Switch to lenient mode to proceed.`,
                            ),
                        )
                    }
                    return {
                        toolName: input.toolName,
                        success: true,
                        result: hit.result,
                        executionTimeMs: Date.now() - started,
                    }
                })) as never,
            register: (() => die("register")) as never,
            unregisterTool: (() => Effect.succeed(undefined)) as never,
            connectMCPServer: (() => die("connectMCPServer")) as never,
            disconnectMCPServer: (() => die("disconnectMCPServer")) as never,
            listTools: (() => Effect.succeed([] as never)) as never,
            getTool: (() => die("getTool")) as never,
            toFunctionCallingFormat: (() => Effect.succeed([] as never)) as never,
            listMCPServers: (() => Effect.succeed([] as never)) as never,
        }),
    )
}
