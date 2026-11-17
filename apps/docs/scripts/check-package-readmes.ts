#!/usr/bin/env bun
/**
 * check-package-readmes: audits every public packages/<dir>/README.md against
 * wiki/Reference/Package-README-Standard.md.
 *
 * Report-only by default (prints a findings table, exits 0). Fail mode:
 *   bun apps/docs/scripts/check-package-readmes.ts --fail      (or README_CHECK_FAIL=1)
 *   bun apps/docs/scripts/check-package-readmes.ts --json      (machine output)
 *
 * Pure functions are exported for tests; `auditAll` walks packages/.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DOCS_ROOT, REPO_ROOT, slugOf, walkContent } from "./ia-inventory";
import { scanText } from "./stale-claims";
import stabilityData from "../src/data/stability.json" with { type: "json" };

export interface Finding {
  readonly pkg: string;
  readonly rule: string;
  readonly detail: string;
}

export interface PackageInfo {
  readonly dir: string;
  readonly name: string;
  readonly private: boolean;
}

/** Default size budget in bytes (about 1,200 words). Best existing READMEs are 3-7.5 KB. */
export const DEFAULT_BUDGET_BYTES = 8000;
/** Per-package budget overrides. The facade README is the npm landing page and the repo README source. */
export const BUDGET_OVERRIDES: Readonly<Record<string, number>> = { "reactive-agents": 20000 };

export const REQUIRED_SECTIONS = ["install", "usage", "api", "docs", "runtime", "license"] as const;
export type SectionKey = (typeof REQUIRED_SECTIONS)[number];

/** H2 heading aliases per canonical section. Matched against the lower-cased heading text. */
const SECTION_ALIASES: Readonly<Record<SectionKey, RegExp>> = {
  install: /^install(ation)?$/,
  usage: /^(usage|quick ?start|quick example|example|examples|getting started)\b/,
  api: /^(api|api reference|key exports|exports|public api|what it exports)\b/,
  docs: /^(docs|documentation|learn more|see also)$/,
  runtime: /^(runtime|runtime support|requirements|compatibility)$/,
  license: /^licen[sc]e$/,
};

const STATIC_DOC_PATHS = new Set(["llms.txt", "llms-full.txt", ".well-known/skills/index.json", ".well-known/agent-skills/index.json"]);

