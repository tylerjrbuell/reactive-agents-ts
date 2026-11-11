// Run: bun test packages/runtime/tests/seam-skills-session-turn.test.ts --timeout 20000
//
// Seam pin: a session turn forwards `skills: { activate }` to its run, so a
// host (Cortex) can pin a skill for ONE chat turn without rebuilding the agent.
// Path: AgentSession.chat / runStream (chat.ts) -> ChatEngine.turn / streamTurn
// (chat/engine.ts) -> makeSessionRunTask / makeSessionRunStreamTask
// (agent/chat-capabilities.ts) -> run() / runStream() -> skillsCarry.
//
// ORACLE: the scripted model answers "body present" only when the pinned
// skill's full body is in the prompt.
//
// RED-ON-CUT (verified): drop `...skillsOption(opts?.skills)` from
// turnRunOptions in chat-capabilities.ts and both pinned turns answer
// "body absent".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunHandle } from "../src/run-controller.js";
import { ReactiveAgents } from "../src/builder.js";

const BASE = mkdtempSync(join(tmpdir(), "ra-skills-session-"));
const WORKSPACE = join(BASE, "workspace");
const FAKE_HOME = join(BASE, "home");
const PRIOR_HOME = process.env.HOME;
const BODY = "# Omega procedure\n\nWrite the omega marker file.";

beforeAll(() => {
  mkdirSync(join(WORKSPACE, ".agents", "skills", "omega-proc"), { recursive: true });
  writeFileSync(
    join(WORKSPACE, ".agents", "skills", "omega-proc", "SKILL.md"),
    `---\nname: omega-proc\ndescription: "Internal omega procedure."\n---\n\n${BODY}\n`,
    "utf8",
  );
  mkdirSync(FAKE_HOME, { recursive: true });
  process.env.HOME = FAKE_HOME;
});

afterAll(() => {
  if (PRIOR_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = PRIOR_HOME;
  rmSync(BASE, { recursive: true, force: true });
});

const build = () =>
  ReactiveAgents.create()
    .withName("skills-session")
    .withTestScenario([
      { text: "FINAL ANSWER: body present", match: "Write the omega marker file" },
      { text: "FINAL ANSWER: body absent" },
    ])
    .withSkills()
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(2)
    .build();

const streamOutput = async (handle: RunHandle): Promise<string> => {
  for await (const ev of handle) {
    if (ev._tag === "StreamCompleted") return String(ev.output ?? "");
    if (ev._tag === "StreamError") return `error: ${ev.cause}`;
  }
  return "";
};

describe("session turn skills option", () => {
  it("session.runStream(msg, { skills: { activate } }) injects the skill for that turn only", async () => {
    const agent = await build();
    const session = agent.session();
    try {
      expect(
        await streamOutput(session.runStream("Say hello.", { workspace: WORKSPACE, skills: { activate: ["omega-proc"] } })),
      ).toContain("body present");
      expect(await streamOutput(session.runStream("Say hello again.", { workspace: WORKSPACE }))).toContain("body absent");
    } finally {
      await session.end();
      await agent.dispose();
    }
  }, 30000);

  it("session.chat(msg, { useTools: true, skills: { activate } }) injects the skill for that turn only", async () => {
    const agent = await build();
    const session = agent.session();
    try {
      const pinned = await session.chat("Say hello.", { useTools: true, workspace: WORKSPACE, skills: { activate: ["omega-proc"] } });
      expect(pinned.message).toContain("body present");
      const plain = await session.chat("Say hello again.", { useTools: true, workspace: WORKSPACE });
      expect(plain.message).toContain("body absent");
    } finally {
      await session.end();
      await agent.dispose();
    }
  }, 30000);
});
