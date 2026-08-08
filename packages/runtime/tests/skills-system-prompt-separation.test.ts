// Run: bun test packages/runtime/tests/skills-system-prompt-separation.test.ts
//
// Integration test: skills declared via `.withSkills()` must render in the system
// prompt's `## Skills` section — NOT inside `<retrieved_memory>` and NOT as
// callable tools. Pins the full chain: skill-postprocess bootstrap → metadata →
// reasoning-think extraction → skillsContext → assembly project stage.
import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";

function makeSkillDir(): string {
  const root = mkdtempSync(join(tmpdir(), "ra-skill-sep-"));
  const skillDir = join(root, "test-skill");
  mkdirSync(skillDir);
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [
      "---",
      "name: test-skill",
      'description: "A test skill for integration testing."',
      "---",
      "",
      "# Test Skill",
      "",
      "Run `echo hello` to greet the world.",
    ].join("\n"),
    "utf8",
  );
  return root;
}

describe("skills render in system prompt, not as tools", () => {
  it("skill catalog XML reaches the system prompt via skillsContext chain", async () => {
    const skillRoot = makeSkillDir();
    try {
      const agent = await ReactiveAgents.create()
        .withName("skill-sep-test")
        .withProvider("test")
        .withModel("test")
        .withSkills({ paths: [skillRoot] })
        .withTestScenario([
          // match guard fires against system prompt + messages.
          // If available_skills is in the system prompt, this turn resolves.
          { text: "FINAL ANSWER: skills are in the prompt.", match: "available_skills" },
          // Fallback: if the match above doesn't fire, the scenario falls through here.
          { text: "FINAL ANSWER: skills NOT found." },
        ] as never)
        .withReasoning({ defaultStrategy: "reactive" })
        .withMaxIterations(3)
        .build();

      const result = await agent.run("Use the test skill.");
      await agent.dispose();

      // If the skill catalog XML landed in the system prompt, the first turn's
      // match guard fires and the output contains "skills are in the prompt".
      const output = String(result.output ?? "");
      expect(output).toContain("skills are in the prompt");
    } finally {
      rmSync(skillRoot, { recursive: true, force: true });
    }
  }, 30000);

  it("activated skill content lands in system prompt", async () => {
    const skillRoot = makeSkillDir();
    try {
      const agent = await ReactiveAgents.create()
        .withName("skill-activated-test")
        .withProvider("test")
        .withModel("test")
        .withSkills({ paths: [skillRoot], activate: ["test-skill"] })
        .withTestScenario([
          // skill_content is the XML tag for activated skills
          { text: "FINAL ANSWER: activated skill present.", match: "skill_content" },
          { text: "FINAL ANSWER: activated skill NOT found." },
        ] as never)
        .withReasoning({ defaultStrategy: "reactive" })
        .withMaxIterations(3)
        .build();

      const result = await agent.run("Run the test skill.");
      await agent.dispose();

      const output = String(result.output ?? "");
      expect(output).toContain("activated skill present");
    } finally {
      rmSync(skillRoot, { recursive: true, force: true });
    }
  }, 30000);

  it("skills are NOT inside retrieved_memory fence", async () => {
    const skillRoot = makeSkillDir();
    try {
      const agent = await ReactiveAgents.create()
        .withName("skill-fence-test")
        .withProvider("test")
        .withModel("test")
        .withSkills({ paths: [skillRoot] })
        .withTestScenario([
          // This match looks for skills inside retrieved_memory — should NOT fire.
          { text: "FINAL ANSWER: LEAK - skills inside memory fence.", match: "retrieved_memory[\\s\\S]*available_skills" },
          // If the match above didn't fire, skills are correctly outside the fence.
          { text: "FINAL ANSWER: correctly separated." },
        ] as never)
        .withReasoning({ defaultStrategy: "reactive" })
        .withMaxIterations(3)
        .build();

      const result = await agent.run("Check skill placement.");
      await agent.dispose();

      const output = String(result.output ?? "");
      expect(output).toContain("correctly separated");
    } finally {
      rmSync(skillRoot, { recursive: true, force: true });
    }
  }, 30000);
});
