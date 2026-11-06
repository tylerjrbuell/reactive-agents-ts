// Plan 9 Phase 4 stage 1 — pins for the kernel turn as an operation list
// (src/kernel/loop/turn-operations.ts). The order IS behavior: a pass runs the
// operations in KERNEL_TURN_OPERATIONS order, so a reorder must fail here, not
// slip through as a refactor. The ending set and the terminate() census are
// ratchets toward the Phase 4 exit target: the exit gate is the only operation
// that ends a run and the only caller of terminate().

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KERNEL_TURN_OPERATIONS,
  openTurnScope,
  runKernelTurn,
  type TurnOperation,
  type TurnOperationImpls,
  type TurnSignal,
} from "../../../src/kernel/loop/turn-operations.js";
import type { IterationCarrier, IterationConfig } from "../../../src/kernel/loop/iterate-pass.js";
import {
  initialKernelState,
  transitionState,
  type KernelContext,
  type KernelState,
} from "../../../src/kernel/state/kernel-state.js";
import { proposeGuardExit, proposeHarnessExit } from "../../../src/kernel/loop/exit-gate.js";
import { terminate } from "../../../src/kernel/loop/terminate.js";
import { passthroughOutputDeliverable } from "../../../src/kernel/loop/runner-helpers/deliverable.js";
import { sentinelDeliverable } from "@reactive-agents/core";

const KERNEL_DIR = fileURLToPath(new URL("../../../src/kernel/", import.meta.url));

describe("KERNEL_TURN_OPERATIONS — the pass order", () => {
  it("is exactly this order (a reorder is a behavior change)", () => {
    expect(KERNEL_TURN_OPERATIONS.map((op) => op.name)).toEqual([
      "run-control-checkpoint",
      "iteration-start",
      "assess-pass-start",
      "recall",
      "think",
      "grounding-redirect-trace",
      "low-delta-guard",
      "auto-checkpoint",
      "scratchpad-sync",
      "reactive-observer",
      "dispatcher-early-stop",
      "dispatcher-temperature",
      "dispatcher-strategy-switch",
      "iteration-progress",
      "repeated-failure-redirect",
      "execution-lane",
      "stall",
      "ics-nudge",
      "oracle-gate",
      "primary-tools-exit",
      "loop-detection",
      "required-tools-guard",
      "post-iteration-snapshot",
      "learn-write",
    ]);
  });

  it("writes every pass-local slot before an operation reads it", () => {
    const written = new Set<string>();
    for (const op of KERNEL_TURN_OPERATIONS) {
      for (const slot of op.reads) {
        if (slot.startsWith("pass.")) expect(`${op.name} reads ${slot}: ${written.has(slot)}`).toBe(`${op.name} reads ${slot}: true`);
      }
      for (const slot of op.writes) written.add(slot);
    }
  });

  it("only these operations may propose an exit (and return the exit gate's disposition)", () => {
    expect(KERNEL_TURN_OPERATIONS.filter((op) => op.proposesExit).map((op) => op.name)).toEqual([
      "run-control-checkpoint",
      "assess-pass-start",
      "think",
      "low-delta-guard",
      "dispatcher-early-stop",
      "dispatcher-strategy-switch",
      "repeated-failure-redirect",
      "stall",
      "oracle-gate",
      "loop-detection",
      "required-tools-guard",
    ]);
  });
});

describe("runKernelTurn", () => {
  const carrier = (): IterationCarrier => ({
    state: initialKernelState({ maxIterations: 5, strategy: "reactive", kernelType: "react" }),
    currentInput: { task: "t" },
    currentOptions: { maxIterations: 5, strategy: "reactive" },
    currentContext: {} as KernelContext,
    prevActionCount: 0, prevStepCount: 0, prevStepCountForLearn: 0, prevDecisionLogCountForLearn: 0,
    prevArtifactCount: 0, consecutiveStalled: 0, requiredToolRedirects: 0, requiredToolNudgeCount: 0,
    failureRecoveryRedirects: 0, switchCount: 0, triedStrategies: [], autoCheckpointed: false,
    mutableScratchpad: new Map(),
  });
  const recordingOps = (calls: string[], stopAt?: { name: string; signal: TurnSignal }): TurnOperationImpls => {
    const ops: Record<string, TurnOperation> = {};
    for (const { name } of KERNEL_TURN_OPERATIONS) {
      ops[name] = () => {
        calls.push(name);
        return Effect.succeed(stopAt?.name === name ? stopAt.signal : "next");
      };
    }
    return ops as TurnOperationImpls;
  };
  const cfg = {} as IterationConfig;

  it("runs every operation in list order and falls through to continue", async () => {
    const calls: string[] = [];
    const signal = await Effect.runPromise(runKernelTurn(openTurnScope(carrier()), cfg, recordingOps(calls)));
    expect(signal).toBe("continue");
    expect(calls).toEqual(KERNEL_TURN_OPERATIONS.map((op) => op.name));
  });

  it("stops at the first operation that ends the pass and returns its signal", async () => {
    const calls: string[] = [];
    const signal = await Effect.runPromise(
      runKernelTurn(openTurnScope(carrier()), cfg, recordingOps(calls, { name: "stall", signal: "continue" })),
    );
    expect(signal).toBe("continue");
    expect(calls.at(-1)).toBe("stall");
    expect(calls).not.toContain("ics-nudge");
  });
});

