import { describe, expect, it } from "bun:test";
import { auditAll, auditReadme, classifyLines, renderTable, sectionKeyOf } from "../scripts/check-package-readmes";

const pkg = { dir: "widget", name: "@reactive-agents/widget", private: false };
const slugs = new Set(["guides/widgets", "reference/stability"]);

const GOOD = `# @reactive-agents/widget

> Widgets for Reactive Agents.

> **Stability:** unstable. The API may change in a minor release.

## Install

\`\`\`bash
bun add @reactive-agents/widget
\`\`\`

## Usage

\`\`\`ts
import { widget } from "@reactive-agents/widget";
\`\`\`

## API

- \`widget()\`: makes a widget.

## Documentation

[Widgets](https://docs.reactiveagents.dev/guides/widgets/)

## Runtime

Bun >= 1.1.0 (recommended) or Node 22.5+.

## License

MIT
`;

const tiers = { widget: "unstable" };
const rules = (md: string, name = pkg) => auditReadme(name, md, slugs, undefined, tiers).map((f) => f.rule);

describe("check-package-readmes", () => {
  it("passes a README that follows the standard", () => {
    expect(auditReadme(pkg, GOOD, slugs, undefined, tiers)).toEqual([]);
  });

  it("flags a README stability that disagrees with src/data/stability.json", () => {
    const stable = GOOD.replace("**Stability:** unstable", "**Stability:** stable");
    const f = auditReadme(pkg, stable, slugs, undefined, tiers);
    expect(f.map((x) => x.rule)).toEqual(["stability-mismatch"]);
    expect(f[0]!.detail).toContain("stability.json says unstable");
    expect(auditReadme(pkg, GOOD, slugs, undefined, {}).map((x) => x.rule)).toEqual(["stability-unlisted"]);
  });

  it("flags wrong title, missing pitch and missing stability", () => {
    const md = GOOD.replace("# @reactive-agents/widget", "# Widget").replace("> Widgets for Reactive Agents.\n\n", "").replace(/> \*\*Stability.*\n/, "");
    const r = rules(md);
    expect(r).toContain("title");
    expect(r).toContain("pitch");
    expect(r).toContain("stability");
  });

  it("flags missing and out-of-order sections", () => {
    expect(rules(GOOD.replace(/## License\n\nMIT\n/, ""))).toContain("section-missing");
    const swapped = GOOD.replace("## Install", "## XX").replace("## Usage", "## Install").replace("## XX", "## Usage");
    expect(rules(swapped)).toContain("section-order");
  });

  it("accepts heading aliases", () => {
    expect(sectionKeyOf("Installation")).toBe("install");
    expect(sectionKeyOf("Quick start")).toBe("usage");
    expect(sectionKeyOf("Key Exports")).toBe("api");
    expect(sectionKeyOf("Something else")).toBeNull();
  });

  it("requires the real package name in the install section", () => {
    expect(rules(GOOD.replace("bun add @reactive-agents/widget", "bun add @reactive-agents/other"))).toContain("install-name");
  });

  it("requires a TypeScript example", () => {
    expect(rules(GOOD.replace("```ts", "```js"))).toContain("example-ts");
  });

  it("flags missing, root-only and broken docs links", () => {
    expect(rules(GOOD.replace("https://docs.reactiveagents.dev/guides/widgets/", "https://docs.reactiveagents.dev/"))).toContain("docs-link");
    expect(rules(GOOD.replace("guides/widgets/", "guides/nope/"))).toContain("docs-link-broken");
  });

  it("flags relative links and wikilinks", () => {
    expect(rules(GOOD + "\n[x](../core/README.md)\n")).toContain("relative-link");
    expect(rules(GOOD + "\nsee [[Plan]]\n")).toContain("wikilink");
  });

  it("flags banned claims: hand-typed counts, unsourced percentages, downloads badges", () => {
    expect(rules(GOOD + "\nOver 9,000 tests pass.\n")).toContain("hand-typed-count");
    expect(rules(GOOD + "\nRecovers 87% of bad calls.\n")).toContain("unsourced-number");
    expect(rules(GOOD + "\nRecovers 87% of bad calls ([source](https://example.com/exp)).\n")).not.toContain("unsourced-number");
    expect(rules(GOOD + "\n![dl](https://img.shields.io/npm/dm/@reactive-agents/widget)\n")).toContain("downloads-badge");
  });

  it("flags wrong runtime floors and stale claims, ignores fenced code", () => {
    expect(rules(GOOD.replace("Node 22.5+", "Node.js 20+"))).toContain("runtime-version");
    expect(rules(GOOD + "\nJoin https://discord.gg/dead1nvite\n")).toContain("stale:non-canonical-discord-invite");
    expect(rules(GOOD.replace('import { widget }', 'const n = "87% 12 tests"; import { widget }'))).toEqual([]);
  });

  it("enforces the size budget with per-package override", () => {
    const big = GOOD + "\n" + "word ".repeat(3000);
    expect(rules(big)).toContain("size");
    expect(auditReadme({ ...pkg, dir: "reactive-agents" }, big, slugs).map((f) => f.rule)).not.toContain("size");
  });

  it("does not treat headings inside fences as sections", () => {
    const lines = classifyLines("```md\n## Install\n```\n## Real");
    expect(lines.map((l) => l.fenced)).toEqual([true, true, true, false]);
  });

  it("audits the real repo: skips private packages, renders a table", () => {
    const r = auditAll();
    expect(r.skipped).toEqual(expect.arrayContaining(["benchmarks", "judge-server"]));
    expect(r.audited).not.toContain("benchmarks");
    expect(r.audited).toContain("core");
    expect(renderTable(r)).toContain("| package | findings | rules |");
  });
});
