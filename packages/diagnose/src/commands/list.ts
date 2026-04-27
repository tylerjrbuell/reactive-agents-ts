// `rax diagnose list` — show recent traces in the default trace dir.

import { listTraces, DEFAULT_TRACE_DIR } from "../lib/resolve.js";
import { bold, dim, fmtBytes, gray } from "../lib/format.js";

export async function listCommand(opts: { limit?: number } = {}): Promise<void> {
  const files = await listTraces();
  if (files.length === 0) {
    console.log(`No traces found in ${DEFAULT_TRACE_DIR}`);
    console.log(dim("Run an agent to generate one (tracing is on by default in Sprint 3.6+)."));
    return;
  }
  const limit = opts.limit ?? 20;
  console.log("");
  console.log(bold(`Recent traces in ${DEFAULT_TRACE_DIR}`));
  console.log("");
  for (const f of files.slice(0, limit)) {
    const age = humanAge(f.mtime);
    console.log(`  ${f.runId}  ${gray(`${age.padStart(8)}  ${fmtBytes(f.sizeBytes).padStart(7)}`)}`);
  }
  if (files.length > limit) {
    console.log(dim(`\n  ${files.length - limit} more...`));
  }
  console.log("");
}

function humanAge(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
