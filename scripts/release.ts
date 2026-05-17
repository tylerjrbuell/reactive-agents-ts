#!/usr/bin/env bun
/**
 * Lockstep release. One explicit version, all public packages, fail-fast.
 *
 * Usage:
 *   bun scripts/release.ts 0.11.0              stamp + build + publish (topo order)
 *   bun scripts/release.ts 0.11.0 --dry-run    print plan, mutate nothing
 *
 * Guarantees:
 *  - Drift is structurally impossible: one `version` var stamps every package.
 *  - All pre-flight checks run BEFORE any mutation. Fail-fast = abort early,
 *    nothing touched.
 *  - Publish is dependency-ordered (topological). On first publish failure the
 *    run aborts immediately and prints what succeeded + the exact resume
 *    command. (npm has no rollback; idempotent skip-already-published is the
 *    correct resume substitute for an atomic registry.)
 */
import { Glob, $ } from "bun";

type Pkg = {
  dir: string;
  file: string;
  name: string;
  json: Record<string, unknown>;
};

const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?(\+[0-9A-Za-z.]+)?$/;

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
// --no-publish: do the full mutating release (changelog, stamp, build) but stop
// before the publish loop. Lets a release be confirmed end-to-end without
// touching npm; revert with `git restore`.
const noPublish = args.includes("--no-publish");
const version = args.find((a) => !a.startsWith("-"));

// ── Pre-flight (no mutation past this block) ─────────────────────────────────

if (!version) fail("pass an explicit semver, e.g. `bun scripts/release.ts 0.11.0`");
if (!SEMVER.test(version)) fail(`'${version}' is not valid semver`);

const root = JSON.parse(await Bun.file("package.json").text()) as Record<string, unknown>;

const pkgFiles = [
  ...new Glob("packages/*/package.json").scanSync(),
  ...new Glob("apps/*/package.json").scanSync(),
];

const targets: Pkg[] = [];
for (const file of pkgFiles) {
  const json = JSON.parse(await Bun.file(file).text()) as Record<string, unknown>;
  if (json.private === true) continue;
  targets.push({ dir: file.replace(/\/package\.json$/, ""), file, name: json.name as string, json });
}
if (targets.length === 0) fail("no public packages discovered");

const names = new Set(targets.map((t) => t.name));

// npm auth must be valid before we touch anything.
const who = await $`npm whoami`.quiet().nothrow();
if (who.exitCode !== 0) fail("not logged in to npm (`npm whoami` failed). Run `npm login` first.");

// ── Topological sort over internal dependency edges ──────────────────────────

const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
const edges = new Map<string, Set<string>>(); // name -> internal deps it needs first
const indeg = new Map<string, number>();
for (const t of targets) {
  edges.set(t.name, new Set());
  indeg.set(t.name, 0);
}
for (const t of targets) {
  for (const field of DEP_FIELDS) {
    const deps = t.json[field] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      if (names.has(dep) && dep !== t.name) edges.get(t.name)!.add(dep);
    }
  }
}
for (const t of targets) indeg.set(t.name, edges.get(t.name)!.size);

const byName = new Map(targets.map((t) => [t.name, t] as const));
const dependents = new Map<string, string[]>();
for (const t of targets) dependents.set(t.name, []);
for (const t of targets) for (const dep of edges.get(t.name)!) dependents.get(dep)!.push(t.name);

const queue = targets.filter((t) => indeg.get(t.name) === 0).map((t) => t.name);
const order: string[] = [];
while (queue.length) {
  const n = queue.shift()!;
  order.push(n);
  for (const child of dependents.get(n)!) {
    indeg.set(child, indeg.get(child)! - 1);
    if (indeg.get(child) === 0) queue.push(child);
  }
}
if (order.length !== targets.length) {
  const cyclic = targets.map((t) => t.name).filter((n) => !order.includes(n));
  fail(`dependency cycle among internal packages, cannot order publish: ${cyclic.join(", ")}`);
}
const ordered = order.map((n) => byName.get(n)!);

// ── Classify: already-published vs needs-publish ─────────────────────────────

console.log(`lockstep release → ${version}  (${targets.length} public packages)`);

const needsPublish: Pkg[] = [];
for (const t of ordered) {
  const seen = await $`npm view ${t.name}@${version} version`.quiet().nothrow();
  if (seen.exitCode === 0) {
    console.log(`  satisfied  ${t.name}@${version} (already on npm)`);
  } else {
    needsPublish.push(t);
    console.log(`  publish    ${t.name}  ${t.json.version} → ${version}`);
  }
}
if (needsPublish.length === 0) {
  console.log(`nothing to do — all ${targets.length} packages already at ${version}`);
  process.exit(0);
}

// ── Collect changelog notes (read-only here; consumed after dry-run guard) ───
// Option 3: aggregate pending .changeset/*.md ourselves. Keeps curated per-PR
// notes (changesets' one real value) without its version machinery.

