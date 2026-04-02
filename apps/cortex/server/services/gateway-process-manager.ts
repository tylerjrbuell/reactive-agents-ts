/**
 * GatewayProcessManager
 *
 * Owns the lifecycle of all active gateway agents:
 *   - On create / activate  → start (or restart) the agent's process
 *   - On pause / delete     → stop the process
 *   - On server boot        → re-hydrate all active agents from DB
 *
 * Each "process" is an in-Cortex scheduled runner — no separate OS process.
 * The agent is built once, then a minute-tick loop fires it on schedule.
 * Between cron fires the agent sits idle (no tokens consumed).
 */

import { Effect } from "effect";
import { parseCron, shouldFireAt } from "@reactive-agents/gateway";
import { cortexLog, formatErrorDetails } from "../cortex-log.js";
import type { Database } from "bun:sqlite";
import { getGatewayAgents, getGatewayAgent, updateGatewayAgent, upsertRun } from "../db/queries.js";
import {
  mergeCortexAllowedTools,
  normalizeCortexAgentConfig,
  type CortexMetaToolsConfig,
} from "./cortex-agent-config.js";
import { ensureParentDirForFile } from "./ensure-log-path.js";
import { CortexIngestService } from "./ingest-service.js";
import type { Layer } from "effect";
import { ReactiveAgents, type ProviderName } from "@reactive-agents/runtime";
import { generateTaskId } from "@reactive-agents/core";

interface AgentProcess {
  readonly agentId: string;
  readonly name: string;
  cronExpression: string | null;
  tickInterval: ReturnType<typeof setInterval> | null;
  running: boolean;            // true while a run is in progress
  lastFiredAt: number | null;
}

export class GatewayProcessManager {
  private processes = new Map<string, AgentProcess>();
  private readonly db: Database;
  private readonly ingestLayer: Layer.Layer<CortexIngestService>;

  // Master tick — checks every minute whether any process should fire
  private masterTick: ReturnType<typeof setInterval> | null = null;

