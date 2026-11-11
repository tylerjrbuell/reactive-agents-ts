import { describe, expect, test } from "bun:test";
import { LAB_TABS, isLabTab, labTabFromHash } from "./lab-tabs.js";

describe("lab tabs", () => {
  test("tab bar order and labels", () => {
    expect(LAB_TABS.map((t) => `${t.id}:${t.label}`)).toEqual(["builder:Builder", "gateway:Agents", "skills:Skills", "tools:Tools", "prompts:Prompts"]);
  });
  test("hash opens a tab; anything else keeps the default", () => {
    expect(labTabFromHash("#gateway")).toBe("gateway");
    expect(labTabFromHash("#skills")).toBe("skills");
    expect(labTabFromHash("#tools")).toBe("tools");
    expect(labTabFromHash("#prompts")).toBe("prompts");
    expect(labTabFromHash("#builder")).toBeNull();
    expect(labTabFromHash("")).toBeNull();
  });
  test("isLabTab guards the tab-switch event", () => {
    expect(isLabTab("tools")).toBe(true);
    expect(isLabTab("agents")).toBe(false);
    expect(isLabTab(undefined)).toBe(false);
  });
});
