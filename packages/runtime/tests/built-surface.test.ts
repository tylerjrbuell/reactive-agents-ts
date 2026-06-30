// Run: bun test packages/runtime/tests/built-surface.test.ts --timeout 120000
//
// REGRESSION NET for build/export drift. The rest of the suite imports the
// builder from `../src/...`, so a method that exists in source but is dropped
// by the build (or never re-exported from the package barrel) stays GREEN
// everywhere while a real `npm install` consumer cannot call it. This test
// loads the BUILT `dist/index.js` the way a published consumer does and asserts
// every documented `.with*` method on the source builder survives compilation
// and is callable on the exported builder instance.
//
// Background: 2026-06-30 a hardening pass briefly believed `.withFabricationGuard`
// / `.withStallPolicy` were dropped from the build. That was a false alarm (a
// probe run from /tmp resolved the stale published package), but it exposed that
// NO test guards the built public surface. This is that guard.
import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const RUNTIME_PKG = resolve(import.meta.dir, "..");
const SRC_BUILDER = resolve(RUNTIME_PKG, "src/builder.ts");
const DIST_ENTRY = resolve(RUNTIME_PKG, "dist/index.js");

/** Extract the documented public `with*` method names from the source builder
 *  class — these ARE the public surface a consumer is told to call. */
function documentedWithMethods(): string[] {
  const src = readFileSync(SRC_BUILDER, "utf8");
  const names = new Set<string>();
  // Class methods are indented 4 spaces: `withFoo(` or `withFoo<T>(`.
  // Comment/doc lines start with `*`/`//` and never match `^    with[A-Z]`.
  const re = /^ {4}(with[A-Z][A-Za-z0-9]*)\s*(?:<[^>]*>)?\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) names.add(m[1]!);
  return [...names].sort();
}

describe("built dist public surface", () => {
  let BuiltReactiveAgents: { create: () => Record<string, unknown> };

  beforeAll(async () => {
    // Guarantee dist is current with src before asserting against it (turbo
    // cache makes this cheap when nothing changed).
    const proc = Bun.spawnSync(["bun", "run", "build"], {
      cwd: RUNTIME_PKG,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
      throw new Error(
        `runtime build failed (exit ${proc.exitCode}):\n${proc.stderr.toString().slice(-2000)}`,
      );
    }
    expect(existsSync(DIST_ENTRY)).toBe(true);
    // Import the BUILT artifact by absolute path — NOT `@reactive-agents/runtime`
    // (which the test runner aliases back to src). This is what a consumer loads.
    const mod = (await import(DIST_ENTRY)) as {
      ReactiveAgents: { create: () => Record<string, unknown> };
    };
    BuiltReactiveAgents = mod.ReactiveAgents;
  });

  it("exports ReactiveAgents.create() from the built dist", () => {
    expect(typeof BuiltReactiveAgents?.create).toBe("function");
  });

  it("exposes EVERY documented .with* method on the built builder instance", () => {
    const documented = documentedWithMethods();
    // Sanity: extraction found the real surface, not zero.
    expect(documented.length).toBeGreaterThan(50);
    expect(documented).toContain("withFabricationGuard");
    expect(documented).toContain("withStallPolicy");

    const builder = BuiltReactiveAgents.create();
    const missing = documented.filter((name) => typeof builder[name] !== "function");

    // A non-empty `missing` means a documented method exists in src but did not
    // survive to the built/exported builder — exactly the drift this guards.
    expect(missing).toEqual([]);
  });
});
