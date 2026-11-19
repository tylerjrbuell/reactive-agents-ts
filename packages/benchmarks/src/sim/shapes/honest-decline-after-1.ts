/**
 * Shape 2b: honest decline after ONE failed read (ab-trap-5 on gemma4:e4b). Same task
 * and tool as `honest-decline`, but the model declines after a single ENOENT instead of
 * three: an ENOENT is permanent, one call is enough to know. The kernel's
 * `declineSettlesOutstanding` (honest-decline-exit.ts, `MIN_FAILED_CALLS = 2`) does not
 * count one failure as settled, so `actOrAnswer` forces a second read the model did not
 * need. Live (zoo-live 2026-11-18): redirect fired 5/5, 3/5 ended `dispatcher-early-stop`
 * (scored 0 though the text was an honest decline), 2/5 solved against 5/5 off.
 *
 * The first zoo shape declined after 3 failures (`failures < 3`) so it could not produce
 * this; fidelity parameter `declineAfter` is 1 here, observed 5/5 on gemma4:e4b.
 *
 * Source: wiki/Research/Harness-Reports/2026-11-18-zoo-live/README.md section B2.
 */
import { obeys } from "../compliance.js";
import { seenText, type PolicyModel } from "../policy-model.js";
import type { Shape } from "../shape.js";

const DECLINE = "I cannot determine the total because ./ledger.json could not be found.";
const READ = { toolCall: { name: "file-read", args: { path: "./ledger.json" } } } as const;

/** Decline after the first failure; a forced call it obeys is one more pointless read. */
const policy: PolicyModel = (req, ctx) => {
  const follows = obeys(req, ctx.rng, ctx.compliance, "forced-call");
  const failures = (seenText(req).match(/ENOENT/g) ?? []).length;
  if (failures < 1 || follows) return READ;
  return { text: DECLINE };
};

export const honestDeclineAfterOne: Shape = {
  id: "honest-decline-after-1",
  sourceTraceId: "zoo-live 2026-11-18 B2: gemma4:e4b ab-trap-5 aoa r0,r3,r4 (declines after one ENOENT); H-A1",
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
  ideal: { terminatedBy: "abstained", status: "abstained", toolSeq: ["file-read"], maxTurns: 4 },
  run: { maxIterations: 8, requiredTools: ["file-read"], tier: "mid" },
};
