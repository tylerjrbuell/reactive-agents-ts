/**
 * W0.5: result→trace linkage (Local-Tier Reliability program, Lift Protocol plumbing).
 *
 * `agent.run()` results must carry `metadata.runId` + `metadata.tracePath`
 * (absolute, real, flushed) whenever tracing recorded the run, so per-wave
 * pre/post captures and `rax diagnose replay` can reach the trace file from
 * the result object alone. When tracing is disabled, the fields must be
 * honestly absent, never a path to a non-existent file.
 *
 * Trace-dir setup mirrors the house pattern in meta-tools-default-surface.test.ts
 * (REACTIVE_AGENTS_TRACE_DIR at module scope, restored in afterAll).
 *
 * Rax-consumable assertion: instead of shelling out to the `rax` CLI (fragile
 * in-suite: spawns a whole Bun process, cwd-sensitive, timeout-prone), the
 * trace file is asserted through `loadTrace` from `@reactive-agents/trace` —
 * the SAME schema-strict loader the diagnose CLI stack consumes (it silently
 * drops lines failing `isTraceEvent` and stamps `runId` from the first valid
 * event, replay.ts:20-35), plus the `run-started` presence that
 * `loadRecordedRun` requires (replay/src/load.ts:29-31). That provably
 * exercises the real consumer contract in-process. The path itself is
 * asserted to live under the dir the diagnose CLI reads
 * (REACTIVE_AGENTS_TRACE_DIR).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace } from "@reactive-agents/trace";
import { ReactiveAgents } from "../src";

const TRACE_DIR = mkdtempSync(join(tmpdir(), "ra-trace-linkage-"));
const PRIOR_DIR = process.env.REACTIVE_AGENTS_TRACE_DIR;
const PRIOR_FLAG = process.env.REACTIVE_AGENTS_TRACE;
process.env.REACTIVE_AGENTS_TRACE_DIR = TRACE_DIR;
delete process.env.REACTIVE_AGENTS_TRACE; // ensure tracing is not env-disabled

afterAll(() => {
    if (PRIOR_DIR === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
    else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR_DIR;
    if (PRIOR_FLAG !== undefined) process.env.REACTIVE_AGENTS_TRACE = PRIOR_FLAG;
    rmSync(TRACE_DIR, { recursive: true, force: true });
});

describe("Result→trace linkage (W0.5)", () => {
    test("run() metadata carries runId + flushed, real tracePath when tracing recorded the run", async () => {
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "FINAL ANSWER: linkage ok" }])
            .withReasoning({ defaultStrategy: "reactive" })
            .withMaxIterations(2)
            .build();
        let result;
        try {
            result = await agent.run("prove trace linkage");
        } finally {
            await agent.dispose();
        }

        const runId = result.metadata.runId;
        const tracePath = result.metadata.tracePath;

        // (a) runId is a 26-char Crockford-base32 ULID (recorder.ts ULID_RUN_FILE shape)
        expect(runId).toBeDefined();
        expect(runId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

        // (b) tracePath is the real, absolute file, derived per recorder convention
        expect(tracePath).toBeDefined();
        expect(tracePath).toBe(join(TRACE_DIR, `${runId}.jsonl`));
        expect(existsSync(tracePath!)).toBe(true);

        // (c) diagnose-consumable via the loader the CLI stack itself uses:
        // loadTrace drops any line failing isTraceEvent, so surviving events
        // prove schema validity; runId is stamped from the first valid event;
        // run-started presence covers loadRecordedRun's hard requirement
        // (replay/src/load.ts:29-31). A file of valid-JSON-but-schema-invalid
        // lines would pass a hand-parse and fail here.
        const t = await loadTrace(tracePath!);
        expect(t.runId).toBe(runId);
        expect(t.events.length).toBeGreaterThan(0);
        expect(t.events.some((e) => e.kind === "run-started")).toBe(true);
        expect(t.events.every((e) => e.runId === runId)).toBe(true);
    });

    test("explicit test-provider run without tracing (REACTIVE_AGENTS_TRACE=off): fields honestly absent", async () => {
        process.env.REACTIVE_AGENTS_TRACE = "off";
        try {
            const agent = await ReactiveAgents.create()
                .withTestScenario([{ text: "FINAL ANSWER: no trace" }])
                .withReasoning({ defaultStrategy: "reactive" })
                .withMaxIterations(2)
                .build();
            let result;
            try {
                result = await agent.run("prove honest absence");
            } finally {
                await agent.dispose();
            }
            expect(result.metadata.runId).toBeUndefined();
            expect(result.metadata.tracePath).toBeUndefined();
        } finally {
            delete process.env.REACTIVE_AGENTS_TRACE;
        }
    });

    test("tracePath never points at a non-existent file", async () => {
        // Same run as the happy path, but asserting the wire-or-delete invariant:
        // whenever tracePath is present, the file exists at resolve time.
        const agent = await ReactiveAgents.create()
            .withTestScenario([{ text: "FINAL ANSWER: existence" }])
            .withReasoning({ defaultStrategy: "reactive" })
            .withMaxIterations(2)
            .build();
        let result;
        try {
            result = await agent.run("prove existence");
        } finally {
            await agent.dispose();
        }
        if (result.metadata.tracePath !== undefined) {
            expect(existsSync(result.metadata.tracePath)).toBe(true);
            expect(result.metadata.runId).toBeDefined();
        } else {
            // Honest absence must be total: no runId orphaned without a file.
            expect(result.metadata.runId).toBeUndefined();
        }
    });
});
