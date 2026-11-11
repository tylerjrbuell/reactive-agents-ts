import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { createLabSkillsStore, formatYamlValue, skillCatalogRows, skillScopeOf, workspaceScopeQuery, type WorkspaceSkillSummary } from "./lab-skills-store.js";

function fakeFetch(routes: Record<string, () => { status?: number; body?: unknown } | "throw">) {
  const urls: string[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).replace("http://x", "")}`;
    urls.push(key);
    const route = routes[key];
    const r = route ? route() : { status: 404 };
    if (r === "throw") throw new Error("network");
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fn, urls };
}

const fs = (name: string, description = ""): WorkspaceSkillSummary => ({
  name,
  description,
  filePath: `/ws/.agents/skills/${name}/SKILL.md`,
  root: "/ws/.agents/skills",
  source: "workspace",
});

describe("lab skills store", () => {
  test("loadInitial reads the library and the workspace skills (framework discovery at the Builder workspace)", async () => {
    const { fn, urls } = fakeFetch({
      "GET /api/skills": () => ({ body: [{ id: "1", name: "db-skill" }] }),
      "GET /api/skills/workspace?root=%2Fws": () => ({ body: { root: "/ws", scanned: [{ path: "/ws/.agents/skills", source: "workspace", exists: true }], skills: [fs("disk")] } }),
    });
    const store = createLabSkillsStore("http://x", fn);
    await store.loadInitial({ root: "/ws" });
    expect(get(store).skills).toEqual([{ id: "1", name: "db-skill" }]);
    expect(get(store).workspaceSkills.map((s) => s.name)).toEqual(["disk"]);
    expect(get(store).workspaceScan?.root).toBe("/ws");
    expect(urls).toContain("GET /api/skills/workspace?root=%2Fws");
  });

  test("a refused workspace keeps the reason and clears the list", async () => {
    const store = createLabSkillsStore("http://x", fakeFetch({ "GET /api/skills/workspace?root=rel": () => ({ status: 400, body: { error: "Workspace must be an absolute path" } }) }).fn);
    await store.loadWorkspace({ root: "rel" });
    expect(get(store).workspaceError).toBe("Workspace must be an absolute path");
    expect(get(store).workspaceSkills).toEqual([]);
  });

  test("skillScopeOf reads the Builder's workspace and skills settings", () => {
    expect(skillScopeOf({ workspace: " /w ", skills: { paths: ["x"], global: true } })).toEqual({ root: "/w", paths: ["x"], global: true });
    expect(skillScopeOf({ workspace: "" })).toEqual({ paths: [] });
  });

  test("workspaceScopeQuery", () => {
    expect(workspaceScopeQuery({})).toBe("");
    expect(workspaceScopeQuery({ root: "/w", paths: ["a", " "], global: true })).toBe("?root=%2Fw&paths=a&global=1");
  });

  test("create throws the server's error; remove reports it", async () => {
    const { fn } = fakeFetch({
      "POST /api/skills": () => ({ status: 400, body: { error: "name taken" } }),
      "DELETE /api/skills/9": () => ({ status: 409, body: { error: "in use" } }),
      "DELETE /api/skills/1": () => ({}),
    });
    const store = createLabSkillsStore("http://x", fn);
    await expect(store.create({ name: "n", instructions: "i" })).rejects.toThrow("name taken");
    expect(await store.remove("9")).toEqual({ ok: false, error: "in use" });
    expect(await store.remove("1")).toEqual({ ok: true });
  });

  test("fetchDetail picks the workspace or SQLite route", async () => {
    const detail = { name: "d", description: "", instructions: "", metadata: {}, filePath: "f", resources: { scripts: [], references: [], assets: [] } };
    const { fn, urls } = fakeFetch({
      "GET /api/skills/workspace/file?path=%2Fws%2Fa%2FSKILL.md": () => ({ body: detail }),
      "GET /api/skills/sqlite/7": () => ({ status: 404, body: { error: "missing" } }),
    });
    const store = createLabSkillsStore("http://x", fn);
    expect(await store.fetchDetail({ kind: "workspace", filePath: "/ws/a/SKILL.md" })).toEqual({ detail });
    expect(await store.fetchDetail({ kind: "sqlite", id: "7" })).toEqual({ error: "missing" });
    expect(urls).toHaveLength(2);
  });
});

describe("skillCatalogRows", () => {
  test("workspace then the Cortex library, each under a header that says whether agents load it", () => {
    const rows = skillCatalogRows([fs("a")], [{ id: "1", name: "b" }, { name: "c" }], "");
    expect(rows.map((r) => (r.t === "hdr" ? `#${r.label}: ${r.note}` : r.t === "ws" ? r.s.name : r.rowKey))).toEqual([
      "#Workspace: agents can load these",
      "a",
      "#Cortex library (deprecated): not sent to agents; move each into an agent's skills",
      "sql-1",
      "sql-i1",
    ]);
  });
  test("filter matches name or description and drops empty sections", () => {
    const rows = skillCatalogRows([fs("alpha", "x"), fs("beta", "has needle")], [{ name: "gamma" }], "NEEDLE");
    expect(rows.map((r) => r.t)).toEqual(["hdr", "ws"]);
  });
});

test("formatYamlValue", () => {
  expect(formatYamlValue(null)).toBe("");
  expect(formatYamlValue({ a: 1 })).toBe('{"a":1}');
  expect(formatYamlValue(3)).toBe("3");
});
