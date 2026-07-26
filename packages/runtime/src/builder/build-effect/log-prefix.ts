/**
 * Build the log prefix that makes a sub-agent's lines FOLLOWABLE: one "│ " per
 * nesting level plus the child's name, e.g. depth 1 → `"  │ researcher · "`,
 * depth 2 → `"  │ │ writer · "`. Prepended to EVERY log line (info/debug/warn/
 * error) by the child's execution engine, so parallel or nested children no
 * longer collapse into one indistinct, unattributable stream. Pure — pinned by
 * `sub-agent-log-prefix.test.ts`.
 *
 * Kept dependency-free in its own module (not `sub-agent-executor.ts`, which
 * imports `ExecutionEngine`) because `reasoning-stream-logger.ts` — imported
 * BY `execution-engine.ts` — also needs this to attribute reasoning-stream
 * DEBUG lines; importing it from `sub-agent-executor.ts` would create a cycle
 * (reasoning-stream-logger → sub-agent-executor → execution-engine →
 * reasoning-stream-logger).
 */
export function buildSubAgentLogPrefix(depth: number, name: string): string {
  return `  ${"│ ".repeat(Math.max(1, depth))}${name} · `;
}
