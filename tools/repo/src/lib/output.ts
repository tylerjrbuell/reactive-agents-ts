/** Output contract shared by every repo-CLI command. */

/** Sinks for process output; injectable so tests can capture. */
export interface Streams {
  stdout(text: string): void
  stderr(text: string): void
}

/** Command I/O. `fail` prints the message then `next: <cmd>` and returns exit code 1. */
export interface Io {
  json: boolean
  out(text: string): void
  data(value: unknown): void
  fail(message: string, next: string): number
}

/** Streams backed by the real process. */
export const processStreams: Streams = {
  stdout: (t) => void process.stdout.write(t),
  stderr: (t) => void process.stderr.write(t),
}

/** Build an Io. In json mode `out` is silent and `data` prints one JSON document. */
export function makeIo(json: boolean, streams: Streams): Io {
  return {
    json,
    out: (text) => {
      if (!json) streams.stdout(`${text}\n`)
    },
    data: (value) => {
      if (json) streams.stdout(`${JSON.stringify(value, null, 2)}\n`)
    },
    fail: (message, next) => {
      streams.stderr(`${message}\nnext: ${next}\n`)
      return 1
    },
  }
}
