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

  it("de-dupes against the most recent identical truncated-ref set", () => {
    let ledger = recordResultTruncation([], ["res_abc123"], 2);
    ledger = recordResultTruncation(ledger, ["res_abc123"], 3);
    expect(entriesOfKind(ledger, "result-truncated").length).toBe(1);
    ledger = recordResultTruncation(ledger, ["res_abc123", "res_def456"], 4);
    expect(entriesOfKind(ledger, "result-truncated").length).toBe(2);
  });
});
