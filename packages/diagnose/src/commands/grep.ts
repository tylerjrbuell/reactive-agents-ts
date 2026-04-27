// `rax diagnose grep <runId> <expression>` — query a trace via JS predicate.
//
// The expression runs against each event as `e`. Examples:
//   "e.kind === 'verifier-verdict' && !e.verified"
//   "e.kind === 'harness-signal-injected' && e.iter > 3"
//   "e.kind === 'kernel-state-snapshot' && e.outputLen === 0"
//
// Matching events print as JSON one per line — pipe to jq for further work.

import { loadTrace, type TraceEvent } from "@reactive-agents/trace";
import { resolveTracePath } from "../lib/resolve.js";

export async function grepCommand(idOrPath: string, expression: string): Promise<void> {
  if (!expression || expression.trim().length === 0) {
    throw new Error("grep requires a JS expression as the second argument");
  }
  const path = await resolveTracePath(idOrPath);
  const trace = await loadTrace(path);

  let predicate: (e: TraceEvent) => unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    predicate = new Function("e", `return (${expression})`) as (e: TraceEvent) => unknown;
  } catch (err) {
    throw new Error(`Invalid grep expression: ${(err as Error).message}`);
  }

  let matchCount = 0;
  for (const ev of trace.events) {
    let pass = false;
    try {
      pass = Boolean(predicate(ev));
    } catch {
      // Errors during predicate evaluation = no match (e.g. accessing fields
      // that don't exist on this event kind). Silently skip — the user is
      // exploring; spamming errors per non-match is not useful.
      pass = false;
    }
    if (pass) {
      matchCount++;
      console.log(JSON.stringify(ev));
    }
  }
  // Footer goes to stderr so stdout stays pure JSONL for piping.
  process.stderr.write(`\n# matched ${matchCount}/${trace.events.length} events\n`);
}
