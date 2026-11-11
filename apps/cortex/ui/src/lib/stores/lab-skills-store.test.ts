import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { createLabSkillsStore, formatYamlValue, skillCatalogRows, type FsSkillSummary } from "./lab-skills-store.js";

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

const fs = (name: string, description = ""): FsSkillSummary => ({ source: "filesystem", relPath: `.agents/skills/${name}/SKILL.md`, skillDir: `.agents/skills/${name}`, name, description });

describe("lab skills store", () => {
  test("loadInitial reads the SQLite list and the disk skills", async () => {
    const { fn } = fakeFetch({
      "GET /api/skills": () => ({ body: [{ id: "1", name: "db-skill" }] }),
      "GET /api/skills/files": () => ({ body: { skills: [fs("disk")] } }),
    });
    const store = createLabSkillsStore("http://x", fn);
    await store.loadInitial();
    expect(get(store).skills).toEqual([{ id: "1", name: "db-skill" }]);
    expect(get(store).fsSkills.map((s) => s.name)).toEqual(["disk"]);
  });

  test("discover failure clears the roots", async () => {
    const ok = createLabSkillsStore("http://x", fakeFetch({ "GET /api/skills/discover": () => ({ body: { paths: [".agents/skills"] } }) }).fn);
    await ok.loadDiscover();
    expect(get(ok).discoveredPaths).toEqual([".agents/skills"]);
    const bad = createLabSkillsStore("http://x", fakeFetch({ "GET /api/skills/discover": () => "throw" }).fn);
    await bad.loadDiscover();
    expect(get(bad).discoveredPaths).toEqual([]);
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

  test("fetchDetail picks the file or SQLite route", async () => {
    const detail = { name: "d", description: "", instructions: "", metadata: {}, filePath: "f", resources: { scripts: [], references: [], assets: [] } };
    const { fn, urls } = fakeFetch({
      "GET /api/skills/file?path=a%2FSKILL.md": () => ({ body: detail }),
      "GET /api/skills/sqlite/7": () => ({ status: 404, body: { error: "missing" } }),
    });
    const store = createLabSkillsStore("http://x", fn);
    expect(await store.fetchDetail({ kind: "filesystem", relPath: "a/SKILL.md" })).toEqual({ detail });
    expect(await store.fetchDetail({ kind: "sqlite", id: "7" })).toEqual({ error: "missing" });
    expect(urls).toHaveLength(2);
  });
});

describe("skillCatalogRows", () => {
  test("disk then SQLite, each under a header", () => {
    const rows = skillCatalogRows([fs("a")], [{ id: "1", name: "b" }, { name: "c" }], "");
    expect(rows.map((r) => (r.t === "hdr" ? `#${r.label}` : r.t === "fs" ? r.s.name : r.rowKey))).toEqual(["#On disk", "a", "#SQLite (desk DB)", "sql-1", "sql-i1"]);
  });
  test("filter matches name or description and drops empty sections", () => {
    const rows = skillCatalogRows([fs("alpha", "x"), fs("beta", "has needle")], [{ name: "gamma" }], "NEEDLE");
    expect(rows.map((r) => r.t)).toEqual(["hdr", "fs"]);
  });
});

test("formatYamlValue", () => {
  expect(formatYamlValue(null)).toBe("");
  expect(formatYamlValue({ a: 1 })).toBe('{"a":1}');
  expect(formatYamlValue(3)).toBe("3");
});
