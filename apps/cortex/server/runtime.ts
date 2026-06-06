import { Effect, Layer } from "effect";
import type { Database } from "bun:sqlite";
import { openDatabase } from "./db/schema.js";
import { CortexIngestServiceLive, CortexIngestService } from "./services/ingest-service.js";
import { CortexEventBridge, CortexEventBridgeLive } from "./services/event-bridge.js";
import { CortexStoreServiceLive } from "./services/store-service.js";
import { CortexRunnerServiceLive, CortexRunnerService } from "./services/runner-service.js";
import { GatewayProcessManager } from "./services/gateway-process-manager.js";
import type { CortexConfig } from "./types.js";

export interface CortexRuntime {
  readonly db: Database;
  readonly ingestLayer: Layer.Layer<CortexIngestService>;
  readonly bridgeLayer: Layer.Layer<CortexEventBridge>;
  readonly storeLayer: ReturnType<typeof CortexStoreServiceLive>;
  readonly runnerLayer: Layer.Layer<CortexRunnerService>;
  /** Raw DB reference for routers that need direct query access (agents, etc.) */
  readonly rawDb: Database;
  /** Gateway process manager — owns lifecycle of all scheduled agents */
  readonly gateway: GatewayProcessManager;
}

export function createCortexRuntime(config: CortexConfig): CortexRuntime {
  const db = openDatabase(config.dbPath);
  // Materialize one shared bridge service instance and re-provide it everywhere.
  // This prevents split-brain subscriber maps between live WS handlers and ingest broadcasts.
  const bridgeService = Effect.runSync(
    CortexEventBridge.pipe(Effect.provide(CortexEventBridgeLive)),
  );
  const bridgeLayer = Layer.succeed(CortexEventBridge, bridgeService);
  const ingestLayer = CortexIngestServiceLive(db).pipe(
    Layer.provide(bridgeLayer),
  ) as Layer.Layer<CortexIngestService>;
  const storeLayer = CortexStoreServiceLive(db);
  // Materialize ONE shared runner instance and re-provide it everywhere (same
  // pattern as the bridge above). The runner's `activeRef` registry — the map of
  // in-flight desk runs — is in-memory state. If `runnerLayer` were a plain
  // un-materialized Layer, every `Effect.provide(runnerLayer)` (one per HTTP
  // request) would rebuild the service with a fresh empty registry, so
  // POST /:runId/pause|stop|resume could never find the agent that POST /api/runs
  // started in a different instance — controls would silently no-op.
  const runnerService = Effect.runSync(
    CortexRunnerService.pipe(
      Effect.provide(
        CortexRunnerServiceLive.pipe(Layer.provide(Layer.merge(storeLayer, ingestLayer))),
      ),
    ),
  );
  const runnerLayer = Layer.succeed(CortexRunnerService, runnerService);

  const gateway = new GatewayProcessManager(db, ingestLayer);

  return { db, ingestLayer, bridgeLayer, storeLayer, runnerLayer, rawDb: db, gateway };
}
