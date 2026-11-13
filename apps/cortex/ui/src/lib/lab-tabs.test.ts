import { describe, expect, test } from "bun:test";
import { LAB_TABS, isLabTab, labTabFromHash, labTabHash, normalizeLabTab } from "./lab-tabs.js";

describe("lab tabs", () => {
  test("tab bar order and labels", () => {
    expect(LAB_TABS.map((t) => `${t.id}:${t.label}`)).toEqual([
      "builder:Builder",
      "agents:Saved agents",
      "status:Gateway",
      "channels:Channels",
      "skills:Skills",
      "memory:Memory",
      "tools:Tools",
      "prompts:Prompts",
    ]);
  });
  test("hash opens a tab; #gateway is an alias of #agents; anything else keeps the default", () => {
    expect(labTabFromHash("#agents")).toBe("agents");
    expect(labTabFromHash("#gateway")).toBe("agents");
    expect(labTabFromHash("#status")).toBe("status");
    expect(labTabFromHash("#channels")).toBe("channels");
    expect(labTabFromHash("#skills")).toBe("skills");
    expect(labTabFromHash("#memory")).toBe("memory");
    expect(labTabFromHash("#tools")).toBe("tools");
    expect(labTabFromHash("#prompts")).toBe("prompts");
    expect(labTabFromHash("#builder")).toBeNull();
    expect(labTabFromHash("#nope")).toBeNull();
    expect(labTabFromHash("")).toBeNull();
  });
  test("a tab writes its own hash, never the alias", () => {
    expect(labTabHash("agents")).toBe("#agents");
    expect(labTabHash("prompts")).toBe("#prompts");
    expect(labTabHash("builder")).toBe("");
    for (const t of LAB_TABS) expect(labTabFromHash(labTabHash(t.id)) ?? "builder").toBe(t.id);
  });
  test("the tab-switch event takes ids and the alias", () => {
    expect(normalizeLabTab("gateway")).toBe("agents");
    expect(normalizeLabTab("tools")).toBe("tools");
    expect(isLabTab("agents")).toBe(true);
    expect(isLabTab("gateway")).toBe(true);
    expect(isLabTab("nope")).toBe(false);
    expect(isLabTab(undefined)).toBe(false);
  });
});
