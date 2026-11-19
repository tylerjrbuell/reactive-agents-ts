/**
 * Production wiring of {@link ProposalHost}: the real session, schedule, goal and model-discovery
 * services behind the narrow interface the proposal service depends on.
 */
import type { Database } from "bun:sqlite";
import { getChatSession, getChatTodo } from "../db/chat-queries.js";
import { listMcpServers } from "../db/mcp-queries.js";
import { BUILTIN_SHELL_PRESETS } from "@reactive-agents/tools";
import { getCapabilityManifest } from "@reactive-agents/runtime";
import { buildModelsResponse, listProviders } from "../api/models.js";
import { buildToolCatalog } from "./tool-catalog.js";
import { checkWorkspaceDir } from "./workspace-dir.js";
import type { ChatGoalService } from "./chat-goal-service.js";
import type { ChatScheduleService } from "./chat-schedule-service.js";
import type { ChatSessionService } from "./chat-session-service.js";
import type { ProposalHost } from "./chat-proposal-service.js";
import { chatSessionSkillListing } from "./workspace-skills.js";

/**
 * Model ids for a provider from the same discovery `/api/models/:provider` uses: live when the
 * provider answers, the framework's static list when offline. Empty only if neither knows any.
 */
export async function discoverModelIds(provider: string): Promise<readonly string[]> {
  try {
    return (await buildModelsResponse(provider, undefined)).models.map((m) => m.name);
  } catch {
    return [];
  }
}

/** Build the host used by the running server. */
export function createProposalHost(
  db: Database,
  sessions: ChatSessionService,
  schedules: ChatScheduleService,
  goals: ChatGoalService,
): ProposalHost {
  return {
    getConfig: (id) => getChatSession(db, id)?.agentConfig ?? null,
    patchConfig: (id, patch) => sessions.updateSessionConfig(id, patch),
    isBusy: (id) => sessions.isBusy(id),
    schedules,
    goals,
    providers: () => listProviders().map((p) => p.id),
    models: discoverModelIds,
    skills: (id) => {
      const session = getChatSession(db, id);
      return { names: session ? chatSessionSkillListing(session).skills.map((s) => s.name) : [] };
    },
    // The live registries, so a proposal can only name something that exists.
    tools: () => [
      ...new Set([
        ...buildToolCatalog(db)
          .filter((t) => (t.kind === "built-in" || t.kind === "mcp" || t.kind === "custom") && t.disabled !== true)
          .map((t) => t.name),
        ...Object.keys(BUILTIN_SHELL_PRESETS),
      ]),
    ],
    mcpServers: () => listMcpServers(db).map((s) => ({ id: s.server_id, name: s.name })),
    strategies: () => getCapabilityManifest().strategies.flatMap((s) => [s.name, ...(s.aliases ?? [])]),
    checkWorkspace: (path) => {
      const r = checkWorkspaceDir(path);
      return r.ok ? { ok: true, path: r.path } : { ok: false, error: r.error };
    },
    todo: (id) => getChatTodo(db, id),
    history: {
      setTodo: async (id, titles) => {
        await sessions.setTodo(
          id,
          titles.map((title, i) => ({ id: `t${i + 1}`, title, status: "pending" as const })),
          "agent", // an agent proposal: the model wrote it, so it is not a user edit
        );
      },
      compact: async (id, keepLast) => {
        await sessions.compact(id, keepLast === undefined ? {} : { keepLast });
      },
      fork: async (id, atTurnId) => {
        await sessions.fork(id, atTurnId === undefined ? {} : { atTurnId });
      },
      rewind: async (id, turnId) => {
        await sessions.rewind(id, turnId);
      },
    },
  };
}