/** Splits markdown into lines flagged as inside a fenced block. */
export function classifyLines(md: string): { text: string; fenced: boolean; lang: string }[] {
  const out: { text: string; fenced: boolean; lang: string }[] = [];
  let fence: string | null = null;
  let lang = "";
  for (const text of md.split("\n")) {
    const m = text.match(/^\s*(```+|~~~+)\s*([A-Za-z0-9_+-]*)/);
    if (m) {
      if (fence === null) {
        fence = m[1]!;
        lang = (m[2] ?? "").toLowerCase();
        out.push({ text, fenced: true, lang });
      } else if (m[1]!.startsWith(fence[0]!) && m[1]!.length >= fence.length) {
        out.push({ text, fenced: true, lang });
        fence = null;
      } else out.push({ text, fenced: true, lang });
      continue;
    }
    out.push({ text, fenced: fence !== null, lang: fence !== null ? lang : "" });
  }
  return out;
}

export function sectionKeyOf(heading: string): SectionKey | null {
  const h = heading.toLowerCase().replace(/[`*_]/g, "").trim();
  for (const k of REQUIRED_SECTIONS) if (SECTION_ALIASES[k].test(h)) return k;
  return null;
}

/** All docs routes (no leading or trailing slash) that exist as content pages. */
export function loadDocsSlugs(root: string = DOCS_ROOT): Set<string> {
  return new Set(walkContent(root).map((f) => slugOf(f, root)));
}

const PUBLIC_ROOT = join(DOCS_ROOT, "..", "..", "..", "public");

/** Static assets (images under screens/ or with an image extension) are files in public/, not docs pages. */
function isAssetRoute(route: string): boolean {
  return route.startsWith("screens/") || /\.(webp|png|jpe?g|svg|gif)$/i.test(route);
}

function docsRoute(url: string): string | null {
  const m = url.match(/^https?:\/\/docs\.reactiveagents\.dev(\/[^\s)#?]*)?/i);
  if (!m) return null;
  return (m[1] ?? "/").replace(/^\/+|\/+$/g, "");
}

export function auditReadme(
  pkg: PackageInfo,
  readme: string,
  docsSlugs: ReadonlySet<string>,
  budget: number = BUDGET_OVERRIDES[pkg.dir] ?? DEFAULT_BUDGET_BYTES,
  stability: Readonly<Record<string, string>> = stabilityData.packages,
  publicRoot: string = PUBLIC_ROOT,
): Finding[] {
  const f: Finding[] = [];
  const add = (rule: string, detail: string): void => void f.push({ pkg: pkg.dir, rule, detail });
  const lines = classifyLines(readme);
  const prose = lines.filter((l) => !l.fenced).map((l) => l.text);

  // title
  const h1 = prose.find((l) => /^#\s+\S/.test(l));
  if (!h1) add("title", "no H1");
  else if (h1.replace(/^#\s+/, "").replace(/`/g, "").trim() !== pkg.name)
    add("title", `H1 "${h1.replace(/^#\s+/, "").trim()}" is not the package name ${pkg.name}`);

  // pitch: a blockquote line after H1 and before the first H2
  const h1i = prose.findIndex((l) => /^#\s+\S/.test(l));
  const h2i = prose.findIndex((l) => /^##\s+\S/.test(l));
  const head = prose.slice(h1i + 1, h2i === -1 ? undefined : h2i);
  const pitch = head.find((l) => /^>\s*\S/.test(l) && !/stability:/i.test(l));
  if (!pitch) add("pitch", "no one-line pitch blockquote ('> ...') between H1 and first H2");
  else if (pitch.length > 220) add("pitch", `pitch is ${pitch.length} chars (max 220)`);

  // stability line
  if (!/stability:?\*{0,2}:?\s*\**\s*(stable|unstable|experimental)\b/i.test(readme))
    add("stability", "no 'Stability: stable|unstable|experimental' line");

  // stability line matches the shared data file (src/data/stability.json)
  const declared = readme.match(/stability:?\*{0,2}:?\s*\**\s*(stable|unstable|experimental)\b/i)?.[1]?.toLowerCase();
  const expected = stability[pkg.dir];
  if (declared && expected === undefined) add("stability-unlisted", `${pkg.dir} is not in src/data/stability.json`);
  else if (declared && expected !== declared) add("stability-mismatch", `README says ${declared}, stability.json says ${expected}`);

  // sections present and in order
  const found: { key: SectionKey; idx: number }[] = [];
  prose.forEach((l, idx) => {
    const m = l.match(/^##\s+(.+?)\s*$/);
    if (!m) return;
    const key = sectionKeyOf(m[1]!);
    if (key && !found.some((x) => x.key === key)) found.push({ key, idx });
  });
  for (const k of REQUIRED_SECTIONS)
    if (!found.some((x) => x.key === k)) add("section-missing", k);
  const order = REQUIRED_SECTIONS.filter((k) => found.some((x) => x.key === k));
  const actual = [...found].sort((a, b) => a.idx - b.idx).map((x) => x.key);
  if (order.join() !== actual.join()) add("section-order", `expected ${order.join(" > ")}, got ${actual.join(" > ")}`);

  // install line names the real package (search the raw section, fences included)
  const raw = readme.split("\n");
  const startRaw = raw.findIndex((l, i) => !lines[i]!.fenced && /^##\s+install/i.test(l));
  if (startRaw !== -1) {
    let endRaw = raw.length;
    for (let i = startRaw + 1; i < raw.length; i++)
      if (/^##\s/.test(raw[i]!) && !lines[i]!.fenced) {
        endRaw = i;
        break;
      }
    const rawSec = raw.slice(startRaw, endRaw).join("\n");
    const ok = pkg.name === "create-reactive-agent" ? /create[- ]reactive-agent/.test(rawSec) : rawSec.includes(pkg.name);
    if (!ok) add("install-name", `install section does not mention ${pkg.name}`);
  }

  // example is TypeScript
  if (!lines.some((l) => l.fenced && ["ts", "typescript", "tsx"].includes(l.lang)))
    add("example-ts", "no fenced ts/typescript/tsx block");

  // docs link resolves
  const urls = [...readme.matchAll(/https?:\/\/docs\.reactiveagents\.dev[^\s)>\]"']*/gi)].map((m) => m[0]);
  const routes = urls.map(docsRoute).filter((r): r is string => r !== null);
  const pathRoutes = routes.filter((r) => r !== "");
  if (pathRoutes.length === 0) add("docs-link", "no link to a docs.reactiveagents.dev page (root links do not count)");
  const pageRoutes = pathRoutes.filter((r) => !isAssetRoute(r));
  if (pageRoutes.length === 0 && pathRoutes.length > 0) add("docs-link", "no link to a docs.reactiveagents.dev page (asset URLs do not count)");
  for (const r of new Set(pathRoutes)) {
    if (isAssetRoute(r)) {
      if (!existsSync(join(publicRoot, r))) add("asset-missing", `/${r} not found under apps/docs/public/`);
    } else if (!docsSlugs.has(r) && !STATIC_DOC_PATHS.has(r)) add("docs-link-broken", `/${r}/ is not a docs page`);
  }

  // relative links and wikilinks break on npm
  for (const l of prose) {
    if (/\]\((?:\.{1,2}\/|(?:docs|src|packages)\/)[^)]*\)/.test(l)) add("relative-link", l.trim().slice(0, 80));
    if (/\[\[[^\]]+\]\]/.test(l)) add("wikilink", l.trim().slice(0, 80));
  }

  // size
  const bytes = Buffer.byteLength(readme, "utf8");
  if (bytes > budget) add("size", `${bytes} bytes > budget ${budget}`);

  // banned patterns (prose only)
  prose.forEach((l) => {
    if (/img\.shields\.io\/npm\/d[mwty]\b|npm-stat\.com|\bdownloads?\b.*(badge|shields)/i.test(l))
      add("downloads-badge", l.trim().slice(0, 80));
    const count = l.match(/\b\d[\d,]*\+?\s+(tests?|packages?|providers?|strategies|test files)\b/i);
    if (count) add("hand-typed-count", count[0]);
    const pct = l.match(/\b\d{1,3}(?:\.\d+)?\s?%/);
    if (pct && !/\]\(https?:|source:|measured|see \[/i.test(l)) add("unsourced-number", `${pct[0]} in "${l.trim().slice(0, 60)}"`);
  });
  // A runtime name directly followed (optionally via a link or bold) by a comparator and/or version.
  const versionsOf = (name: string): string[] => {
    const re = new RegExp(
      String.raw`\b${name}(?:\.js)?\b(?:\]\([^)]*\))?\**[\s)]*(?:(?:>=|≥)\s*)?v?(\d+(?:\.\d+){0,2})(?![\d.]*\w)`,
      "gi",
    );
    return [...readme.matchAll(re)].map((m) => m[1]!);
  };
  for (const v of versionsOf("Bun")) if (!/^1\.1(\.0)?$/.test(v)) add("runtime-version", `Bun ${v} (floor is 1.1.0)`);
  for (const v of versionsOf("Node"))
    if (!/^22\.5(\.0)?$/.test(v) && Number(v.split(".")[0]) >= 10) add("runtime-version", `Node ${v} (floor is 22.5)`);
  // stale-claims rules (discord, bun-required, any-absolute, node-old-floor, ...)
  for (const c of scanText(`packages/${pkg.dir}/README.md`, readme))
    add(`stale:${c.rule}`, c.text.trim().slice(0, 80));

  // license
  if (found.some((x) => x.key === "license") && !/\bMIT\b/.test(readme))
    add("license-text", "License section does not name MIT");

  return dedupe(f);
}

function dedupe(fs: Finding[]): Finding[] {
  const seen = new Set<string>();
  return fs.filter((x) => {
    const k = `${x.rule}|${x.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function listPackages(repoRoot: string = REPO_ROOT): PackageInfo[] {
  const root = join(repoRoot, "packages");
  return readdirSync(root)
    .sort()
    .flatMap((dir) => {
      const pj = join(root, dir, "package.json");
      if (!existsSync(pj)) return [];
      const j = JSON.parse(readFileSync(pj, "utf8")) as { name: string; private?: boolean };
      return [{ dir, name: j.name, private: j.private === true }];
    });
}

export function auditAll(repoRoot: string = REPO_ROOT): { findings: Finding[]; audited: string[]; skipped: string[] } {
  const slugs = loadDocsSlugs(join(repoRoot, "apps/docs/src/content/docs"));
  const findings: Finding[] = [];
  const audited: string[] = [];
  const skipped: string[] = [];
  for (const p of listPackages(repoRoot)) {
    if (p.private) {
      skipped.push(p.dir);
      continue;
    }
    audited.push(p.dir);
    const file = join(repoRoot, "packages", p.dir, "README.md");
    if (!existsSync(file)) {
      findings.push({ pkg: p.dir, rule: "missing-readme", detail: "no README.md" });
      continue;
    }
    findings.push(...auditReadme(p, readFileSync(file, "utf8"), slugs));
  }
  return { findings, audited, skipped };
}

export function renderTable(r: { findings: Finding[]; audited: string[]; skipped: string[] }): string {
  const byPkg = new Map<string, Map<string, number>>();
  for (const x of r.findings) {
    const m = byPkg.get(x.pkg) ?? new Map<string, number>();
    m.set(x.rule, (m.get(x.rule) ?? 0) + 1);
    byPkg.set(x.pkg, m);
  }
  const rows = ["| package | findings | rules |", "|---|---|---|"];
  for (const p of r.audited) {
    const m = byPkg.get(p);
    const total = m ? [...m.values()].reduce((a, b) => a + b, 0) : 0;
    const rules = m ? [...m].map(([k, n]) => (n > 1 ? `${k} x${n}` : k)).join(", ") : "clean";
    rows.push(`| ${p} | ${total} | ${rules} |`);
  }
  const byRule = new Map<string, number>();
  for (const x of r.findings) byRule.set(x.rule, (byRule.get(x.rule) ?? 0) + 1);
  const sum = ["", "| rule | findings |", "|---|---|", ...[...byRule].sort((a, b) => b[1] - a[1]).map(([k, n]) => `| ${k} | ${n} |`)];
  const clean = r.audited.filter((p) => !byPkg.has(p)).length;
  return [
    ...rows,
    ...sum,
    "",
    `audited ${r.audited.length} public packages (${clean} clean), skipped private: ${r.skipped.join(", ") || "none"}; ${r.findings.length} findings`,
  ].join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const r = auditAll();
  if (args.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else console.log(renderTable(r));
  const fail = args.includes("--fail") || process.env.README_CHECK_FAIL === "1";
  if (fail && r.findings.length > 0) process.exit(1);
}