describe("the run ends only through the exit gate (ending set: exit-gate)", () => {
  const runOptions = { maxIterations: 5, strategy: "reactive", kernelType: "react" } as const;
  const scopeOf = (state = initialKernelState(runOptions)) =>
    openTurnScope({
      state,
      currentInput: { task: "t" },
      currentOptions: { maxIterations: 5, strategy: "reactive" },
      currentContext: {} as KernelContext,
      prevActionCount: 0, prevStepCount: 0, prevStepCountForLearn: 0, prevDecisionLogCountForLearn: 0,
      prevArtifactCount: 0, consecutiveStalled: 0, requiredToolRedirects: 0, requiredToolNudgeCount: 0,
      failureRecoveryRedirects: 0, switchCount: 0, triedStrategies: [], autoCheckpointed: false,
      mutableScratchpad: new Map(),
    });
  const opsEndingAt = (calls: string[], name: string, end: () => Effect.Effect<TurnSignal>): TurnOperationImpls => {
    const ops: Record<string, TurnOperation> = {};
    for (const op of KERNEL_TURN_OPERATIONS) {
      ops[op.name] = () => {
        calls.push(op.name);
        return op.name === name ? end() : Effect.succeed("next");
      };
    }
    return ops as TurnOperationImpls;
  };
  const accepted = (state: KernelState) =>
    proposeHarnessExit(state, {
      proposedBy: "harness",
      end: { via: "terminate", options: { reason: "stop_requested", deliverable: passthroughOutputDeliverable(null) } },
    });

  it("an accepted disposition breaks the loop and its state becomes the pass state", async () => {
    const calls: string[] = [];
    const t = scopeOf();
    let gated: KernelState | undefined;
    const signal = await Effect.runPromise(
      runKernelTurn(t, {} as IterationConfig, opsEndingAt(calls, "stall", () => {
        const d = accepted(t.state);
        gated = d.state;
        return Effect.succeed(d);
      })),
    );
    expect(signal).toBe("break");
    expect(t.state).toBe(gated!);
    expect(t.state.status).toBe("done");
    expect(t.state.meta.terminatedBy).toBe("stop_requested");
    expect(calls).not.toContain("ics-nudge");
  });

  it("a denied disposition keeps the run going (continue), with the gate's guidance state", async () => {
    const calls: string[] = [];
    const t = scopeOf();
    const signal = await Effect.runPromise(
      runKernelTurn(t, {} as IterationConfig, opsEndingAt(calls, "low-delta-guard", () =>
        proposeGuardExit(t.state, "low_delta_guard", "low_delta_guard", sentinelDeliverable("no_substantive_output", "none"),
          { task: "t" }, { maxIterations: 5, strategy: "reactive" }),
      )),
    );
    expect(signal).toBe("continue");
    expect(t.state.status).toBe("thinking");
    expect(t.state.steps.at(-1)?.metadata?.exitGate?.gateDecision).toBe("deny-once");
  });

  // Source pin: no operation writes "break"; the runner's gate mapping is the one place.
  const TURN_SOURCES = ["loop/turn-operations.ts", "loop/turn-guard-operations.ts"];
  it("the only \"break\" in the turn operations is the runner's exit-gate disposition mapping", () => {
    const hits = TURN_SOURCES.flatMap((rel) =>
      readFileSync(join(KERNEL_DIR, rel), "utf8")
        .split("\n")
        .filter((l) => l.includes('"break"') && !isCommentLine(l))
        .map((l) => `${rel}: ${l.trim()}`),
    );
    expect(hits).toEqual([
      'loop/turn-operations.ts: return isExitDenial(signal.decision) ? "continue" : "break";',
    ]);
  });
});

