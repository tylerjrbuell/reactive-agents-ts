// Run: bun test packages/runtime/tests/inline-loop-deliverable-truth.test.ts --timeout 20000
//
// Inline/minimal agent loop — deliverable truth.
//
// Empirical origin (2026-07-11 probe fleet, gemma4): EVERY default-strategy
// (reactive) run reported `receipt.deliverables[].produced:false` while the
// file was on disk (p1/p2/p4/p5/p10). Root cause: the inline agent loop
// executes tools in inline-act.ts with callId+name+args+success all in hand,
// but ships NO reasoning-step ledger — `metadata.reasoningSteps` stays [] and
// `isArtifactProduced`'s toolCallId-linkage scan starves. Strategy paths were
// fixed in a4c5154d; this pins the ENGINE path.
//
// Test-provider note: a match-guarded toolCall turn can be eaten by the
// tool-relevance classifier (its prompt embeds the task text) — static
// `withTools({ required })` suppresses the classifier AND forces the tool
// (memory: feedback_scenario_classifier_consumption).
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ReactiveAgents } from "../src/index.js";

const OUT_DIR = join(process.cwd(), "qa-test-inline");
const OUT = join(OUT_DIR, "out.txt");

beforeAll(() => rmSync(OUT_DIR, { recursive: true, force: true }));
afterAll(() => rmSync(OUT_DIR, { recursive: true, force: true }));

describe("inline loop — deliverable truth", () => {
  it("mints the canonical tool ledger so a written deliverable verifies produced", async () => {
    const agent = await ReactiveAgents.create()
      .withName("inline-deliverable-agent")
      .withTools({ builtins: ["file-write"], required: ["file-write"] })
      .withTestScenario([
        {
          toolCall: {
            id: "tc-inline-1",
            name: "file-write",
            args: { path: "./qa-test-inline/out.txt", content: "alpha" },
          },
        },
        { text: "Done — I wrote alpha to the file." },
      ])
      .build();
    try {
      const result = await agent.run(
        "Write the single word alpha to the file ./qa-test-inline/out.txt.",
      );

      // The REAL builtin executed — file must exist (sanity, not the pin).
      expect(existsSync(OUT)).toBe(true);

      // The engine loop ships the canonical pair…
      const steps = (result.metadata as {
        reasoningSteps?: readonly {
          type: string;
          metadata?: {
            toolCall?: { id: string; name: string };
            toolCallId?: string;
            observationResult?: { success?: boolean };
          };
        }[];
      }).reasoningSteps ?? [];
      const action = steps.find(
        (s) => s.type === "action" && s.metadata?.toolCall?.name === "file-write",
      );
      expect(action).toBeDefined();
      const obs = steps.find(
        (s) =>
          s.type === "observation" &&
          s.metadata?.toolCallId === action?.metadata?.toolCall?.id &&
          s.metadata?.observationResult?.success === true,
      );
      expect(obs).toBeDefined();

      // …and the receipt tells the truth about the declared deliverable.
      expect(result.receipt?.deliverables).toEqual([
        { spec: "produce the file ./qa-test-inline/out.txt", produced: true },
      ]);

      // goalAchieved upgrades from the deliverable evidence (2026-07-11):
      // end_turn used to leave it null forever even when every declared
      // deliverable verifiably landed.
      expect(result.goalAchieved).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
