// Run: bun run repo test apps/docs/tests/framework-facts.test.ts
// Derivations from code (scripts/derive-framework-facts.ts) and their drift
// checks. Each check has a "reverted" case: the same real inputs with one fact
// changed must fail, so the check cannot pass vacuously.
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWN_UNDOCUMENTED_CLI,
  REPO_ROOT,
  deriveFacts,
  findDrift,
  parseCliCommands,
  parsePhases,
  parseProviders,
  parseStrategies,
  readCorpus,
  renderFacts,
  type DocsCorpus,
  type FrameworkFacts,
} from "../scripts/derive-framework-facts";
import { addedHeadings, frontmatterOf, parseNameStatus, suggest } from "../scripts/indicators-suggest";

const facts = deriveFacts();
const corpus = readCorpus();
const withCorpus = (patch: Partial<DocsCorpus>): DocsCorpus => ({ ...corpus, ...patch });
const withFacts = (patch: Partial<FrameworkFacts>): FrameworkFacts => ({ ...facts, ...patch });

describe("generated facts file", () => {
  it("committed src/data/framework-facts.json equals what the code derives now", () => {
    const path = join(REPO_ROOT, "apps/docs/src/data/framework-facts.json");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(renderFacts(facts));
  });

  it("derives a plausible, non-empty framework", () => {
    expect(facts.packages.length).toBeGreaterThan(20);
    expect(facts.strategies.canonical).toContain("reactive");
    expect(facts.strategies.aliases).toContain("react");
    expect(facts.providers.map((p) => p.key)).toContain("anthropic");
    expect(facts.phases).toContain("bootstrap");
    expect(facts.cliCommands).toContain("run");
  });

  it("agrees with the independently generated metrics.json", () => {
    const m = JSON.parse(readFileSync(join(REPO_ROOT, "apps/docs/src/data/metrics.json"), "utf8")) as Record<string, number>;
    expect(facts.strategies.canonical.length).toBe(m.strategies!);
    expect(facts.providers.length).toBe(m.providers!);
    expect(facts.phases.length).toBe(m.phases!);
  });

  it("parsers throw when their anchor moves instead of passing vacuously", () => {
    expect(() => parseStrategies("nothing")).toThrow("StrategyRegistry");
    expect(() => parseProviders("nothing")).toThrow("PROVIDER_DEFAULT_MODELS");
    expect(() => parsePhases("nothing")).toThrow("LifecyclePhase");
    expect(() => parseCliCommands("nothing")).toThrow("switch");
  });
});

