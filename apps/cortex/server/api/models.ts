/**
 * /api/models — dynamic model lists per provider.
 * - /framework/:provider — from @reactive-agents/llm-provider (ModelPresets + defaults)
 * - /ollama — proxies to Ollama /api/tags
 */
import { listFrameworkModelsForProvider, getProviderDefaultModel, resolveCapability } from "@reactive-agents/llm-provider";
import { Elysia } from "elysia";

interface OllamaTag { name: string; modified_at: string; size: number; digest?: string }
interface OllamaTagsResponse { models?: OllamaTag[] }

const OLLAMA_DEFAULT = process.env.OLLAMA_HOST ?? "http://localhost:11434";

/**
 * Does this model have a thinking mode? `null` = unknown (the framework has no data for it),
 * which the UI shows as "unknown" rather than claiming the model can't think.
 */
function frameworkSupportsThinking(provider: string, model: string): boolean | null {
  const cap = resolveCapability(provider, model);
  return cap.source === "fallback" ? null : cap.supportsThinkingMode;
}

/** Ollama reports a model's capabilities (`completion`, `tools`, `thinking`, …) via /api/show. Cached per model digest. */
const ollamaThinkingCache = new Map<string, boolean | null>();
async function ollamaSupportsThinking(baseUrl: string, name: string, digest: string): Promise<boolean | null> {
  const key = `${baseUrl}|${name}|${digest}`;
  const hit = ollamaThinkingCache.get(key);
  if (hit !== undefined) return hit;
  let result: boolean | null = null;
  try {
    const res = await fetch(`${baseUrl}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name }),
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const show = (await res.json()) as { capabilities?: unknown };
      if (Array.isArray(show.capabilities)) result = show.capabilities.includes("thinking");
    }
  } catch {
    /* unreachable or slow: leave unknown, do not cache */
    return null;
  }
  ollamaThinkingCache.set(key, result);
  return result;
}

export const modelsRouter = new Elysia({ prefix: "/api/models" })
  .get("/framework/:provider", ({ params }) => {
    const provider = decodeURIComponent(params.provider ?? "").trim();
    const models = listFrameworkModelsForProvider(provider).map((m) => ({
      ...m,
      supportsThinking: frameworkSupportsThinking(provider, m.name),
    }));
    // `default` is the framework's current provider-default model id. Cortex no
    // longer hardcodes a default — the UI seeds from this so it follows whatever
    // the framework ships (e.g. when a model retires and the default is bumped).
    const def = getProviderDefaultModel(provider);
    return { models, default: def ?? null };
  })
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
      const models = await Promise.all(
        (data.models ?? []).map(async (m) => ({
          name: m.name,
          label: m.name,
          sizeBytes: m.size,
          supportsThinking: await ollamaSupportsThinking(ollamaUrl, m.name, m.digest ?? ""),
        })),
      );
      return { models };
    } catch (e) {
      set.status = 503;
      return {
        error: `Ollama not reachable at ${ollamaUrl}: ${String(e)}`,
        models: [],
      };
    }
  });
