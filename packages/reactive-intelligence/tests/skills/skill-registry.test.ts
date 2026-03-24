import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { parseSKILLmd, discoverSkills } from "../../src/skills/skill-registry.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const TMP_DIR = path.join(os.tmpdir(), "test-skill-registry");

describe("SkillRegistry", () => {
  beforeEach(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  const writeSkill = (dir: string, name: string, content: string) => {
    const skillDir = path.join(dir, name);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
    return skillDir;
  };

  describe("parseSKILLmd", () => {
    it("extracts YAML frontmatter + body", () => {
      const dir = writeSkill(TMP_DIR, "my-skill", `---
name: my-skill
description: Does useful things
---

# Steps
1. Do the thing
`);
      const result = parseSKILLmd(path.join(dir, "SKILL.md"));
      expect(result).not.toBeNull();
      expect(result!.name).toBe("my-skill");
      expect(result!.description).toBe("Does useful things");
      expect(result!.instructions).toContain("# Steps");
    });

    it("parses metadata with requires and allowed-tools", () => {
      const dir = writeSkill(TMP_DIR, "complex-skill", `---
name: complex-skill
description: A complex skill
metadata:
  requires: web-search citation-formatter
  allowed-tools: gh-api file-read
---

Instructions here.
`);
      const result = parseSKILLmd(path.join(dir, "SKILL.md"));
      expect(result).not.toBeNull();
      expect(result!.metadata).toBeDefined();
      expect(result!.metadata.requires).toEqual(["web-search", "citation-formatter"]);
      expect(result!.metadata["allowed-tools"]).toEqual(["gh-api", "file-read"]);
    });

    it("returns null for missing name", () => {
      const dir = writeSkill(TMP_DIR, "no-name", `---
description: Missing name field
---
Body.
`);
      const result = parseSKILLmd(path.join(dir, "SKILL.md"));
      expect(result).toBeNull();
    });

    it("warns but parses when description is missing", () => {
      const dir = writeSkill(TMP_DIR, "no-desc", `---
name: no-desc
---
Body content.
`);
      const result = parseSKILLmd(path.join(dir, "SKILL.md"));
      expect(result).not.toBeNull();
      expect(result!.name).toBe("no-desc");
      expect(result!.description).toBe("");
    });

    it("returns null for unparseable YAML", () => {
      const dir = writeSkill(TMP_DIR, "broken", `not yaml at all`);
      const result = parseSKILLmd(path.join(dir, "SKILL.md"));
      expect(result).toBeNull();
    });

    it("detects scripts/ and references/ resources", () => {
      const dir = writeSkill(TMP_DIR, "with-resources", `---
name: with-resources
description: Has resources
---
Use resources.
`);
      fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
      fs.writeFileSync(path.join(dir, "scripts", "check.py"), "print('ok')");
      fs.mkdirSync(path.join(dir, "references"), { recursive: true });
      fs.writeFileSync(path.join(dir, "references", "guide.md"), "# Guide");

      const result = parseSKILLmd(path.join(dir, "SKILL.md"));
      expect(result!.resources.scripts).toEqual(["check.py"]);
      expect(result!.resources.references).toEqual(["guide.md"]);
    });
  });

  describe("discoverSkills", () => {
    it("finds SKILL.md files in custom paths", () => {
      const skillsDir = path.join(TMP_DIR, "custom-skills");
      writeSkill(skillsDir, "skill-a", `---
name: skill-a
description: Skill A
---
Instructions A.
`);
      const result = discoverSkills([skillsDir], "agent-1", TMP_DIR);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.name).toBe("skill-a");
    });

    it("detects name collisions and keeps first by precedence", () => {
      const dir1 = path.join(TMP_DIR, "high-priority");
      const dir2 = path.join(TMP_DIR, "low-priority");
      writeSkill(dir1, "same-name", `---
name: same-name
description: High priority version
---
High.
`);
      writeSkill(dir2, "same-name", `---
name: same-name
description: Low priority version
---
Low.
`);
      const result = discoverSkills([dir1, dir2], "agent-1", TMP_DIR);
      expect(result.skills).toHaveLength(1);
      expect(result.skills[0]!.description).toBe("High priority version");
      expect(result.collisions).toHaveLength(1);
    });

    it("ignores directories without SKILL.md", () => {
      const dir = path.join(TMP_DIR, "no-skills");
      fs.mkdirSync(path.join(dir, "random-dir"), { recursive: true });
      fs.writeFileSync(path.join(dir, "random-dir", "README.md"), "Not a skill");
      const result = discoverSkills([dir], "agent-1", TMP_DIR);
      expect(result.skills).toHaveLength(0);
    });

    it("handles non-existent scan paths gracefully", () => {
      const result = discoverSkills(["/nonexistent/path"], "agent-1", TMP_DIR);
      expect(result.skills).toHaveLength(0);
      expect(result.warnings).toHaveLength(0); // non-existent paths are silently skipped
    });
  });
});