  constructor(db: Database, ingestLayer: Layer.Layer<CortexIngestService>) {
    this.db = db;
    this.ingestLayer = ingestLayer;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Call once on server start — re-hydrates all active agents from DB. */
  async hydrate(): Promise<void> {
    const agents = getGatewayAgents(this.db);
    const active = agents.filter((a) => a.status === "active" && a.agent_type === "gateway");
    for (const a of active) {
      this.startProcess(a.agent_id, a.name, a.schedule, JSON.parse(a.config) as Record<string, unknown>);
    }
    if (active.length > 0) {
      cortexLog("info", "gateway", `Hydrated ${active.length} gateway agent(s)`);
    }
    this.ensureMasterTick();
  }

  /** Start or restart a gateway agent process. */
  startProcess(agentId: string, name: string, schedule: string | null, config: Record<string, unknown>): void {
    // Stop existing process if any
    this.stopProcess(agentId);

    const proc: AgentProcess = {
      agentId,
      name,
      cronExpression: schedule,
      tickInterval: null,
      running: false,
      lastFiredAt: null,
    };
    this.processes.set(agentId, proc);

    cortexLog("info", "gateway", `Started process for "${name}"`, {
      agentId,
      schedule: schedule ?? "manual",
    });

    this.ensureMasterTick();
  }

  /** Stop and remove a gateway agent process. */
  stopProcess(agentId: string): void {
    const proc = this.processes.get(agentId);
    if (!proc) return;
    if (proc.tickInterval) clearInterval(proc.tickInterval);
    this.processes.delete(agentId);
    cortexLog("info", "gateway", `Stopped process for "${proc.name}"`, { agentId });
  }

  /** Immediately trigger a gateway agent run (ignores schedule). */
  async triggerNow(agentId: string): Promise<{ runId: string; agentId: string } | { error: string }> {
    const row = getGatewayAgent(this.db, agentId);
    if (!row) return { error: `Agent ${agentId} not found in DB` };

    // Gateway agents maintain a managed process. Ad-hoc agents are fire-on-demand only.
    if (row.agent_type === "gateway" && !this.processes.has(agentId)) {
      this.startProcess(agentId, row.name, row.schedule, JSON.parse(row.config) as Record<string, unknown>);
    }

    const config = JSON.parse(row.config) as Record<string, unknown>;
    try {
      const result = await this.fireAgent(agentId, row.name, config);
      if (!result) return { error: `Failed to start agent "${row.name}" — check server logs` };
      return result;
    } catch (e) {
      return { error: String(e) };
    }
  }

  /** List currently registered processes with their state. */
  listProcesses() {
    return [...this.processes.values()].map((p) => ({
      agentId:       p.agentId,
      name:          p.name,
      schedule:      p.cronExpression,
      running:       p.running,
      lastFiredAt:   p.lastFiredAt,
    }));
  }

  // ── Internal ───────────────────────────────────────────────────────────

  private ensureMasterTick() {
    if (this.masterTick) return;
    // Fire on the next whole minute, then every minute after
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();
    setTimeout(() => {
      this.tick();
      this.masterTick = setInterval(() => this.tick(), 60_000);
    }, msUntilNextMinute);

    cortexLog("info", "gateway", `Master tick starts in ${Math.round(msUntilNextMinute / 1000)}s`);
  }

  private tick() {
    const now = new Date();
    for (const [agentId, proc] of this.processes) {
      if (!proc.cronExpression) continue;
      if (proc.running) continue; // skip if already running

      const parsed = parseCron(proc.cronExpression);
      if (!parsed) continue;

      if (shouldFireAt(parsed, now)) {
        cortexLog("info", "gateway", `Cron fired for "${proc.name}"`, {
          agentId,
          expression: proc.cronExpression,
          time: now.toISOString(),
        });

        const row = getGatewayAgent(this.db, agentId);
        if (!row || row.status !== "active") continue;

        const config = JSON.parse(row.config) as Record<string, unknown>;
        void this.fireAgent(agentId, proc.name, config).then(() => {
          proc.lastFiredAt = Date.now();
        });
      }
    }
  }

  private async fireAgent(
    agentId: string,
    name: string,
    configRaw: Record<string, unknown>,
  ): Promise<{ runId: string; agentId: string } | null> {
    const proc = this.processes.get(agentId);
    if (proc) proc.running = true;

    const config = normalizeCortexAgentConfig(configRaw);

    // `prompt` is the task instruction; `systemPrompt` is the separate system context.
    // Fallback chain: explicit prompt > systemPrompt (legacy) > generic instruction.
    const prompt = (config.prompt as string | undefined)
      ?? "Execute your assigned task.";

    const providerRaw = (config.provider as string | undefined) ?? "anthropic";
    const modelRaw    = (config.model    as string | undefined) ?? undefined;
    const runId = generateTaskId();

    try {
      const ingest = await Effect.runPromise(
        CortexIngestService.pipe(Effect.provide(this.ingestLayer)),
      );

      let builder = ReactiveAgents.create()
        .withName(name)
        .withProvider(providerRaw as ProviderName);

      // ── Model + inference params (temperature 0 is valid — do not use truthiness) ──
      const maxTokens = typeof config.maxTokens === "number" ? config.maxTokens : 0;
      const temperature = typeof config.temperature === "number" ? config.temperature : undefined;
      if (modelRaw || temperature !== undefined || maxTokens > 0) {
        const mp: Record<string, unknown> = {};
        if (modelRaw) mp.model = modelRaw;
        if (temperature !== undefined) mp.temperature = temperature;
        if (maxTokens > 0) mp.maxTokens = maxTokens;
        builder = builder.withModel(mp as any);
      }

      // ── Reasoning ────────────────────────────────────────────────────
      const reasoningOpts: Record<string, unknown> = {};
      if (config.strategy) reasoningOpts.defaultStrategy = config.strategy;
      const maxIterations = typeof config.maxIterations === "number" ? config.maxIterations : 0;
      if (maxIterations > 0) reasoningOpts.maxIterations = maxIterations;
      if (Object.keys(reasoningOpts).length > 0) builder = builder.withReasoning(reasoningOpts as any);

      // ── Memory / tools ────────────────────────────────────────────────
      builder = builder.withMemory();
      const tools = config.tools as string[] | undefined;
      const metaToolsCfg = config.metaTools as CortexMetaToolsConfig | undefined;
      if (tools && tools.length > 0) {
        builder = builder.withTools({
          allowedTools: mergeCortexAllowedTools(tools, metaToolsCfg),
        });
      }

      // ── System prompt ─────────────────────────────────────────────────
      const systemPrompt = (config.systemPrompt as string | undefined)?.trim();
      if (systemPrompt) builder = builder.withSystemPrompt(systemPrompt);

      // ── Execution controls ────────────────────────────────────────────
      const timeout = typeof config.timeout === "number" ? config.timeout : 0;
      if (timeout > 0) builder = builder.withTimeout(timeout);

      const retryPolicyCfg = config.retryPolicy as { enabled?: boolean; maxRetries?: number; backoffMs?: number } | undefined;
      const maxRetries = retryPolicyCfg?.maxRetries;
      if (
        retryPolicyCfg?.enabled === true
        && typeof maxRetries === "number"
        && maxRetries > 0
      ) {
        builder = builder.withRetryPolicy({
          maxRetries,
          backoffMs: typeof retryPolicyCfg.backoffMs === "number" ? retryPolicyCfg.backoffMs : 1000,
        });
      }

      const cacheTimeout = typeof config.cacheTimeout === "number" ? config.cacheTimeout : 0;
      if (cacheTimeout > 0) builder = builder.withCacheTimeout(cacheTimeout);

      const progressCheckpoint = typeof config.progressCheckpoint === "number" ? config.progressCheckpoint : 0;
      if (progressCheckpoint > 0) builder = builder.withProgressCheckpoint(progressCheckpoint);

      // ── Fallbacks ─────────────────────────────────────────────────────
      const fallbacksCfg = config.fallbacks as { enabled?: boolean; providers?: string[]; errorThreshold?: number } | undefined;
      if (fallbacksCfg?.enabled && fallbacksCfg.providers?.length) {
        builder = builder.withFallbacks({ providers: fallbacksCfg.providers, errorThreshold: fallbacksCfg.errorThreshold ?? 3 });
      }

      // ── Meta tools ────────────────────────────────────────────────────
      if (metaToolsCfg?.enabled) {
        builder = builder.withMetaTools({
          brief: metaToolsCfg.brief ?? false,
          find: metaToolsCfg.find ?? false,
          pulse: metaToolsCfg.pulse ?? false,
          recall: metaToolsCfg.recall ?? false,
          harnessSkill: metaToolsCfg.harnessSkill ?? false,
        });
      }

      // ── Min iterations ────────────────────────────────────────────────
      const minIterations = typeof config.minIterations === "number" ? config.minIterations : 0;
      if (minIterations > 0) builder = builder.withMinIterations(minIterations);

      // ── Verification step ─────────────────────────────────────────────
      const verificationStep = config.verificationStep as "none" | "reflect" | undefined;
      if (verificationStep === "reflect") builder = builder.withVerificationStep({ mode: "reflect" });

      // ── Observability / logging ───────────────────────────────────────
      const observabilityVerbosity =
        config.observabilityVerbosity as "off" | "minimal" | "normal" | "verbose" | undefined;
      if (observabilityVerbosity && observabilityVerbosity !== "off") {
        builder = builder.withObservability({ verbosity: observabilityVerbosity, live: true } as any);
      }
      const agentLogFile = process.env.CORTEX_AGENT_LOG_FILE ?? ".cortex/logs/agent-debug.log";
      if (observabilityVerbosity === "verbose") {
        ensureParentDirForFile(agentLogFile);
        builder = builder.withLogging({
          level: "debug",
          format: "json",
          output: "file",
          filePath: agentLogFile,
        } as any);
      } else if (observabilityVerbosity && observabilityVerbosity !== "off") {
        ensureParentDirForFile(agentLogFile);
        builder = builder.withLogging({
          level: "info",
          format: "json",
          output: "file",
          filePath: agentLogFile,
        } as any);
      }

      cortexLog("debug", "gateway", "prepared normalized agent config for run", {
        agentId,
        runId,
        config,
      });

      const agent = await builder.build();
      const agentId_ = agent.agentId;

      // Pre-create the run row so the UI can find it immediately on navigation.
      // Without this, a GET /api/runs/:runId races the first ingest event and returns 404,
      // causing run-store to give up and show the run as "failed".
      upsertRun(this.db, agentId_, runId);

      const unsubscribe = await agent.subscribe((event) => {
        Effect.runFork(
          ingest.handleEvent(agentId_, runId, { v: 1, agentId: agentId_, runId, event })
            .pipe(Effect.catchAll(() => Effect.void)),
        );
      });

      cortexLog("info", "gateway", `Running "${name}"`, { agentId, runId });

      void agent.run(prompt, { taskId: runId })
        .then((result) => {
          // Emit debrief if available
          const debrief = (result as any).debrief;
          if (debrief) {
            Effect.runFork(
              ingest.handleEvent(agentId_, runId, {
                v: 1, agentId: agentId_, runId,
                event: { _tag: "DebriefCompleted" as const, taskId: runId, agentId: agentId_, debrief } as any,
              }).pipe(Effect.catchAll(() => Effect.void)),
            );
          }
        })
        .catch((err) => {
          cortexLog("warn", "gateway", `Agent "${name}" run failed`, {
            agentId,
            runId,
            ...formatErrorDetails(err),
          });
        })
        .finally(() => {
          try { unsubscribe(); } catch { /* ok */ }
          if (proc) proc.running = false;
          // Update run_count in DB
          try {
            this.db.prepare(
              "UPDATE cortex_agents SET run_count = run_count + 1, last_run_at = ? WHERE agent_id = ?",
            ).run(Date.now(), agentId);
          } catch { /* ok */ }
        });

      return { runId, agentId: agentId_ };
    } catch (e) {
      const msg = String(e);
      cortexLog("warn", "gateway", `Failed to start agent "${name}": ${msg}`, {
        agentId,
        ...formatErrorDetails(e),
      });
      if (proc) proc.running = false;
      // Re-throw so triggerNow can return a proper error
      throw new Error(msg);
    }
  }

  destroy() {
    if (this.masterTick) clearInterval(this.masterTick);
    this.masterTick = null;
    for (const [id] of this.processes) this.stopProcess(id);
  }
}