describe("proposeHarnessExit — the harness-authority rule accepts exactly as the sites ended runs before", () => {
  const options = { maxIterations: 5, strategy: "reactive", kernelType: "react" } as const;
  const withOutput = () => transitionState(initialKernelState(options), { output: "partial answer" });

  it("terminate: the same state terminate() produces", () => {
    const s = withOutput();
    const opts = { reason: "abstained" as const, deliverable: sentinelDeliverable("no_substantive_output", "why") };
    const d = proposeHarnessExit(s, { proposedBy: "harness", end: { via: "terminate", options: opts } });
    expect(d.decision).toBe("accept");
    expect(d.state).toEqual(terminate(s, opts));
  });

  it("fail: status failed with the error, output nulled, terminatedBy untouched", () => {
    const d = proposeHarnessExit(withOutput(), { proposedBy: "harness", end: { via: "fail", error: "quota" } });
    expect(d.decision).toBe("accept");
    expect(d.state.status).toBe("failed");
    expect(d.state.error).toBe("quota");
    expect(d.state.output).toBeNull();
    expect(d.state.meta.terminatedBy).toBeUndefined();
  });

  it("killswitch: done keeps the output under the hook's own terminatedBy; failed nulls it", () => {
    const done = proposeHarnessExit(withOutput(), {
      proposedBy: "harness", end: { via: "killswitch", terminatedBy: "killswitch:stop", aborted: false },
    });
    expect(done.state.status).toBe("done");
    expect(done.state.output).toBe("partial answer");
    expect(done.state.meta.terminatedBy).toBe("killswitch:stop");
    const failed = proposeHarnessExit(withOutput(), {
      proposedBy: "harness", end: { via: "killswitch", terminatedBy: "budget", aborted: true },
    });
    expect(failed.state.status).toBe("failed");
    expect(failed.state.output).toBeNull();
    expect(failed.state.meta.terminatedBy).toBe("budget");
  });
});

// A real terminate() call: not a method, not a comment line, not the definition.
const TERMINATE_CALL = /(?<![.\w])terminate\(/;
const isCommentLine = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);

function terminateCallCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  const files = readdirSync(KERNEL_DIR, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const rel of files) {
    const n = readFileSync(join(KERNEL_DIR, rel), "utf8")
      .split("\n")
      .filter((l) => TERMINATE_CALL.test(l) && !isCommentLine(l) && !l.includes("export function terminate("))
      .length;
    if (n > 0) counts[rel.split("\\").join("/")] = n;
  }
  return counts;
}

describe("terminate() ownership (Phase 4 exit: in the turn path only the exit gate calls terminate())", () => {
  // Ceilings, not targets: a count may drop (then lower it here), never grow,
  // and a file not listed may not start calling terminate(). New run-ending
  // behavior goes through the exit gate (proposeGuardExit / proposeHarnessExit /
  // proposeCapExit). The rest below is the kernel step (think/act) and post-loop.
  const CEILINGS: Record<string, number> = {
    "loop/exit-gate.ts": 3, // the owner: guard accept, handoff, harness-authority accept
    "loop/runner-post-loop-deliverable.ts": 1,
    "loop/runner.ts": 2,
    "capabilities/act/act.ts": 2,
    "capabilities/reason/dispatch-think-response.ts": 1,
    "capabilities/reason/unresolved-tool-call.ts": 1,
  };

  // The turn operations and every helper they delegate a run-ending decision to.
  const TURN_PATH = [
    "loop/turn-operations.ts",
    "loop/turn-guard-operations.ts",
    "loop/iterate-pass.ts",
    "loop/iterate-run-ctl-checkpoint.ts",
    "loop/iterate-before-think-seam.ts",
    "loop/iterate-assessment-seam.ts",
    "loop/iterate-early-stop-seam.ts",
    "loop/iterate-control-plane-seams.ts",
    "loop/runner-helpers/pace-terminal.ts",
    "loop/runner-helpers/stall-deliverable.ts",
    "loop/runner-helpers/loop-resolution.ts",
  ];

  it("no turn operation or turn helper calls terminate() — they propose to the exit gate", () => {
    for (const f of TURN_PATH) expect(`${f}: ${existsSync(join(KERNEL_DIR, f))}`).toBe(`${f}: true`);
    const counts = terminateCallCounts();
    expect(TURN_PATH.filter((f) => counts[f] !== undefined).map((f) => `${f}: ${counts[f]}`)).toEqual([]);
  });

  it("no kernel file exceeds its terminate() ceiling and no new caller appears", () => {
    const over = Object.entries(terminateCallCounts())
      .filter(([file, n]) => n > (CEILINGS[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} > ${CEILINGS[file] ?? 0}`);
    expect(over).toEqual([]);
  });
});
