// RED-ON-CUT: remove the `answerBlessed` filter in envelopeFromKernelState -> first case red.
import { describe, it, expect } from "bun:test";
import { envelopeFromKernelState } from "./completion-envelope.js";

const mk = (decision?: { accepted: boolean; verifier?: { verified: boolean } }) =>
  envelopeFromKernelState({
    status: "done",
    meta: {
      ...(decision ? { deliverableDecision: decision } : {}),
      assessment: { requirements: { outstanding: ["answer", "tool:write"], blocked: [], satisfied: [] } },
    } as never,
  });

describe("envelope answer floor", () => {
  it("accepted + verified deliverable: answer floor dropped, deterministic criterion kept", () => {
    expect(mk({ accepted: true, verifier: { verified: true } }).outstandingCriteria).toEqual(["tool:write"]);
  });
  it("refused or undecided deliverable keeps the answer floor", () => {
    expect(mk({ accepted: false }).outstandingCriteria).toEqual(["answer", "tool:write"]);
    expect(mk().outstandingCriteria).toEqual(["answer", "tool:write"]);
  });
});
