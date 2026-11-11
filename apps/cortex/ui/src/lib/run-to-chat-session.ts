/**
 * "Continue in chat" from the run view (Bench spec section 8, owner decision 5;
 * it replaces the run view's old Chat tab).
 *
 * A run that a chat session started opens that session. Any other run becomes a
 * new chat session: `POST /api/chat/sessions` with the run's recorded agent
 * config (its launch snapshot, `launchParams`), `runId` so the chat agent gets
 * the run as context, and `seedTurns` holding the run's task and final answer
 * (`seedTurns` takes plain `{ role, content }` pairs, so the seeded answer
 * carries no trace; the run view keeps it). Pure: the caller does the fetch and
 * the navigation.
 */

/** One seeded chat turn (`ChatSessionConfigBody.seedTurns`). */
export interface SeedTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** What the run view knows about a run, for continuing it in chat. */
export interface RunChatSource {
  readonly runId: string;
  /** The run's title (`runTitleOf`): the new session's name. */
  readonly title: string;
  /** The task the run was given (`AgentStarted.task`, else the launch prompt). */
  readonly task?: string;
  /** The run's final answer; empty when it produced none. */
  readonly answer?: string;
  /** Provider and model the run reported (vitals), used when no snapshot names them. */
  readonly provider?: string;
  readonly model?: string;
  /** The run's stored launch config (`GET /api/runs/:runId` `launchParams`). */
  readonly launchParams?: Readonly<Record<string, unknown>> | null;
  /** The chat session that started the run, when it still exists. */
  readonly chatSessionId?: string;
}

/** Chat defaults (Settings) for a run that recorded neither a snapshot nor a provider. */
export interface ChatDefaults {
  readonly provider?: string;
  readonly model?: string;
}

/** Body for `POST /api/chat/sessions`. */
export type ChatSessionCreateBody = Readonly<Record<string, unknown>> & {
  readonly name: string;
  readonly runId: string;
  readonly seedTurns?: readonly SeedTurn[];
};

/** What "Continue in chat" does for a run. */
export type RunChatPlan =
  | { readonly kind: "open"; readonly sessionId: string }
  | {
      readonly kind: "create";
      readonly body: ChatSessionCreateBody;
      /** False when the run stored no launch snapshot: the session runs on chat defaults (toast it). */
      readonly configRecorded: boolean;
    };

/**
 * Launch-only inputs of a desk run (`RunConfigBody` beyond the shared agent
 * config): the prompt is seeded as a turn instead, the rest has no chat meaning.
 * The chat route drops any other key its body schema does not know.
 */
const RUN_ONLY_KEYS: ReadonlySet<string> = new Set(["prompt", "agentName", "variables", "variableValues"]);

const NAME_MAX = 60;

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/** The agent config a chat session gets from a run's launch snapshot (run-only keys removed). */
export function chatConfigFromLaunch(launch: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(launch)) {
    if (RUN_ONLY_KEYS.has(k) || v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

/**
 * The seeded exchange: the task as the user turn and the answer as the reply.
 * Nothing is seeded without an answer (a lone question would read as unanswered;
 * `runId` still gives the chat agent the run as context).
 */
export function seedTurnsOf(task: string | undefined, answer: string | undefined): readonly SeedTurn[] {
  const a = answer?.trim();
  if (!a) return [];
  const t = task?.trim();
  return t ? [{ role: "user", content: t }, { role: "assistant", content: a }] : [{ role: "assistant", content: a }];
}

/** Plan "Continue in chat" for a run. */
export function runToChatSession(run: RunChatSource, defaults: ChatDefaults = {}): RunChatPlan {
  if (run.chatSessionId) return { kind: "open", sessionId: run.chatSessionId };

  const launch = run.launchParams ?? undefined;
  const config = launch ? chatConfigFromLaunch(launch) : {};
  const task = run.task ?? (launch ? str(launch.prompt) : undefined);
  // Provider and model travel as a pair from one source: the snapshot, else what the run reported, else the chat defaults.
  const pair = str(config.provider)
    ? { provider: str(config.provider), model: str(config.model) }
    : str(run.provider)
      ? { provider: str(run.provider), model: str(run.model) }
      : { provider: str(defaults.provider), model: str(defaults.model) };
  const { provider, model } = pair;
  const seedTurns = seedTurnsOf(task, run.answer);
  const name = run.title.length > NAME_MAX ? `${run.title.slice(0, NAME_MAX - 1).trimEnd()}…` : run.title;

  const body: ChatSessionCreateBody = {
    ...config,
    name,
    runId: run.runId,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(seedTurns.length > 0 ? { seedTurns } : {}),
  };
  return { kind: "create", body, configRecorded: launch !== undefined };
}
