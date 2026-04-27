#!/usr/bin/env node
// rax-diagnose — first-class harness diagnostic CLI (Sprint 3.6).
//
// Usage:
//   rax-diagnose list                    # show recent traces
//   rax-diagnose replay <runId>          # pretty-print timeline (use "latest" for most recent)
//   rax-diagnose replay <runId> --raw    # one-event-per-line, no grouping
//   rax-diagnose replay <runId> --json   # raw JSONL stream
//   rax-diagnose replay <runId> --only=verifier-verdict,harness-signal-injected
//   rax-diagnose grep <runId> "<expr>"   # filter via JS predicate; output JSONL
//   rax-diagnose diff <runIdA> <runIdB>  # structural diff between two runs
//
// Run IDs: bare ULID (resolves under ~/.reactive-agents/traces/), absolute
// path to a .jsonl file, or the literal "latest" alias.

import { listCommand } from "./commands/list.js";
import { replayCommand } from "./commands/replay.js";
import { grepCommand } from "./commands/grep.js";
import { diffCommand } from "./commands/diff.js";

interface ParsedArgs {
  readonly command: string;
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, string | boolean>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const command = argv[0] ?? "help";
  const rest = argv.slice(1);
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (const token of rest) {
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 0) {
        flags.set(token.slice(2, eq), token.slice(eq + 1));
      } else {
        flags.set(token.slice(2), true);
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

function printHelp(): void {
  console.log(`rax-diagnose — harness diagnostic CLI

Commands:
  list                            Show recent traces
  replay <runId> [--raw|--json]   Pretty-print timeline; --only=k1,k2 to filter
  grep <runId> "<expr>"           Filter events with a JS predicate (e is the event)
  diff <runIdA> <runIdB>          Structural diff between two runs

Run IDs:
  - bare ULID resolves under ~/.reactive-agents/traces/
  - absolute path to a .jsonl file
  - "latest" — most recently modified trace

Examples:
  rax-diagnose list
  rax-diagnose replay latest
  rax-diagnose replay 01KQ81... --only=verifier-verdict,harness-signal-injected
  rax-diagnose grep latest "e.kind === 'verifier-verdict' && !e.verified"
  rax-diagnose diff 01KQ80... 01KQ81...

Env:
  REACTIVE_AGENTS_TRACE_DIR  override the default trace directory
  REACTIVE_AGENTS_TRACE=off  disable trace recording in agent runs
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  try {
    switch (args.command) {
      case "list": {
        const limitFlag = args.flags.get("limit");
        const limit = typeof limitFlag === "string" ? Number(limitFlag) : undefined;
        await listCommand({ limit });
        return;
      }
      case "replay": {
        const id = args.positional[0];
        if (!id) throw new Error("replay requires a runId. Try: rax-diagnose replay latest");
        const raw = Boolean(args.flags.get("raw"));
        const json = Boolean(args.flags.get("json"));
        const onlyFlag = args.flags.get("only");
        const only = typeof onlyFlag === "string" ? onlyFlag.split(",").map((s) => s.trim()) : undefined;
        await replayCommand(id, { raw, json, only });
        return;
      }
      case "grep": {
        const id = args.positional[0];
        const expr = args.positional[1];
        if (!id || !expr) throw new Error("grep requires <runId> and a JS expression");
        await grepCommand(id, expr);
        return;
      }
      case "diff": {
        const a = args.positional[0];
        const b = args.positional[1];
        if (!a || !b) throw new Error("diff requires two runIds");
        await diffCommand(a, b);
        return;
      }
      case "help":
      case "--help":
      case "-h":
        printHelp();
        return;
      default:
        console.error(`Unknown command: ${args.command}`);
        console.error("Run with --help to see available commands.");
        process.exit(2);
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

void main();
