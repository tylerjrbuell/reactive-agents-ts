import { describe, expect, test } from "bun:test";
import { addDocumentPatch, pinnedSkills, removeDocumentPatch, toggleSkillPatch } from "./chat-config-patch.js";

const skill = { name: "tdd", description: "", source: "workspace" as const, root: "/ws/.agents/skills" };

describe("chat config patches", () => {
  test("a pin is the skill's name: no scan root is written, other settings are kept", () => {
    const pinned = toggleSkillPatch({}, skill).skills;
    expect(pinned).toEqual({ paths: [], activate: ["tdd"] });
    const again = toggleSkillPatch({ skills: { paths: ["/extra"], activate: ["tdd"], global: true } }, { name: "other" }).skills;
    expect(again).toEqual({ paths: ["/extra"], activate: ["tdd", "other"], global: true });
    const unpinned = toggleSkillPatch({ skills: pinned }, skill).skills;
    expect(unpinned).toEqual({ paths: [] });
    expect(pinnedSkills({ skills: unpinned })).toEqual([]);
  });

  test("documents dedupe by source and remove by source", () => {
    const one = addDocumentPatch({}, " ./notes.md ")!;
    expect(one.documents).toEqual([{ source: "./notes.md" }]);
    expect(addDocumentPatch({ documents: one.documents }, "./notes.md")).toBeNull();
    expect(addDocumentPatch({}, "  ")).toBeNull();
    expect(removeDocumentPatch({ documents: one.documents }, "./notes.md").documents).toEqual([]);
  });
});
