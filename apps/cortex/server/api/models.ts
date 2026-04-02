/**
 * /api/models — dynamic model lists per provider.
 * Ollama: proxies to localhost:11434/api/tags
 */
import { Elysia } from "elysia";

interface OllamaTag { name: string; modified_at: string; size: number }
interface OllamaTagsResponse { models?: OllamaTag[] }

const OLLAMA_DEFAULT = process.env.OLLAMA_HOST ?? "http://localhost:11434";

export const modelsRouter = new Elysia({ prefix: "/api/models" })
  .get("/ollama", async ({ set, query }) => {
    const ollamaUrl = (query as Record<string, string | undefined>).endpoint?.trim() || OLLAMA_DEFAULT;
    try {
      const res = await fetch(`${ollamaUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) {
        set.status = 502;
        return { error: `Ollama returned ${res.status}`, models: [] };
      }
      const data = (await res.json()) as OllamaTagsResponse;
      const models = (data.models ?? []).map((m) => ({
        name: m.name,
        label: m.name,
        sizeBytes: m.size,
      }));
      return { models };
    } catch (e) {
      set.status = 503;
      return {
        error: `Ollama not reachable at ${ollamaUrl}: ${String(e)}`,
        models: [],
      };
    }
  });
