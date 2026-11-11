// Run: bun run repo test apps/cortex/server/tests/chat-turn-skills.test.ts
/**
 * `/skill <name>` pins a skill for one chat turn (never written to the session config),
 * and the stored turn says which skills the run had active and why, from the run's own
 * `SkillActivated` events and `AgentStarted.config.skills` (roadmap C5).
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@reactive-agents/core";
import { openDatabase } from "../db/schema.js";
import { getChatSession, getChatTurns } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { recordSkillActivity, turnSkillPinsOf, withTurnSkillPins, withTurnSkills } from "../services/chat-turn-skills.js";

describe("recordSkillActivity", () => {
  it("keeps each run's record and activations; an activation without taskId counts for the current run", async () => {
    let emit: (e: AgentEvent) => void = () => {};
    const { log, unsubscribe } = await recordSkillActivity({
      subscribe: async (h) => {
        emit = h;
        return () => {};
      },
    });
    // Bootstrap activations can arrive before AgentStarted.
    emit({ _tag: "SkillActivated", skillName: "pin", version: 1, trigger: "bootstrap", iteration: 0, confidence: "unrated", taskId: "t1", sha256: "s1" });
    emit({
      _tag: "AgentStarted", taskId: "t1", agentId: "a", provider: "test", model: "m", timestamp: 1,
      config: { skills: { roots: ["/w/.agents/skills"], catalog: [{ name: "pin", sha256: "s1" }, { name: "lib" }], pinned: ["pin"] } },
    } as AgentEvent);
    emit({ _tag: "AgentStarted", taskId: "child", agentId: "c", provider: "test", model: "m", timestamp: 2, parentAgentId: "a" } as AgentEvent);
    emit({ _tag: "SkillActivated", skillName: "lib", version: 1, trigger: "model", iteration: 2, confidence: "unrated" });
    const view = log.skillsOf("t1");
    expect(view?.activations).toEqual([
      { name: "pin", via: "pinned", version: 1, sha256: "s1", iteration: 0 },
      { name: "lib", via: "agent", version: 1, iteration: 2 },
    ]);
    expect(view?.available).toBe(2);
    expect(log.skillsOf("nope")).toBeUndefined();
    unsubscribe();
  });
});

describe("per-turn pins", () => {
  it("turnSkillPinsOf cleans the request list", () => {
    expect(turnSkillPinsOf([" a ", "A", "", 3, "b"])).toEqual(["a", "b"]);
    expect(turnSkillPinsOf("a")).toEqual([]);
  });
  it("withTurnSkillPins adds names to activate and leaves cfg alone without pins", () => {
    const cfg = { provider: "test", skills: { paths: ["/x"], activate: ["keep"] } };
    expect(withTurnSkillPins(cfg, [])).toBe(cfg);
    expect(withTurnSkillPins(cfg, ["keep", "new"]).skills).toEqual({ paths: ["/x"], activate: ["keep", "new"] });
  });
  it("withTurnSkills leaves a trace without skills unchanged", () => {
    expect(withTurnSkills(undefined, undefined)).toBeUndefined();
    expect(withTurnSkills(undefined, { activations: [], pinned: [], available: 1, roots: [] })?.skills?.available).toBe(1);
  });
});

describe("chatStream with a one-turn pin (test provider, real agent)", () => {
  let ws: string;
  const path = `/tmp/cortex-turn-skills-${crypto.randomUUID()}.db`;
  beforeAll(() => {
    ws = mkdtempSync(join(tmpdir(), "cortex-turn-skills-"));
    const dir = join(ws, ".agents", "skills", "release-notes");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), "---\nname: release-notes\ndescription: Write release notes the repo way\n---\n\nUse the RN-77 format.\n");
  });
  afterAll(() => {
    rmSync(ws, { recursive: true, force: true });
    for (const sfx of ["", "-wal", "-shm"]) rmSync(path + sfx, { force: true });
  });

  it("the pinned turn records the skill as pinned; the session config is untouched", async () => {
    const db = openDatabase(path);
    const svc = new ChatSessionService(db);
    try {
      const id = await svc.createSession({ agentConfig: { provider: "test", model: "test-model", enableTools: true, workspace: ws } });
      const events: { _tag: string }[] = [];
      for await (const e of svc.chatStream(id, "Draft the notes", undefined, undefined, { skills: ["release-notes"] })) events.push(e);
      expect(events.some((e) => e._tag === "StreamCompleted")).toBe(true);

      const last = getChatTurns(db, id).at(-1)!;
      expect(last.role).toBe("assistant");
      const skills = last.trace?.skills;
      expect(skills?.activations.find((a) => a.name === "release-notes")?.via).toBe("pinned");
      expect(skills?.pinned).toContain("release-notes");
      // The pin was for this turn only.
      expect((getChatSession(db, id)!.agentConfig.skills as { activate?: string[] } | undefined)?.activate).toBeUndefined();

      // The next turn has no pin: the skill is still in the catalog but not pinned.
      for await (const _ of svc.chatStream(id, "Anything else?")) void _;
      const next = getChatTurns(db, id).at(-1)!;
      expect(next.trace?.skills?.pinned ?? []).not.toContain("release-notes");
      expect(next.trace?.skills?.available).toBeGreaterThanOrEqual(1);
    } finally {
      await svc.disposeAll();
      db.close();
    }
  });
});
