import { BENCH_TASKS } from "./tasks.js";

export interface ResolvedSpotTask {
  readonly prompt: string;
  readonly tools: string[];
  readonly expectedSections: string[];
  readonly taskId?: string;
}

// Pure resolver: SPOT_TASK_ID (bench task set) takes precedence over free-form SPOT_TASK/SPOT_TOOLS.
// Lives in its own module so importing it never triggers spot-test.ts's top-level agent run.
export function resolveSpotTask(env: Record<string, string | undefined>): ResolvedSpotTask {
  const id = env.SPOT_TASK_ID;
  if (id) {
    const t = BENCH_TASKS.find((x) => x.id === id);
    if (!t) throw new Error(`unknown SPOT_TASK_ID: ${id}`);
    return { prompt: t.prompt, tools: [...t.tools], expectedSections: [...t.expectedSections], taskId: t.id };
  }
  return {
    prompt:
      env.SPOT_TASK ??
      "Fetch the last 10 commits to tylerjrbuell/reactive-agents-ts then write a local markdown file (./commits.md) with all 10 commit messages.",
    tools: (env.SPOT_TOOLS ?? "file-write,github/list_commits").split(","),
    expectedSections: [],
  };
}
