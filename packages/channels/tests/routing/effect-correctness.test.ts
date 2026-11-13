import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import type { ChannelAdapter } from "../../src/adapter.js";
import { channelError } from "../../src/errors.js";
import { AdapterHub } from "../../src/routing/adapter-hub.js";
import { ChannelLeaseError, makeFileLeases, type AccountLeases } from "../../src/routing/lease.js";
import { createChannelRouter } from "../../src/routing/router.js";
import { ChannelAlreadyOwned } from "../../src/routing/types.js";
import { env, makeFakeAgents, makeScriptedAdapter, waitFor } from "./scripted.js";

const hubFor = (over: Partial<ConstructorParameters<typeof AdapterHub>[0]> = {}) =>
  new AdapterHub({
    taskId: () => "t",
    onEnvelope: () => Effect.void,
    onMessage: () => Effect.void,
    senderGate: () => Effect.succeed(true),
    ...over,
  });

/** A scripted adapter that records when its scope-bound resources are released. */
const recording = (id: string, log: string[]): ChannelAdapter => {
  const inner = makeScriptedAdapter({ id });
  return {
    ...inner,
    start: () =>
      Effect.zipRight(
        inner.start(),
        Effect.addFinalizer(() => Effect.sync(() => void log.push(`stop:${id}`))),
      ),
  };
};

describe("F1b: inbound handler defect", () => {
  test("a defect in the envelope handler fails the channel instead of silently ending the fiber", async () => {
    const scripted = makeScriptedAdapter({ id: "a" });
    const failed: string[] = [];
    const hub = hubFor({
      onEnvelope: () => Effect.die(new Error("handler blew up")),
      onChannelFailed: (id, error) => Effect.sync(() => void failed.push(`${id}:${error.kind}`)),
    });
    await Effect.runPromise(hub.register(scripted));
    scripted.push(env());
    await waitFor(() => failed.length === 1);
    expect(failed).toEqual(["a:unknown"]);
    expect(hub.info()[0]?.state.status).toBe("failed");
    expect(hub.info()[0]?.connected).toBe(false);
    await Effect.runPromise(hub.shutdown());
  });
});

describe("F7: adapter hub registration", () => {
  test("a failed start leaves no ghost registration", async () => {
    const inner = makeScriptedAdapter({ id: "bad" });
    const bad: ChannelAdapter = { ...inner, start: () => Effect.fail(channelError("bad", "network")) };
    const hub = hubFor();
    const exit = await Effect.runPromiseExit(hub.register(bad));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(hub.has("bad")).toBe(false);
    expect(hub.info()).toEqual([]);
  });

  test("concurrent registrations share one scope and shutdown stops both adapters", async () => {
    const log: string[] = [];
    const hub = hubFor();
    await Effect.runPromise(
      Effect.all([hub.register(recording("a", log)), hub.register(recording("b", log))], { concurrency: "unbounded" }),
    );
    await Effect.runPromise(hub.shutdown());
    expect([...log].sort()).toEqual(["stop:a", "stop:b"]);
  });
});

describe("F6: router teardown order", () => {
  test("adapters stop before the account lease is released", async () => {
    const log: string[] = [];
    const leases: AccountLeases = {
      acquire: (channelId) =>
        Effect.acquireRelease(Effect.void, () => Effect.sync(() => void log.push(`release:${channelId}`))),
    };
    await Effect.runPromise(
      Effect.scoped(
        createChannelRouter({
          channels: [recording("chan", log)],
          routes: [{ id: "r", match: { channelId: "chan" }, target: { agentId: "a" }, allow: ["scripted:alice"] }],
          agents: makeFakeAgents().resolver,
          leases,
        }),
      ),
    );
    expect(log).toEqual(["stop:chan", "release:chan"]);
  });
});

describe("F5: file lease", () => {
  const lockFor = (dir: string, fingerprint: string) =>
    join(dir, `${createHash("sha256").update(fingerprint).digest("hex").slice(0, 32)}.lock`);

  test("an unusable lock directory is a typed ChannelLeaseError, not a defect", async () => {
    const base = mkdtempSync(join(tmpdir(), "ra-lease-"));
    const blocker = join(base, "file");
    writeFileSync(blocker, "x");
    const leases = makeFileLeases({ lockDir: join(blocker, "sub") });
    const exit = await Effect.runPromiseExit(Effect.scoped(leases.acquire("c", "fp")));
    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" ? exit.cause.error : undefined).toBeInstanceOf(
      ChannelLeaseError,
    );
  });

  test("a live lock is never removed by a contender", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-lease-"));
    const path = lockFor(dir, "fp");
    const live = JSON.stringify({ pid: process.pid, since: 1, host: hostname() });
    writeFileSync(path, live);
    const exit = await Effect.runPromiseExit(Effect.scoped(makeFileLeases({ lockDir: dir }).acquire("c", "fp")));
    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" ? exit.cause.error : undefined).toBeInstanceOf(
      ChannelAlreadyOwned,
    );
    expect(readdirSync(dir)).toEqual([path.split("/").pop() ?? ""]);
  });

  test("a stale lock is taken over and leaves no tombstone behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-lease-"));
    writeFileSync(lockFor(dir, "fp"), JSON.stringify({ pid: 2 ** 22 + 12345, since: 1, host: hostname() }));
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* makeFileLeases({ lockDir: dir }).acquire("c", "fp");
          expect(readdirSync(dir).length).toBe(1);
        }),
      ),
    );
    expect(readdirSync(dir)).toEqual([]);
  });
});
