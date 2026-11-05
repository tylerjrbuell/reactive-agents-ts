// Run: bun test packages/reasoning/src/kernel/capabilities/reason/artifact-write-hint.integration.test.ts --timeout 20000
//
// A file deliverable drafted as chat text is redirected to the write (Plan 9
// Phase 1 H3 defect 2, qwen rw-2, trace 01M6MT1WV5P2VBC8F06PAG2NPD).
//
// The model drafted the whole ./analysis.md as prose eight times and never
// called file-write. The local-tier adapter quality check said "Review your
// answer ... fix it now" (it knows only user requiredTools) and quoted the
// harness's "Working directory" preamble as the task, which invited another
// rewrite. `guardQualityCheck` now computes the hint from the contract when a
// file deliverable is missing (`artifactWriteHint`): it names the path and the
// writing tool and says the draft is the content to write.
//
// RED-ON-CUT: in think-guards.ts replace
// `artifactWriteHint(state, input.requiredTools ?? []) ?? adapterMsg` with
// `adapterMsg` and the first test goes red (the hint is the review text, and the
// scripted write keyed on the new hint is never reached).

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer, type ProviderAdapter, type TestTurn } from "@reactive-agents/llm-provider";
import { reactKernel } from "../../loop/react-kernel.js";
import { runPass } from "../../loop/run-pass.js";
import { succeedingToolLayer } from "../../../testing/tool-service-mock.js";
import { makeKernelInput } from "../../../testing/kernel-fixtures.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import {
  initialKernelState,
  transitionState,
  type KernelInput,
  type KernelState,
} from "../../state/kernel-state.js";
import { artifactWriteHint, guardQualityCheck } from "./think-guards.js";

const DRAFT =
  "# Analysis\n\n## Summary\nThe dataset shows steady growth across all regions.\n\n## Findings\n" +
  "Revenue rose in every quarter and the north region led the gains.".repeat(12);

const PARAMS = [
  { name: "path", type: "string", required: true },
  { name: "content", type: "string", required: true },
];
const SCHEMAS = [
  { name: "file-write", description: "write content to a file", parameters: PARAMS },
  { name: "file-read", description: "read a file", parameters: [PARAMS[0]!] },
];

const run = (task: string, requiredTools: readonly string[], scenario: TestTurn[]) =>
  Effect.runPromise(
    runPass(
      reactKernel,
      // requiredTools as in the live rw-2 run; without them a prose reply takes
      // the trivial-task fast path and never reaches the guard chain.
      { task, availableToolSchemas: SCHEMAS, requiredTools, contextProfile: { tier: "local" } } satisfies KernelInput,
      { maxIterations: 8, strategy: "reactive", kernelType: "react", taskId: "artifact-write-hint" },
    ).pipe(Effect.provide(Layer.merge(TestLLMServiceLayer(scenario), succeedingToolLayer({ written: true }, PARAMS)))),
  );

/** The quality-check observations the guard appended (system, success:true). */
const qcHints = (state: KernelState): readonly string[] =>
  state.steps
    .filter(
      (s) =>
        s.type === "observation" &&
        s.metadata?.observationResult?.toolName === "system" &&
        s.metadata.observationResult.success === true,
    )
    .map((s) => s.content);

const read: TestTurn = { toolCall: { name: "file-read", args: { path: "./data.csv" } } };

describe("artifact write hint — a drafted deliverable is redirected to the write", () => {
  it("prose answer with ./analysis.md outstanding: the hint names file-write and the path", async () => {
    const pass = await run(
      "Read ./data.csv, then write ./analysis.md with a Summary and a Findings section.",
      ["file-read"],
      [
        read,
        { text: DRAFT },
        // Reachable only when the hint names the write action for the path.
        {
          match: "Call file-write with path \\./analysis\\.md",
          toolCall: { name: "file-write", args: { path: "./analysis.md", content: DRAFT } },
        },
        { text: "Wrote ./analysis.md with the Summary and Findings sections." + DRAFT },
      ],
    );
    const hints = qcHints(pass.state);
    expect(hints.some((h) => h.includes("file-write") && h.includes("./analysis.md"))).toBe(true);
    expect(hints.some((h) => h.includes("Review your answer"))).toBe(false);
    expect(
      pass.state.steps.some((s) => s.type === "action" && s.content.includes("file-write") && s.content.includes("analysis.md")),
    ).toBe(true);
  });

  it("control: a contractless run keeps the adapter text", () => {
    const state = transitionState(
      initialKernelState({ maxIterations: 8, strategy: "reactive", kernelType: "react" }),
      { iteration: 2 },
    );
    expect(artifactWriteHint(state, [])).toBeUndefined();
    const adapter: ProviderAdapter = { qualityCheck: () => "Review your answer: adapter text" };
    const redirected = guardQualityCheck(
      makeKernelInput({ task: "t", availableToolSchemas: [] }),
      state,
      { ...CONTEXT_PROFILES.local, tier: "local" },
      adapter,
      state.steps,
      0,
      0,
    );
    expect(redirected?.pendingGuidance?.qualityGateHint).toBe("Review your answer: adapter text");
  });
});
