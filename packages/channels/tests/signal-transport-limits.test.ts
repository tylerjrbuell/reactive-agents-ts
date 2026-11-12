import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { Chunk, Effect, Stream, TestContext, type Scope } from "effect";
import {
  linesOf,
  makeJsonRpcConnection,
  makeSignalProcessTransport,
  makeStderrRing,
  safeCause,
} from "../src/adapters/signal-transport.js";

const ACCOUNT = "+15559990000";

const run = <A, E>(eff: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(eff.pipe(Effect.scoped, Effect.provide(TestContext.TestContext)));

describe("linesOf", () => {
  test("splits complete lines as before", async () => {
    const source = new PassThrough();
    const collected = Effect.runPromise(Stream.runCollect(linesOf("signal", source)).pipe(Effect.map(Chunk.toReadonlyArray)));
    source.write('{"a":1}\n{"b":');
    source.write('2}\n\n');
    source.end();
    expect(await collected).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("a line that never ends is cut off with too_large and the source is destroyed", async () => {
    const source = new PassThrough();
    const outcome = Effect.runPromise(Effect.flip(Stream.runCollect(linesOf("signal", source, 100))));
    source.write("x".repeat(60));
    source.write("x".repeat(60)); // 120 chars, no newline
    const error = await outcome;
    expect(error).toMatchObject({ _tag: "ChannelError", kind: "too_large" });
    expect(source.destroyed).toBe(true);
  });

  test("a complete over-long line is refused too", async () => {
    const source = new PassThrough();
    const outcome = Effect.runPromise(Effect.flip(Stream.runCollect(linesOf("signal", source, 100))));
    source.write(`${"y".repeat(150)}\nok\n`);
    expect(await outcome).toMatchObject({ kind: "too_large" });
  });
});

describe("notification backlog", () => {
  test("a consumer that never drains gets a typed too_large failure, not unbounded memory", () =>
    run(
      Effect.gen(function* () {
        const notification = JSON.stringify({ jsonrpc: "2.0", method: "receive", params: {} });
        const connection = yield* makeJsonRpcConnection("signal", {
          lines: Stream.fromIterable(Array.from({ length: 10 }, () => notification)),
          write: () => Effect.void,
          maxPendingNotifications: 3,
        });
        const error = yield* Effect.flip(Stream.runCollect(connection.notifications));
        expect(error).toMatchObject({ kind: "too_large" });
      }),
    ));
});

describe("account redaction", () => {
  test("a spawn failure keeps only name and code: the account is nowhere in the error", async () => {
    const transport = makeSignalProcessTransport({ account: ACCOUNT, command: "ra-no-such-binary-for-test" });
    const error = await run(
      Effect.gen(function* () {
        const connection = yield* transport.open;
        return yield* Effect.flip(Stream.runCollect(connection.notifications));
      }),
    );
    expect(error.kind).toBe("network");
    expect(error.cause).toEqual({ name: "Error", code: "ENOENT" });
    expect(JSON.stringify(error)).not.toContain(ACCOUNT);
    expect(String(error.message)).not.toContain(ACCOUNT);
    expect(transport.diagnostics?.().join("\n") ?? "").not.toContain(ACCOUNT);
  });

  test("safeCause drops everything but name and code", () => {
    const err = Object.assign(new Error("spawn x ENOENT"), { code: "ENOENT", spawnargs: ["-a", ACCOUNT], path: "x" });
    expect(safeCause(err)).toEqual({ name: "Error", code: "ENOENT" });
    expect(safeCause("string")).toEqual({ name: "Error" });
  });
});

describe("stderr ring", () => {
  test("keeps the last lines only, cuts long lines, and masks the account", () => {
    const ring = makeStderrRing([ACCOUNT], 5, 40);
    for (let i = 0; i < 20; i++) ring.push(`line ${i} for ${ACCOUNT}\n`);
    ring.push(`${"z".repeat(500)}\n`);
    const lines = ring.lines();
    expect(lines.length).toBe(5);
    expect(lines.at(-1)?.length).toBe(40);
    expect(lines.join("\n")).not.toContain(ACCOUNT);
    expect(lines[0]).toContain("<redacted>");
  });

  test("masks a secret split across chunks and an unterminated tail", () => {
    const ring = makeStderrRing([ACCOUNT]);
    ring.push("error for +1555");
    ring.push("9990000\n");
    ring.push(`partial ${ACCOUNT}`);
    expect(ring.lines().join("\n")).not.toContain(ACCOUNT);
  });
});
