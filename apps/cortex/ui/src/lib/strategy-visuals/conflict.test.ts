import { describe, expect, it } from "bun:test";
import type { StrategyApprovalConflict } from "@reactive-agents/ui-core";
import { fetchStrategyConflict, type ConflictFetch } from "./conflict.js";

const conflict: StrategyApprovalConflict = {
  strategy: "code-action",
  message: "Code Action cannot ask before file-write.",
  gatedTools: ["file-write"],
  resolutions: [{ id: "switch-strategy", label: "Use the reactive strategy", patch: { strategy: "reactive" } }],
};

/** A fetch that records its call and answers with `payload`. */
const stub = (payload: unknown, ok = true) => {
  const calls: { url: string; body: unknown }[] = [];
  const fn: ConflictFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return { ok, json: async () => payload };
  };
  return { fn, calls };
};

describe("fetchStrategyConflict", () => {
  it("asks the server and returns its verdict untouched (the UI holds no copy of the rule)", async () => {
    const s = stub({ conflict });
    const c = await fetchStrategyConflict({ strategy: "code-action", tools: ["file-write"] }, { toolsEnabled: true }, s.fn, "http://x");
    expect(c).toEqual(conflict);
    expect(s.calls).toEqual([{ url: "http://x/api/strategy-conflict", body: { config: { strategy: "code-action", tools: ["file-write"] }, toolsEnabled: true } }]);
  });

  it("is undefined when the server says the config can run, or cannot answer", async () => {
    expect(await fetchStrategyConflict({ strategy: "code-action" }, {}, stub({ conflict: null }).fn, "http://x")).toBeUndefined();
    expect(await fetchStrategyConflict({ strategy: "code-action" }, {}, stub({}, false).fn, "http://x")).toBeUndefined();
    const down: ConflictFetch = async () => {
      throw new Error("offline");
    };
    expect(await fetchStrategyConflict({ strategy: "code-action" }, {}, down, "http://x")).toBeUndefined();
  });

  it("does not ask about a strategy that has no approval-scope rule", async () => {
    const s = stub({ conflict });
    expect(await fetchStrategyConflict({ strategy: "reactive" }, {}, s.fn, "http://x")).toBeUndefined();
    expect(s.calls).toHaveLength(0);
  });
});
