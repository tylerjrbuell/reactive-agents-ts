import { describe, it, expect } from "bun:test";
import { resolveThenRetrieve } from "../src/research/resolve-then-retrieve.js";

describe("resolveThenRetrieve", () => {
  it("returns the retrieved value when resolve succeeds", async () => {
    const resolve = async (name: string) => (name === "Master Chief" ? { pageId: "mc-1" } : null);
    const retrieve = async (r: { pageId: string }) => ({ pageId: r.pageId, bio: "Spartan-117" });
    const result = await resolveThenRetrieve("Master Chief", { resolve, retrieve });
    expect(result).toEqual({ pageId: "mc-1", bio: "Spartan-117" });
  });

  it("returns null (not an error) when resolve finds nothing", async () => {
    const resolve = async () => null;
    const retrieve = async () => ({ never: "called" });
    const result = await resolveThenRetrieve("Unknown Entity", { resolve, retrieve });
    expect(result).toBeNull();
  });
});
