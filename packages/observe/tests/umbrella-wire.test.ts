/**
 * WS-4 Phase 3 — observe pkg wire-up test.
 *
 * Pins the umbrella sub-path export and the apps/examples consumer.
 *
 * Anti-mission #6 (no scaffold-without-callers): observe must have at least
 * one umbrella surface and one production consumer or it does not exist.
 *
 * RED state (before wire-up):
 *   - `reactive-agents/observe` sub-path does not resolve (umbrella has no
 *     `./observe` export key and no `src/observe.ts` re-exporter).
 *   - `apps/examples/src/observe/otel-export.ts` does not exist / is not
 *     registered in the example suite.
 *
 * GREEN state (after wire-up):
 *   - `reactive-agents/observe` re-exports `OpenInferenceTracerLayer`,
 *     `setupOpenInferenceExporter`, `autoConfigureExporter`.
 *   - The example file exists, is registered, and `run()` actually invokes
 *     `setupOpenInferenceExporter` (not just imports it) so the consumer
 *     is real (anti-scaffold).
 */
import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

describe("WS-4 Phase 3 — @reactive-agents/observe wire-up", () => {
  describe("umbrella package surface", () => {
    it("re-exports observe public symbols via the umbrella sub-path", async () => {
      // Importing through the umbrella sub-path proves:
      //   1) `packages/reactive-agents/src/observe.ts` re-exporter exists
      //   2) `packages/reactive-agents/package.json` "exports"."./observe"
      //      is registered
      //   3) `packages/reactive-agents/tsup.config.ts` builds the entry
      //   4) `@reactive-agents/observe` is a workspace dep of the umbrella
      const mod = (await import("reactive-agents/observe")) as Record<
        string,
        unknown
      >;
      expect(typeof mod["OpenInferenceTracerLayer"]).toBe("object"); // Effect Layer
      expect(typeof mod["setupOpenInferenceExporter"]).toBe("function");
      expect(typeof mod["autoConfigureExporter"]).toBe("function");
    });

    it("lists @reactive-agents/observe as a workspace dep on the umbrella", () => {
      const pkgPath = resolve(
        REPO_ROOT,
        "packages/reactive-agents/package.json",
      );
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(pkg.dependencies?.["@reactive-agents/observe"]).toBe(
        "workspace:*",
      );
    });
  });

  describe("apps/examples consumer", () => {
    it("ships an OTel export example file", () => {
      const examplePath = resolve(
        REPO_ROOT,
        "apps/examples/src/observe/otel-export.ts",
      );
      expect(existsSync(examplePath)).toBe(true);

      const source = readFileSync(examplePath, "utf8");
      // The example MUST actually invoke setupOpenInferenceExporter so the
      // consumer is real (otherwise this is scaffold-without-callers).
      expect(source).toContain("setupOpenInferenceExporter");
      // The example MUST provide the tracer Layer to the agent runtime so
      // spans actually get produced.
      expect(source).toContain("OpenInferenceTracerLayer");
      // And it must export a run() function matching the suite convention.
      expect(source).toMatch(/export\s+async\s+function\s+run\s*\(/);
    });

    it("registers the example in the apps/examples runner", () => {
      const indexPath = resolve(REPO_ROOT, "apps/examples/index.ts");
      const source = readFileSync(indexPath, "utf8");
      expect(source).toContain("./src/observe/otel-export.ts");
    });

    it("example actually runs setupOpenInferenceExporter and shuts down cleanly", async () => {
      // Real-consumer check: import the example, run it, assert it exercised
      // the OTel exporter path without throwing. We resolve the path via the
      // repo to keep this test independent of how bun resolves apps/examples.
      const examplePath = resolve(
        REPO_ROOT,
        "apps/examples/src/observe/otel-export.ts",
      );
      const mod = (await import(examplePath)) as {
        run: (opts?: {
          provider?: string;
          model?: string;
        }) => Promise<{
          passed: boolean;
          output: string;
          steps: number;
          tokens: number;
          durationMs: number;
        }>;
      };
      const result = await mod.run({ provider: "test" });
      expect(result.passed).toBe(true);
      // Output should mention the exporter so we know the OTel branch ran.
      expect(result.output.toLowerCase()).toContain("otel");
    });
  });
});
