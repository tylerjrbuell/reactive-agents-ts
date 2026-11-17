/**
 * The channel hub's durable inbox, outbox and follow-up timers: the framework's own SQLite store
 * (`openSqliteRouterStore`) opened on the Cortex database file, composed with Cortex's route table,
 * leases and meter (`channel-hub-store.ts`). Nothing of the inbox logic is Cortex's: this only picks
 * the file, opens the framework store, and merges the three durable ports into Cortex's store.
 *
 * A `:memory:` database has no file to share, so it keeps the in-memory ports (the status then
 * shows the "In-memory inbox" note). `CORTEX_CHANNEL_INBOX=memory` is the rollback switch.
 */
import { Effect } from "effect";
import { openSqliteRouterStore, type SqliteRouterStore } from "@reactive-agents/channels";
import { cortexLog, formatErrorDetails } from "../cortex-log.js";
import type { DurableRouterStore, makeDurableRouterStore } from "./channel-hub-store.js";

/** The Cortex database handle, typed as the store factory takes it. */
type CortexDb = Parameters<typeof makeDurableRouterStore>[0];

/** Whether the durable inbox is on: `CORTEX_CHANNEL_INBOX=memory` (also `off` / `0` / `false`) keeps the in-memory ports. */
export const durableInboxFromEnv = (env: Readonly<Record<string, string | undefined>>): boolean => {
  const v = env.CORTEX_CHANNEL_INBOX?.trim().toLowerCase();
  return !(v === "memory" || v === "off" || v === "0" || v === "false");
};

/** The store the router gets, and how to release what was opened for it. */
export interface HubStore {
  readonly store: DurableRouterStore;
  /** True when the framework's durable inbox, outbox and timers back this store. */
  readonly durableInbox: boolean;
  readonly close: () => Promise<void>;
}

/** `cortex` unchanged (no inbox) when the db is in memory or the framework store cannot open; failure is logged, never thrown. */
export const openHubStore = async (db: CortexDb, cortex: DurableRouterStore, enabled: boolean): Promise<HubStore> => {
  const plain: HubStore = { store: cortex, durableInbox: false, close: () => Promise.resolve() };
  if (!enabled || db.filename === "" || db.filename === ":memory:") return plain;
  try {
    const fw: SqliteRouterStore = await Effect.runPromise(openSqliteRouterStore({ path: db.filename }));
    return {
      store: { ...cortex, inbox: fw.inbox, outbox: fw.outbox, timers: fw.timers },
      durableInbox: true,
      close: () => Effect.runPromise(fw.close),
    };
  } catch (e) {
    cortexLog("warn", "channels", "The durable channel inbox could not open; the hub runs with an in-memory inbox", formatErrorDetails(e));
    return plain;
  }
};
