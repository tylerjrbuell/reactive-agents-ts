import { writable, type Writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "../constants.js";
import { cortexRunsPostBody } from "../cortex-runs-post-body.js";
import { resolveRunIdFromRunsApi } from "../resolve-run-id.js";
import type { AgentConfig } from "../types/agent-config.js";
import { toast } from "./toast-store.js";
import { settings } from "./settings.js";
import type { AgentNode } from "./agent-store.js";

export interface StageState {
  readonly submitting: boolean;
  readonly lastSubmitError: string | null;
  readonly firstConnectHandled: boolean;
}

export interface StageStore {
  readonly subscribe: Writable<StageState>["subscribe"];
  setNavigate: (fn: (path: string) => void | Promise<void>) => void;
  handleAgentConnected: (agent: AgentNode, totalAgentCount: number) => void;
  /**
   * Start a run from Beacon. When `cfg` is passed (BottomInputBar agent blueprint),
   * the full body is serialized — including `taskContext` for `withTaskContext`.
   */
  submitPrompt: (prompt: string, cfg?: AgentConfig) => Promise<void>;
}

export interface CreateStageStoreOptions {
  /** Injected for tests; defaults to SvelteKit `goto` when running in the app. */
  readonly navigate?: (path: string) => void | Promise<void>;
  readonly fetchImpl?: typeof fetch;
}

export function createStageStore(options?: CreateStageStoreOptions): StageStore {
  const fetchFn = options?.fetchImpl ?? globalThis.fetch.bind(globalThis);
  let navigate = options?.navigate;

  const state = writable<StageState>({
    submitting: false,
    lastSubmitError: null,
    firstConnectHandled: false,
  });

  /** Call once from layout after SvelteKit is available if `navigate` was not injected. */
  function setNavigate(fn: (path: string) => void | Promise<void>) {
    navigate = fn;
  }

  function handleAgentConnected(agent: AgentNode, totalAgentCount: number) {
    state.update((s) => {
      if (!s.firstConnectHandled && totalAgentCount === 1) {
        void navigate?.(`/run/${agent.runId}`);
        return { ...s, firstConnectHandled: true };
      }
      return s;
    });
  }

  async function submitPrompt(prompt: string, cfg?: AgentConfig): Promise<void> {
    state.update((s) => ({ ...s, submitting: true, lastSubmitError: null }));
    const sinceMs = Date.now();
    const s = settings.get();
    const body = cfg
      ? cortexRunsPostBody(prompt, cfg)
      : {
          prompt,
          provider: s.defaultProvider,
          model: s.defaultModel || undefined,
          tools: ["web-search"] as string[],
        };
    try {
      const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 501) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Run submission is not available yet (server returned 501).");
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = (await res.json()) as { runId?: string; agentId?: string };

      let runId = data.runId;
      if (!runId && data.agentId) {
        runId = (await resolveRunIdFromRunsApi(fetchFn, data.agentId, sinceMs)) ?? undefined;
      }
      if (!runId) {
        throw new Error(
          "Run started but run id was not available yet. Check Stage — the agent may still be connecting.",
        );
      }
      toast.info("Agent started", "Connecting to Cortex…");
      void navigate?.(`/run/${runId}`);
    } catch (e) {
      const msg = String(e).replace(/^Error: /, "");
      toast.error("Failed to start agent", msg);
      state.update((s) => ({ ...s, lastSubmitError: msg }));
    } finally {
      state.update((s) => ({ ...s, submitting: false }));
    }
  }

  return {
    subscribe: state.subscribe,
    setNavigate,
    handleAgentConnected,
    submitPrompt,
  };
}
