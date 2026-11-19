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

/**
 * Inputs named as ABSOLUTE paths under a dot-directory, as the bench and any user
 * passes them (`<repo>/.bench-run-<pid>-<hash>/a.json`; also `~/.config`, `./.env.local`).
 * Live (zoo-live 2026-11-18, B1): the filename extractor `FILE_TOKEN` rejected the
 * dot-leading segment, extracted ZERO inputs, and "nothing unread" was read as "all
 * read": the lean turn fired after 1 of 2 reads, replied "I still need to read b.json",
 * and the exit gate accepted it (gemma4:e4b h3-exact-value, 1/5 vs 5/5 off). The plain
 * `a.json` shape above cannot see this.
 */
export const unreadInputAbspath: Shape = {
  id: "unread-input-abspath",
  sourceTraceId: "zoo-live 2026-11-18 B1: gemma4:e4b h3-exact-value lft r1-r4 (dot-directory absolute paths); H-L1",
  task:
    'Read /home/user/work/repo/.bench-run-4242-ab12cd/a.json and /home/user/work/repo/.bench-run-4242-ab12cd/b.json, ' +
    'which each have a numeric "count" field. Add the two counts together and reply with the sum.',
  tools: [
    {
      name: "file-read",
      description: "Read a file.",
      parameters: [{ name: "path", type: "string", required: true }],
      run: (args) => ({
        ok: true,
        result: { finding: String(args.path ?? "").endsWith("a.json") ? A_RESULT : B_RESULT },
      }),
    },
  ],
  policy: ((): PolicyModel => {
    const dir = "/home/user/work/repo/.bench-run-4242-ab12cd";
    return (req) => {
      const seen = seenText(req);
      const hasA = seen.includes(A_RESULT);
      const hasB = seen.includes(B_RESULT);
      if (!hasA) return { toolCall: { id: "r1", name: "file-read", args: { path: `${dir}/a.json` } } };
      if (!hasB && hasTools(req)) return { toolCall: { id: "r2", name: "file-read", args: { path: `${dir}/b.json` } } };
      if (!hasB) return { text: "The count in a.json is 412. I still need to read b.json to give the sum." };
      return { text: "The sum is 412 plus 7, which is 419." };
    };
  })(),
  ideal: { terminatedBy: "end_turn", status: "completed", toolSeq: ["file-read", "file-read"], maxTurns: 3 },
  run: { maxIterations: 6, requiredTools: ["file-read"], tier: "mid" },
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
