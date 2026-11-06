// packages/trace/src/tool-claim.ts
//
// A run that reports success while a tool the task asked for was never called
// (2026-11-06 tool-surface spike, D2: "Fetch https://example.com with http-get
// and tell me the page title" ended `cause=none` with zero tool calls and an
// answer that names the page title).
//
// The trace has no registry of the run's tools (builtins dropped by the opt-in
// leave no `tool-surface-resolved` entry), so a tool is recognised by how the
// CURRENT turn of the task and the shipped output name it, never by what the
// output asserts:
//   - a kebab-case token (`http-get`, `file-write`) that is not part of a path
//     or URL, and
//   - that the task calls a tool (`the file-write tool`), or that the output
//     shows in a code span or fence (`http-get https://...`).
// Conversation history before the current turn is skipped (`contract-compiled
// .currentTurn.offset`): a tool an earlier turn named is not this turn's ask.
// Corpus check (2026-11-06, 3,039 runs, 2,441 zero-call successes): 5 hits;
// the `with <token>` wording alone (1 false positive: "with domain-specific
// ...") is not enough and is not used.

/** A kebab-case token that stands alone (not inside a path, URL or longer word). */
const TOKEN = /(?<![\w/.-])[a-z]+(?:-[a-z]+)+(?![\w/.-])/g;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Tool names the task's current turn asked for and the run never called.
 *
 * @param task The task text (`run-started.task`).
 * @param currentTurnOffset Where the current turn starts in `task`
 *   (`contract-compiled.currentTurn.offset`); 0 when unknown.
 * @param output The shipped output (`run-completed.output`).
 * @param called Names of the tools the run called (any outcome).
 * @returns Tool-like names the turn named as a tool (or the output showed as a
 *   command) with no call of that name; empty when none.
 */
export function uncalledClaimedTools(task: string, currentTurnOffset: number, output: string, called: ReadonlySet<string>): readonly string[] {
  const turn = task.slice(Math.max(0, Math.min(currentTurnOffset, task.length)));
  const fenced = [...output.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map((m) => m[0]).join("\n");
  return [...new Set(turn.match(TOKEN) ?? [])].filter((t) => {
    if (called.has(t)) return false;
    const namedAsTool = new RegExp(`(?<![\\w/.-])${escapeRe(t)}\\s+tool\\b`, "i").test(turn);
    const shownAsCommand = new RegExp(`(?<![\\w/.-])${escapeRe(t)}(?![\\w/.-])`).test(fenced);
    return namedAsTool || shownAsCommand;
  });
}
