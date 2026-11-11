// Run: bun run repo test apps/cortex/server/tests/workspace-skills.test.ts
/**
 * Workspace skills (roadmap C5): Cortex lists the skills the agent can load with the
 * framework's own discovery at the session's workspace, chat agents always get
 * withSkills(), pins are names, and the cwd-relative roots older chat pins wrote are
 * rewritten so the pin still resolves when the workspace differs from the server cwd.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { applySchema } from "../db/schema.js";
import { getChatSession } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { skillsRouter } from "../api/skills.js";
import { chatSessionSkillListing, listWorkspaceSkills, migrateChatSkillsConfig, skillRootOf } from "../services/workspace-skills.js";
import { parseCortexSkillsConfig } from "../services/cortex-agent-config.js";
import type { BuildCortexAgentParams } from "../services/build-cortex-agent.js";

const skill = (dir: string, name: string, description = `${name} skill`) => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nDo ${name}.\n`);
};

let ws: string;
let cwd: string;
let home: string;
const prevHome = process.env.HOME;

beforeAll(() => {
  ws = mkdtempSync(join(tmpdir(), "cortex-ws-skills-"));
  cwd = mkdtempSync(join(tmpdir(), "cortex-cwd-skills-"));
  home = mkdtempSync(join(tmpdir(), "cortex-home-skills-"));
  skill(join(ws, ".agents", "skills"), "release-notes", "Write release notes the repo way");
  skill(join(ws, ".claude", "skills"), "claude-only");
  skill(join(ws, ".agent-7", "skills"), "agent-scoped");
  skill(join(cwd, "apps", "x", ".agents", "skills"), "old-pin");
  skill(join(home, ".agents", "skills"), "global-one");
  process.env.HOME = home;
});
afterAll(() => {
  process.env.HOME = prevHome;
  for (const d of [ws, cwd, home]) rmSync(d, { recursive: true, force: true });
});

describe("listWorkspaceSkills (framework discovery)", () => {
  it("lists workspace, .claude and agent-scoped skills with their source; globals stay off", () => {
    const l = listWorkspaceSkills({ root: ws, agentId: "agent-7" });
    expect(l.skills.map((s) => [s.name, s.source])).toEqual([
      ["agent-scoped", "agent"],
      ["claude-only", "claude"],
      ["release-notes", "workspace"],
    ]);
    expect(l.skills.find((s) => s.name === "release-notes")?.description).toBe("Write release notes the repo way");
    expect(l.scanned.some((d) => d.path.startsWith(home))).toBe(false);
  });
  it("global: true adds the user-global dirs", () => {
    const l = listWorkspaceSkills({ root: ws, global: true });
    expect(l.skills.find((s) => s.name === "global-one")?.source).toBe("global");
  });
});

describe("migrateChatSkillsConfig", () => {
  it("rewrites a cwd-relative pin root to absolute, drops a built-in root, keeps names", () => {
    const out = migrateChatSkillsConfig(
      { paths: ["apps/x/.agents/skills", ".agents/skills"], activate: ["old-pin"] },
      { root: ws, serverCwd: cwd },
    );
    expect(out).toEqual({ paths: [join(cwd, "apps", "x", ".agents", "skills")], activate: ["old-pin"] });
  });
  it("no config still yields one: every chat agent gets withSkills()", () => {
    expect(migrateChatSkillsConfig(undefined, { root: ws, serverCwd: cwd })).toEqual({ paths: [] });
  });
  it("a workspace-relative path that exists there wins over the cwd", () => {
    mkdirSync(join(ws, "more"), { recursive: true });
    expect(migrateChatSkillsConfig({ paths: ["more"] }, { root: ws, serverCwd: cwd }).paths).toEqual([join(ws, "more")]);
  });
});

describe("chat sessions", () => {
  let db: Database;
  let svc: ChatSessionService;
  beforeAll(() => {
    db = new Database(":memory:");
    applySchema(db);
    svc = new ChatSessionService(db);
  });
  afterAll(async () => {
    await svc.disposeAll();
    db.close();
  });

  type ChatParamsOf = (sessionId: string, cfg: Record<string, unknown>, stableAgentId: string | undefined) => BuildCortexAgentParams;
  const paramsOf = (id: string): BuildCortexAgentParams => {
    const row = getChatSession(db, id)!;
    return (svc as unknown as { buildChatAgentParams: ChatParamsOf }).buildChatAgentParams(id, row.agentConfig, row.stableAgentId);
  };

  it("a chat with no skills config still gets withSkills() (desk runs do not)", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test", enableTools: true, workspace: ws } });
    expect(paramsOf(id).skills).toEqual({ paths: [] });
    expect(parseCortexSkillsConfig(undefined)).toBeUndefined();
    expect(parseCortexSkillsConfig({ paths: [] })).toBeUndefined();
  });

  it("pins are names and survive activate-only configs; global reaches the builder params", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test", enableTools: true, workspace: ws, skills: { activate: ["release-notes"], global: true } } });
    expect(paramsOf(id).skills).toEqual({ paths: [], activate: ["release-notes"], global: true });
  });

  it("the session listing discovers at the session workspace, not the server cwd", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test", enableTools: true, workspace: ws } });
    const row = getChatSession(db, id)!;
    const listing = chatSessionSkillListing(row, cwd);
    expect(listing.root).toBe(ws);
    expect(listing.skills.map((s) => s.name)).toContain("release-notes");
    expect(listing.skills.map((s) => s.name)).not.toContain("old-pin");
    expect(skillRootOf({}, cwd)).toBe(cwd);
  });

  it("GET /api/skills/session/:id and /api/skills/workspace", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test", enableTools: true, workspace: ws, skills: { activate: ["release-notes"] } } });
    const app = new Elysia().use(skillsRouter(CortexStoreServiceLive(db), db));
    const res = await app.handle(new Request(`http://localhost/api/skills/session/${id}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { root: string; pinned: string[]; skills: { name: string; source: string }[] };
    expect(body.root).toBe(ws);
    expect(body.pinned).toEqual(["release-notes"]);
    expect(body.skills.find((s) => s.name === "release-notes")?.source).toBe("workspace");

    const missing = await app.handle(new Request("http://localhost/api/skills/session/nope"));
    expect(missing.status).toBe(404);

    const wsRes = await app.handle(new Request(`http://localhost/api/skills/workspace?root=${encodeURIComponent(ws)}`));
    expect(((await wsRes.json()) as { skills: { name: string }[] }).skills.map((s) => s.name)).toContain("claude-only");
    const bad = await app.handle(new Request("http://localhost/api/skills/workspace?root=relative/dir"));
    expect(bad.status).toBe(400);

    // Detail reads only a SKILL.md discovery found for that scope.
    const file = join(ws, ".agents", "skills", "release-notes", "SKILL.md");
    const doc = await app.handle(new Request(`http://localhost/api/skills/workspace/file?root=${encodeURIComponent(ws)}&path=${encodeURIComponent(file)}`));
    expect(((await doc.json()) as { name: string }).name).toBe("release-notes");
    const outside = await app.handle(new Request(`http://localhost/api/skills/workspace/file?root=${encodeURIComponent(ws)}&path=${encodeURIComponent("/etc/passwd")}`));
    expect(outside.status).toBe(404);
  });
});
