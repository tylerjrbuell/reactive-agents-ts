import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENT_PROMPT } from "../src/agent-docs/agent-prompt";
import { listDocsPages, llmsDetails } from "../src/agent-docs/llms-entry";
import {
  agentPreamble,
  markdownPathForPagePath,
  markdownPathForSlug,
  renderPageMarkdown,
  slugForId,
  sourceToAgentMarkdown,
} from "../src/agent-docs/page-markdown";

const DOCS = resolve(import.meta.dir, "..");
const REPO = resolve(DOCS, "../..");
const read = (p: string) => readFileSync(resolve(REPO, p), "utf8");
const CONTENT = resolve(DOCS, "src/content/docs");

describe("markdown twin paths", () => {
  it("maps ids and page paths to <page>.md", () => {
    expect(slugForId("index")).toBe("");
    expect(slugForId("features/cortex/index.mdx")).toBe("features/cortex");
    expect(markdownPathForSlug("")).toBe("/index.md");
    expect(markdownPathForSlug("guides/quickstart")).toBe("/guides/quickstart.md");
    expect(markdownPathForPagePath("/guides/quickstart/")).toBe("/guides/quickstart.md");
    expect(markdownPathForPagePath("/")).toBe("/index.md");
  });

  it("opens every twin with the two-line agent preamble", () => {
    const md = renderPageMarkdown({
      id: "guides/quickstart",
      title: "Quickstart",
      description: "Build your first agent.",
      body: "Hello.",
      mdx: false,
      version: "0.18.0",
      knownSlugs: new Set(["guides/quickstart"]),
    });
    expect(md.startsWith(agentPreamble("0.18.0"))).toBe(true);
    expect(md.split("\n")[0]).toContain("current reference for Reactive Agents 0.18.0");
    expect(md.split("\n")[1]).toContain("/llms.txt");
    expect(md).toContain("# Quickstart");
  });
});

describe("sourceToAgentMarkdown", () => {
  const known = new Set(["guides/installation", "concepts/effect-ts"]);
  const opts = { mdx: true, pagePath: "/guides/quickstart/", knownSlugs: known, agentPrompt: "PROMPT" };

  it("drops MDX imports and layout tags but keeps code fences byte-for-byte", () => {
    const src = [
      "import { Tabs, TabItem } from '@astrojs/starlight/components';",
      "",
      "<Tabs>",
      '  <TabItem label="Builder">',
      "```typescript",
      'import { ReactiveAgents } from "reactive-agents";',
      "const x: Promise<AgentResult> = run();",
      "```",
      "  </TabItem>",
      "</Tabs>",
    ].join("\n");
    const out = sourceToAgentMarkdown(src, opts);
    expect(out).not.toContain("@astrojs/starlight/components");
    expect(out).not.toContain("<Tabs>");
    expect(out).toContain("**Builder:**");
    expect(out).toContain('import { ReactiveAgents } from "reactive-agents";');
    expect(out).toContain("Promise<AgentResult>");
  });

  it("converts asides, link cards and the agent prompt", () => {
    const src = [
      '<Aside type="tip" title="In a hurry?">',
      "Skip ahead.",
      "</Aside>",
      "<LinkCard",
      '  title="Installation"',
      '  description="Set up -> run"',
      '  href="../installation/"',
      "/>",
      "<AgentPrompt />",
      ":::note[Effect]",
      "Peer dependency.",
      ":::",
    ].join("\n");
    const out = sourceToAgentMarkdown(src, opts);
    expect(out).toContain("**Tip: In a hurry?**");
    expect(out).toContain(
      "- [Installation](https://docs.reactiveagents.dev/guides/installation.md): Set up -> run",
    );
    expect(out).toContain("```text\nPROMPT\n```");
    expect(out).toContain("**Note: Effect**");
    expect(out).not.toContain(":::");
  });

  it("leaves inline generics alone and rewrites internal links to twins", () => {
    const out = sourceToAgentMarkdown(
      "Returns `Promise<AgentResult>`. See [Effect](/concepts/effect-ts/#layers) and [npm](https://npmjs.com).",
      opts,
    );
    expect(out).toContain("`Promise<AgentResult>`");
    expect(out).toContain("(https://docs.reactiveagents.dev/concepts/effect-ts.md#layers)");
    expect(out).toContain("(https://npmjs.com)");
  });

  it("strips multi-line imports and layout HTML, fills metrics expressions", () => {
    const src = [
      "import {",
      "    Card,",
      "    CardGrid,",
      "} from '@astrojs/starlight/components'",
      '<div class="ra-panel">',
      '        <span class="ra-stat-value">{metrics.tests.toLocaleString()}+</span> tests',
      '  <a href="/guides/installation/">Install</a>',
      "</div>",
    ].join("\n");
    const out = sourceToAgentMarkdown(src, { ...opts, metrics: { tests: 20700 } });
    expect(out).not.toContain("CardGrid");
    expect(out).not.toContain("<div");
    expect(out).toContain("20,700+ tests");
    expect(out).toContain("[Install](https://docs.reactiveagents.dev/guides/installation.md)");
    expect(out).not.toMatch(/^ {4}/m);
  });

  it("never treats tags in a .md page as components", () => {
    expect(sourceToAgentMarkdown("Use <AgentResult> here.", { ...opts, mdx: false })).toBe(
      "Use <AgentResult> here.",
    );
  });
});

