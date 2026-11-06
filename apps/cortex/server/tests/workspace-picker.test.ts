// Run: bun run repo test apps/cortex/server/tests/workspace-picker.test.ts
//
// The workspace picker suggests directories (launch dir + git root, scan root,
// recent) and browses subdirectories so desk users never have to type a path.
// These pin the ranking, the browse listing (directories only, hidden behind a
// flag) and the refusals (relative, missing, not a directory).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { applySchema } from "../db/schema.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { workspaceRouter } from "../api/workspace.js";
import { browseDirectory, findGitRoot, rankWorkspaceCandidates, workspaceCandidates } from "../services/workspace-dir.js";

let root: string;
let repo: string;
let db: Database;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cortex-picker-"));
  repo = join(root, "repo");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "apps", "cortex"), { recursive: true });
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, ".hidden"));
  writeFileSync(join(repo, "README.md"), "not a directory");
  mkdirSync(join(root, "other", ".git"), { recursive: true });
  symlinkSync(join(root, "other"), join(repo, "linked"));
  db = new Database(":memory:");
  applySchema(db);
});

afterAll(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe("rankWorkspaceCandidates", () => {
  it("orders launch git root, launch, scan root, then recent in input order; dedupes keeping the best source", () => {
    const out = rankWorkspaceCandidates([
      { path: "/r2", source: "recent", isGitRepo: false },
      { path: "/repo", source: "recent", isGitRepo: true },
      { path: "/r1", source: "recent", isGitRepo: false },
      { path: "/scan", source: "scan-root", isGitRepo: false },
      { path: "/repo/app", source: "launch", isGitRepo: false },
      { path: "/repo", source: "launch-git-root", isGitRepo: true },
    ]);
    expect(out.map((c) => [c.path, c.source])).toEqual([
      ["/repo", "launch-git-root"],
      ["/repo/app", "launch"],
      ["/scan", "scan-root"],
      ["/r2", "recent"],
      ["/r1", "recent"],
    ]);
  });
});

describe("workspaceCandidates", () => {
  it("finds the git root above the launch dir and keeps only existing directories", async () => {
    expect(findGitRoot(join(repo, "apps", "cortex"))).toBe(repo);
    const svc = new ChatSessionService(db);
    await svc.createSession({ agentConfig: { provider: "test", workspace: join(root, "other") } });
    await svc.createSession({ agentConfig: { provider: "test", workspace: join(root, "gone") } });
    const out = workspaceCandidates(db, { launchDir: join(repo, "apps", "cortex"), scanRoot: join(repo, "src") });
    expect(out).toEqual([
      { path: repo, source: "launch-git-root", isGitRepo: true },
      { path: join(repo, "apps", "cortex"), source: "launch", isGitRepo: false },
      { path: join(repo, "src"), source: "scan-root", isGitRepo: false },
      { path: join(root, "other"), source: "recent", isGitRepo: true },
    ]);
  });
});

describe("browseDirectory", () => {
  it("lists subdirectories only (symlinked dirs included), hidden ones behind the flag", () => {
    const r = browseDirectory(repo);
    if (!r.ok) throw new Error(r.error);
    expect(r.path).toBe(repo);
    expect(r.parent).toBe(root);
    expect(r.isGitRepo).toBe(true);
    expect(r.entries.map((e) => e.name)).toEqual(["apps", "linked", "src"]);
    expect(r.entries.find((e) => e.name === "linked")?.isGitRepo).toBe(true);
    const withHidden = browseDirectory(repo, { hidden: true });
    expect(withHidden.ok && withHidden.entries.map((e) => e.name)).toEqual([".git", ".hidden", "apps", "linked", "src"]);
  });

  it("reports truncation past the limit and null parent at the filesystem root", () => {
    const r = browseDirectory(repo, { limit: 1 });
    expect(r.ok && [r.entries.length, r.truncated]).toEqual([1, true]);
    const top = browseDirectory("/");
    expect(top.ok && top.parent).toBeNull();
  });

  it("refuses relative, missing and non-directory paths", () => {
    expect(browseDirectory("relative").ok).toBe(false);
    expect(browseDirectory(join(root, "missing")).ok).toBe(false);
    expect(browseDirectory(join(repo, "README.md")).ok).toBe(false);
  });
});

describe("GET /api/workspace/candidates and /browse", () => {
  const get = (path: string) => new Elysia().use(workspaceRouter(db, { launchDir: join(repo, "apps", "cortex") })).handle(new Request(`http://localhost${path}`));

  it("candidates lead with the launch project's git root and include home", async () => {
    const res = await get("/api/workspace/candidates");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: { path: string; source: string }[]; home: string };
    expect(body.candidates[0]).toMatchObject({ path: repo, source: "launch-git-root" });
    expect(typeof body.home).toBe("string");
  });

  it("browse lists a directory, honours hidden=1 and returns 400 on a bad path", async () => {
    const ok = (await (await get(`/api/workspace/browse?path=${encodeURIComponent(repo)}`)).json()) as { entries: { name: string }[] };
    expect(ok.entries.map((e) => e.name)).toEqual(["apps", "linked", "src"]);
    const hidden = (await (await get(`/api/workspace/browse?path=${encodeURIComponent(repo)}&hidden=1`)).json()) as { entries: { name: string }[] };
    expect(hidden.entries.map((e) => e.name)).toContain(".hidden");
    expect((await get("/api/workspace/browse?path=relative%2Fdir")).status).toBe(400);
    expect((await get(`/api/workspace/browse?path=${encodeURIComponent(join(root, "missing"))}`)).status).toBe(400);
  });

  it("browse with no path starts at the home directory", async () => {
    const res = await get("/api/workspace/browse");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
