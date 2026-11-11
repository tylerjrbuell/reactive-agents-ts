// Run: bun run repo test apps/cortex/server/tests/cortex-version.test.ts
//
// Settings · About versions: a source checkout reads the repo VERSION (+ git sha), not
// the frozen workspace package.json baseline; a published package reads its stamped
// package.json and the runtime's.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cortexPackageRoot, resolveCortexVersion, type VersionDeps } from "../services/cortex-version.js";
import { healthRouter } from "../api/health.js";

const fakeFs = (files: Record<string, string>, sha: string | null = null, runtimeEntry?: string): VersionDeps => ({
  readText: (p) => files[p],
  gitShortSha: () => sha,
  runtimeEntry: () => runtimeEntry,
});

describe("resolveCortexVersion", () => {
  it("source checkout: VERSION and git sha, not the package.json baseline", () => {
    const deps = fakeFs(
      {
        "/repo/package.json": JSON.stringify({ name: "reactive-agents", workspaces: ["packages/*", "apps/*"] }),
        "/repo/VERSION": "0.18.0\n",
        "/repo/apps/cortex/package.json": JSON.stringify({ name: "@reactive-agents/cortex", version: "0.10.6" }),
      },
      "abc1234",
    );
    expect(resolveCortexVersion("/repo/apps/cortex", deps)).toEqual({
      cortexVersion: "0.18.0",
      frameworkVersion: "0.18.0",
      commit: "abc1234",
      origin: "workspace",
    });
  });

  it("published package: stamped package.json and the runtime's version", () => {
    const deps = fakeFs(
      {
        "/app/node_modules/@reactive-agents/cortex/package.json": JSON.stringify({ name: "@reactive-agents/cortex", version: "0.18.0" }),
        "/app/node_modules/@reactive-agents/runtime/package.json": JSON.stringify({ name: "@reactive-agents/runtime", version: "0.18.0" }),
        // A user's project that merely has a VERSION file is not the monorepo.
        "/app/VERSION": "9.9.9",
        "/app/package.json": JSON.stringify({ name: "my-app" }),
      },
      "deadbee",
      "/app/node_modules/@reactive-agents/runtime/dist/index.js",
    );
    expect(resolveCortexVersion("/app/node_modules/@reactive-agents/cortex", deps)).toEqual({
      cortexVersion: "0.18.0",
      frameworkVersion: "0.18.0",
      commit: null,
      origin: "package",
    });
  });

  it("this checkout reports the repo VERSION", async () => {
    const root = cortexPackageRoot();
    expect(root.endsWith(join("apps", "cortex"))).toBe(true);
    const repoVersion = readFileSync(join(root, "..", "..", "VERSION"), "utf8").trim();
    const res = await healthRouter.handle(new Request("http://localhost/api/health/"));
    const body = (await res.json()) as { ok: boolean; version: string; cortexVersion: string; frameworkVersion: string; origin: string };
    expect(body.ok).toBe(true);
    expect(body.origin).toBe("workspace");
    expect(body.cortexVersion).toBe(repoVersion);
    expect(body.version).toBe(repoVersion);
    expect(body.frameworkVersion).toBe(repoVersion);
  });
});