describe("docs vs code drift", () => {
  it("the real docs agree with the real code", () => {
    expect(findDrift(facts, corpus)).toEqual([]);
  });

  it("flags a new CLI command that reference/cli.md does not mention", () => {
    const f = withFacts({ cliCommands: [...facts.cliCommands, "frobnicate"] });
    expect(findDrift(f, corpus)).toEqual([expect.stringContaining('"rax frobnicate"')]);
  });

  it("the CLI debt list is empty: every command is documented", () => {
    expect(KNOWN_UNDOCUMENTED_CLI).toEqual([]);
  });

  it("flags a documented command on the debt list, and a debt entry that vanished from the CLI", () => {
    // The real list is empty, so pass a synthetic one: the check must still fire both ways.
    expect(findDrift(facts, corpus, ["ps"])).toEqual([expect.stringContaining("remove it from KNOWN_UNDOCUMENTED_CLI")]);
    expect(findDrift(facts, corpus, ["no-such-command"])).toEqual([expect.stringContaining("has no such command")]);
    const undocumented = withCorpus({ cli: corpus.cli.replaceAll("rax attach", "rax a-t-t-a-c-h") });
    expect(findDrift(facts, undocumented)).toEqual([expect.stringContaining('"rax attach"')]);
  });

  it("flags a provider the providers page forgot", () => {
    const stripped = corpus.providers.replaceAll("groq", "g-r-o-q");
    expect(findDrift(facts, withCorpus({ providers: stripped }))).toEqual([expect.stringContaining('"groq"')]);
  });

  it("flags a lifecycle phase missing from the reference docs", () => {
    const f = withFacts({ phases: [...facts.phases, "teleport"] });
    expect(findDrift(f, corpus)).toEqual([expect.stringContaining('"teleport"')]);
  });

  it("flags a public package with no stability tier, and a stale or private entry", () => {
    const noCore = Object.fromEntries(Object.entries(corpus.stability).filter(([k]) => k !== "core"));
    expect(findDrift(facts, withCorpus({ stability: noCore }))).toEqual([expect.stringContaining('"core" has no tier')]);
    expect(findDrift(facts, withCorpus({ stability: { ...corpus.stability, ghost: "stable" } }))).toEqual([expect.stringContaining("ghost")]);
    expect(findDrift(facts, withCorpus({ stability: { ...corpus.stability, benchmarks: "stable" } }))).toEqual([expect.stringContaining("private package")]);
  });

  it("flags a page whose frontmatter stability disagrees with its package or feature tier", () => {
    expect(findDrift(facts, corpus)).toEqual([]);
    // package-mapped page: package tier changes, page does not
    expect(findDrift(facts, withCorpus({ stability: { ...corpus.stability, eval: "stable" } }))).toEqual([expect.stringContaining("pages: features/eval")]);
    // page frontmatter changes against its package
    expect(findDrift(facts, withCorpus({ pageStability: { ...corpus.pageStability, "features/a2a-protocol": "unstable" } }))).toEqual([expect.stringContaining("pages: features/a2a-protocol")]);
    // feature-level tier
    expect(findDrift(facts, withCorpus({ pageStability: { ...corpus.pageStability, "guides/durable-execution": "stable" } }))).toEqual([expect.stringContaining("pageTiers says unstable")]);
    // mapped page lost its tier
    const { "features/gateway": _gone, ...noGateway } = corpus.pageStability;
    expect(findDrift(facts, withCorpus({ pageStability: noGateway }))).toEqual([expect.stringContaining('"(none)"')]);
    // unmapped page declaring a tier
    expect(findDrift(facts, withCorpus({ pageStability: { ...corpus.pageStability, "guides/faq": "experimental" } }))).toEqual([expect.stringContaining("neither pagePackages nor pageTiers")]);
  });

  it("flags 'All exports unstable' in code beside a stable tier in the table", () => {
    const f = withFacts({ packages: facts.packages.map((p) => (p.dir === "react" ? { ...p, allUnstable: true } : p)) });
    expect(findDrift(f, withCorpus({ stability: { ...corpus.stability, react: "stable" } }))).toEqual([expect.stringContaining("All exports unstable")]);
    expect(findDrift(f, corpus)).toEqual([]);
  });
});

describe("docs:indicators:suggest (report only)", () => {
  it("keeps only doc pages from name-status output; renames use the new path", () => {
    const out = ["A\tapps/docs/src/content/docs/guides/new.mdx", "M\tapps/docs/src/content/docs/guides/x.md", "R090\told.md\tapps/docs/src/content/docs/guides/moved.md", "M\tREADME.md", "M\tapps/docs/src/components/A.astro"].join("\n");
    expect(parseNameStatus(out).map((c) => `${c.status} ${c.file.split("/").at(-1)}`)).toEqual(["A new.mdx", "M x.md", "R moved.md"]);
  });

  it("extracts added headings and authored versions", () => {
    expect(addedHeadings("+## Ollama Cloud <Since version=\"0.19\" />\n+text\n-## Gone\n+### `withX()`")).toEqual(["Ollama Cloud", "withX()"]);
    expect(frontmatterOf('---\ntitle: T\nsince: "0.19"\nupdated: 0.20\n---\nbody')).toEqual({ since: "0.19", updated: "0.20" });
  });

  it("advice follows the evidence", () => {
    const f = (status: "A" | "M" | "D") => ({ status, file: "apps/docs/src/content/docs/guides/x.md" }) as const;
    expect(suggest(f("A"), {}, [], "0.19").advice).toContain('since: "0.19"');
    expect(suggest(f("A"), { since: "0.19" }, [], "0.19").advice).toStartWith("ok");
    expect(suggest(f("M"), {}, ["New section"], "0.19").advice).toContain('updated: "0.19"');
    expect(suggest(f("M"), {}, [], "0.19").advice).toContain("no new headings");
    expect(suggest(f("D"), {}, [], "0.19").advice).toContain("deleted");
  });
});
