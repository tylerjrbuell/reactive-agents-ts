// Run: bun test packages/runtime/tests/seam-skills-run-stream.test.ts --timeout 20000
//
// Seam pins for per-run skills on the streaming path and bootstrap skill
// activation events:
//   1. `runStream(task, { skills: { activate } })` pins the skill for that
//      turn like `run()` (TurnCarryOption carries `skillsActivate`).
//   2. Bootstrap-injected skills publish ONE `SkillActivated` each per run
//      (trigger "bootstrap", the run's taskId, sha256 equal to the
//      `run-started.config.skills` catalog hash).
//   3. `onSkillActivated` (wireRiHooks) fires for those events.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SkillActivated } from "@reactive-agents/core";
import { parseSKILLmd } from "@reactive-agents/reactive-intelligence";
import { ReactiveAgents } from "../src/builder.js";
import { turnCarryMetadata } from "../src/chat/todo-seed.js";

const BASE = mkdtempSync(join(tmpdir(), "ra-skills-stream-"));
const WORKSPACE = join(BASE, "workspace");
const FAKE_HOME = join(BASE, "home");
const PRIOR_HOME = process.env.HOME;
const BODY = "# Omega procedure\n\nWrite the omega marker file.";
const SKILL_MD = join(WORKSPACE, ".agents", "skills", "omega-proc", "SKILL.md");

beforeAll(() => {
  mkdirSync(join(WORKSPACE, ".agents", "skills", "omega-proc"), { recursive: true });
  writeFileSync(SKILL_MD, `---\nname: omega-proc\ndescription: "Internal omega procedure."\n---\n\n${BODY}\n`, "utf8");
  mkdirSync(FAKE_HOME, { recursive: true });
  process.env.HOME = FAKE_HOME;
});

afterAll(() => {
  if (PRIOR_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = PRIOR_HOME;
  rmSync(BASE, { recursive: true, force: true });
});

type Builder = ReturnType<typeof ReactiveAgents.create>;

const build = (configure: (b: Builder) => Builder = (b) => b) =>
  configure(
    ReactiveAgents.create()
      .withName("skills-stream")
      .withTestScenario([
        // Fires only when the pinned skill's full body is in the prompt.
        { text: "FINAL ANSWER: body present", match: "Write the omega marker file" },
        { text: "FINAL ANSWER: body absent" },
      ]),
  )
    .withSkills()
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(2)
    .build();

const streamOutput = async (
  agent: Awaited<ReturnType<typeof build>>,
  options: Parameters<Awaited<ReturnType<typeof build>>["runStream"]>[1],
): Promise<string> => {
  for await (const ev of agent.runStream("Say hello.", options)) {
    if (ev._tag === "StreamCompleted") return String(ev.output ?? "");
    if (ev._tag === "StreamError") return `error: ${ev.cause}`;
  }
  return "";
};

describe("runStream skills option", () => {
  it("turnCarryMetadata carries skills.activate as task context", () => {
    expect(turnCarryMetadata({ skills: { activate: ["omega-proc"] } })).toEqual({
      context: { skillsActivate: ["omega-proc"] },
    });
    expect(turnCarryMetadata({ skills: { activate: [] } })).toEqual({});
  });

  it("runStream(task, { skills: { activate } }) injects the pinned skill for that turn only", async () => {
    const agent = await build();
    expect(await streamOutput(agent, { workspace: WORKSPACE, skills: { activate: ["omega-proc"] } })).toContain("body present");
    expect(await streamOutput(agent, { workspace: WORKSPACE })).toContain("body absent");
    await agent.dispose();
  }, 30000);
});

describe("bootstrap SkillActivated", () => {
  it("publishes one event per pinned skill per run, with taskId and the catalog sha256", async () => {
    const agent = await build();
    const events: SkillActivated[] = [];
    const unsub = await agent.subscribe("SkillActivated", (e) => void events.push(e));
    const result = await agent.run("Say hello.", { workspace: WORKSPACE, skills: { activate: ["omega-proc"] } });
    unsub();
    await agent.dispose();

    expect(String(result.output)).toContain("body present");
    const boot = events.filter((e) => e.trigger === "bootstrap");
    expect(boot.length).toBe(1);
    expect(boot[0]!.skillName).toBe("omega-proc");
    expect(boot[0]!.iteration).toBe(0);
    expect(boot[0]!.taskId).toBe(String(result.taskId));
    const body = parseSKILLmd(SKILL_MD)!.instructions;
    expect(boot[0]!.sha256).toBe(createHash("sha256").update(body).digest("hex"));
  }, 30000);

  it("an unpinned, irrelevant skill publishes nothing", async () => {
    const agent = await build();
    const events: SkillActivated[] = [];
    const unsub = await agent.subscribe("SkillActivated", (e) => void events.push(e));
    await agent.run("Say hello.", { workspace: WORKSPACE });
    unsub();
    await agent.dispose();
    expect(events.length).toBe(0);
  }, 30000);

  it("onSkillActivated fires with trigger 'bootstrap' (wireRiHooks)", async () => {
    const seen: { name: string; trigger: string }[] = [];
    const agent = await build((b) =>
      b.withReactiveIntelligence({ onSkillActivated: (skill, trigger) => void seen.push({ name: skill.name, trigger }) }),
    );
    await agent.run("Say hello.", { workspace: WORKSPACE, skills: { activate: ["omega-proc"] } });
    await agent.dispose();
    expect(seen).toEqual([{ name: "omega-proc", trigger: "bootstrap" }]);
  }, 30000);
});
