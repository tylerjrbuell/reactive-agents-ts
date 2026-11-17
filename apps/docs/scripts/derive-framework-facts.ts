#!/usr/bin/env bun
/**
 * Framework facts derived from code, and the drift checks that compare them
 * with what the docs say. wiki/Reference/Docs-Derivation-Audit.md lists every
 * manual sync point; this file implements the ones that are cheap to derive.
 *
 *   bun run --cwd apps/docs facts            # rewrite src/data/framework-facts.json
 *   bun run --cwd apps/docs facts:check      # fail when the committed file is stale or docs drift
 *
 * Sources of truth (all read-only, parsed with the same shapes the existing
 * gates use, and each parse throws when its anchor moves so it cannot pass
 * vacuously):
 *   packages      packages/<dir>/package.json (name, private)
 *   strategies    packages/reasoning/src/services/strategy-registry.ts
 *   providers     packages/llm-provider/src/provider-defaults.ts
 *   phases        packages/runtime/src/types.ts (LifecyclePhase)
 *   cliCommands   apps/cli/src/index.ts (top-level `case "<cmd>"`)
 *   allUnstable   package index.ts JSDoc "@unstable All exports unstable"
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../../..");
const FACTS_PATH = join(REPO_ROOT, "apps/docs/src/data/framework-facts.json");

export interface FrameworkFacts {
  readonly packages: ReadonlyArray<{ dir: string; name: string; private: boolean; allUnstable: boolean }>;
  readonly strategies: { keys: string[]; canonical: string[]; aliases: string[] };
  readonly providers: ReadonlyArray<{ key: string; defaultModel: string }>;
  readonly phases: string[];
  readonly cliCommands: string[];
}

function read(root: string, rel: string): string {
  const p = join(root, rel);
  if (!existsSync(p)) throw new Error(`derive-framework-facts: ${rel} not found`);
  return readFileSync(p, "utf8");
}

export function parseStrategies(src: string): FrameworkFacts["strategies"] {
  const block = src.match(/new Map<string, StrategyFn>\(\[([\s\S]*?)\]\),/);
  if (!block) throw new Error("derive-framework-facts: StrategyRegistry bootstrap Map not found; update this parse");
  const keys: string[] = [];
  const seen = new Map<string, string>();
  const canonical: string[] = [];
  const aliases: string[] = [];
  for (const m of block[1]!.matchAll(/\[\s*"([^"]+)"\s*,\s*([^\]]+?)\s*\]/g)) {
    const key = m[1]!;
    const inner = m[2]!.match(/\(([^()]*)\)\s*$/);
    const impl = (inner ? inner[1]! : m[2]!).trim();
    keys.push(key);
    if (seen.has(impl)) aliases.push(key);
    else {
      seen.set(impl, key);
      canonical.push(key);
    }
  }
  if (keys.length === 0) throw new Error("derive-framework-facts: no strategies parsed");
  return { keys, canonical, aliases };
}

export function parseProviders(src: string): FrameworkFacts["providers"] {
  const block = src.match(/PROVIDER_DEFAULT_MODELS[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error("derive-framework-facts: PROVIDER_DEFAULT_MODELS not found; update this parse");
  const out = [...block[1]!.matchAll(/^\s*['"]?([\w-]+)['"]?\s*:\s*['"]([^'"]+)['"]/gm)].map((m) => ({ key: m[1]!, defaultModel: m[2]! }));
  if (out.length === 0) throw new Error("derive-framework-facts: no providers parsed");
  return out;
}

export function parsePhases(src: string): string[] {
  const start = src.indexOf("export const LifecyclePhase = Schema.Literal(");
  if (start === -1) throw new Error("derive-framework-facts: LifecyclePhase not found; update this parse");
  // Phases are the top-level string literals; comments sit between them.
  const body = src.slice(start).replace(/\/\*[\s\S]*?\*\//g, "").split(/\n\)/)[0]!;
  const out = [...body.matchAll(/^\s*"([a-z-]+)"\s*,?\s*$/gm)].map((m) => m[1]!);
  if (out.length === 0) throw new Error("derive-framework-facts: no phases parsed");
  return out;
}

export function parseCliCommands(src: string): string[] {
  const sw = src.indexOf("switch (command)");
  if (sw === -1) throw new Error("derive-framework-facts: CLI dispatch switch not found; update this parse");
  const out = new Set<string>();
  for (const m of src.slice(sw).matchAll(/^ {4}case "([a-z][\w-]*)":/gm)) out.add(m[1]!);
  return [...out];
}

export function deriveFacts(root: string = REPO_ROOT): FrameworkFacts {
  const packages = readdirSync(join(root, "packages"))
    .filter((d) => existsSync(join(root, "packages", d, "package.json")))
    .sort()
    .map((dir) => {
      const pkg = JSON.parse(read(root, `packages/${dir}/package.json`)) as { name: string; private?: boolean };
      const idx = existsSync(join(root, "packages", dir, "src/index.ts")) ? read(root, `packages/${dir}/src/index.ts`) : "";
      return { dir, name: pkg.name, private: pkg.private === true, allUnstable: /@unstable\s+All exports unstable/.test(idx) };
    });
  return {
    packages,
    strategies: parseStrategies(read(root, "packages/reasoning/src/services/strategy-registry.ts")),
    providers: parseProviders(read(root, "packages/llm-provider/src/provider-defaults.ts")),
    phases: parsePhases(read(root, "packages/runtime/src/types.ts")),
    cliCommands: parseCliCommands(read(root, "apps/cli/src/index.ts")),
  };
}

export const renderFacts = (f: FrameworkFacts): string => `${JSON.stringify(f, null, 2)}\n`;

/* ── Drift checks: docs vs derived facts ─────────────────────────────── */

