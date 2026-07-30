import { describe, it, expect } from "bun:test";
import type { TaskContract } from "@reactive-agents/core";
import { mergeContractRequiredTools } from "../builder/contract-tool-set.js";
import { ReactiveAgents } from "../builder.js";
import { asBuilderState } from "./_helpers.js";

/**
 * Realization-plan P2b (execute-time complement to P2's build-time validation).
 *
 * A `.withContract({ tools: [{ kind: "required", name: Y }] })` agent must have
 * Y reach `KernelInput.requiredTools` at execute-time so the kernel's existing
 * required-tools success gate enforces it. The runtime feeds KernelInput via
 * `config.requiredTools.tools` → classifier.ts:73-74 `effectiveRequiredTools`
 * → pre-loop-dispatch.ts:149 `requiredTools` → ReasoningExecuteRequest →
 * KernelInput.requiredTools.
 *
 * `mergeContractRequiredTools` is the pure derivation helper that unions the
 * contract's `kind === "required"` names into the existing requiredTools config
 * at build (runtime-construction.ts). Tests pin the union semantics; reaching
 * `effectiveRequiredTools` is then guaranteed by the classifier's existing read
 * of `config.requiredTools?.tools`.
 *
 * NOTE — forbidden tools are NOT covered here. The contract's forbidden tools
 * cannot reach `KernelInput.blockedTools` from the runtime: `blockedTools` is
 * not a field on `ReasoningExecuteRequest` nor mapped from request → KernelInput
 * in any non-reflexion strategy (reactive.ts:175 omits it). Closing that hole
 * requires a packages/reasoning edit (out of runtime-warden authority). See the
 * UpwardReport for the blocker.
 */

const successOracle = { type: "regex" as const, pattern: "ok" };

describe("mergeContractRequiredTools — required names reach requiredTools config", () => {
  it("populates requiredTools.tools from a contract's required names when no prior config", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [{ kind: "required", name: "file-read" }],
      success: successOracle,
    };
    const merged = mergeContractRequiredTools(undefined, contract);
    expect(merged?.tools).toContain("file-read");
  });

  it("unions contract-required names with an existing static requiredTools list", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [{ kind: "required", name: "web-search" }],
      success: successOracle,
    };
    const merged = mergeContractRequiredTools(
      { tools: ["file-read"], maxRetries: 2 },
      contract,
    );
    expect(merged?.tools).toEqual(
      expect.arrayContaining(["file-read", "web-search"]),
    );
    // preserves other config fields
    expect(merged?.maxRetries).toBe(2);
  });

  it("dedupes when the contract names a tool already in the static list", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [{ kind: "required", name: "file-read" }],
      success: successOracle,
    };
    const merged = mergeContractRequiredTools(
      { tools: ["file-read"] },
      contract,
    );
    expect(merged?.tools?.filter((t) => t === "file-read")).toHaveLength(1);
  });

  it("ignores available/forbidden kinds (only required tools become required)", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [
        { kind: "required", name: "file-read" },
        { kind: "available", name: "find" },
        { kind: "forbidden", name: "shell-execute" },
      ],
      success: successOracle,
    };
    const merged = mergeContractRequiredTools(undefined, contract);
    expect(merged?.tools).toContain("file-read");
    expect(merged?.tools).not.toContain("find");
    expect(merged?.tools).not.toContain("shell-execute");
  });

  it("returns the existing config unchanged when contract has no required tools", () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [{ kind: "available", name: "find" }],
      success: successOracle,
    };
    const prior = { adaptive: true as const };
    const merged = mergeContractRequiredTools(prior, contract);
    expect(merged).toEqual(prior);
  });

  it("returns undefined when no contract and no prior config — does NOT invent an adaptive default", () => {
    // Regression pin for 2026-07-29: this seam used to default to
    // `{ adaptive: true }` whenever reasoning+tools were enabled, silently
    // re-enabling the opt-in tool-relevance classifier (classifier.ts:82-116)
    // for every caller that never called `.withRequiredTools()`.
    const merged = mergeContractRequiredTools(undefined, undefined);
    expect(merged).toBeUndefined();
  });

  it("returns the prior config unchanged when no contract, even if it opted into adaptive", () => {
    const prior = { adaptive: true as const };
    const merged = mergeContractRequiredTools(prior, undefined);
    expect(merged).toEqual(prior);
  });
});

describe("withContract — required tools bind to the construction-read state", () => {
  it(".withContract({required}) stores _taskContract on the SAME view runtime-construction.ts reads", () => {
    // `runtime-construction.ts` reads builder state via
    // `self as unknown as BuilderRuntimeStateView` and passes `_taskContract`
    // (+ `_requiredToolsConfig`) into `mergeContractRequiredTools` at the
    // `requiredTools:` config-assembly site.
    // `asBuilderState` widens to a SUPERSET of that view, so a passing assertion
    // here proves the helper receives this contract at run time. The helper's
    // union semantics are pinned by the unit suite above; classifier.ts:73-74
    // then reads `config.requiredTools.tools` into `effectiveRequiredTools`,
    // which pre-loop-dispatch.ts:149 forwards as ReasoningExecuteRequest
    // `requiredTools` → KernelInput.requiredTools. (Population through the live
    // classifier is verified by inspection; an end-to-end run-level assertion
    // would couple this runtime test to kernel-gate internals — see the
    // budget-test precedent at builder-with-budget.test.ts for the same seam
    // boundary.)
    const contract: TaskContract = {
      prompt: "do the thing",
      tools: [{ kind: "required", name: "file-read" }],
      success: successOracle,
    };
    const builder = ReactiveAgents.create()
      .withProvider("test")
      .withReasoning()
      .withTools({ builtins: ["file-read"] })
      .withContract(contract);
    const state = asBuilderState(builder);
    expect(state._taskContract).toBeDefined();
    expect(state._taskContract?.tools).toEqual(contract.tools);

    // Spot-prove the exact derivation the construction site performs on this
    // state lands file-read in the requiredTools config the classifier reads.
    const resolved = mergeContractRequiredTools(
      state._requiredToolsConfig,
      state._taskContract,
    );
    expect(resolved?.tools).toContain("file-read");
  });
});
