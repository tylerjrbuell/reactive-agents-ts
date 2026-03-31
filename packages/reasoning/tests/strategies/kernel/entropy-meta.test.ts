import { describe, test, expect } from "bun:test";
import { initialKernelState } from "../../../src/strategies/kernel/kernel-state.js";

describe("KernelRunOptions entropy fields", () => {
  test("initialKernelState stores taskDescription, modelId, temperature in meta.entropy", () => {
    const state = initialKernelState({
      maxIterations: 10,
      strategy: "reactive",
      kernelType: "react",
      taskDescription: "Find the capital of France",
      modelId: "cogito:14b",
      temperature: 0.3,
    });
    const entropy = state.meta.entropy as { taskDescription?: string; modelId?: string; temperature?: number } | undefined;
    expect(entropy?.taskDescription).toBe("Find the capital of France");
    expect(entropy?.modelId).toBe("cogito:14b");
    expect(entropy?.temperature).toBe(0.3);
  });

  test("entropy meta defaults to undefined when fields omitted", () => {
    const state = initialKernelState({
      maxIterations: 10,
      strategy: "reactive",
      kernelType: "react",
    });
    expect(state.meta.entropy).toBeUndefined();
  });
});