/**
 * `rax` commands that exist in code but have no section in reference/cli.md
 * yet. This is visible debt: an entry that becomes documented fails the check
 * until it is removed, so the list can only shrink.
 */
export const KNOWN_UNDOCUMENTED_CLI: readonly string[] = [];

/** CLI subcommands that are flags/aliases, not commands to document. */
const CLI_IGNORE = new Set(["version", "help"]);

export interface DocsCorpus {
  /** reference/cli.md */
  readonly cli: string;
  /** features/llm-providers.md */
  readonly providers: string;
  /** reference/**, concatenated */
  readonly reference: string;
  /** apps/docs/src/data/stability.json parsed */
  readonly stability: Readonly<Record<string, string>>;
}

export function readCorpus(root: string = REPO_ROOT): DocsCorpus {
  const docs = join(root, "apps/docs/src/content/docs");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.mdx?$/.test(e.name) ? [join(dir, e.name)] : []));
  return {
    cli: readFileSync(join(docs, "reference/cli.md"), "utf8"),
    providers: readFileSync(join(docs, "features/llm-providers.md"), "utf8"),
    reference: walk(join(docs, "reference")).map((p) => readFileSync(p, "utf8")).join("\n"),
    stability: (JSON.parse(readFileSync(join(root, "apps/docs/src/data/stability.json"), "utf8")) as { packages: Record<string, string> }).packages,
  };
}

/**
 * Public packages with no tier in stability.json yet. Visible debt: empty now
 * (create-reactive-agent was given `unstable` on 2026-11-17). An entry that
 * gains a tier fails the check until it is removed.
 */
export const STABILITY_EXEMPT: readonly string[] = [];

/** Registered providers that are internal fixtures, not something users pick (the mock provider). */
export const PROVIDER_EXEMPT: readonly string[] = ["test"];

export function findDrift(f: FrameworkFacts, c: DocsCorpus, knownUndocumentedCli: readonly string[] = KNOWN_UNDOCUMENTED_CLI): string[] {
  const out: string[] = [];

  // CLI commands: every top-level command is documented, or is on the shrinking debt list.
  for (const cmd of f.cliCommands) {
    if (CLI_IGNORE.has(cmd)) continue;
    const documented = new RegExp(`rax ${cmd}\\b`).test(c.cli);
    const known = knownUndocumentedCli.includes(cmd);
    if (!documented && !known) out.push(`cli: "rax ${cmd}" exists in apps/cli/src/index.ts but reference/cli.md never mentions it`);
    if (documented && known) out.push(`cli: "rax ${cmd}" is now documented; remove it from KNOWN_UNDOCUMENTED_CLI`);
  }
  for (const cmd of knownUndocumentedCli) if (!f.cliCommands.includes(cmd)) out.push(`cli: KNOWN_UNDOCUMENTED_CLI lists "${cmd}" but the CLI has no such command`);

  // Providers: each registered provider key is named in the providers page.
  for (const p of f.providers) {
    if (PROVIDER_EXEMPT.includes(p.key)) continue;
    if (!new RegExp(`["'\`]${p.key}["'\`]`).test(c.providers)) out.push(`providers: "${p.key}" is in provider-defaults.ts but features/llm-providers.md never names it`);
  }

  // Lifecycle phases: each phase name is in the reference docs.
  for (const ph of f.phases) {
    if (!new RegExp(`["'\`]${ph}["'\`]`).test(c.reference)) out.push(`phases: "${ph}" is a LifecyclePhase but reference/** never names it`);
  }

  // Strategies are not re-checked here: docs-consistency.test.ts pins every count claim to the registry.

  // Packages: the stability table lists exactly the public packages, and an
  // "All exports unstable" tag in code can never sit beside a stable tier.
  const pub = f.packages.filter((p) => !p.private && !STABILITY_EXEMPT.includes(p.dir));
  for (const p of pub) if (!(p.dir in c.stability)) out.push(`packages: public package "${p.dir}" has no tier in src/data/stability.json`);
  for (const dir of STABILITY_EXEMPT) if (dir in c.stability) out.push(`packages: "${dir}" now has a tier; remove it from STABILITY_EXEMPT`);
  for (const dir of Object.keys(c.stability)) {
    const p = f.packages.find((x) => x.dir === dir);
    if (!p) out.push(`packages: stability.json lists "${dir}" but packages/${dir} does not exist`);
    else if (p.private) out.push(`packages: stability.json lists private package "${dir}"`);
  }
  for (const p of f.packages) {
    if (p.allUnstable && c.stability[p.dir] === "stable") out.push(`packages: ${p.dir} declares "@unstable All exports unstable" but stability.json says stable`);
  }
  return out;
}

if (import.meta.main) {
  const facts = deriveFacts();
  const next = renderFacts(facts);
  if (process.argv.includes("--check")) {
    let bad = false;
    const cur = existsSync(FACTS_PATH) ? readFileSync(FACTS_PATH, "utf8") : "";
    if (cur !== next) {
      console.error("framework-facts.json is stale. Run: bun run --cwd apps/docs facts");
      bad = true;
    }
    const drift = findDrift(facts, readCorpus());
    for (const d of drift) console.error(`drift: ${d}`);
    if (drift.length > 0) bad = true;
    if (bad) process.exit(1);
    console.log("framework facts: committed file current, docs agree with code");
  } else {
    writeFileSync(FACTS_PATH, next);
    console.log(`wrote ${FACTS_PATH}`);
  }
}
