import { Elysia } from "elysia";
import { Effect } from "effect";
import { createCortexRuntime } from "./runtime.js";
import { runsRouter } from "./api/runs.js";
import { agentConfigSourceRouter } from "./api/agent-config-source.js";
import { messagesRouter } from "./api/messages.js";
import { agentsRouter } from "./api/agents.js";
import { toolsRouter } from "./api/tools.js";
import { mcpServersRouter } from "./api/mcp-servers.js";
import { skillsRouter } from "./api/skills.js";
import { modelsRouter } from "./api/models.js";
import { modelThroughputRouter } from "./api/model-throughput.js";
import { modelInsightsRouter } from "./api/model-insights.js";
import { crashedRunsRouter } from "./api/crashed-runs.js";
import { chatRouter } from "./api/chat.js";
import { ChatBtwService } from "./services/chat-btw.js";
import { memoryRouter } from "./api/memory.js";
import { MemoryInspector } from "./services/memory-inspector.js";
import { agentSkillsRouter } from "./api/agent-skills.js";
import { AgentSkillsService, defaultRefineAgent } from "./services/agent-skills.js";
import { recordSkillControlEvents } from "./db/skill-lifecycle-queries.js";
import { promptRouter } from "./api/prompts.js";
import { templateResolveRouter } from "./api/template-resolve.js";
import { healthRouter } from "./api/health.js";
import { providerKeysRouter } from "./api/provider-keys.js";
import { judgmentRouter } from "./api/judgment.js";
import { ollamaSettingsRouter } from "./api/ollama-settings.js";
import { voiceRouter } from "./api/voice.js";
import { VoiceSettingsStore } from "./services/voice/voice-settings.js";
import { createSpeechSupervisor, execDockerRunner } from "./services/voice/speech-supervisor.js";
import { installOllamaEndpointStore, OllamaEndpointStore } from "./services/ollama-cloud.js";
import { installProviderKeyStore, ProviderKeyStore } from "./services/provider-key-store.js";
import { gatewayRouter } from "./api/gateway.js";
import { channelHubRouter } from "./api/channel-hub.js";
import { ChannelCredentials } from "./services/channel-credentials.js";
import { dirname } from "node:path";
import { capabilitiesRouter } from "./api/capabilities.js";
import { workspaceRouter } from "./api/workspace.js";
import { ChatSessionBusyError, ChatSessionService } from "./services/chat-session-service.js";
import { ChatScheduleService } from "./services/chat-schedule-service.js";
import { ChatGoalService } from "./services/chat-goal-service.js";
import { DetachedTurns } from "./services/chat-detached-turn.js";
import { makeDetachedRunner } from "./services/chat-detached-run.js";
import { ChatProposalService } from "./services/chat-proposal-service.js";
import { createProposalHost } from "./services/proposal-host.js";
import { handleIngestMessage, INGEST_MAX_BYTES } from "./ws/ingest.js";
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
import { cortexBanner, cortexLog } from "./cortex-log.js";
import { applyCortexProcessDefaults, cortexEnv } from "./env-config.js";
import { CortexStartRefusedError } from "./errors.js";
import { closeOrphanedChatRuns } from "./db/queries.js";
import { isLoopbackHost, resolveCortexHostname } from "./listen-host.js";
import { bindRefusal, guardConfigFromEnv, guardRequest } from "./request-guard.js";

