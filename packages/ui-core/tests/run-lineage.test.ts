import { describe, expect, it } from "bun:test";
import { continuationChainOf, continuationsOf } from "../src/state/run-lineage.js";

const runs = [
  { runId: "a" },
  { runId: "a-cont-1", continuedFrom: "a" },
  { runId: "a-cont-2", continuedFrom: "a-cont-1" },
  { runId: "solo" },
];

describe("run lineage", () => {
  it("lists the runs that continue a run", () => {
    expect(continuationsOf(runs, "a")).toEqual(["a-cont-1"]);
    expect(continuationsOf(runs, "solo")).toEqual([]);
  });

  it("gives the whole chain, oldest first, from any member", () => {
    for (const id of ["a", "a-cont-1", "a-cont-2"]) expect(continuationChainOf(runs, id)).toEqual(["a", "a-cont-1", "a-cont-2"]);
  });

  it("an unlinked run (every run before the feature) is a chain of one", () => {
    expect(continuationChainOf(runs, "solo")).toEqual(["solo"]);
    expect(continuationChainOf([], "x")).toEqual(["x"]);
  });

  it("still names a parent that is not in the list", () => {
    expect(continuationChainOf([{ runId: "c", continuedFrom: "gone" }], "c")).toEqual(["gone", "c"]);
  });

  it("follows the first continuation when a run was continued twice, and survives a cycle", () => {
    const branched = [{ runId: "p" }, { runId: "x", continuedFrom: "p" }, { runId: "y", continuedFrom: "p" }];
    expect(continuationChainOf(branched, "p")).toEqual(["p", "x"]);
    const cyclic = [{ runId: "m", continuedFrom: "n" }, { runId: "n", continuedFrom: "m" }];
    expect(continuationChainOf(cyclic, "m")).toHaveLength(2);
  });
});
