import { PassThrough } from "node:stream";

/**
 * A `PassThrough` posing as the TTY `NodeJS.WriteStream` the status renderer
 * writes to. The one documented widening cast for renderer tests lives here so
 * individual tests stay cast-free.
 */
export function makeMockStream(isTTY = true): NodeJS.WriteStream {
  // boundary: tests read this stream back through its Readable side ("data"
  // events), which the capture-only fakeWriteStream double does not provide.
  const stream = new PassThrough() as unknown as NodeJS.WriteStream;
  stream.isTTY = isTTY;
  return stream;
}
