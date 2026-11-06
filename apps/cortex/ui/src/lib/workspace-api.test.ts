import { describe, expect, test } from "bun:test";
import { browseWorkspace, pathCrumbs, workspaceCandidates, workspaceLabel, workspaceSuggestions, type WorkspaceCandidate } from "./workspace-api.js";

const json = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

const cands: WorkspaceCandidate[] = [
  { path: "/repo", source: "launch-git-root", isGitRepo: true },
  { path: "/repo/app", source: "launch", isGitRepo: false },
  { path: "/old", source: "recent", isGitRepo: false },
];

describe("workspaceSuggestions", () => {
  test("current workspace leads (marked current), then ranked candidates, deduped", () => {
    expect(workspaceSuggestions("/old", cands)).toEqual([
      { path: "/old", current: true, source: "recent" },
      { path: "/repo", current: false, source: "launch-git-root" },
      { path: "/repo/app", current: false, source: "launch" },
    ]);
  });

  test("no current workspace: launch project first", () => {
    expect(workspaceSuggestions("", cands)[0]).toEqual({ path: "/repo", current: false, source: "launch-git-root" });
  });

  test("a current workspace no source suggested still shows", () => {
    expect(workspaceSuggestions("/elsewhere", [])).toEqual([{ path: "/elsewhere", current: true }]);
  });
});

describe("pathCrumbs", () => {
  test("splits an absolute path into clickable ancestors", () => {
    expect(pathCrumbs("/home/me/")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "me", path: "/home/me" },
    ]);
    expect(pathCrumbs("/")).toEqual([{ label: "/", path: "/" }]);
  });
});

describe("workspace clients", () => {
  test("candidates drop malformed rows and fail soft", async () => {
    const r = await workspaceCandidates(json({ candidates: [...cands, { path: 3 }, { path: "/x", source: "bogus" }], home: "/home/me" }));
    expect(r).toEqual({ candidates: cands, home: "/home/me" });
    expect(await workspaceCandidates(json({}, 500))).toEqual({ candidates: [], home: null });
  });

  test("browse returns the listing or the server's refusal", async () => {
    const listing = { ok: true as const, path: "/repo", parent: "/", isGitRepo: true, entries: [{ name: "src", path: "/repo/src", isGitRepo: false }], truncated: false };
    expect(await browseWorkspace("/repo", false, json(listing))).toEqual(listing);
    expect(await browseWorkspace("rel", false, json({ ok: false, error: "Workspace must be an absolute path" }, 400))).toEqual({ ok: false, error: "Workspace must be an absolute path" });
  });

  test("workspaceLabel shows the last segment", () => {
    expect(workspaceLabel("/home/me/project/")).toBe("project");
  });
});
