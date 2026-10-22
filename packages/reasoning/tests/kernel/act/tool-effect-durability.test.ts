// Run: bun test packages/reasoning/tests/kernel/act/tool-effect-durability.test.ts --timeout 15000
//
// Durable tool-effect seam (GH #262) — kernel act phase. Verifies the ONE
// dispatch choke point (`executeToolAndObserve`, which the single-call AND
// parallel-batch paths share):
//   1. Every side-effecting dispatch records a pre-executing `onToolEffectStart`
//      spec (framework-minted fx-<taskId>-<iteration>-<index>, canonical args)
//      that is AWAITED before the tool runs, then an `onToolEffectEnd` outcome
//      after the result is known.
//   2. A recovered "succeeded" ToolEffectRecord means the effect ALREADY
//      happened: the tool function is NOT invoked, the observation is injected
//      from record.resultContent, the step keeps the LIVE toolCallId, and the
//      step metadata carries `recoveredEffect` for the receipt.
//   3. Observer failures (throwing/rejecting controllers) never kill dispatch.
import { describe, it, expect } from "bun:test";
import { Effect, Option } from "effect";
import type { RunControllerLike, ToolEffectSpec, ToolEffectOutcome } from "@reactive-agents/core";
import {
  RecoveredToolEffectsRef,
  RunControllerRef,
  canonicalToolArgsJson,
  toolEffectIdentityKey,
} from "@reactive-agents/core";
import type { KernelStateLike } from "@reactive-agents/core";
import { executeToolAndObserve, executeToolAndObserveBatch } from "../../../src/kernel/capabilities/act/tool-observe.js";
import { mintToolEffectId } from "../../../src/kernel/capabilities/act/act.js";
import type { ToolServiceInstance } from "../../../src/kernel/state/kernel-state.js";

const syntheticState: KernelStateLike = {
  taskId: "test-task",
  strategy: "react",
  kernelType: "react",
  steps: [],
  toolsUsed: new Set<string>(),
  iteration: 0,
  tokens: 0,
  status: "acting",
  output: null,
  error: null,
  meta: {},
};

interface EffectLog {
  readonly starts: ToolEffectSpec[];
  readonly ends: { readonly spec: ToolEffectSpec; readonly outcome: ToolEffectOutcome }[];
}

/** Fake durable controller: records every awaited observer call. */
function recordingController(log: EffectLog): RunControllerLike {
  return {
    checkpoint: () => Promise.resolve(undefined),
    onToolEffectStart: (spec) => {
      log.starts.push(spec);
      return Promise.resolve();
    },
    onToolEffectEnd: (spec, outcome) => {
      log.ends.push({ spec, outcome });
      return Promise.resolve();
    },
  };
}

/** Controller whose observers always reject — dispatch must survive. */
function failingController(): RunControllerLike {
  return {
    checkpoint: () => Promise.resolve(undefined),
    onToolEffectStart: () => Promise.reject(new Error("start observer crashed")),
    onToolEffectEnd: () => Promise.reject(new Error("end observer crashed")),
  };
}

