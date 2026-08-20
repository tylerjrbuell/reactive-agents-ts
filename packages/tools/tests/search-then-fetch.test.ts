import { describe, it, expect } from "bun:test";
import { searchThenFetch } from "../src/research/search-then-fetch.js";

describe("searchThenFetch", () => {
  it("caps fetches to maxResults even when search returns more", async () => {
    const search = async () => Array.from({ length: 20 }, (_, i) => ({ id: i }));
    let fetchCalls = 0;
    const fetchOne = async (r: { id: number }) => {
      fetchCalls++;
      return { id: r.id, title: `item-${r.id}` };
    };
    const result = await searchThenFetch("anything", { search, fetchOne, maxResults: 4 });
    expect(fetchCalls).toBe(4);
    expect(result.items).toHaveLength(4);
  });

  it("collects per-item fetch errors instead of failing the whole search", async () => {
    const search = async () => [{ id: 1 }, { id: 2 }, { id: 3 }];
    const fetchOne = async (r: { id: number }) => {
      if (r.id === 2) throw new Error("fetch failed");
      return { id: r.id };
    };
    const result = await searchThenFetch("q", { search, fetchOne });
    expect(result.items).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
  });
});
