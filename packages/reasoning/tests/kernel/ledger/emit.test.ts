import { describe, it, expect } from "bun:test";
import { recordResultTruncation } from "../../../src/kernel/ledger/emit.js";
import { entriesOfKind } from "../../../src/kernel/ledger/run-ledger.js";

describe("recordResultTruncation (FM-17 layer 1)", () => {
  it("records a result-truncated fact enumerating the truncated refs", () => {
    const ledger = recordResultTruncation([], ["res_abc123"], 2);
    const facts = entriesOfKind(ledger, "result-truncated");
    expect(facts.length).toBe(1);
    expect(facts[0]).toMatchObject({ iteration: 2, truncatedRefs: ["res_abc123"] });
  });

  it("no-ops when nothing was truncated", () => {
    const ledger = recordResultTruncation([], [], 2);
    expect(entriesOfKind(ledger, "result-truncated").length).toBe(0);
  });

  // Finding I4. The de-dupe key is `(iteration, refs)`, not `refs` alone.
  // Keying on refs alone silently dropped every iteration whose truncated set
  // was unchanged — which is precisely the STABLE stall the fact exists to
  // record. assess() reads "no entry at iteration N" as "the model saw
  // everything that turn" and resets its trailing stall run, so the mechanism
  // erased its own evidence the moment the stall stopped changing shape.
  it("records a NEW iteration even when the truncated-ref set is unchanged", () => {
    let ledger = recordResultTruncation([], ["res_abc123"], 2);
    ledger = recordResultTruncation(ledger, ["res_abc123"], 3);
    expect(entriesOfKind(ledger, "result-truncated").length).toBe(2);
    ledger = recordResultTruncation(ledger, ["res_abc123", "res_def456"], 4);
    expect(entriesOfKind(ledger, "result-truncated").length).toBe(3);
    expect(entriesOfKind(ledger, "result-truncated").map((e) => e.iteration)).toEqual([2, 3, 4]);
  });

  it("still no-ops on a repeated render WITHIN one iteration", () => {
    let ledger = recordResultTruncation([], ["res_abc123"], 2);
    ledger = recordResultTruncation(ledger, ["res_abc123"], 2);
    expect(entriesOfKind(ledger, "result-truncated").length).toBe(1);
  });
});