/** ToolService stub that appends every actual execution to a log. */
function stubToolServiceWithLog(log: string[]): Option.Option<ToolServiceInstance> {
  return Option.some({
    execute: (req) => {
      log.push(`exec:${req.toolName}`);
      return req.toolName === "boom"
        ? Effect.fail(new Error("kaboom"))
        : Effect.succeed({ success: true, result: { ok: true } });
    },
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
}

const observationMetadata = (
  step: { readonly metadata?: unknown },
): Record<string, unknown> | undefined =>
  step.metadata as Record<string, unknown> | undefined;

describe("durable tool-effect recording (GH #262, act phase)", () => {
  describe("pre-dispatch + post-outcome observers", () => {
    it("records a single dispatch: awaited start spec with the minted effect id + canonical args before execution, then the end outcome", async () => {
      const log: EffectLog = { starts: [], ends: [] };
      const executionLog: string[] = [];
      // { b:2, a:1 } proves args reach the record CANONICAL (key-sorted).
      const program = executeToolAndObserve(
        stubToolServiceWithLog(executionLog),
        { toolName: "file-write", args: { b: 2, a: 1 } },
        {
          iteration: 7,
          phase: "act",
          strategy: "react",
          state: syntheticState,
          callId: "call_a",
          effectId: mintToolEffectId("task-42", 7, 0),
        },
        { extractFactsLLM: false },
      ).pipe(Effect.locally(// Runtime-warden owns the real wiring; the controller rides the ambient FiberRef.
        RunControllerRef,
        recordingController(log),
      ));

      const result = await Effect.runPromise(program);

      // Exactly one start, awaited BEFORE the tool body ran.
      const start = log.starts[0];
      expect(start?.effectId).toBe("fx-task-42-7-0");
      expect(start?.toolName).toBe("file-write");
      expect(start?.toolCallId).toBe("call_a");
      expect(start?.iteration).toBe(7);
      expect(start?.argsJson).toBe(canonicalToolArgsJson({ b: 2, a: 1 }));
      expect(log.starts.length).toBe(1);

      // End record arrives after the outcome is known, with the right status.
      const end = log.ends[0];
      expect(end?.spec.effectId).toBe("fx-task-42-7-0");
      expect(end?.outcome.status).toBe("succeeded");
      expect(end?.outcome.resultContent).toBeTruthy();
      expect(result.success).toBe(true);
    });

    it("two dispatch calls record two waited start specs then two end records with per-call statuses", async () => {
      const log: EffectLog = { starts: [], ends: [] };
      const executionLog: string[] = [];
      const results = await Effect.runPromise(
        executeToolAndObserveBatch(
          stubToolServiceWithLog(executionLog),
          [
            {
              toolName: "file-write",
              args: { path: "a.txt", content: "x" },
              callId: "call_1",
              effectId: mintToolEffectId("task-42", 7, 1),
            },
            { toolName: "boom", args: { k: "v" }, callId: "call_2", effectId: mintToolEffectId("task-42", 7, 4) },
          ],
          { iteration: 7, phase: "act", strategy: "react", state: syntheticState },
          { extractFactsLLM: false },
          2,
        ).pipe(Effect.locally(RunControllerRef, recordingController(log))),
      );

      expect(results.length).toBe(2);
      // Both members recorded — ids carry the caller's dispatch index.
      const startIds = log.starts.map((s) => s.effectId).sort();
      expect(startIds).toEqual(["fx-task-42-7-1", "fx-task-42-7-4"]);
      expect(log.starts.length).toBe(2);

      const endByEffectId = new Map(log.ends.map((e) => [e.spec.effectId, e.outcome]));
      expect(endByEffectId.get("fx-task-42-7-1")?.status).toBe("succeeded");
      expect(endByEffectId.get("fx-task-42-7-4")?.status).toBe("failed");
      // Both tools actually ran — boom's failure was a TOOL outcome, not a skipped dispatch.
      expect(executionLog.sort()).toEqual(["exec:boom", "exec:file-write"]);
    });

    it("no observer + no effectId: dispatch is byte-identical (absent-observer zero cost)", async () => {
      const executionLog: string[] = [];
      const result = await Effect.runPromise(
        executeToolAndObserve(
          stubToolServiceWithLog(executionLog),
          { toolName: "web-search", args: { query: "x" } },
          { iteration: 1, phase: "act", strategy: "react", state: syntheticState, callId: "c1" },
          { extractFactsLLM: false },
        ),
      );
      expect(result.success).toBe(true);
      expect(executionLog).toEqual(["exec:web-search"]);
    });
  });

  describe("recovery consult (crash-resume injection)", () => {
    const recoveredRecord = (overrides?: Record<string, unknown>) => ({
      toolName: "delete-records",
      toolCallId: "call_orig",
      iteration: 3,
      argsJson: canonicalToolArgsJson({ confirm: true }),
      status: "succeeded" as const,
      resultContent: "deleted 3 records",
      effectId: "fx-task-42-3-0",
    });

    it("injected from record.resultContent WITHOUT re-executing; live toolCallId kept; metadata.recoveredEffect present", async () => {
      const log: EffectLog = { starts: [], ends: [] };
      const executionLog: string[] = [];
      const seeded = new Map([
        [toolEffectIdentityKey("delete-records", canonicalToolArgsJson({ confirm: true })), recoveredRecord()],
      ]);
      const program = executeToolAndObserve(
        stubToolServiceWithLog(executionLog),
        { toolName: "delete-records", args: { confirm: true } },
        {
          iteration: 3,
          phase: "act",
          strategy: "react",
          state: syntheticState,
          callId: "call_live",
          effectId: "fx-task-42-3-0",
        },
        { extractFactsLLM: false },
      ).pipe(
        Effect.locally(RunControllerRef, recordingController(log)),
        Effect.locally(RecoveredToolEffectsRef, seeded),
      );
      const result = await Effect.runPromise(program);

      // Effect already happened — the tool must NOT run again.
      expect(executionLog).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.content).toBe("deleted 3 records");
      // Ledger bookkeeping uses the ORIGINAL sql toolCallId from this dispatch.
      expect(result.obsStep.metadata?.toolCallId).toBe("call_live");
      const meta = observationMetadata(result.obsStep);
      expect((meta?.recoveredEffect as Record<string, unknown>)?.effectId).toBe("fx-task-42-3-0");
      expect((meta?.recoveredEffect as Record<string, unknown>)?.toolCallId).toBe("call_orig");
      // No live dispatch happened — no start/end records either.
      expect(log.starts).toEqual([]);
      expect(log.ends).toEqual([]);
    });

    it("an ambiguous (executing-status) record does NOT inject: the call replays and records normally", async () => {
      const log: EffectLog = { starts: [], ends: [] };
      const executionLog: string[] = [];
      const seeded = new Map([
        [
          toolEffectIdentityKey("delete-records", canonicalToolArgsJson({ confirm: true })),
          { ...recoveredRecord(), status: "executing" as const, resultContent: undefined },
        ],
      ]);
      const program = executeToolAndObserve(
        stubToolServiceWithLog(executionLog),
        { toolName: "delete-records", args: { confirm: true } },
        {
          iteration: 3,
          phase: "act",
          strategy: "react",
          state: syntheticState,
          callId: "call_live",
          effectId: "fx-task-42-3-0",
        },
        { extractFactsLLM: false },
      ).pipe(
        Effect.locally(RunControllerRef, recordingController(log)),
        Effect.locally(RecoveredToolEffectsRef, seeded),
      );
      const result = await Effect.runPromise(program);
      expect(executionLog).toEqual(["exec:delete-records"]);
      expect(result.success).toBe(true);
      expect(log.starts.length).toBe(1);
      expect(log.ends[0]?.outcome.status).toBe("succeeded");
    });

    it("mismatched identity (different args) does not inject", async () => {
      const log: EffectLog = { starts: [], ends: [] };
      const executionLog: string[] = [];
      const seeded = new Map([
        [toolEffectIdentityKey("delete-records", canonicalToolArgsJson({ confirm: false })), recoveredRecord()],
      ]);
      const program = executeToolAndObserve(
        stubToolServiceWithLog(executionLog),
        { toolName: "delete-records", args: { confirm: true } },
        {
          iteration: 3,
          phase: "act",
          strategy: "react",
          state: syntheticState,
          callId: "call_live",
          effectId: "fx-task-42-3-0",
        },
        { extractFactsLLM: false },
      ).pipe(
        Effect.locally(RunControllerRef, recordingController(log)),
        Effect.locally(RecoveredToolEffectsRef, seeded),
      );
      await Effect.runPromise(program);
      expect(executionLog).toEqual(["exec:delete-records"]);
    });
  });

  describe("observer isolation", () => {
    it("a rejecting controller never kills dispatch (warn-surfaced)", async () => {
      const executionLog: string[] = [];
      const program = executeToolAndObserve(
        stubToolServiceWithLog(executionLog),
        { toolName: "file-write", args: { path: "a.txt" } },
        {
          iteration: 1,
          phase: "act",
          strategy: "react",
          state: syntheticState,
          callId: "call_ok",
          effectId: "fx-task-42-1-0",
        },
        { extractFactsLLM: false },
      ).pipe(Effect.locally(RunControllerRef, failingController()));
      const result = await Effect.runPromise(program) as { success?: boolean; content?: string };
      expect(executionLog).toEqual(["exec:file-write"]);
      expect(result.success).toBe(true);
    });
  });

  describe("effect id minting", () => {
    it("mints fx-<taskId>-<iteration>-<index>", () => {
      expect(mintToolEffectId("task-1", 4, 2)).toBe("fx-task-1-4-2");
      expect(mintToolEffectId("run", 0, 0)).toBe("fx-run-0-0");
    });
  });
});
