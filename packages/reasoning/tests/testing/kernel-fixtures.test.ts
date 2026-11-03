// Run: bun test packages/reasoning/tests/testing/kernel-fixtures.test.ts --timeout 15000
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect, Option } from "effect";
import {
  FIXTURE_TASK,
  makeKernelContext,
  makeKernelHooks,
  makeKernelInput,
  makeKernelRunOptions,
  makeKernelState,
} from "../../src/testing/index.js";
import type {
  KernelContext,
  KernelHooks,
  KernelInput,
  KernelRunOptions,
  KernelState,
} from "../../src/kernel/state/kernel-state.js";

describe("kernel fixture builders", () => {
  test("defaults type-check as the target types", () => {
    // Compile-time assertions: each builder's no-override result satisfies its type.
    const input = makeKernelInput() satisfies KernelInput;
    const options = makeKernelRunOptions() satisfies KernelRunOptions;
    const state = makeKernelState() satisfies KernelState;
    const hooks = makeKernelHooks() satisfies KernelHooks;
    const context = makeKernelContext() satisfies KernelContext;

    expect(input.task).toBe(FIXTURE_TASK);
    expect(options).toEqual({ maxIterations: 10, strategy: "reactive", kernelType: "react" });
    expect(state.status).toBe("thinking");
    expect(state.steps).toEqual([]);
    expect(state.toolsUsed.size).toBe(0);
    expect(state.meta.maxIterations).toBe(10);
    expect(Option.isNone(context.toolService)).toBe(true);
    expect(Option.isNone(context.memoryService)).toBe(true);
    expect(context.toolCallingDriver.mode).toBe("native-fc");
    expect(context.profile.tier).toBe("mid");
    expect(Effect.runSync(hooks.onDone(state))).toBeUndefined();
  });

  test("overrides win", () => {
    expect(makeKernelInput({ task: "t", requiredTools: ["web-search"] })).toEqual({
      task: "t",
      requiredTools: ["web-search"],
    });
    expect(makeKernelRunOptions({ strategy: "react" }).strategy).toBe("react");
    const state = makeKernelState({ iteration: 4, output: "done" });
    expect(state.iteration).toBe(4);
    expect(state.output).toBe("done");

    let switched = "";
    const hooks = makeKernelHooks({
      onStrategySwitched: (_s, from, to) => Effect.sync(() => { switched = `${from}->${to}`; }),
    });
    Effect.runSync(hooks.onStrategySwitched(state, "a", "b", "why"));
    expect(switched).toBe("a->b");

    const input = makeKernelInput({ task: "ctx" });
    expect(makeKernelContext({ input }).input).toBe(input);
  });

  test("each call returns a fresh state (no shared mutable sets)", () => {
    expect(makeKernelState().toolsUsed).not.toBe(makeKernelState().toolsUsed);
  });

  test("builder sources contain zero double casts", () => {
    const dir = resolve(import.meta.dir, "../../src/testing");
    const needle = ["as", "unknown", "as"].join(" ");
    for (const file of ["kernel-fixtures.ts", "index.ts"]) {
      const src = readFileSync(join(dir, file), "utf-8");
      expect({ file, hits: src.split(needle).length - 1 }).toEqual({ file, hits: 0 });
    }
    expect(readdirSync(dir)).toContain("kernel-fixtures.ts");
  });
});
