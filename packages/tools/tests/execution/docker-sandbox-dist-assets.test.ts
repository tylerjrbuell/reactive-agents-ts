// Run: bunx turbo run build --filter=@reactive-agents/tools && bun test packages/tools/tests/execution/docker-sandbox-dist-assets.test.ts --timeout 20000
//
// Found 2026-11-20 by the shipped-assets gate: docker-sandbox.ts resolves its
// seccomp profile and Dockerfiles next to the module (`sandbox-image/`). tsup
// bundled the module into dist/ but never copied `sandbox-image/`, so every npm
// install ran the Docker sandbox WITHOUT seccomp (the missing file was silently
// treated as "no profile") and buildSandboxImage() always returned false. Repo
// tests import src, where the files exist, so they never saw it.
//
// This file imports the BUILT package (dist/, the files npm users get), never
// src. It needs a current build (CI builds before `bun test`; locally run the
// build above).
//
// RED-ON-CUT: drop the `onSuccess` asset copy from tsup.config.ts, delete
// dist/sandbox-image, rebuild: all three tests fail.
import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSeccompProfilePath } from "../../dist/index.js";

const distFile = (name: string) => fileURLToPath(new URL(`../../dist/${name}`, import.meta.url));

describe("docker sandbox assets in the built dist (npm install layout)", () => {
  it("dist ships the seccomp profile", () => {
    expect(existsSync(distFile("sandbox-image/seccomp-sandbox.json"))).toBe(true);
  });

  it("dist ships the hardened-image Dockerfiles", () => {
    const missing = ["bun", "node", "python"].filter(
      (lang) => !existsSync(distFile(`sandbox-image/Dockerfile.${lang}`)),
    );
    expect(missing).toEqual([]);
  });

  it("getSeccompProfilePath() from dist names an existing file", () => {
    const path = getSeccompProfilePath();
    expect({ path, exists: existsSync(path) }).toEqual({ path, exists: true });
  });
});
