/**
 * Trace-dir single-resolver pin.
 *
 * The recorder writes through `effectiveTraceDir` (trace/src/paths.ts), which
 * under NODE_ENV=test with no REACTIVE_AGENTS_TRACE_DIR redirects the home
 * default to a per-process temp dir. The runtime's default tracing config must
 * resolve through the SAME resolver (`resolveTraceDir`); otherwise the engine
 * looks in `~/.reactive-agents/traces`, finds nothing, and
 * `metadata.tracePath` is silently absent although the trace file exists.
 * That divergence broke the killswitch / tier-1 trace tests when run from a
 * package dir (turbo), where the root test preload does not set the env var.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resolveTraceDir } from "@reactive-agents/trace";
import { ReactiveAgents } from "../src";
import { defaultTracingConfig } from "../src/builder/helpers.js";

const PRIOR_DIR = process.env.REACTIVE_AGENTS_TRACE_DIR;
const PRIOR_FLAG = process.env.REACTIVE_AGENTS_TRACE;
const PRIOR_NODE_ENV = process.env.NODE_ENV;
const written: string[] = [];

afterAll(() => {
    if (PRIOR_DIR === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
    else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR_DIR;
    if (PRIOR_FLAG === undefined) delete process.env.REACTIVE_AGENTS_TRACE;
    else process.env.REACTIVE_AGENTS_TRACE = PRIOR_FLAG;
    if (PRIOR_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = PRIOR_NODE_ENV;
    for (const f of written) rmSync(f, { force: true });
});

describe("trace dir: runtime and recorder share one resolver", () => {
    test("defaultTracingConfig resolves through resolveTraceDir", () => {
        process.env.NODE_ENV = "test";
        delete process.env.REACTIVE_AGENTS_TRACE_DIR;
        delete process.env.REACTIVE_AGENTS_TRACE;
        expect(defaultTracingConfig()).toEqual({ dir: resolveTraceDir() });
    });

    test("metadata.tracePath is present under NODE_ENV=test with REACTIVE_AGENTS_TRACE_DIR unset", async () => {
        process.env.NODE_ENV = "test";
        delete process.env.REACTIVE_AGENTS_TRACE_DIR;
        delete process.env.REACTIVE_AGENTS_TRACE;

        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "FINAL ANSWER: resolver ok" }])
            .withReasoning({ defaultStrategy: "reactive" })
            .withMaxIterations(2)
            .build();
        let result;
        try {
            result = await agent.run("prove one trace-dir resolver");
        } finally {
            await agent.dispose();
        }

        const runId = result.metadata.runId;
        const tracePath = result.metadata.tracePath;
        expect(runId).toBeDefined();
        expect(tracePath).toBeDefined();
        written.push(tracePath!);
        expect(tracePath).toBe(join(resolveTraceDir(), `${runId}.jsonl`));
        expect(existsSync(tracePath!)).toBe(true);
    }, 20000);
});
