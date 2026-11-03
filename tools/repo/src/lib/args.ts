import type { Io } from "./output.ts"

/** Flags a command accepts. `flags` are booleans; `values` take one following value. */
export interface AllowedArgs {
  flags?: readonly string[]
  values?: readonly string[]
}

/**
 * Reject any unknown flag or stray positional. Returns exit code 2 (after printing
 * `next: bun run repo <cmd> --help`) or `undefined` when all args are acceptable.
 */
export function rejectUnknown(
  io: Io,
  cmd: string,
  args: readonly string[],
  allowed: AllowedArgs,
): number | undefined {
  const flags = new Set(allowed.flags ?? [])
  const values = new Set(allowed.values ?? [])
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string
    if (values.has(a)) {
      if (i + 1 >= args.length) return io.usage(`missing value for ${a}`, `bun run repo ${cmd} --help`)
      i++
    } else if (!flags.has(a)) {
      const kind = a.startsWith("-") ? "flag" : "argument"
      return io.usage(`unknown ${kind}: ${a}`, `bun run repo ${cmd} --help`)
    }
  }
  return undefined
}

/** Value following `name` in args, or undefined. */
export function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
