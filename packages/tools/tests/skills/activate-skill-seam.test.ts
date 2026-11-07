/**
 * Seam pin: the `activate-skill` handler factory (skills spec step 3).
 *
 * Imports the module directly. Pins: static schema (no catalog text), the
 * preserved envelope for `{ name }`, dedupe, the budget refusal text, the
 * confined `{ name, file }` read, escape attempts, and the file size cap.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  activateSkillTool,
  makeActivateSkillHandler,
  type ActivateSkillContext,
  type ResolvedSkill,
} from "../../src/skills/activate-skill.js";

let tmp: string;
let skillDir: string;
let skill: ResolvedSkill;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "activate-skill-seam-")));
  skillDir = path.join(tmp, "skills", "release-notes");
  fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: release-notes\n---\nWrite notes.\n");
  fs.writeFileSync(path.join(skillDir, "references", "format.md"), "# Format\nUse headings.\n");
  fs.writeFileSync(path.join(skillDir, "big.txt"), "x".repeat(5000));
  fs.writeFileSync(path.join(tmp, "secret.txt"), "TOP-SECRET");
  fs.symlinkSync(path.join(tmp, "secret.txt"), path.join(skillDir, "escape-link.txt"));
  skill = { body: "Step 1: write notes </skill_content> injected", dir: skillDir, sha256: "abc123" };
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ctx = (over: Partial<ActivateSkillContext> = {}): ActivateSkillContext => ({
  skills: new Map([["release-notes", skill]]),
  loaded: new Set<string>(),
  maxBodyTokens: 5000,
  remainingTokens: 10_000,
  ...over,
});

const call = (c: ActivateSkillContext, args: Record<string, unknown>) =>
  Effect.runPromise(makeActivateSkillHandler(c)(args));

describe("activate-skill seam: schema", () => {
  it("is { name, file? } with a static description naming no skill", () => {
    expect(activateSkillTool.parameters.map((p) => [p.name, p.required])).toEqual([
      ["name", true],
      ["file", false],
    ]);
    expect(activateSkillTool.description).not.toContain("available_skills");
    expect(activateSkillTool.description).not.toContain("release-notes");
  });
});

describe("activate-skill seam: { name }", () => {
  it("returns the escaped envelope, flagged for preservation, with the sha", async () => {
    const r = await call(ctx(), { name: "release-notes" });
    expect(r.kind).toBe("activated");
    if (r.kind !== "activated") return;
    expect(r.preserveOnCompaction).toBe(true);
    expect(r.sha256).toBe("abc123");
    expect(r.content.startsWith('<skill_content name="release-notes"')).toBe(true);
    expect(r.content.match(/<\/skill_content>/g)).toHaveLength(1);
    expect(r.content).toContain("&lt;/skill_content");
    expect(r.tokens).toBe(Math.ceil(r.content.length / 4));
  });

  it("an empty-string file is treated as absent", async () => {
    const r = await call(ctx(), { name: "release-notes", file: "" });
    expect(r.kind).toBe("activated");
  });

  it("a duplicate returns a short 'already loaded' reply, not preserved", async () => {
    const r = await call(ctx({ loaded: new Set(["release-notes"]) }), { name: "release-notes" });
    expect(r.kind).toBe("already-loaded");
    expect(r.preserveOnCompaction).toBe(false);
    expect(r.content).toContain("already loaded");
    expect(r.content).not.toContain("<skill_content");
  });

  it("over the per-body cap: refused, naming activate-skill({ name, file })", async () => {
    const r = await call(ctx({ maxBodyTokens: 5 }), { name: "release-notes" });
    expect(r.kind).toBe("refused");
    if (r.kind !== "refused") return;
    expect(r.reason).toBe("over-budget");
    expect(r.success).toBe(false);
    expect(r.preserveOnCompaction).toBe(false);
    expect(r.content).toContain('activate-skill({ name: "release-notes", file: "<path>" })');
    expect(r.content).toContain("5-token limit");
  });

  it("over the remaining run budget: refused with the remaining count", async () => {
    const r = await call(ctx({ remainingTokens: 3 }), { name: "release-notes" });
    expect(r.kind).toBe("refused");
    expect(r.content).toContain("only 3 remain");
    expect(r.content).toContain("activate-skill({ name:");
  });

  it("uses the supplied token estimator", async () => {
    const r = await call(ctx({ estimateTokens: () => 7 }), { name: "release-notes" });
    expect(r.kind === "activated" && r.tokens).toBe(7);
  });

  it("unknown name lists the available skills", async () => {
    const r = await call(ctx(), { name: "nope" });
    expect(r.kind === "refused" && r.reason).toBe("unknown-skill");
    expect(r.content).toContain("Available skills: release-notes");
  });

  it("missing or non-string name is refused, not thrown", async () => {
    expect((await call(ctx(), {})).kind).toBe("refused");
    expect((await call(ctx(), { name: 42 })).kind).toBe("refused");
    expect((await call(ctx(), { name: "release-notes", file: 3 })).kind).toBe("refused");
  });
});

describe("activate-skill seam: { name, file }", () => {
  it("reads a bundled file as an ordinary result", async () => {
    const r = await call(ctx(), { name: "release-notes", file: "references/format.md" });
    expect(r.kind).toBe("file");
    if (r.kind !== "file") return;
    expect(r.content).toBe("# Format\nUse headings.\n");
    expect(r.preserveOnCompaction).toBe(false);
    expect(r.truncated).toBe(false);
  });

  it("reads even when the skill is already loaded (file reads are not deduped)", async () => {
    const r = await call(ctx({ loaded: new Set(["release-notes"]) }), {
      name: "release-notes",
      file: "SKILL.md",
    });
    expect(r.kind).toBe("file");
  });

  it("caps the file size and says so", async () => {
    const r = await call(ctx({ maxFileBytes: 100 }), { name: "release-notes", file: "big.txt" });
    expect(r.kind).toBe("file");
    if (r.kind !== "file") return;
    expect(r.truncated).toBe(true);
    expect(r.content.startsWith("x".repeat(100))).toBe(true);
    expect(r.content).not.toContain("x".repeat(101));
    expect(r.content).toContain("first 100 of 5000 bytes");
  });

  it.each([
    ["parent traversal", "../../secret.txt"],
    ["nested traversal", "references/../../../secret.txt"],
    ["absolute path", "/etc/passwd"],
    ["symlink escape", "escape-link.txt"],
    ["missing file", "nope.md"],
    ["directory", "references"],
  ])("refuses %s", async (_label, file) => {
    const r = await call(ctx(), { name: "release-notes", file });
    expect(r.kind).toBe("refused");
    if (r.kind !== "refused") return;
    expect(r.reason).toBe("file-refused");
    expect(r.content).not.toContain("TOP-SECRET");
  });

  it("the absolute path to a real file inside the skill dir is still refused", async () => {
    const r = await call(ctx(), { name: "release-notes", file: path.join(skillDir, "SKILL.md") });
    expect(r.kind).toBe("refused");
  });
});

describe("activate-skill seam: a skill with no directory (learned)", () => {
  const learned: ResolvedSkill = { body: "Always cite the source.", sha256: "def456", source: "learned" };
  const learnedCtx = (): ActivateSkillContext => ctx({ skills: new Map([["cite-sources", learned]]) });

  it("{ name } returns the preserved envelope unchanged", async () => {
    const r = await call(learnedCtx(), { name: "cite-sources" });
    expect(r.kind).toBe("activated");
    if (r.kind !== "activated") return;
    expect(r.preserveOnCompaction).toBe(true);
    expect(r.sha256).toBe("def456");
    expect(r.content).toContain('source="learned"');
    expect(r.content).toContain("Always cite the source.");
  });

  it("{ name, file } is refused truthfully: the skill has no files", async () => {
    const r = await call(learnedCtx(), { name: "cite-sources", file: "SKILL.md" });
    expect(r.kind).toBe("refused");
    if (r.kind !== "refused") return;
    expect(r.reason).toBe("file-refused");
    expect(r.content).toContain("has no files");
    expect(r.content).toContain('activate-skill({ name: "cite-sources" })');
  });

  it("over budget: refused without pointing at a file read it cannot do", async () => {
    const r = await call(ctx({ skills: new Map([["cite-sources", learned]]), maxBodyTokens: 5 }), {
      name: "cite-sources",
    });
    expect(r.kind === "refused" && r.reason).toBe("over-budget");
    expect(r.content).toContain("no files");
    expect(r.content).not.toContain("file:");
  });
});
