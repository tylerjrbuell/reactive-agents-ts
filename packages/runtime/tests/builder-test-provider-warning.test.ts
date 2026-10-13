/**
 * W0.3 — implicit-test-provider warning (Local-Tier Reliability program, Wave 0).
 *
 * `build()` must warn prominently when the provider resolves to "test" WITHOUT
 * the user ever expressing intent to use it (the silent fake-green DX trap).
 * Explicit arms — `.withProvider("test")` and `.withTestScenario(...)` — stay
 * silent. Signal only: no throw, no default flip.
 *
 * Warning-capture pattern matches the house style (see build-validation.test.ts:
 * patch console.warn, collect strings, restore).
 */
import { describe, test, expect } from "bun:test";
import { Layer } from "effect";
import { ReactiveAgents } from "../src";
import { LLMService, TestLLMService } from "@reactive-agents/llm-provider";

/** Characteristic substrings of the implicit-test-provider warning. */
const MARKER = "canned output";

function captureWarnings(): { warnings: string[]; restore: () => void } {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
        for (const arg of args) {
            if (typeof arg === "string") warnings.push(arg);
        }
    };
    return { warnings, restore: () => (console.warn = original) };
}

describe("Implicit test-provider warning (W0.3)", () => {
    test("build() warns when provider was never explicitly chosen (silently defaults to test)", async () => {
        const { warnings, restore } = captureWarnings();
        const agent = await ReactiveAgents.create().build();
        restore();
        await agent.dispose();

        const hits = warnings.filter((w) => w.includes(MARKER));
        expect(hits.length).toBe(1); // warn-once per build
        // Message must name the symptom AND the cure to be actionable.
        expect(hits[0]).toContain("test");
        expect(hits[0]).toMatch(/without (ever )?calling a model/);
        expect(hits[0]).toContain(".withProvider");
    });

    test("explicit .withProvider(\"test\") stays silent", async () => {
        const { warnings, restore } = captureWarnings();
        const agent = await ReactiveAgents.create().withProvider("test").build();
        restore();
        await agent.dispose();

        expect(warnings.filter((w) => w.includes(MARKER)).length).toBe(0);
    });

    test("explicit .withTestScenario(...) stays silent (dedicated test arm)", async () => {
        const { warnings, restore } = captureWarnings();
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "ok" }])
            .build();
        restore();
        await agent.dispose();

        expect(warnings.filter((w) => w.includes(MARKER)).length).toBe(0);
    });

    test("a real explicit provider (.withProvider(\"anthropic\")) does not trigger the test-provider warning", async () => {
        const { warnings, restore } = captureWarnings();
        // No API key needed: we only build, and the missing-key warning (if any)
        // is a different message — we assert the canned-output warning is absent.
        const agent = await ReactiveAgents.create()
            .withProvider("anthropic")
            .withLazyValidation()
            .build();
        restore();
        await agent.dispose();

        expect(warnings.filter((w) => w.includes(MARKER)).length).toBe(0);
    });

    test("explicit .withReplayLLM(...) stays silent (provider field is irrelevant under an LLM override)", async () => {
        const replayLayer = Layer.succeed(
            LLMService,
            LLMService.of({ ...TestLLMService([{ text: "ok" }]) }),
        );
        const { warnings, restore } = captureWarnings();
        const agent = await ReactiveAgents.create().withReplayLLM(replayLayer).build();
        restore();
        await agent.dispose();

        expect(warnings.filter((w) => w.includes(MARKER)).length).toBe(0);
    });
});
