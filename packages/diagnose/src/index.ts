// @reactive-agents/diagnose — programmatic API.
//
// The CLI (`rax-diagnose`) is the primary surface. Programmatic exports are
// for tests and for other tools (e.g. the harness-improvement-loop skill)
// that want to call commands directly.

export { resolveTracePath, listTraces, DEFAULT_TRACE_DIR } from "./lib/resolve.js";
export type { TraceFileInfo } from "./lib/resolve.js";
export { replayCommand } from "./commands/replay.js";
export type { ReplayOpts } from "./commands/replay.js";
export { grepCommand } from "./commands/grep.js";
export { diffCommand } from "./commands/diff.js";
export { listCommand } from "./commands/list.js";
