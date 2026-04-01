import { CORTEX_SERVER_URL } from "./constants.js";

/**
 * After `POST /api/runs` returns `{ agentId }`, poll until the run row appears
 * (framework task id ingested as `run_id`).
 */
export async function resolveRunIdFromRunsApi(
  fetchFn: typeof fetch,
  agentId: string,
  sinceMs: number,
): Promise<string | null> {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs`);
    if (!res.ok) continue;
    const runs = (await res.json()) as Array<{ runId: string; agentId: string; startedAt: number }>;
    const hit = runs
      .filter((x) => x.agentId === agentId && x.startedAt >= sinceMs - 10_000)
      .sort((a, b) => b.startedAt - a.startedAt)[0];
    if (hit) return hit.runId;
  }
  return null;
}
