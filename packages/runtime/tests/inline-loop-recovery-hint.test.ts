// Run: bun test packages/runtime/tests/inline-loop-recovery-hint.test.ts --timeout 20000
//
// Inline-path tool errors carry the recovery hint.
//
// Empirical origin (2026-07-11 probe p4, gemma4): file-read ENOENT on the
// inline path returned a bare "[Tool error: File read failed: ENOENT …]" with
// NO recovery hint — even though list-directory was exposed. The model then
// hardcoded an exchange rate inside a code-execute comment and shipped a
// fabricated 186.00 as success. The kernel act path got hint wiring on
// 2026-07-09 (tool-execution.ts getRecoveryHint, exposure-gated); the inline
// loop never did. The tool_result channel is one of only three channels that
// reach the model — a bare errno wastes it.
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("inline loop — tool-error recovery hint", () => {
  it("names list-directory on ENOENT when it is exposed", async () => {
    const agent = await ReactiveAgents.create()
      .withTools({ builtins: ["file-read", "list-directory"], required: ["file-read"] })
      .withTestScenario([
        {
          toolCall: {
            id: "t1",
            name: "file-read",
            args: { path: "./definitely-not-here-xyz/rates.json" },
          },
        },
        { text: "I could not read the file." },
      ])
      .build();
    try {
      const r = await agent.run(
        "Read ./definitely-not-here-xyz/rates.json and report the rate.",
      );
      const steps = (r.metadata as {
        reasoningSteps?: readonly { type: string; content: string }[];
      }).reasoningSteps ?? [];
      const errObs = steps.find(
        (s) => s.type === "observation" && s.content.includes("Tool error"),
      );
      expect(errObs).toBeDefined();
      expect(errObs!.content).toContain("list-directory");
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("does NOT name list-directory when it is not exposed (absent tool is worse than silence)", async () => {
    const agent = await ReactiveAgents.create()
      .withTools({ builtins: ["file-read"], required: ["file-read"] })
      .withTestScenario([
        {
          toolCall: {
            id: "t1",
            name: "file-read",
            args: { path: "./definitely-not-here-xyz/rates.json" },
          },
        },
        { text: "I could not read the file." },
      ])
      .build();
    try {
      const r = await agent.run(
        "Read ./definitely-not-here-xyz/rates.json and report the rate.",
      );
      const steps = (r.metadata as {
        reasoningSteps?: readonly { type: string; content: string }[];
      }).reasoningSteps ?? [];
      const errObs = steps.find(
        (s) => s.type === "observation" && s.content.includes("Tool error"),
      );
      expect(errObs).toBeDefined();
      expect(errObs!.content).not.toContain("list-directory");
      // The exposure-safe fallback still gives actionable guidance.
      expect(errObs!.content).toContain("working root");
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
