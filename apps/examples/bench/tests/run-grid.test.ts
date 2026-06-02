import { describe, it, expect } from "bun:test";
import { planCells } from "../run-grid.js";

describe("planCells", () => {
  it("expands tiers × tasks × arms × N into cells", () => {
    const cells = planCells({
      tiers: ["local"],
      taskIds: ["overflow-summarize", "overflow-transcribe"],
      arms: [{ label: "baseline", env: {} }, { label: "candidate", env: { RA_OVERHAUL: "1" } }],
      n: 3,
    });
    expect(cells.length).toBe(1 * 2 * 2 * 3);
    const c = cells[0]!;
    expect(c).toHaveProperty("tier");
    expect(c).toHaveProperty("taskId");
    expect(c).toHaveProperty("arm");
    expect(c).toHaveProperty("run");
  });
});
