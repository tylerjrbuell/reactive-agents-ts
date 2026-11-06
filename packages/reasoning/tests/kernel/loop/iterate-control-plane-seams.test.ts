// #281 — direct-import behavioral pins for iterate-control-plane-seams.ts
// (extracted verbatim from iterate-pass.ts, #222). Each seam resolves its own
// proposal against the in-loop abstain signal through the single-decider
// resolver; the ONLY control-flow deviation from the inline code is the
// returned `exit`: when abstain wins, the honest decline is a harness-authority
// proposal the exit gate accepts (Plan 9 Phase 4), and the turn runner ends the
// pass on that disposition. These pins fix that adapter: abstain wins => an
// accepted exit whose state is the terminate()d "abstained" state; otherwise
// exit is null and the state passes through untouched.

import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  resolveF3ControlPlane,
  resolveStallControlPlane,
  resolveSwitchControlPlane,
} from "../../../src/kernel/loop/iterate-control-plane-seams.js";
import {
  initialKernelState,
  type KernelInput,
  type KernelRunOptions,
} from "../../../src/kernel/state/kernel-state.js";

const options: KernelRunOptions = { maxIterations: 5, strategy: "reactive", kernelType: "react" };
const baseState = () => initialKernelState(options);

// A required tool that no registered schema provides, on iteration 0 =>
// requiredToolUnavailable => the in-loop forced-abstention qualifies.
const unsatisfiableInput: KernelInput = {
  task: "use the missing tool",
  requiredTools: ["missing-tool"],
  availableToolSchemas: [{ name: "other-tool", description: "d", parameters: [] }],
};
const satisfiableInput: KernelInput = { task: "just answer" };

const common = (input: KernelInput, requiredTools: readonly string[]) => ({
  state: baseState(),
  currentInput: input,
  requiredTools,
  currentOptions: options,
  horizon: undefined,
});

const lane = { lane: "gather" as const, missingRequiredTools: [] as readonly string[], canFinalize: false };

describe("resolveSwitchControlPlane (F1 / P5)", () => {
  it("abstain outranks the strategy switch: returns the gate's accepted exit + a terminated 'abstained' state", async () => {
    const out = await Effect.runPromise(
      resolveSwitchControlPlane(common(unsatisfiableInput, ["missing-tool"])),
    );
    expect(out.exit?.decision).toBe("accept");
    expect(out.exit?.state).toBe(out.state);
    expect(out.state.status).toBe("done");
    expect(out.state.meta.terminatedBy).toBe("abstained");
    expect(out.state.meta.abstention).toBeDefined();
  });

  it("passes the state through untouched when nothing qualifies to abstain", async () => {
    const args = common(satisfiableInput, []);
    const out = await Effect.runPromise(resolveSwitchControlPlane(args));
    expect(out.exit).toBeNull();
    expect(out.state).toBe(args.state);
  });
});

describe("resolveStallControlPlane", () => {
  it("abstain outranks the stall steer", async () => {
    const out = await Effect.runPromise(
      resolveStallControlPlane({ ...common(unsatisfiableInput, ["missing-tool"]), laneDecision: lane }),
    );
    expect(out.exit?.decision).toBe("accept");
    expect(out.exit?.state).toBe(out.state);
    expect(out.state.meta.terminatedBy).toBe("abstained");
  });

  it("does not abstain a satisfiable run", async () => {
    const args = { ...common(satisfiableInput, []), laneDecision: lane };
    const out = await Effect.runPromise(resolveStallControlPlane(args));
    expect(out.exit).toBeNull();
    expect(out.state).toBe(args.state);
  });
});

describe("resolveF3ControlPlane", () => {
  const f3 = (input: KernelInput, requiredTools: readonly string[]) => ({
    ...common(input, requiredTools),
    repeated: { toolName: "web-search", errorClass: "timeout" as const, count: 3 },
    repeatedRecovery: { failedUnresolved: ["web-search"] },
    guidance: "stop retrying web-search",
  });

  it("abstain outranks the repeated-failure redirect", async () => {
    const out = await Effect.runPromise(resolveF3ControlPlane(f3(unsatisfiableInput, ["missing-tool"])));
    expect(out.exit?.decision).toBe("accept");
    expect(out.exit?.state).toBe(out.state);
    expect(out.state.meta.terminatedBy).toBe("abstained");
  });

  it("lets the redirect stand (no abstain) for a satisfiable run", async () => {
    const out = await Effect.runPromise(resolveF3ControlPlane(f3(satisfiableInput, [])));
    expect(out.exit).toBeNull();
  });
});
