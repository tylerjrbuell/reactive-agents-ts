import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../builder.js";

describe("withReasoning({ maxIterations }) wiring", () => {
  it("caps reactive kernel at 1 iteration when maxIterations: 1", async () => {
    // W4: withReasoning({ maxIterations: 1 }) must propagate into
    // reasoningConfig.strategies.reactive.maxIterations. The token-delta guard
    // fires at iteration 3, so maxIterations: 1 is the only value reliably
    // below the guard threshold. With the bug, the kernel defaults to 10
    // iterations and the stepsCount would be 3 (guard fires first).
    //
    // Uses the default test scenario ([{ text: "" }]) — empty responses avoid
    // the fast-path exit (length ≤ 20), so only maxIterations controls termination.
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
      .build();

    const result = await agent.run("Think deeply about an extremely complex problem.");
    await agent.dispose();

    // maxIterations: 1 → exactly 1 think step before loop exits
    expect(result.metadata.stepsCount).toBe(1);
  });

  it("produces more steps when maxIterations is not constrained to 1", async () => {
    // Confirms the default (10) runs more iterations than the 1-iter cap above.
    // Token-delta guard fires at 3 iterations, so stepsCount will be 3.
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    const result = await agent.run("Think deeply about an extremely complex problem.");
    await agent.dispose();

    // Default maxIterations (10): token-delta guard fires at iter 3 → stepsCount = 3
    expect(result.metadata.stepsCount).toBeGreaterThan(1);
  });
});
