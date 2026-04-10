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
import { getMcpServersByIds, parseMcpConfig } from "../db/mcp-queries.js";
import {
  coerceTaskContextRecord,
  normalizeCortexAgentConfig,
  parseCortexSkillsConfig,
  type CortexAgentToolEntry,
  type CortexDynamicSubAgentsConfig,
  type CortexMetaToolsConfig,
} from "./cortex-agent-config.js";
import { CortexIngestService } from "./ingest-service.js";
import type { Layer } from "effect";
import { generateTaskId } from "@reactive-agents/core";
import { buildCortexAgent } from "./build-cortex-agent.js";

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

      const tools = config.tools as string[] | undefined;
      const additionalToolNames =
        typeof config.additionalToolNames === "string" && config.additionalToolNames.trim() !== ""
          ? config.additionalToolNames.trim()
          : undefined;
      const metaToolsCfg = config.metaTools as CortexMetaToolsConfig | undefined;
      const mcpIds = (config.mcpServerIds as string[] | undefined)?.filter((x) => typeof x === "string" && x.length > 0) ?? [];
      const mcpRows = mcpIds.length > 0 ? getMcpServersByIds(this.db, mcpIds) : [];
      const mcpConfigs = mcpRows.map(parseMcpConfig);
      const agentTools = config.agentTools as CortexAgentToolEntry[] | undefined;
      const dynamicSub = config.dynamicSubAgents as CortexDynamicSubAgentsConfig | undefined;

      const retryPolicyCfg = config.retryPolicy as { enabled?: boolean; maxRetries?: number; backoffMs?: number } | undefined;
      const maxRetries = retryPolicyCfg?.maxRetries;
      const retryPolicy = retryPolicyCfg?.enabled === true && typeof maxRetries === "number" && maxRetries > 0
        ? { enabled: true, maxRetries, backoffMs: typeof retryPolicyCfg.backoffMs === "number" ? retryPolicyCfg.backoffMs : 1000 }
        : undefined;

      const fallbacksCfg = config.fallbacks as { enabled?: boolean; providers?: string[]; errorThreshold?: number } | undefined;

      cortexLog("debug", "gateway", "prepared normalized agent config for run", {
        agentId,
        runId,
        config,
      });

      const _temperature = typeof config.temperature === "number" ? config.temperature : undefined;
      const _maxTokens = typeof config.maxTokens === "number" && config.maxTokens > 0 ? config.maxTokens : undefined;
      const _strategy = config.strategy as string | undefined;
      const _maxIterations = typeof config.maxIterations === "number" && config.maxIterations > 0 ? config.maxIterations : undefined;
      const _minIterations = typeof config.minIterations === "number" && config.minIterations > 0 ? config.minIterations : undefined;
      const _systemPrompt = (config.systemPrompt as string | undefined)?.trim() || undefined;
      const _taskContext = coerceTaskContextRecord(config.taskContext) ?? undefined;
      const _skills = parseCortexSkillsConfig(config.skills) ?? undefined;
      const _timeout = typeof config.timeout === "number" && config.timeout > 0 ? config.timeout : undefined;
      const _cacheTimeout = typeof config.cacheTimeout === "number" && config.cacheTimeout > 0 ? config.cacheTimeout : undefined;
      const _progressCheckpoint = typeof config.progressCheckpoint === "number" && config.progressCheckpoint > 0 ? config.progressCheckpoint : undefined;
      const _verificationStep = config.verificationStep as string | undefined;
      const _runtimeVerification = config.runtimeVerification === true;
      const _terminalTools = config.terminalTools === true;
      const _terminalShellAdditional =
        typeof config.terminalShellAdditionalCommands === "string" &&
        config.terminalShellAdditionalCommands.trim() !== ""
          ? config.terminalShellAdditionalCommands.trim()
          : undefined;
      const _terminalShellAllowed =
        typeof config.terminalShellAllowedCommands === "string" &&
        config.terminalShellAllowedCommands.trim() !== ""
          ? config.terminalShellAllowedCommands.trim()
          : undefined;
      const _observabilityVerbosity = config.observabilityVerbosity as "off" | "minimal" | "normal" | "verbose" | undefined;
      const _memory = config.memory as { working?: boolean; episodic?: boolean; semantic?: boolean } | undefined;
      const _contextSynthesis = config.contextSynthesis as "auto" | "template" | "llm" | "none" | undefined;
      const _guardrails = config.guardrails as { enabled?: boolean; injectionThreshold?: number; piiThreshold?: number; toxicityThreshold?: number } | undefined;
      const _persona = config.persona as { enabled?: boolean; role?: string; tone?: string; traits?: string; responseStyle?: string } | undefined;

      const agent = await buildCortexAgent({
        agentName: name,
        agentId,
        provider: providerRaw,
        ...(modelRaw ? { model: modelRaw } : {}),
        ...(_temperature != null ? { temperature: _temperature } : {}),
        ...(_maxTokens != null ? { maxTokens: _maxTokens } : {}),
        ...(_strategy ? { strategy: _strategy } : {}),
        ...(_maxIterations != null ? { maxIterations: _maxIterations } : {}),
        ...(_minIterations != null ? { minIterations: _minIterations } : {}),
        ...(_systemPrompt ? { systemPrompt: _systemPrompt } : {}),
        ...(_taskContext ? { taskContext: _taskContext } : {}),
        healthCheck: config.healthCheck === true,
        ...(_skills ? { skills: _skills } : {}),
        mcpConfigs,
        ...(tools ? { tools } : {}),
        ...(additionalToolNames ? { additionalToolNames } : {}),
        ...(agentTools ? { agentTools } : {}),
        ...(dynamicSub ? { dynamicSubAgents: dynamicSub } : {}),
        ...(metaToolsCfg ? { metaTools: metaToolsCfg } : {}),
        ...(_timeout != null ? { timeout: _timeout } : {}),
        ...(retryPolicy ? { retryPolicy } : {}),
        ...(_cacheTimeout != null ? { cacheTimeout: _cacheTimeout } : {}),
        ...(_progressCheckpoint != null ? { progressCheckpoint: _progressCheckpoint } : {}),
        ...(fallbacksCfg ? { fallbacks: fallbacksCfg } : {}),
        ...(_verificationStep ? { verificationStep: _verificationStep } : {}),
        ...(_runtimeVerification ? { runtimeVerification: true as const } : {}),
        ...(_terminalTools ? { terminalTools: true as const } : {}),
        ...(_terminalShellAdditional ? { terminalShellAdditionalCommands: _terminalShellAdditional } : {}),
        ...(_terminalShellAllowed ? { terminalShellAllowedCommands: _terminalShellAllowed } : {}),
        ...(_observabilityVerbosity ? { observabilityVerbosity: _observabilityVerbosity } : {}),
        strategySwitching: config.strategySwitching === true,
        ...(_memory ? { memory: _memory } : {}),
        ...(_contextSynthesis ? { contextSynthesis: _contextSynthesis } : {}),
        ...(_guardrails ? { guardrails: _guardrails } : {}),
        ...(_persona ? { persona: _persona } : {}),
      });
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
