import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { buildGuidanceText } from "../src/context/guidance.js"
import { ToolService } from "@reactive-agents/tools"
import { LLMService, TestLLMService, type LLMMessage, type StreamEvent } from "@reactive-agents/llm-provider"
import type { LLMErrors } from "@reactive-agents/llm-provider"
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core"
import { executeReactive } from "../src/strategies/reactive.js"
import { defaultReasoningConfig } from "../src/types/config.js"
import { provideTestEnvelope } from "../src/kernel/envelope/run-envelope.js"

// Hotfix 0.5-1 (2026-07-07): GuidanceContext was assembled every think turn
// and pendingGuidance cleared — but the rendered text never reached the
// model (the dead ContextManager owned the renderer). think.ts now appends
// buildGuidanceText output to the system prompt's dynamic tail.
describe("buildGuidanceText (live guidance rendering)", () => {
    test("no active signals → null (zero prompt cost)", () => {
        expect(buildGuidanceText({ requiredToolsPending: [], loopDetected: false })).toBeNull()
    })

    test("required tools + loop nudge render as a Guidance block", () => {
        const text = buildGuidanceText({
            requiredToolsPending: ["web-search"],
            loopDetected: true,
            loopDetectedMessage: "custom nudge",
        })
        expect(text).toContain("Guidance:")
        expect(text).toContain("REQUIRED tools not yet called: web-search")
        expect(text).toContain("custom nudge")
    })

    test("evidence gap renders the revision instruction", () => {
        const text = buildGuidanceText({
            requiredToolsPending: [],
            loopDetected: false,
            evidenceGap: "invented price",
        })
        expect(text).toContain("invented price")
        expect(text).toContain("Revise using only data")
    })
})

