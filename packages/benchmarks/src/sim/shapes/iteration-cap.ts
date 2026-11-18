/**
 * Shape 5: sequential independent calls hitting the iteration cap (todo-heavy).
 * Six notes files must each be read and doubled into an output file. The calls are
 * independent, but a naive model makes one per turn: 6 reads then 6 writes needs
 * 12 turns against a cap of 10, so the run is cut off with the work unfinished.
 * The parallel-tool hint (local tier, where the base prompt lacks the batching
 * sentence) invites all calls in one reply; a model that follows it needs 3 turns.
 * Whether a real model follows the hint is the `compliance` parameter.
 *
 * Source: H3 task h3-todo-heavy (packages/benchmarks/src/h3/tasks.ts); S3 pth
 * receipts, where this one task carries the whole parallelToolHint effect (3.5x
 * fewer tokens, 13 turns to 3).
 */
import { obeys } from "../compliance.js";
import { seenText, type PolicyModel } from "../policy-model.js";
import type { Shape, ShapeTool } from "../shape.js";

const NOTES = [17, 42, 8, 63, 29, 54] as const;
const INDEXES = [1, 2, 3, 4, 5, 6] as const;

const fileOf = (n: number, prefix: string): string => `${prefix}-${n}.txt`;

const readCall = (n: number) => ({ id: `r${n}`, name: "file-read", args: { path: fileOf(n, "notes") } });
const writeCall = (n: number) => ({
  id: `w${n}`,
  name: "file-write",
  args: { path: fileOf(n, "out"), content: String(NOTES[n - 1]! * 2) },
});

const policy: PolicyModel = (req, ctx) => {
  const batch = obeys(req, ctx.rng, ctx.compliance, "parallel-tool-hint");
  const seen = seenText(req);
  const unread = INDEXES.filter((n) => !seen.includes(`READ_OK_${n}`));
  const unwritten = INDEXES.filter((n) => !seen.includes(`WROTE_OK_${n}`));
  if (unread.length > 0) {
    return batch ? { toolCalls: unread.map(readCall) } : { toolCall: readCall(unread[0]!) };
  }
  if (unwritten.length > 0) {
    return batch ? { toolCalls: unwritten.map(writeCall) } : { toolCall: writeCall(unwritten[0]!) };
  }
  return { text: "All six output files are written, each holding double the integer in its notes file." };
};

const tools: readonly ShapeTool[] = [
  {
    name: "file-read",
    description: "Read a file.",
    parameters: [{ name: "path", type: "string", required: true }],
    run: (args) => {
      const n = Number(/notes-(\d)\.txt/.exec(String(args.path ?? ""))?.[1] ?? 0);
      return { ok: true, result: { content: String(NOTES[n - 1] ?? 0), status: `READ_OK_${n}` } };
    },
  },
  {
    name: "file-write",
    description: "Write a file.",
    parameters: [
      { name: "path", type: "string", required: true },
      { name: "content", type: "string", required: true },
    ],
    run: (args) => {
      const n = Number(/out-(\d)\.txt/.exec(String(args.path ?? ""))?.[1] ?? 0);
      return { ok: true, result: { status: `WROTE_OK_${n}` } };
    },
  },
];

export const iterationCap: Shape = {
  id: "iteration-cap-sequential",
  sourceTraceId: "bench:h3-todo-heavy (S3 pth: 13 turns to 3, 3.5x tokens); parallel-tool-hint.ts",
  task: "Six files in your working directory, notes-1.txt through notes-6.txt, each contain one integer. For each notes-N.txt, write out-N.txt containing exactly double that integer (digits only). Finish all six.",
  tools,
  policy,
  ideal: {
    terminatedBy: "end_turn",
    status: "completed",
    toolSeq: [...INDEXES.map(() => "file-read"), ...INDEXES.map(() => "file-write")],
    maxTurns: 4,
  },
  run: { maxIterations: 10, requiredTools: ["file-read", "file-write"], tier: "local" },
};
