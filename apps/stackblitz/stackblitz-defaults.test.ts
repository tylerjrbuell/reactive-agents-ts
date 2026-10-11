// Run: bun test apps/stackblitz/stackblitz-defaults.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type DemoName =
  | "01-hello-agent"
  | "02-tool-integration"
  | "03-strategy-demo";
type DemoFile = "src/agent.ts" | "src/env-setup.ts" | ".env.example";

const DEMOS: readonly DemoName[] = [
  "01-hello-agent",
  "02-tool-integration",
  "03-strategy-demo",
] as const;

const readDemoFile = (demo: DemoName, file: DemoFile): string =>
  readFileSync(resolve(import.meta.dir, demo, file), "utf8");

describe("StackBlitz demo defaults", () => {
  for (const demo of DEMOS) {
    it(`${demo} defers unconfigured models to current provider defaults`, () => {
      const source = readDemoFile(demo, "src/agent.ts");
      const envExample = readDemoFile(demo, ".env.example");

      expect(source).not.toContain("gemini-2.0-flash");
      expect(source).not.toContain('.withModel(model ?? "")');
      expect(source).toContain("const model = process.env.MODEL?.trim() || undefined;");
      expect(source).toContain("if (model) builder = builder.withModel(model);");
      expect(envExample).not.toContain("MODEL=gemini-2.0-flash");
    }, 15000);

    it(`${demo} disposes agents and reports failures instead of blank output`, () => {
      const source = readDemoFile(demo, "src/agent.ts");

      expect(source).toContain("dispose()");
      expect(source).toContain("finisher.report()");
      expect(source).not.toMatch(/^console\.log\(result\.output\)$/m);
      expect(source).not.toContain("process.exit(1)"); // no stray dead-code exits
    }, 15000);

    it(`${demo} has no dead ollamaEndpoint variable and uses the shared setup module`, () => {
      const source = readDemoFile(demo, "src/agent.ts");

      expect(source).not.toContain("const ollamaEndpoint =");
      expect(source).toContain('from "./env-setup.ts"');
    }, 15000);
  }

  it("auto-detects the provider from whichever key is present", () => {
    const setup = readDemoFile("01-hello-agent", "src/env-setup.ts");
    const source = readDemoFile("01-hello-agent", "src/agent.ts");

    expect(setup).toContain("detectProvider");
    expect(setup).toContain("GOOGLE_API_KEY");
    expect(source).toContain('const provider = resolveProvider("gemini");');
  }, 15000);

  it("streams live execution instead of a blocking run", () => {
    const hello = readDemoFile("01-hello-agent", "src/agent.ts");
    const tools = readDemoFile("02-tool-integration", "src/agent.ts");

    expect(hello).toContain("runStream(");
    expect(hello).toContain('"TextDelta"');
    expect(hello).toContain('"IterationProgress"');
    expect(tools).toContain('"ToolCallStarted"');
    expect(tools).toContain('"ToolCallCompleted"');
  }, 15000);

  it("surfaces the evidence receipt on completed runs", () => {
    const hello = readDemoFile("01-hello-agent", "src/agent.ts");

    expect(hello).toContain("receipt");
    expect(hello).toContain("verdict");
  }, 15000);

  it("opts into a curated tool surface for the live data demo", () => {
    const source = readDemoFile("02-tool-integration", "src/agent.ts");
    const readme = readDemoFile("02-tool-integration", "README.md");

    expect(source).toContain('builtins: ["crypto-price", "code-execute"]');
    expect(source).not.toContain("builtins: true");
    expect(source).toContain("crypto price");
    expect(source).not.toContain("scratchpad-write");
    expect(readme).not.toContain("scratchpad");
  }, 15000);

  it("runs three strategies with per-run budgets and reports strategyUsed", () => {
    const source = readDemoFile("03-strategy-demo", "src/agent.ts");
    const readme = readDemoFile("03-strategy-demo", "README.md");
    const envExample = readDemoFile("03-strategy-demo", ".env.example");

    expect(source).toContain('STRATEGIES: Strategy[] = ["reactive", "plan-execute-reflect", "adaptive"]');
    expect(source).toContain("withBudget({ tokenLimit: budgetLimit })");
    expect(source).toContain("strategyUsed");
    expect(source).not.toContain("STRATEGY_A");
    expect(readme).toContain("adaptive");
    expect(envExample).not.toContain("# STRATEGY_B=plan-execute-reflect");
  }, 15000);

  it("keeps the strategy demo's custom-strategy escape hatch current", () => {
    const envExample = readDemoFile("03-strategy-demo", ".env.example");

    expect(envExample).toContain("# STRATEGIES=reactive,tree-of-thought");
  }, 15000);

  it("updates the hello demo docs to match its new features", () => {
    const readme = readDemoFile("01-hello-agent", "README.md");

    expect(readme).toContain("streams");
    expect(readme).toContain("receipt");
  }, 15000);

  it("keeps entries free of top-level await for WebContainer evaluation", () => {
    // StackBlitz WebContainer instantiates the entry in a way that rejects
    // top-level await / top-level for-await with
    // `SyntaxError: Unexpected reserved word`. All async work must live
    // inside main(), invoked via main().catch at the bottom.
    for (const demo of DEMOS) {
      const source = readDemoFile(demo, "src/agent.ts");

      expect(source).toContain("async function main()");
      expect(source).toContain("main().catch(");
      for (const line of source.split("\n")) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith("import ") ||
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*")
        ) {
          continue;
        }
        // No top-level `await ...` or `for await ...` outside main().
        // (Indented awaits inside main()/helpers are fine.)
        expect(line).not.toMatch(/^(const|let|var)\s+\w+\s*=\s*await\s/);
        expect(line).not.toMatch(/^await\s/);
        expect(line).not.toMatch(/^for\s+await\s*\(/);
      }
    }
  }, 15000);

  it("uses explicit .ts import extensions so plain node can run the entry", () => {
    // Lets the demos run under Node's native type-stripping
    // (node --env-file-if-exists=.env src/agent.ts) as a tsx fallback.
    // (The shared-setup assertion above already pins the .ts extension;
    // this guards against a bare "./env-setup" slipping back in.)
    for (const demo of DEMOS) {
      const source = readDemoFile(demo, "src/agent.ts");

      expect(source).toContain('from "./env-setup.ts"');
      expect(source).not.toMatch(/from "\.\/env-setup"/);
    }
  }, 15000);
});