// ── Automatic-caching fix (2026-08-24) ─────────────────────────────────────
//
// Live trace evidence: with guidance rendered into the SYSTEM PROMPT's
// dynamic tail, the system string's length churned 444 -> 649 -> 444 -> 444
// chars across iterations, tracking exactly when the guidance channel fired.
// Anthropic's automatic prompt cache puts system BEFORE messages in its
// cache hierarchy, so any system-content change invalidates the cache for
// that call and everything downstream — the "tail placement keeps the
// stable prefix intact" claim in the old comment was false: appending
// anywhere inside the system STRING still changes the whole string's
// content and hash.
//
// think.ts now appends guidanceText as a trailing user-role MESSAGE on the
// outgoing request instead of into the system prompt, so the system prompt
// stays byte-identical across iterations regardless of guidance state.
describe("guidance lands in MESSAGES, not systemPrompt (automatic-cache stability)", () => {
    const TOOL_SCHEMA = {
        name: "web-search",
        description: "Search the web",
        parameters: [{ name: "query", type: "string", description: "query", required: true }],
    }

    function toolLayer() {
        return Layer.succeed(
            ToolService,
            ToolService.of({
                execute: () =>
                    Effect.succeed({
                        success: true,
                        result: { results: [{ title: "hit", url: "https://example.com", content: "data" }] },
                    }),
                getTool: (name: string) =>
                    Effect.succeed({ name, description: "t", parameters: [{ name: "query", type: "string", required: true }] }),
                register: () => Effect.void,
                listTools: () => Effect.succeed([]),
                deregister: () => Effect.void,
            } as unknown as Parameters<typeof ToolService.of>[0]),
        )
    }

    /** Records every request handed to LLMService.stream(), then delegates to a real TestLLMService. */
    function recordingLLMLayer(scenario: Parameters<typeof TestLLMService>[0]) {
        const inner = TestLLMService(scenario)
        const captured: Array<{ systemPrompt?: string; messages: readonly LLMMessage[] }> = []
        return {
            captured,
            layer: Layer.succeed(
                LLMService,
                LLMService.of({
                    ...inner,
                    stream: (request) => {
                        captured.push({ systemPrompt: request.systemPrompt, messages: request.messages })
                        return inner.stream(request) as Effect.Effect<Stream.Stream<StreamEvent, LLMErrors>, LLMErrors>
                    },
                }),
            ),
        }
    }

    test("guidance text appears in the outgoing MESSAGES, not systemPrompt, when a prompt.guidance override injects it", async () => {
        const OVERRIDE = "CUSTOM GUIDANCE: give your final answer now."
        const rh = new RegistrationHarness()
        rh.on("prompt.guidance", () => OVERRIDE)
        const pipeline = new HarnessPipeline(rh._collected)

        const { captured, layer } = recordingLLMLayer([
            { toolCall: { name: "web-search", args: { query: "x" } } },
            { text: "FINAL ANSWER: done" },
        ])

        const result = await Effect.runPromise(provideTestEnvelope(
            executeReactive({
                taskDescription: "search and finish",
                taskType: "simple",
                memoryContext: "",
                availableTools: ["web-search"],
                availableToolSchemas: [TOOL_SCHEMA],
                config: defaultReasoningConfig,
                harnessPipeline: pipeline,
            }).pipe(Effect.provide(Layer.merge(layer, toolLayer()))),
        ))

        expect(result.status).toBe("completed")
        expect(captured.length).toBeGreaterThanOrEqual(1)

        for (const call of captured) {
            expect(call.systemPrompt ?? "").not.toContain(OVERRIDE)
        }
        const anyMessageCarriesGuidance = captured.some((call) =>
            call.messages.some((m) => typeof m.content === "string" && m.content.includes(OVERRIDE)),
        )
        expect(anyMessageCarriesGuidance).toBe(true)
    })

    test("systemPrompt stays byte-identical across a guidance-bearing iteration and a guidance-free one", async () => {
        const OVERRIDE = "CUSTOM GUIDANCE: iteration-specific nudge."
        const rh = new RegistrationHarness()
        // Fire guidance only on the FIRST think iteration; suppress on every other.
        rh.on("prompt.guidance", (_default: unknown, ctx: { iteration: number }) =>
            ctx.iteration === 0 ? OVERRIDE : null,
        )
        const pipeline = new HarnessPipeline(rh._collected)

        const { captured, layer } = recordingLLMLayer([
            { toolCall: { name: "web-search", args: { query: "x" } } },
            { text: "FINAL ANSWER: done" },
        ])

        const result = await Effect.runPromise(provideTestEnvelope(
            executeReactive({
                taskDescription: "search and finish",
                taskType: "simple",
                memoryContext: "",
                availableTools: ["web-search"],
                availableToolSchemas: [TOOL_SCHEMA],
                config: defaultReasoningConfig,
                harnessPipeline: pipeline,
            }).pipe(Effect.provide(Layer.merge(layer, toolLayer()))),
        ))

        expect(result.status).toBe("completed")
        expect(captured.length).toBeGreaterThanOrEqual(2)

        // The regression this fix closes: system prompt must be byte-identical
        // across calls regardless of whether guidance fired on that iteration.
        const systemPrompts = captured.map((c) => c.systemPrompt ?? "")
        expect(new Set(systemPrompts).size).toBe(1)

        // But the MESSAGES must differ — the guidance-bearing call carries the
        // override text, the guidance-free one does not.
        const withGuidance = captured.filter((c) =>
            c.messages.some((m) => typeof m.content === "string" && m.content.includes(OVERRIDE)),
        )
        const withoutGuidance = captured.filter((c) =>
            !c.messages.some((m) => typeof m.content === "string" && m.content.includes(OVERRIDE)),
        )
        expect(withGuidance.length).toBeGreaterThanOrEqual(1)
        expect(withoutGuidance.length).toBeGreaterThanOrEqual(1)
    })

    test("guidance never leaks into persistent kernel conversation state (state.messages)", async () => {
        const OVERRIDE = "CUSTOM GUIDANCE: ephemeral-only nudge."
        const rh = new RegistrationHarness()
        rh.on("prompt.guidance", () => OVERRIDE)
        const pipeline = new HarnessPipeline(rh._collected)

        const { layer } = recordingLLMLayer([
            { toolCall: { name: "web-search", args: { query: "x" } } },
            { text: "FINAL ANSWER: done" },
        ])

        const result = await Effect.runPromise(provideTestEnvelope(
            executeReactive({
                taskDescription: "search and finish",
                taskType: "simple",
                memoryContext: "",
                availableTools: ["web-search"],
                availableToolSchemas: [TOOL_SCHEMA],
                config: defaultReasoningConfig,
                harnessPipeline: pipeline,
            }).pipe(Effect.provide(Layer.merge(layer, toolLayer()))),
        ))

        expect(result.status).toBe("completed")
        // The kernel's own reported message/output surface must never contain
        // the ephemeral guidance text — it is request-only steering, not
        // conversation history that gets replayed/compacted/persisted.
        const serialized = JSON.stringify(result)
        expect(serialized).not.toContain(OVERRIDE)
    })
})
