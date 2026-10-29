/**
 * Production wiring of {@link ProposalHost}: the real session, schedule, goal and model-discovery
 * services behind the narrow interface the proposal service depends on.
 */
import type { Database } from "bun:sqlite";
import { getChatSession } from "../db/chat-queries.js";
import { buildModelsResponse, listProviders } from "../api/models.js";
import type { ChatGoalService } from "./chat-goal-service.js";
import type { ChatScheduleService } from "./chat-schedule-service.js";
import type { ChatSessionService } from "./chat-session-service.js";
import type { ProposalHost } from "./chat-proposal-service.js";
import { discoverSkillDirectoryPaths } from "./skill-directories.js";
import { listFilesystemSkillSummaries } from "./skill-filesystem.js";

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
    skills: () => ({
      names: listFilesystemSkillSummaries().map((s) => s.name),
      paths: discoverSkillDirectoryPaths(),
    }),
  };
}
