/**
 * Shape 1: partial answer with an unread input (the leanFinalTurn exact-value
 * defect). The model must read two inputs and add their counts. With tools on the
 * wire it reads the second input; with NO tools (a lean final turn) it writes a
 * partial reply instead of the total. Two variants differ only in how the task
 * NAMES its inputs:
 *  - filename tokens (`a.json`, `b.json`): the `unreadNamedInputs` gate sees them
 *    and holds the lean turn until both are read;
 *  - prose ("the first report"): the gate cannot see them, so the lean turn fires
 *    after one read and the tool-less partial reply ends the run. Known
 *    deterministic bug, pinned as the lever's regression test.
 *
 * Source: audit 2026-11-18 speedups receipts (leanFinalTurn on gemma4:e4b,
 * h3-exact-value 0/5 vs 5/5) and S6.md Q2 (kernel lean-final-turn.ts unreadNamedInputs).
 */
import { hasTools, seenText, type PolicyModel } from "../policy-model.js";
import type { Shape, ShapeTool } from "../shape.js";

const A_RESULT = "A_COUNT=412";
const B_RESULT = "B_COUNT=7";
const PARAMS = [{ name: "q", type: "string", required: true }] as const;

const gatherTool = (firstKey: string): ShapeTool => ({
  name: "gather",
  description: "Read one report.",
  parameters: PARAMS,
  run: (args) => ({
    ok: true,
    result: { finding: String(args.q ?? "").includes(firstKey) ? A_RESULT : B_RESULT },
  }),
});

const partialWhenToolless =
  (firstArg: string, secondArg: string): PolicyModel =>
  (req) => {
    const seen = seenText(req);
    const hasA = seen.includes(A_RESULT);
    const hasB = seen.includes(B_RESULT);
    if (!hasA) return { toolCall: { id: "g1", name: "gather", args: { q: firstArg } } };
    if (!hasB && hasTools(req)) return { toolCall: { id: "g2", name: "gather", args: { q: secondArg } } };
    if (!hasB) return { text: "The first count is 412. I still need the second report to give the total." };
    return { text: "The total is 412 plus 7, which is 419." };
  };

const IDEAL = {
  terminatedBy: "end_turn",
  status: "completed",
  toolSeq: ["gather", "gather"],
  maxTurns: 3,
} as const;

const RUN = { maxIterations: 6, requiredTools: ["gather"], tier: "mid" } as const;
const SOURCE =
  "audit:2026-11-18 speedups receipts (leanFinalTurn, gemma4:e4b h3-exact-value 0/5 vs 5/5); S6.md Q2";

/** Inputs named as files: the gate sees both. */
export const unreadInputFilename: Shape = {
  id: "unread-input-filename",
  sourceTraceId: SOURCE,
  task: "Use the gather tool to read a.json and b.json, then add the two counts and tell me the total.",
  tools: [gatherTool("a.json")],
  policy: partialWhenToolless("a.json", "b.json"),
  ideal: IDEAL,
  run: RUN,
};

/** Inputs named in prose only: the gate cannot see the second one. */
export const unreadInputProse: Shape = {
  id: "unread-input-prose",
  sourceTraceId: SOURCE,
  task: "Use the gather tool to read the first report and the second report, then add the two counts and tell me the total.",
  tools: [gatherTool("first report")],
  policy: partialWhenToolless("first report", "second report"),
  ideal: IDEAL,
  run: RUN,
};
