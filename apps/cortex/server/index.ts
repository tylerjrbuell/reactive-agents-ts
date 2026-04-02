import { Elysia } from "elysia";
import { Effect } from "effect";
import { createCortexRuntime } from "./runtime.js";
import { runsRouter } from "./api/runs.js";
import { agentsRouter } from "./api/agents.js";
import { toolsRouter } from "./api/tools.js";
import { skillsRouter } from "./api/skills.js";
import { modelsRouter } from "./api/models.js";
import { handleIngestMessage } from "./ws/ingest.js";
import {
  handleLiveOpen,
  handleLiveClose,
  replayRunEvents,
  type LiveWsData,
} from "./ws/live.js";
import type { ElysiaWS } from "elysia/ws";
import { CortexEventBridge } from "./services/event-bridge.js";
import type { CortexConfig } from "./types.js";
import { defaultCortexConfig } from "./types.js";
import { cortexLog } from "./cortex-log.js";

/** Base URL for startup log and “open browser” (aligns with CORTEX_URL when set). */
function cortexListenDisplayUrl(port: number): string {
  const raw = process.env.CORTEX_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      return `${u.protocol}//${u.host}`;
    } catch {
      /* ignore invalid CORTEX_URL */
    }
  }
  return `http://127.0.0.1:${port}`;
}

export async function startCortexServer(config: CortexConfig = defaultCortexConfig): Promise<void> {
  const runtime = createCortexRuntime(config);

  const bridgeSvc = await Effect.runPromise(
    CortexEventBridge.pipe(Effect.provide(runtime.bridgeLayer)),
  );

  const app = new Elysia()
    .use(runsRouter(runtime.storeLayer, runtime.runnerLayer))
    .use(agentsRouter(runtime.rawDb))
    .use(toolsRouter(runtime.storeLayer))
    .use(skillsRouter(runtime.storeLayer))
    .use(modelsRouter)
    .ws("/ws/ingest", {
      open() {
        cortexLog("info", "ingest-ws", "ingest client connected");
      },
      close() {
        cortexLog("info", "ingest-ws", "ingest client disconnected");
      },
      message(ws, raw) {
        handleIngestMessage(ws.raw, raw, runtime.ingestLayer);
      },
    })
    .ws("/ws/live/:agentId", {
      upgrade({ params, query }) {
        const p = params as Record<string, string | undefined>;
        const agentId = p.agentId ?? p.agentid;
        return {
          agentId,
          runId: query.runId,
        };
      },
      open(ws) {
        const live = ws as unknown as ElysiaWS<LiveWsData>;
        handleLiveOpen(live, bridgeSvc);
        if (live.data.runId) {
          void replayRunEvents(live, runtime.storeLayer, runtime.bridgeLayer);
        }
      },
      close(ws) {
        handleLiveClose(ws as unknown as ElysiaWS<LiveWsData>, bridgeSvc);
      },
    })
    .get("/*", ({ set }) => {
      if (config.staticAssetsPath) {
        return Bun.file(`${config.staticAssetsPath}/index.html`);
      }
      set.status = 404;
      return "Cortex UI not built. Run: cd apps/cortex/ui && bun run build";
    });

  const displayUrl = cortexListenDisplayUrl(config.port);

  app.listen(config.port, () => {
    if (process.env.CORTEX_SPAWNED_BY_RAX !== "1") {
      console.log(`\n◈ CORTEX running at ${displayUrl}\n`);
      cortexLog(
        "info",
        "server",
        "logging: set CORTEX_LOG=debug for per-event ingest + WS details (default is info)",
      );
    }
  });

  if (config.openBrowser) {
    const { exec } = await import("node:child_process");
    const platform = process.platform;
    const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
    exec(`${cmd} ${displayUrl}`);
  }
}

if (import.meta.main) {
  const staticFromEnv = process.env.CORTEX_STATIC_PATH?.trim();
  startCortexServer({
    ...defaultCortexConfig,
    port: parseInt(process.env.CORTEX_PORT ?? "4321", 10),
    openBrowser: process.env.CORTEX_NO_OPEN !== "1",
    staticAssetsPath: staticFromEnv || new URL("../ui/build", import.meta.url).pathname,
  });
}
