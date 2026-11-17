// Run: bun run repo test apps/cortex/server/tests/channel-hub-durable-inbox.test.ts
//
// The hub runs the framework's durable SQLite inbox, outbox and follow-up timers on the Cortex db file:
//  - status carries inbox / outbox / timers counts for a file db; `CORTEX_CHANNEL_INBOX=memory` and a
//    `:memory:` db keep the in-memory ports (no counts, the UI shows its note)
//  - a real child process is SIGKILLed mid-turn; a second process on the same file retries the orphaned
//    turn exactly once, ignores a redelivered duplicate and sends the reply the crash left `pending`
//    (removing the durable inbox from `openHubStore` fails the second test)
import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { insertChannel, insertRoute } from "../db/channel-hub-queries.js";
import { ChannelHub } from "../services/channel-hub.js";
import { durableInboxFromEnv } from "../services/channel-hub-durable-inbox.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { CortexEventBridge, CortexEventBridgeLive } from "../services/event-bridge.js";
import { CortexIngestServiceLive } from "../services/ingest-service.js";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";
import { scriptedChannel } from "./helpers/scripted-channel.js";

const CH = "ch-durable01";
const dbs: string[] = [];
const hubs: ChannelHub[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(hubs.splice(0).map((h) => h.stop()));
  for (const c of children.splice(0)) c.kill("SIGKILL");
  for (const p of dbs.splice(0)) rmDbFiles(p);
});

const ingestLayer = (database: Database) => {
  const bridge = Effect.runSync(CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)));
  return CortexIngestServiceLive(database).pipe(Layer.provide(Layer.succeed(CortexEventBridge, bridge))) as Layer.Layer<never>;
};

const hubOn = (path: string, durableInbox: boolean) => {
  const db = new Database(path);
  applySchema(db);
  insertChannel(db, { id: CH, platform: "telegram", settings: {} });
  insertRoute(db, { id: "r1", match: { channelId: CH }, target: { agentId: "agent-x" }, owners: ["telegram:1"] });
  const ch = scriptedChannel(CH);
  const hub = new ChannelHub({
    db,
    ingestLayer: ingestLayer(db) as never,
    toBuildParams: gatewayConfigToBuildParams,
    makeAdapters: () => ({ adapters: [ch.adapter], webhooks: [], skipped: [] }),
    durableInbox,
  });
  hubs.push(hub);
  return hub;
};

describe("hub status carries the durable queues", () => {
  it("a file db reports inbox, outbox and timers counts", async () => {
    const path = tmpDbPath("hub-durable");
    dbs.push(path);
    const hub = hubOn(path, true);
    await hub.start();
    const s = await hub.status();
    expect(s.phase).toBe("running");
    expect(s.durableStore).toBe(true);
    expect(s.router?.inbox).toEqual({ received: 0, running: 0, done: 0, failed: 0, dropped: 0 });
    expect(s.router?.outbox).toEqual({ pending: 0, sent: 0, failed: 0 });
    expect(s.router?.timers).toEqual({ pending: 0, fired: 0, cancelled: 0 });
  });

  it("a webhook route starts: the router gets the route as saved, not re-encoded with a default senderTools the framework refuses on webhooks", async () => {
    const path = tmpDbPath("hub-webhook");
    dbs.push(path);
    const db = new Database(path);
    applySchema(db);
    insertChannel(db, { id: CH, platform: "webhook", settings: { ingressPort: 4398 } });
    insertRoute(db, { id: "rw", match: { channelId: CH }, target: { agentId: "agent-x" } });
    const ch = scriptedChannel(CH);
    const hub = new ChannelHub({
      db,
      ingestLayer: ingestLayer(db) as never,
      toBuildParams: gatewayConfigToBuildParams,
      makeAdapters: () => ({ adapters: [{ ...ch.adapter, platform: "webhook" }], webhooks: [], skipped: [] }),
    });
    hubs.push(hub);
    await hub.start();
    const s = await hub.status();
    expect(s.error).toBeNull();
    expect(s.phase).toBe("running");
  });

  it("the memory switch and a :memory: db keep the in-memory ports", async () => {
    const path = tmpDbPath("hub-memory");
    dbs.push(path);
    const off = hubOn(path, false);
    await off.start();
    expect((await off.status()).router?.inbox).toBeUndefined();
    const mem = hubOn(":memory:", true);
    await mem.start();
    expect((await mem.status()).router?.inbox).toBeUndefined();
    expect(durableInboxFromEnv({})).toBe(true);
    expect(durableInboxFromEnv({ CORTEX_CHANNEL_INBOX: "memory" })).toBe(false);
  });
});

interface ChildRun {
  readonly proc: ChildProcess;
  readonly lines: Promise<string[]>;
  readonly waitFor: (line: string) => Promise<void>;
}

const runChild = (mode: "crash" | "restart", path: string): ChildRun => {
  const proc = spawn(process.execPath, [join(import.meta.dir, "helpers", "durable-inbox-child.ts"), mode, path], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(proc);
  const out: string[] = [];
  let buf = "";
  const waiters: Array<{ line: string; done: () => void }> = [];
  proc.stdout?.on("data", (d: Buffer) => {
    buf += d.toString();
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const l of parts) {
      out.push(l);
      for (const w of waiters.filter((x) => x.line === l)) w.done();
    }
  });
  let err = "";
  proc.stderr?.on("data", (d: Buffer) => (err += d.toString()));
  const lines = new Promise<string[]>((resolve, reject) => {
    proc.on("exit", (code, signal) => (code === 0 || signal === "SIGKILL" ? resolve(out) : reject(new Error(`child ${mode} exited ${code}: ${err}`))));
  });
  const waitFor = (line: string) =>
    new Promise<void>((resolve, reject) => {
      if (out.includes(line)) return resolve();
      waiters.push({ line, done: resolve });
      proc.on("exit", () => reject(new Error(`child exited before "${line}": ${err}`)));
    });
  return { proc, lines, waitFor };
};

describe("restart recovery across a real SIGKILL", () => {
  it("retries the orphaned turn once, dedupes a redelivery, sends the pending reply", async () => {
    const path = tmpDbPath("hub-crash");
    dbs.push(path);

    const first = runChild("crash", path);
    await first.waitFor("READY");
    first.proc.kill("SIGKILL");
    await first.lines;

    // What the dead process left behind, read straight from the file.
    const peek = new Database(path, { readonly: true });
    const rows = peek.prepare("SELECT status, COUNT(*) AS n FROM router_inbox GROUP BY status").all() as { status: string; n: number }[];
    const pending = peek.prepare("SELECT COUNT(*) AS n FROM router_outbox WHERE status = 'pending'").get() as { n: number };
    peek.close();
    expect(rows).toEqual([{ status: "running", n: 1 }]);
    expect(pending.n).toBe(1);

    const second = runChild("restart", path);
    const lines = await second.lines;
    const summary = JSON.parse(lines[lines.length - 1] ?? "{}") as {
      turns: string[];
      sent: string[];
      inbox: Record<string, number>;
      outbox: Record<string, number>;
    };
    // One retry of the killed turn (the redelivered duplicate ran nothing), and both replies went out.
    expect(summary.turns).toEqual(["hang"]);
    expect([...summary.sent].sort()).toEqual(["queued reply", "re:hang"]);
    expect(summary.inbox).toEqual({ received: 0, running: 0, done: 1, failed: 0, dropped: 0 });
    expect(summary.outbox["pending"]).toBe(0);
  }, 15_000);
});
