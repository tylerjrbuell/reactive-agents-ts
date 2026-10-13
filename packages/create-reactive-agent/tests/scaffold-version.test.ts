import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { renderTemplate } from "../src/templates/index.js";
import { ownPackageVersion } from "../src/lib/own-version.js";
import type { ScaffoldOptions } from "../src/types.js";

// The truth the scaffold must pin: THIS package's own package.json version,
// which the lockstep release stamps at tag time (scripts/release.ts). A
// hardcoded fallback drifts and scaffolds projects that pin a framework too
// old to compile the template APIs (see the W0.1 brief).
const ownVersion = (
  JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  }
).version;

function baseOpts(over: Partial<ScaffoldOptions> = {}): ScaffoldOptions {
  return {
    dir: path.join(os.tmpdir(), "cra-version-test", "proj"),
    projectName: "proj",
    template: "minimal",
    provider: "anthropic",
    packageManager: "bun",
    ...over,
  };
}

function generatedRaiDep(opts: ScaffoldOptions): string {
  const files = renderTemplate(opts);
  const pkg = JSON.parse(files.find((f) => f.path === "package.json")!.content) as {
    dependencies: Record<string, string>;
  };
  return pkg.dependencies["reactive-agents"];
}

describe("scaffold version pin (W0.1)", () => {
  test("ownPackageVersion reads this package's package.json", () => {
    expect(ownPackageVersion()).toBe(ownVersion);
  });

  test("no opts.version pins ^<own package.json version>, not a stale literal", () => {
    const dep = generatedRaiDep(baseOpts());
    expect(dep).toBe(`^${ownVersion}`);
    // The old lying fallback - must never come back.
    expect(dep).not.toBe("^0.14.0");
  });

  test("opts.version override still wins", () => {
    expect(generatedRaiDep(baseOpts({ version: "9.9.9-override" }))).toBe("9.9.9-override");
  });

  test("template source contains no hardcoded reactive-agents version literal", () => {
    // Mirrors the release-time drift check in scripts/release.ts: the pin must
    // be computed (identifier), never a quoted literal in the template source.
    const shared = readFileSync(
      new URL("../src/templates/shared.ts", import.meta.url),
      "utf8",
    );
    expect(shared).not.toMatch(/"reactive-agents":\s*["']/);
  });
});