/** Base URL for startup log and “open browser” (aligns with CORTEX_URL when set). */
function cortexListenDisplayUrl(port: number): string {
  const raw = cortexEnv().url;
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

/**
 * Start the Cortex API + WebSocket server (and the built UI when present).
 * Binds `127.0.0.1` unless `config.hostname` or `CORTEX_HOST` says otherwise.
 */
export async function startCortexServer(
  config: Partial<CortexConfig> = {},
): Promise<StartedCortexServer> {
  // Merge with defaults so callers can pass partial config (e.g. just { port }).
  // Auto-resolve UI assets path when not provided, so npm consumers get the bundled UI
  // without configuration. From dist/index.js → `../ui/build`. From source server/index.ts →
  // `../ui/build`. Both layouts go up one level to reach the package root.
  const resolvedConfig: CortexConfig = {
    ...defaultCortexConfig,
    ...config,
    staticAssetsPath:
      config.staticAssetsPath ??
      defaultCortexConfig.staticAssetsPath ??
      new URL("../ui/build", import.meta.url).pathname,
  };

  // Off loopback the API needs an access token; refuse to start before anything is opened or bound.
  applyCortexProcessDefaults();
  const env = cortexEnv();
  const token = (config.token ?? env.token)?.trim() || undefined;
  const refusal = bindRefusal(resolveCortexHostname(config.hostname, env.raw), token);
  if (refusal !== undefined) throw new CortexStartRefusedError({ message: refusal });

  const runtime = createCortexRuntime(resolvedConfig);

  // Provider keys saved in Settings: encrypted beside the DB; every build path reads them
  // through `providerKeyForAgent` (services/provider-key-store.ts).
  const providerKeys = new ProviderKeyStore({ dir: dirname(resolvedConfig.dbPath) });
  installProviderKeyStore(providerKeys);
  // The Ollama endpoint saved in Settings (Ollama Cloud preset) applies to every agent build
  // and probe in this process (services/ollama-cloud.ts).
  const ollamaEndpoint = new OllamaEndpointStore(dirname(resolvedConfig.dbPath));
  installOllamaEndpointStore(ollamaEndpoint);

  const bridgeSvc = await Effect.runPromise(
    CortexEventBridge.pipe(Effect.provide(runtime.bridgeLayer)),
  );

  // The channel hub hosts every messaging channel (`CORTEX_CHANNEL_HUB=off` hands them back to the
  // per-agent host). `start()` imports per-agent config synchronously, so it must run before `hydrate`:
  // from then on the legacy host skips the channels the hub owns (one poller per bot token).
  if (runtime.hub.isEnabled) {
    runtime.gateway.attachChannelHub(runtime.hub);
    void runtime.hub.start();
  }

  // Hydrate gateway agents — starts persistent processes for all active agents
  void runtime.gateway.hydrate();

  // Chat runs run in this process: any still `live` from before a restart can never end (B3).
  const orphaned = closeOrphanedChatRuns(runtime.rawDb, Date.now());
  if (orphaned > 0) cortexLog("info", "server", "closed chat runs left live by a restart", { count: orphaned });

  const chatSessionService = new ChatSessionService(runtime.rawDb, { ingestLayer: runtime.ingestLayer });
  // Chat turns paused on a durable approval gate before a restart: list them again (desk + chat).
  chatSessionService.approvals.restore();

  // Goal segments, schedule fires and loop ticks run as detached streamed turns in this shared buffer,
  // so the open chat shows them live and a reload re-attaches (chat-detached-run.ts).
  const detachedTurns = new DetachedTurns();
  const runDetached = makeDetachedRunner(chatSessionService, detachedTurns);

  const chatGoalService = new ChatGoalService(runtime.rawDb, runDetached);
  chatGoalService.recoverOnBoot();
  chatSessionService.attachGoalSource((id) => {
    const g = chatGoalService.get(id)?.goal;
    return g ? { status: g.status, objective: g.objective } : null;
  });

  // A goal owns its session: scheduled fires skip (recorded as skipped:busy) instead of racing it.
  const chatScheduleService = new ChatScheduleService(runtime.rawDb, (id, msg) => {
    if (chatGoalService.activeGoal(id)) throw new ChatSessionBusyError(id);
    return runDetached(id, msg);
  });
  chatScheduleService.start();

  // Agent `session-control` proposals: the tool only records them; Apply goes through these services.
  const chatProposalService = new ChatProposalService(
    runtime.rawDb,
    createProposalHost(runtime.rawDb, chatSessionService, chatScheduleService, chatGoalService),
  );
  chatSessionService.attachSessionControl(chatProposalService);

  // Memory studio: one `agent.memory()` handle per inspected agent, disposed on exit.
  const memoryInspector = new MemoryInspector();

  // Cached chat agents can hold MCP docker containers; tear them down on exit.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      chatScheduleService.dispose();
      chatGoalService.dispose();
      void Promise.allSettled([chatSessionService.disposeAll(), memoryInspector.disposeAll(), runtime.hub.stop()]).finally(() =>
        process.exit(0),
      );
    });
  }

  // DNS-rebinding wall, cross-site check and access token for /api/* and /ws/* (request-guard.ts);
  // runs before routing, WS upgrades included.
  const guard = { ...guardConfigFromEnv(env.raw), ...(token ? { token } : {}) };
  // Opt-in supervisor for a local Speaches container (services/voice/speech-supervisor.ts); inert until the user turns it on.
  const voiceSettings = new VoiceSettingsStore(dirname(resolvedConfig.dbPath));
  const speechSupervisor = createSpeechSupervisor({ settings: voiceSettings, docker: execDockerRunner });
  const app = new Elysia()
    .onRequest(({ request }) => guardRequest(request, guard))
    .use(healthRouter)
    .use(providerKeysRouter(providerKeys))
    .use(judgmentRouter(providerKeys))
    .use(ollamaSettingsRouter(ollamaEndpoint))
    .use(voiceRouter({ settings: voiceSettings, keys: providerKeys, supervisor: speechSupervisor, allowDocker: isLoopbackHost(resolveCortexHostname(config.hostname, env.raw)) || token !== undefined }))
    .use(capabilitiesRouter)
    .use(runsRouter(runtime.storeLayer, runtime.runnerLayer))
    .use(agentConfigSourceRouter(runtime.storeLayer))
    .use(messagesRouter(runtime.rawDb))
    .use(agentsRouter(runtime.rawDb, runtime.gateway))
    .use(gatewayRouter(runtime.rawDb, runtime.gateway, new ChannelCredentials(providerKeys), { hub: runtime.hub }))
    .use(channelHubRouter(runtime.rawDb, runtime.hub, new ChannelCredentials(providerKeys)))
    .use(toolsRouter(runtime.storeLayer, runtime.rawDb))
    .use(mcpServersRouter(runtime.rawDb))
    .use(skillsRouter(runtime.storeLayer, runtime.rawDb))
    .use(modelsRouter)
    .use(modelThroughputRouter(runtime.rawDb))
    .use(modelInsightsRouter(runtime.rawDb))
    .use(crashedRunsRouter(runtime.rawDb, runtime.runnerLayer))
    .use(chatRouter(chatSessionService, chatScheduleService, chatGoalService, chatProposalService, new ChatBtwService(runtime.rawDb), detachedTurns))
    .use(memoryRouter(memoryInspector, runtime.rawDb))
    .use(
      agentSkillsRouter(
        new AgentSkillsService(memoryInspector, defaultRefineAgent, (agentId, events) =>
          recordSkillControlEvents(runtime.rawDb, agentId, events),
        ),
        runtime.rawDb,
      ),
    )
    .use(promptRouter(runtime.rawDb))
    .use(templateResolveRouter())
    .use(workspaceRouter(runtime.rawDb))
    .ws("/ws/ingest", {
      maxPayloadLength: INGEST_MAX_BYTES,
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
    // Serve static assets from the built UI (JS, CSS, fonts, images, etc.)
    // Must come before the SPA fallback route so asset requests are matched first.
    .get("/_app/*", async ({ params, set }) => {
      if (!resolvedConfig.staticAssetsPath) {
        set.status = 404;
        return "Cortex UI not built. Run: cd apps/cortex/ui && bun run build";
      }
      const assetPath = `${resolvedConfig.staticAssetsPath}/_app/${params["*"]}`;
      const file = Bun.file(assetPath);
      if (!(await file.exists())) {
        set.status = 404;
        return "Asset not found";
      }
      return file;
    })
    .get("/*", ({ set }) => {
      if (resolvedConfig.staticAssetsPath) {
        return Bun.file(`${resolvedConfig.staticAssetsPath}/index.html`);
      }
      set.status = 404;
      return "Cortex UI not built. Run: cd apps/cortex/ui && bun run build";
    });

  const displayUrl = cortexListenDisplayUrl(resolvedConfig.port);
  // Loopback unless the caller opts in (listen-host.ts): the API has no authentication.
  const hostname = resolveCortexHostname(config.hostname, env.raw);

  // Bun’s default idleTimeout (~10s) drops connections that send no response bytes yet — e.g. long MCP
  // `refresh-tools` (docker pull / handshake). Node’s Vite proxy then logs "socket hang up". 0 disables.
  app.listen(
    { port: resolvedConfig.port, hostname, idleTimeout: 0 },
    () => {
      if (!env.spawnedByRax) {
        cortexBanner(`\n◈ CORTEX running at ${displayUrl}\n`);
        cortexLog(
          "info",
          "server",
          "logging: set CORTEX_LOG=debug for per-event ingest + WS details (default is info)",
        );
      }
      if (!isLoopbackHost(hostname)) {
        cortexLog(
          "warn",
          "server",
          `listening on ${hostname}: other machines can reach this Cortex; every request needs the access token (CORTEX_TOKEN)`,
        );
      }
    },
  );

  speechSupervisor.start();

  if (resolvedConfig.openBrowser) {
    // argv, never a shell string: `displayUrl` derives from CORTEX_URL.
    const { execFile } = await import("node:child_process");
    const platform = process.platform;
    const [file, args]: [string, string[]] =
      platform === "darwin" ? ["open", [displayUrl]] : platform === "win32" ? ["cmd", ["/c", "start", "", displayUrl]] : ["xdg-open", [displayUrl]];
    execFile(file, args, () => undefined);
  }

  return {
    hostname: app.server?.hostname ?? hostname,
    port: app.server?.port ?? resolvedConfig.port,
    stop: async () => {
      speechSupervisor.stop();
      chatScheduleService.dispose();
      chatGoalService.dispose();
      await chatSessionService.disposeAll();
      await memoryInspector.disposeAll();
      await runtime.hub.stop();
      await app.stop(true);
      installOllamaEndpointStore(null); // restores the env the server started with
    },
  };
}

/** A started Cortex server: where it listens, and how to shut it down (tests, embedders). */
export interface StartedCortexServer {
  /** The bound interface (`127.0.0.1` unless opted in via `hostname` / `CORTEX_HOST`). */
  readonly hostname: string;
  readonly port: number;
  /** Stop listening and dispose chat agents, schedules and goals. */
  readonly stop: () => Promise<void>;
}

if (import.meta.main) {
  const entryEnv = cortexEnv();
  const staticFromEnv = entryEnv.staticPath;
  startCortexServer({
    ...defaultCortexConfig,
    port: entryEnv.port,
    openBrowser: entryEnv.openBrowser,
    // Honor explicit env override; otherwise startCortexServer auto-resolves to ../ui/build.
    ...(staticFromEnv ? { staticAssetsPath: staticFromEnv } : {}),
  });
}
