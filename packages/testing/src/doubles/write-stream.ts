/**
 * Typed `NodeJS.WriteStream` test double.
 *
 * `NodeJS.WriteStream` is `tty.WriteStream`, which extends `net.Socket`. Tests
 * used to pass a `PassThrough` widened with a double cast. `fakeWriteStream`
 * instead subclasses a real (unconnected) `net.Socket`, implements the TTY
 * members, and captures every write — so it type-checks with no cast.
 */

import { Socket } from "node:net";

/** Options for {@link fakeWriteStream}. */
export interface FakeWriteStreamOptions {
  /** Reported `isTTY`. Default `false`. */
  readonly isTTY?: boolean;
  /** Reported terminal width. Default `80`. */
  readonly columns?: number;
  /** Reported terminal height. Default `24`. */
  readonly rows?: number;
}

/** A captured write stream: the stream to hand to code, and what it received. */
export interface FakeWriteStream {
  readonly stream: NodeJS.WriteStream;
  /** Everything written so far, concatenated as UTF-8 text. */
  output(): string;
}

class CapturingTtyStream extends Socket implements NodeJS.WriteStream {
  isTTY: boolean;
  columns: number;
  rows: number;
  readonly chunks: string[] = [];

  constructor(opts: FakeWriteStreamOptions) {
    super();
    this.isTTY = opts.isTTY ?? false;
    this.columns = opts.columns ?? 80;
    this.rows = opts.rows ?? 24;
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    // Writable hands `_write` a Buffer unless `decodeStrings: false`; decode as UTF-8.
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    callback();
  }

  clearLine(_dir: -1 | 0 | 1, callback?: () => void): boolean {
    callback?.();
    return true;
  }

  clearScreenDown(callback?: () => void): boolean {
    callback?.();
    return true;
  }

  cursorTo(_x: number, yOrCallback?: number | (() => void), callback?: () => void): boolean {
    (typeof yOrCallback === "function" ? yOrCallback : callback)?.();
    return true;
  }

  moveCursor(_dx: number, _dy: number, callback?: () => void): boolean {
    callback?.();
    return true;
  }

  getColorDepth(_env?: object): number {
    return this.isTTY ? 8 : 1;
  }

  hasColors(countOrEnv?: number | object, _env?: object): boolean {
    const count = typeof countOrEnv === "number" ? countOrEnv : 16;
    return this.isTTY && count <= 256;
  }

  getWindowSize(): [number, number] {
    return [this.columns, this.rows];
  }
}

/**
 * Build a capturing `NodeJS.WriteStream`.
 *
 * Writes are captured synchronously, so `output()` reflects a `write()` as soon
 * as it returns.
 *
 * @example
 * ```ts
 * const { stream, output } = fakeWriteStream({ isTTY: true, columns: 120 });
 * render(stream);
 * expect(output()).toContain("done");
 * ```
 */
export function fakeWriteStream(opts: FakeWriteStreamOptions = {}): FakeWriteStream {
  const stream = new CapturingTtyStream(opts);
  return { stream, output: () => stream.chunks.join("") };
}
