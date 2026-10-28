import { describe, expect, test } from "bun:test";
import { addDocumentPatch, pinnedSkills, removeDocumentPatch, skillRoot, toggleSkillPatch } from "./chat-config-patch.js";

const skill = { name: "tdd", description: "", skillDir: "apps/docs/skills/tdd" };

describe("chat config patches", () => {
  test("skill root is the parent of the skill folder", () => {
    expect(skillRoot("apps/docs/skills/tdd")).toBe("apps/docs/skills");
    expect(skillRoot("tdd")).toBe(".");
  });

  test("pin adds the root once and the name; unpin removes only the name", () => {
    const pinned = toggleSkillPatch({}, skill).skills;
    expect(pinned).toEqual({ paths: ["apps/docs/skills"], activate: ["tdd"] });
    const again = toggleSkillPatch({ skills: pinned }, { ...skill, name: "other", skillDir: "apps/docs/skills/other" }).skills;
    expect(again.paths).toEqual(["apps/docs/skills"]);
    expect(again.activate).toEqual(["tdd", "other"]);
    const unpinned = toggleSkillPatch({ skills: pinned }, skill).skills;
    expect(unpinned).toEqual({ paths: ["apps/docs/skills"] });
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
