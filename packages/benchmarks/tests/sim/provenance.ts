/**
 * Kernel-source provenance for a `bench:sim` run: which `packages/reasoning/src` the matrix ran.
 * The sim imports `@reactive-agents/reasoning`, which resolves to src under Bun (no rebuild), so a
 * dirty working tree is a different kernel than the commit names. Zero tokens; fails soft.
 */
import { execFileSync } from "node:child_process";

/** Where the sim's kernel came from. */
export interface KernelProvenance {
  /** `git rev-parse HEAD`, or `unknown`. */
  readonly head: string;
  /** Last commit touching `packages/reasoning/src`, or `unknown`. */
  readonly srcCommit: string;
  /** True when `packages/reasoning/src` has uncommitted or untracked changes (`unknown` when git failed). */
  readonly dirty: boolean | "unknown";
  /** Resolved module URL of `@reactive-agents/reasoning`, or `unknown`. */
  readonly resolved: string;
}

/** Runs `git <args>` and returns trimmed stdout; throws on failure. */
export type GitRunner = (args: readonly string[]) => string;

const realGit: GitRunner = (args) => execFileSync("git", [...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const SRC = "packages/reasoning/src";
/** Repo-root pathspec: `bun run bench:sim` runs with cwd `packages/benchmarks`, where a plain relative path matches nothing. */
const SRC_SPEC = `:(top)${SRC}`;

/**
 * Read the provenance of the reasoning source this process runs.
 *
 * @param git Git runner (injected in tests).
 * @param resolved Resolved module URL of `@reactive-agents/reasoning`.
 */
export function kernelProvenance(git: GitRunner = realGit, resolved: string = resolveReasoning()): KernelProvenance {
  const soft = (args: readonly string[]): string | undefined => {
    try {
      return git(args);
    } catch {
      return undefined;
    }
  };
  const head = soft(["rev-parse", "HEAD"]);
  const srcCommit = soft(["log", "-1", "--format=%H", "--", SRC_SPEC]);
  const status = soft(["status", "--porcelain", "--", SRC_SPEC]);
  return {
    head: head || "unknown",
    srcCommit: srcCommit || "unknown",
    dirty: status === undefined ? "unknown" : status.length > 0,
    resolved,
  };
}

/** Resolved URL of the reasoning package as this process sees it. */
export function resolveReasoning(): string {
  try {
    return import.meta.resolve("@reactive-agents/reasoning");
  } catch {
    return "unknown";
  }
}

const short = (sha: string): string => (sha === "unknown" ? sha : sha.slice(0, 9));

/** One report-header line naming the kernel source and its dirty flag. */
export function formatKernelProvenance(p: KernelProvenance): string {
  const dirty = p.dirty === "unknown" ? "dirty=unknown" : p.dirty ? "DIRTY (uncommitted changes in src)" : "clean";
  return `kernel source: ${SRC} last changed at ${short(p.srcCommit)} (HEAD ${short(p.head)}), ${dirty}; resolves to ${p.resolved}`;
}
