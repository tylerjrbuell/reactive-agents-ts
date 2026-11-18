/**
 * Shape 3: no-call stall x4 (rw-7, actOrAnswer). The model answers the first four
 * think turns with prose and no tool call while required tool work is outstanding,
 * then proceeds (read, write, final). It ignores soft prose steering but honors a
 * hard `toolChoice: "required"`: the one lever that can end the stall early is the
 * forced-call retry (`actOrAnswer`). Firing is deterministic; whether a real model
 * obeys the forced call is the `compliance` parameter.
 *
 * Source: bench task rw-7 (the S3 aoa-gpt4omini row, rw-7 flagged by the per-task
 * veto) and the no-call stall class the actOrAnswer docs describe
 * (packages/reasoning/src/kernel/capabilities/reason/act-or-answer.ts).
 */
import { obeys } from "../compliance.js";
import { seenText, type PolicyModel } from "../policy-model.js";
import type { Shape } from "../shape.js";

const SOURCE_TEXT = "export function validate(x) { return x > 0 }";
const STALL = "I will start by examining the code and thinking through the approach.";
const READ = { toolCall: { name: "file-read", args: { path: "src/validator.ts" } } } as const;

const policy: PolicyModel = (req, ctx) => {
  const forced = obeys(req, ctx.rng, ctx.compliance, "forced-call");
  const seen = seenText(req);
  if (seen.includes("WRITE_OK")) return { text: "Fixed the off-by-one bug in src/validator.ts." };
  if (seen.includes(SOURCE_TEXT)) {
    return { toolCall: { name: "file-write", args: { path: "src/validator.ts", content: "FIXED validate" } } };
  }
  if (forced) return READ;
  // Count stalled TURNS: a forced retry of the same turn is not another stall.
  const stalls = ctx.scratch["stalls"] ?? 0;
  if (req.toolChoice !== "required" && stalls < 4) {
    ctx.scratch["stalls"] = stalls + 1;
    return { text: STALL };
  }
  return req.toolChoice === "required" ? { text: STALL } : READ;
};

export const noCallStall: Shape = {
  id: "no-call-stall",
  sourceTraceId: "bench:rw-7 (S3 aoa-gpt4omini rw-7 per-task veto); act-or-answer.ts stall class",
  task: "The file src/validator.ts has a bug. Read it, fix the bug in place by writing the file, then say what you fixed.",
  tools: [
    {
      name: "file-read",
      description: "Read a file.",
      parameters: [{ name: "path", type: "string", required: true }],
      run: () => ({ ok: true, result: { content: SOURCE_TEXT } }),
    },
    {
      name: "file-write",
      description: "Write a file.",
      parameters: [
        { name: "path", type: "string", required: true },
        { name: "content", type: "string", required: true },
      ],
      run: () => ({ ok: true, result: { status: "WRITE_OK" } }),
    },
  ],
  policy,
  ideal: { terminatedBy: "end_turn", status: "completed", toolSeq: ["file-read", "file-write"], maxTurns: 5 },
  run: { maxIterations: 8, requiredTools: ["file-read", "file-write"], tier: "mid" },
};
