import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { findOversizePage, scanRepo, scanText } from "../scripts/stale-claims";

const rules = (t: string) => scanText("x.md", t).map((c) => c.rule);

describe("stale-claims guard", () => {
  it("flags a non-canonical Discord invite, allows the canonical one", () => {
    expect(rules("join https://discord.gg/498xEG5A")).toEqual(["non-canonical-discord-invite"]);
    expect(rules("join https://discord.gg/Mp99vQam3Q")).toEqual([]);
  });

  it("flags Node-on-the-roadmap", () => {
    expect(rules("Node.js support is on the roadmap.")).toEqual(["node-on-roadmap"]);
  });

  it("flags Bun-required without Node, allows paired or negated wording", () => {
    expect(rules("Requires Bun >= 1.1.0")).toEqual(["bun-required"]);
    expect(rules("Bun >=1.1 required")).toEqual(["bun-required"]);
    expect(rules("Bun is recommended, never required")).toEqual([]);
    expect(rules("Bun (recommended) or Node 22.5+ required")).toEqual([]);
  });

  it("flags zero/no any absolutes, allows contributor instructions", () => {
    expect(rules("TypeScript-native with zero `any` in framework code")).toEqual(["any-absolute"]);
    expect(rules("Written with no any anywhere")).toEqual(["any-absolute"]);
    expect(rules("- No `any` — use precise types")).toEqual([]);
  });

  it("flags Node 18/20 and Bun 1.0 floors, allows the real floors and unrelated text", () => {
    expect(rules("- Node.js 18+")).toEqual(["node-old-floor"]);
    expect(rules("Works in Node 18+, Bun, and browsers.")).toEqual(["node-old-floor"]);
    expect(rules("Bun ≥ 1.0 (or Node ≥ 20)")).toEqual(["node-old-floor", "bun-old-floor"]);
    expect(rules("**[Bun](https://bun.sh)** ≥ 1.0 (or Node ≥ 22.5)")).toEqual(["bun-old-floor"]);
    expect(rules("Bun 1.0+ is recommended")).toEqual(["bun-old-floor"]);
    expect(rules("Bun ≥1.1.0 and Node.js 22.5+")).toEqual([]);
    expect(rules("CI runs on Node 20 LTS; ships 20 packages")).toEqual([]);
  });

  it("flags 'stable since 0.9' and the stale What's New range", () => {
    expect(rules("the API has been stable since 0.9.0")).toEqual(["stable-since-0-9"]);
    expect(rules("description=\"v0.9.0 → v0.10.6 release highlights\"")).toEqual(["stable-since-0-9"]);
    expect(rules("0.x minor releases may include breaking changes")).toEqual([]);
  });

  it("flags strategy switching described as default-on, allows opt-in and history", () => {
    expect(rules("Strategy switching is on by default; customize it")).toEqual(["switching-default-on"]);
    expect(rules("`enableStrategySwitching` now defaults to `true`.")).toEqual(["switching-default-on"]);
    expect(rules("// enableStrategySwitching defaults to true")).toEqual(["switching-default-on"]);
    expect(rules("Strategy switching is opt-in (off by default).")).toEqual([]);
    expect(rules("It was on by default; strategy switching is now opt-in")).toEqual([]);
    expect(rules("### Strategy switching on by default (superseded in v0.18)")).toEqual([]);
  });

  describe("count-mismatch vs metrics.json", () => {
    const m = { tests: 13601, packages: 33, packagesTotal: 35 };
    const counts = (t: string, file = "x.md") => scanText(file, t, m).map((c) => c.rule);
    it("flags stale test and package counts", () => {
      expect(counts("bun test # 9,000+ tests")).toEqual(["count-mismatch"]);
      expect(counts("5,028 tests across 556 files")).toEqual(["count-mismatch"]);
      expect(counts("It ships 25 packages")).toEqual(["count-mismatch"]);
      expect(counts("13,000+ tests")).toEqual([]);
    });
    it("allows matching counts, tiny counts and release notes", () => {
      expect(counts("13,601 tests / 2,200+ files")).toEqual([]);
      expect(counts("33 packages on npm (35 total in the monorepo)")).toEqual([]);
      expect(counts("add 3 tests and 12 packages of notes")).toEqual([]);
      expect(counts("9,000+ tests", "apps/docs/src/content/docs/guides/whats-new.mdx")).toEqual([]);
    });
    it("is off without metrics (pure-text callers)", () => {
      expect(rules("9,000+ tests")).toEqual([]);
    });
  });

  describe("strategy-table-duplicate (one canonical strategies page)", () => {
    const table = [
      "| Strategy | Notes |",
      "|---|---|",
      "| **ReAct** | default |",
      "| **Reflexion** | critique |",
      "| **Plan-Execute** | plans |",
      "| **Tree-of-Thought** | search |",
      "| **Adaptive** | routes |",
    ].join("\n");
    it("flags a second table that re-lists 5+ strategies, one per row", () => {
      expect(rules(table)).toEqual(["strategy-table-duplicate"]);
      expect(rules("| Workload | Strategy |\n|---|---|\n| API | `reactive` |\n| plans | `plan-execute-reflect` |\n| ideas | `tree-of-thought` |\n| critique | `reflexion` |\n| mixed | `adaptive` |")).toEqual(["strategy-table-duplicate"]); // a workload-to-strategy cheat sheet is the same table
    });
    it("allows the canonical page, release notes, skills and short template maps", () => {
      expect(scanText("apps/docs/src/content/docs/guides/choosing-strategies.mdx", table)).toEqual([]);
      expect(scanText("apps/docs/src/content/docs/guides/whats-new.mdx", table)).toEqual([]);
      expect(scanText("apps/docs/skills/x/SKILL.md", table)).toEqual([]);
      expect(rules("| T | U |\n|---|---|\n| `react` | a |\n| `plan-execute` | b |\n| `reflexion` | c |\n| `tree-of-thought` | d |\n| `fact-check` | e |")).toEqual([]);
    });
  });

  describe("one-home duplicate guards (tools+MCP, memory, cost)", () => {
    const P = "apps/docs/src/content/docs/";
    const cases: ReadonlyArray<readonly [string, string, string, string]> = [
      ["tools-mcp-duplicate", "  resultCompression: {\n    previewItems: 5,\n  }", "guides/tools.mdx", "guides/other.mdx"],
      ["tools-mcp-duplicate", '  auth: { type: "client_credentials", clientId: "x" }', "guides/tools.mdx", "cookbook/x.md"],
      ["memory-duplicate", "  memory: { tier: \"enhanced\", experienceLearning: true },", "guides/memory.mdx", "guides/production-checklist.mdx"],
      ["memory-duplicate", "  decayFactor: 0.95,", "guides/memory.mdx", "cookbook/x.md"],
      ["cost-duplicate", "  tierModels: { haiku: \"a\" },", "features/cost-tracking.md", "guides/cost-optimization.mdx"],
      ["cost-duplicate", "if (e instanceof BudgetExceededError) {", "features/cost-tracking.md", "guides/production-checklist.mdx"],
      ["gateway-duplicate", '    crons: [{ schedule: "0 9 * * MON" }],', "features/gateway.md", "cookbook/production-deployment.md"],
      ["gateway-duplicate", "    policies: { maxActionsPerHour: 20 },", "features/gateway.md", "guides/deploying-agents.mdx"],
      ["gateway-duplicate", "const tg = new TelegramChannelAdapter({ token });", "guides/messaging-channels.mdx", "cookbook/x.md"],
      ["config-env-duplicate", "LLM_MAX_RETRIES=3", "reference/configuration.md", "guides/installation.mdx"],
      ["durable-runs-duplicate", '  .withApprovalPolicy({ tools: ["x"], mode: "detach" })', "guides/durable-hitl.md", "guides/production-checklist.mdx"],
      ["durable-runs-duplicate", "  await agent.approveRun(result.runId);", "guides/durable-hitl.md", "cookbook/building-tools.md"],
    ];
    it("flags a second copy of the option-level snippet on a non-canonical page", () => {
      for (const [rule, text, , other] of cases) {
        expect(scanText(P + other, text).map((c) => c.rule)).toEqual([rule]);
      }
    });
    it("allows the canonical page, reference pages, release notes and skills", () => {
      for (const [, text, home] of cases) {
        expect(scanText(P + home, text)).toEqual([]);
        expect(scanText(P + "reference/builder-api.md", text)).toEqual([]);
        expect(scanText(P + "guides/whats-new.mdx", text)).toEqual([]);
        expect(scanText("apps/docs/skills/x/SKILL.md", text)).toEqual([]);
      }
    });
    it("lets prose name the methods and options", () => {
      expect(scanText(P + "guides/x.md", "Use `.withMemoryConsolidation()` and `.withModelRouting()`; `previewItems` is documented in tools.")).toEqual([]);
    });
  });

  it("tools guide children share the tools-mcp home", () => {
    const P = "apps/docs/src/content/docs/";
    const snippet = '  auth: { type: "client_credentials", clientId: "x" }';
    expect(scanText(P + "guides/tools/mcp-tools.mdx", snippet)).toEqual([]);
    expect(scanText(P + "guides/tools/execution-and-results.mdx", "  resultCompression: {\n    previewItems: 5,\n  }")).toEqual([]);
    expect(scanText(P + "guides/security-hardening.md", snippet).map((c) => c.rule)).toEqual(["tools-mcp-duplicate"]);
  });

  describe("page-size ceiling", () => {
    const P = "apps/docs/src/content/docs/";
    const page = (words: number) => `---\ntitle: T\n---\n\n${"word ".repeat(words)}`;
    it("flags a new page over the ceiling, allows one under it", () => {
      expect(scanText(P + "guides/new-page.mdx", page(3400))).toEqual([]);
      expect(scanText(P + "guides/new-page.mdx", page(3600)).map((c) => c.rule)).toEqual(["page-too-long"]);
    });
    it("lets a listed exception shrink but not grow, and demands removal once it fits", () => {
      const cli = P + "features/cortex/chat-and-composer.mdx"; // the one remaining listed exception (cap 5700)
      expect(scanText(cli, page(5400))).toEqual([]);
      expect(scanText(cli, page(6200)).map((c) => c.rule)).toEqual(["page-too-long"]);
      expect(scanText(cli, page(3000))).toEqual([]);
      expect(findOversizePage(cli, page(3000), true).map((c) => c.rule)).toEqual(["oversize-exception-stale"]);
    });
    it("ignores files outside the content collection", () => {
      expect(scanText("apps/docs/skills/x/SKILL.md", page(9000))).toEqual([]);
    });
  });

  it("root README strategy table is governed (collapsed); npm README stays exempt", () => {
    const t = ["| S | N |", "|---|---|", "| ReAct | a |", "| Reflexion | b |", "| Plan-Execute | c |", "| Tree-of-Thought | d |", "| Adaptive | e |"].join("\n");
    expect(scanText("README.md", t).map((c) => c.rule)).toEqual(["strategy-table-duplicate"]);
    expect(scanText("packages/reactive-agents/README.md", t)).toEqual([]);
  });

  it("repo public surface has no stale claims", () => {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    expect(scanRepo(repoRoot)).toEqual([]);
  });
});