describe("llms.txt entry", () => {
  const pages = listDocsPages(CONTENT);
  const details = llmsDetails({ pages, version: "0.18.0" });

  it("has agent guidance, starting points and an index line for every page", () => {
    expect(details).toContain("## How agents should use these docs");
    expect(details).toContain("## Common starting points");
    for (const page of pages) {
      expect(details).toContain(`(https://docs.reactiveagents.dev${markdownPathForSlug(page.slug)})`);
    }
    expect(pages.some((p) => p.slug === "404")).toBe(false);
  });
});

describe("agent prompt and Quickstart for agents use only real API", () => {
  const builder = read("packages/runtime/src/builder.ts");
  const providerTypes = read("packages/runtime/src/builder/types.ts");
  const scaffoldCli = read("packages/create-reactive-agent/src/cli.ts");
  const templates = read("packages/create-reactive-agent/src/types.ts");
  const quickstart = readFileSync(resolve(CONTENT, "guides/quickstart.mdx"), "utf8");
  const agentsSection = quickstart.slice(quickstart.indexOf("## Quickstart for agents"));
  const recommended = agentsSection.slice(0, agentsSection.indexOf("**Common wrong patterns**"));

  const declares = (method: string) =>
    new RegExp(`^\\s+(async\\s+)?${method}(<[^>]*>)?\\(`, "m").test(builder);

  it("every builder method the prompt and the minimal agent use exists", () => {
    const used = new Set<string>();
    for (const text of [AGENT_PROMPT, recommended]) {
      for (const m of text.matchAll(/\.(with[A-Z]\w*|build|create)\(/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(3);
    for (const method of used) {
      if (method === "create") expect(builder).toMatch(/^\s+create: \(\): ReactiveAgentBuilder/m);
      else expect(declares(method)).toBe(true);
    }
  });

  it("every 'write instead' method exists and every removed method is gone", () => {
    for (const method of ["withTools", "withObservability", "withDurableRuns", "withAgentTool", "withFallbacks"]) {
      expect(declares(method)).toBe(true);
    }
    for (const removed of [
      "withTerminalTools",
      "withTelemetry",
      "withoutTracing",
      "withProgressCheckpoint",
      "withIdentity",
      "withInteraction",
      "withOrchestration",
      "withCacheTimeout",
    ]) {
      expect(declares(removed)).toBe(false);
    }
  });

  it("providers, templates and scaffold flags match the scaffolder and ProviderName", () => {
    for (const p of ["anthropic", "openai", "gemini", "groq", "xai", "ollama", "litellm"]) {
      expect(providerTypes).toContain(`| '${p}'`);
    }
    expect(providerTypes).not.toContain("| 'google'");
    for (const t of [
      "minimal",
      "with-tools",
      "streaming",
      "with-structured-output",
      "with-approval-gates",
      "with-memory",
      "cloudflare-worker",
    ]) {
      expect(templates).toContain(`"${t}"`);
    }
    for (const flag of ["--template=", "--provider=", "--yes"]) {
      expect(scaffoldCli).toContain(flag);
      expect(AGENT_PROMPT).toContain(flag);
    }
  });
});
