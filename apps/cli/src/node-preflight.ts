// File: apps/cli/src/node-preflight.ts
//
// Side-effect module that `index.ts` imports FIRST. tsup keeps it a separate
// file (marked external), so in the built ESM bundle it is evaluated before
// any framework package — which is the only way to act before
// `@reactive-agents/runtime-shim` loads `node:sqlite` at import time.
//
// It does two things, both no-ops under Bun:
//   1. Refuses to start on Node.js older than 22.5 with a one-line message.
//   2. Silences Node's one-shot "SQLite is an experimental feature" notice,
//      which runtime-shim triggers on every command (even `rax --version`).
//      Every other warning still prints.

const MIN_NODE: readonly [number, number] = [22, 5];

const isBun = typeof process.versions.bun === "string";

/** True when `version` ("22.5.1") is below the supported Node floor. */
export function isBelowNodeFloor(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map((part) => Number.parseInt(part, 10));
  return major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1]);
}

/** True for Node's experimental notice about `node:sqlite`, and nothing else. */
export function isSqliteExperimentalWarning(warning: string | Error, rest: readonly unknown[]): boolean {
  const message = typeof warning === "string" ? warning : warning.message;
  const type = typeof warning === "string" ? rest[0] : warning.name;
  const typeName =
    typeof type === "string"
      ? type
      : typeof type === "object" && type !== null && "type" in type && typeof type.type === "string"
        ? type.type
        : undefined;
  return typeName === "ExperimentalWarning" && /\bSQLite\b/.test(message);
}

if (!isBun) {
  if (isBelowNodeFloor(process.versions.node)) {
    console.error(
      `rax needs Node.js ${MIN_NODE.join(".")}+ (found ${process.versions.node}). Upgrade Node, or run rax with Bun (https://bun.sh).`,
    );
    process.exit(1);
  }

  const emitWarning = process.emitWarning;
  process.emitWarning = function filteredEmitWarning(
    this: NodeJS.Process,
    warning: string | Error,
    ...rest: unknown[]
  ): void {
    if (isSqliteExperimentalWarning(warning, rest)) return;
    Reflect.apply(emitWarning, this, [warning, ...rest]);
  };
}