// `.changeset` is a hidden dir — scan inside it so dot-dir traversal isn't skipped.
const csFiles = [...new Glob("*.md").scanSync({ cwd: ".changeset" })]
  .filter((f) => !/^README\.md$/i.test(f))
  .map((f) => `.changeset/${f}`);
const notes: string[] = [];
for (const f of csFiles) {
  const body = (await Bun.file(f).text())
    .replace(/^---[\s\S]*?---\s*/, "") // strip changeset frontmatter (pkg+bump)
    .trim();
  if (body) notes.push(body);
}
if (notes.length === 0) {
  console.warn(
    `warning: no changeset notes found — CHANGELOG.md gets a bare '## ${version}' (allowed: manual/hotfix release)`,
  );
}

if (dryRun) {
  console.log(
    `\ndry-run: would aggregate ${notes.length} changeset note(s) → root CHANGELOG.md,`,
  );
  console.log(`         stamp ${targets.length} packages, build, then publish ${needsPublish.length} in this order:`);
  needsPublish.forEach((t, i) => console.log(`  ${i + 1}. ${t.name}`));
  process.exit(0);
}

// ── Aggregate root CHANGELOG.md, then consume the changeset files ────────────

const prevLog = (await Bun.file("CHANGELOG.md").exists())
  ? await Bun.file("CHANGELOG.md").text()
  : "";
// Header format matches the existing CHANGELOG: `## [<version>] — <date>`.
// Keeps the whole file uniform so the backfill + GitHub-release regexes
// (which anchor on `## \[?<version>\]?`) match every entry, legacy and new.
const today = new Date().toISOString().slice(0, 10);
const header = `## [${version}] — ${today}`;
const entry =
  `${header}\n\n` +
  (notes.length ? notes.join("\n\n") + "\n\n" : "_No notable changes._\n\n");
await Bun.write("CHANGELOG.md", entry + prevLog);
for (const f of csFiles) await Bun.file(f).unlink();
console.log(`changelog: wrote ${header} (${notes.length} note(s)), consumed ${csFiles.length} changeset file(s)`);

// ── Mutate: stamp every package + root to the single version ─────────────────

// Rewrite internal `workspace:*` deps → the exact lockstep version. We
// publish via `npm publish` (npm does NOT resolve the workspace protocol;
// only `bun publish` did, but its auth is unreliable in CI). All internal
// packages share one version, so an exact pin is correct. Reuses the
// module-level DEP_FIELDS (declared above for the topo-order step).
function pinWorkspaceDeps(json: Record<string, unknown>): number {
  let n = 0;
  for (const field of DEP_FIELDS) {
    const deps = json[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, range] of Object.entries(deps as Record<string, string>)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        (deps as Record<string, string>)[name] = version;
        n++;
      }
    }
  }
  return n;
}

let pinned = 0;
for (const t of targets) {
  t.json.version = version;
  pinned += pinWorkspaceDeps(t.json as Record<string, unknown>);
  await Bun.write(t.file, JSON.stringify(t.json, null, 2) + "\n");
}
root.version = version;
await Bun.write("package.json", JSON.stringify(root, null, 2) + "\n");
console.log(
  `stamped ${targets.length} packages + root → ${version} (pinned ${pinned} workspace:* dep(s))`,
);

// ── Build once (turbo cache) ─────────────────────────────────────────────────

const build = await $`bun run build`.nothrow();
if (build.exitCode !== 0) fail("build failed — aborting before publish, nothing released");

if (noPublish) {
  console.log(
    `\n--no-publish: stopped before publish. ${needsPublish.length} package(s) would publish in topo order.`,
  );
  console.log(`Working tree is mutated (versions + CHANGELOG + consumed changesets). Revert with: git restore . && git clean -fd`);
  process.exit(0);
}

// ── Publish in dependency order, fail-fast ───────────────────────────────────
// `npm publish` (not `bun publish`): npm's setup-node/$HOME/.npmrc auth is
// proven in CI (`npm whoami` succeeds there), whereas `bun publish` could not
// resolve auth from the Bun-shell subprocess in CI despite 4 attempts. Safe
// because workspace:* deps were already pinned to ${version} above, so npm
// (which does not understand the workspace protocol) sees concrete ranges.

const done: string[] = [];
for (let i = 0; i < needsPublish.length; i++) {
  const t = needsPublish[i];
  const res = await $`npm publish --access public`.cwd(t.dir).nothrow();
  if (res.exitCode !== 0) {
    const remaining = needsPublish.slice(i).map((p) => p.name);
    console.error(`\nFAILED publishing ${t.name}@${version} (exit ${res.exitCode})`);
    console.error(`published OK: ${done.length ? done.join(", ") : "(none)"}`);
    console.error(`not published: ${remaining.join(", ")}`);
    console.error(`\nFix the cause, then re-run the SAME command to resume:`);
    console.error(`  bun scripts/release.ts ${version}`);
    console.error(`(already-published packages are skipped automatically.)`);
    process.exit(1);
  }
  done.push(t.name);
  console.log(`published ${t.name}@${version}  (${i + 1}/${needsPublish.length})`);
}

console.log(`\nreleased ${version} — ${done.length} packages published`);
