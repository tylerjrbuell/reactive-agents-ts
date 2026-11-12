/**
 * /api/judgment — read-only helpers for Lab · Judgment.
 *
 * - GET /models   the TypeSafe (Jev) model catalog for the key agents would use
 *                 (saved key, else TYPESAFE_API_KEY). `available: false` with a reason
 *                 when there is no key or the call failed. No `ask` is made, so nothing
 *                 is billed. A key is never returned; failures go through `redactKey`.
 *
 * Ollama and LLM-emulation models are not listed here: the framework exposes no
 * catalog or capability query for them, so the UI takes a typed model id.
 */
import { Elysia } from "elysia";
import { listJudgmentCatalog, TYPESAFE_KEY_ID, type ListJudgmentCatalog } from "../services/cortex-judgment.js";
import { redactKey, type ProviderKeyStore } from "../services/provider-key-store.js";

/** `GET /api/judgment/models`. */
export interface JudgmentModelsResponse {
  readonly available: boolean;
  /** Why there is no list (no key, call failed), key-free. */
  readonly reason?: string;
  readonly models: ReadonlyArray<{ readonly name: string; readonly description: string }>;
}

/** Build the router over the key store; `listCatalog` lets tests replace the TypeSafe call. */
export function judgmentRouter(store: ProviderKeyStore, listCatalog: ListJudgmentCatalog = listJudgmentCatalog) {
  return new Elysia({ prefix: "/api/judgment" }).get("/models", async (): Promise<JudgmentModelsResponse> => {
    const status = store.status(TYPESAFE_KEY_ID);
    const apiKey = store.keyForAgent(TYPESAFE_KEY_ID);
    const envSet = status.ok && status.value.envSet;
    if (!apiKey && !envSet) {
      return { available: false, reason: "No TypeSafe key. Save one in Settings · Providers or set TYPESAFE_API_KEY.", models: [] };
    }
    const r = await listCatalog(apiKey ? { apiKey } : {});
    if (!r.ok) return { available: false, reason: redactKey(r.message, apiKey), models: [] };
    return { available: true, models: r.models.map((m) => ({ name: m.name, description: m.description })) };
  });
}
