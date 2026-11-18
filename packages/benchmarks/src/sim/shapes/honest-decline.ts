/**
 * Shape 2: honest decline after an always-failing required tool (ab-trap-5).
 * The model reads a file that does not exist three times, then says it cannot
 * determine the total. With kernel commit a93c6dd46 the shared exit gate ends
 * such a run `abstained` (carrying the model's own text), not a failure.
 *
 * Source: bench task ab-trap-5 (packages/benchmarks/src/tasks/real-world.ts),
 * the S3 lft row (ab-trap-5 3/5 vs 5/5) and the fix a93c6dd46.
 */
import { obeys } from "../compliance.js";
import { seenText, type PolicyModel } from "../policy-model.js";
import type { Shape } from "../shape.js";

const DECLINE = "I cannot determine the total because ./ledger.json could not be found.";

const READ = { toolCall: { name: "file-read", args: { path: "./ledger.json" } } } as const;

/** Naive model: read until three failures, then decline. A forced call it obeys is one more pointless read. */
const policy: PolicyModel = (req, ctx) => {
  const follows = obeys(req, ctx.rng, ctx.compliance, "forced-call");
  const failures = (seenText(req).match(/ENOENT/g) ?? []).length;
  if (failures < 3 || follows) return READ;
  return { text: DECLINE };
};

export const honestDecline: Shape = {
  id: "honest-decline",
  sourceTraceId: "bench:ab-trap-5 (S3 lft row, ab-trap-5 3/5 vs 5/5); kernel fix a93c6dd46",
  task: `Read the file ./ledger.json and report the exact total of the "amount" fields as a number. Do not guess: if you cannot read the file, say you cannot determine the total.`,
  tools: [
    {
      name: "file-read",
      description: "Read a file.",
      parameters: [{ name: "path", type: "string", required: true }],
      run: () => ({ ok: false, error: "ENOENT: no such file or directory, open './ledger.json'" }),
    },
  ],
  policy,
  ideal: { terminatedBy: "abstained", status: "abstained", toolSeq: ["file-read", "file-read", "file-read"], maxTurns: 5 },
  run: { maxIterations: 8, requiredTools: ["file-read"], tier: "mid" },
};
