import { readFileSync } from "node:fs";

/**
 * Read the published version from this package's own `package.json`.
 *
 * This is the single source of truth for every version the CLI emits: the
 * `--version` banner AND the `reactive-agents` range stamped into scaffolded
 * projects. A hardcoded literal drifts from the lockstep release stamp
 * (`scripts/release.ts`) and makes both lie - worst, it scaffolds projects
 * pinning a framework version too old to compile the templates.
 *
 * Resolution walks candidate locations relative to this module and accepts the
 * first `package.json` whose `name` is this package, so it works in every
 * layout the file is reached from:
 * - `src/lib/own-version.ts` under `bun test` (package root is two levels up)
 * - the bundled `dist/` ESM output (depth depends on the bundler layout)
 */
const OWN_PACKAGE_NAME = "create-reactive-agent";
const CANDIDATES = ["../package.json", "../../package.json"] as const;

export function ownPackageVersion(): string {
  for (const candidate of CANDIDATES) {
    let raw: string;
    try {
      raw = readFileSync(new URL(candidate, import.meta.url), "utf8");
    } catch {
      continue; // not a readable file at this depth - try the next one
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // malformed JSON at this depth - try the next one
    }
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "name" in parsed &&
      parsed.name === OWN_PACKAGE_NAME &&
      "version" in parsed &&
      typeof parsed.version === "string"
    ) {
      return parsed.version;
    }
  }
  return "unknown";
}

/**
 * The caret range scaffolded projects pin for `reactive-agents`, derived from
 * {@link ownPackageVersion}. Throws rather than emitting a stale or `unknown`
 * range - a scaffold that cannot install its framework is worse than one that
 * never gets written.
 */
export function ownPackageVersionRange(): string {
  const version = ownPackageVersion();
  if (version === "unknown" || version === "") {
    throw new Error(
      "create-reactive-agent could not read its own package.json version; " +
        "refusing to scaffold with an unknown reactive-agents range.",
    );
  }
  return `^${version}`;
}
