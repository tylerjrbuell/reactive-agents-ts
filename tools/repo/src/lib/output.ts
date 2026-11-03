/** Output contract shared by every repo-CLI command. */

/** Sinks for process output; injectable so tests can capture. */
export interface Streams {
  stdout(text: string): void
  stderr(text: string): void
}

/**
 * Command I/O. `fail` prints the message then `next: <cmd>` and returns exit code 1;
 * `usage` does the same for caller mistakes and returns exit code 2. These two own the
 * `next:` line format.
 */
export interface Io {
  json: boolean
  /** `--full` given: output cap lifted. */
  full: boolean
  /** Capped line output: past {@link OUTPUT_CAP} lines it is dropped and counted for `flush`. */
  out(text: string): void
  /** Uncapped line output for load-bearing lines (summaries, footers). */
  result(text: string): void
  /** Emit the `... N more (use --full)` suffix when `out` dropped lines. Call once, last. */
  flush(): void
  data(value: unknown): void
  fail(message: string, next: string): number
  usage(message: string, next: string): number
}

/** Default max lines of capped `out` per command run. */
export const OUTPUT_CAP = 40

/** Streams backed by the real process. */
export const processStreams: Streams = {
  stdout: (t) => void process.stdout.write(t),
  stderr: (t) => void process.stderr.write(t),
}

/** Build an Io. In json mode `out` is silent and `data` prints one JSON document. */
export function makeIo(json: boolean, streams: Streams, full = false): Io {
  let lines = 0
  let dropped = 0
  return {
    json,
    full,
    out: (text) => {
      if (json) return
      if (!full && lines >= OUTPUT_CAP) {
        dropped += 1
        return
      }
      lines += 1
      streams.stdout(`${text}\n`)
    },
    result: (text) => {
      if (!json) streams.stdout(`${text}\n`)
    },
    flush: () => {
      if (!json && dropped > 0) streams.stdout(`... ${dropped} more (use --full)\n`)
    },
    data: (value) => {
      if (json) streams.stdout(`${JSON.stringify(value, null, 2)}\n`)
    },
    fail: (message, next) => {
      streams.stderr(`${message}\nnext: ${next}\n`)
      return 1
    },
    usage: (message, next) => {
      streams.stderr(`${message}\nnext: ${next}\n`)
      return 2
    },
  }
}
