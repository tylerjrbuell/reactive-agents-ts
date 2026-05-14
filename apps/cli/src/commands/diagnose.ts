// rax diagnose — forensic CLI for recorded trace files.
//
// Thin dispatcher over @reactive-agents/diagnose. The standalone
// `rax-diagnose` binary remains available for backwards compatibility but
// this is the canonical entry point in v0.11+.

import {
  listCommand,
  replayCommand,
  grepCommand,
  diffCommand,
  debriefCommand,
  replayRunCommand,
} from "@reactive-agents/diagnose";
import { fail, info } from "../ui.js";

const HELP = `
  Usage: rax diagnose <subcommand> [options]

  Subcommands:
    list [--limit <n>]                       Show recent traces
    replay <runId> [--raw|--json] [--only=k1,k2]
                                             Pretty-print trace timeline
    replay-run <runId> [--json]              Show recorded-run metadata for re-execution via the replay() API
    grep <runId> "<expr>"                    Filter events with a JS predicate (e is the event)
    diff <runIdA> <runIdB>                   Structural diff between two runs
    debrief <runId> [--json]                 Decision timeline with rationale (why this path)

  Run IDs:
    - bare ULID resolves under ~/.reactive-agents/traces/
    - absolute path to a .jsonl file
    - "latest" — most recently modified trace

  Examples:
    rax diagnose list
    rax diagnose replay latest
    rax diagnose replay 01KQ81... --only=verifier-verdict,harness-signal-injected
    rax diagnose grep latest "e.kind === 'verifier-verdict' && !e.verified"
    rax diagnose diff 01KQ80... 01KQ81...
    rax diagnose replay-run latest --json

  Env:
    REACTIVE_AGENTS_TRACE_DIR  override the default trace directory
    REACTIVE_AGENTS_TRACE=off  disable trace recording in agent runs
`.trimEnd();

function parseFlags(argv: readonly string[]): {
  positional: string[];
  flags: Map<string, string | boolean>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (const token of argv) {
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 0) flags.set(token.slice(2, eq), token.slice(eq + 1));
      else flags.set(token.slice(2), true);
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

export async function runDiagnose(argv: string[]): Promise<void> {
  const sub = argv[0];
  if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
    console.log(HELP);
    return;
  }
  const { positional, flags } = parseFlags(argv.slice(1));

  switch (sub) {
    case "list": {
      const limitFlag = flags.get("limit");
      const limit = typeof limitFlag === "string" ? Number(limitFlag) : undefined;
      await listCommand({ limit });
      return;
    }
    case "replay": {
      const id = positional[0];
      if (!id) throw new Error("replay requires a runId. Try: rax diagnose replay latest");
      const raw = Boolean(flags.get("raw"));
      const json = Boolean(flags.get("json"));
      const onlyFlag = flags.get("only");
      const only = typeof onlyFlag === "string" ? onlyFlag.split(",").map((s) => s.trim()) : undefined;
      await replayCommand(id, { raw, json, only });
      return;
    }
    case "replay-run": {
      const id = positional[0];
      if (!id) throw new Error("replay-run requires a runId. Try: rax diagnose replay-run latest");
      const json = Boolean(flags.get("json"));
      await replayRunCommand(id, { json });
      return;
    }
    case "grep": {
      const id = positional[0];
      const expr = positional[1];
      if (!id || !expr) throw new Error("grep requires <runId> and a JS expression");
      await grepCommand(id, expr);
      return;
    }
    case "diff": {
      const a = positional[0];
      const b = positional[1];
      if (!a || !b) throw new Error("diff requires two runIds");
      await diffCommand(a, b);
      return;
    }
    case "debrief": {
      const id = positional[0];
      if (!id) throw new Error("debrief requires a runId. Try: rax diagnose debrief latest");
      const json = Boolean(flags.get("json"));
      await debriefCommand(id, { json });
      return;
    }
    default:
      console.error(fail(`Unknown diagnose subcommand: ${sub}`));
      console.error(info("Run `rax diagnose --help` to see available subcommands."));
      process.exit(1);
  }
}
