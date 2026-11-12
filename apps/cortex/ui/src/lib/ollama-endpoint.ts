/**
 * Settings · Providers · Ollama endpoint: the server's saved endpoint (`/api/settings/ollama`),
 * the Ollama Cloud preset and the words around them. The server applies the endpoint to every
 * run, chat, utility agent, model list and capability probe; the key is a separate entry in
 * the provider keys list (`ollama`, env `OLLAMA_API_KEY`).
 */

/** The one-click Ollama Cloud endpoint. */
export const OLLAMA_CLOUD_ENDPOINT = "https://ollama.com";
/** The local server default. */
export const OLLAMA_LOCAL_ENDPOINT = "http://localhost:11434";

/** `GET /api/settings/ollama`. */
export interface OllamaSettingsView {
  readonly endpoint: string | null;
  readonly effective: string;
  readonly cloud: boolean;
  readonly local: boolean;
  readonly cloudEndpoint: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The view from untrusted JSON, or null. */
export function parseOllamaSettings(v: unknown): OllamaSettingsView | null {
  if (!isRecord(v) || typeof v.effective !== "string") return null;
  return {
    endpoint: typeof v.endpoint === "string" ? v.endpoint : null,
    effective: v.effective,
    cloud: v.cloud === true,
    local: v.local === true,
    cloudEndpoint: typeof v.cloudEndpoint === "string" ? v.cloudEndpoint : OLLAMA_CLOUD_ENDPOINT,
  };
}

/** True when `endpoint` (typed in the field) is the Ollama Cloud preset. */
export function isCloudEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint.trim().replace(/\/+$/, "")).hostname === "ollama.com";
  } catch {
    return false;
  }
}

/** One line under the field: what agents will talk to, and whether a key is needed. */
export function endpointNote(view: OllamaSettingsView | null): string {
  if (!view) return "Could not read the saved endpoint from the Cortex server.";
  if (view.cloud) return `Agents use Ollama Cloud (${view.effective}). It needs an Ollama API key: save one above or set OLLAMA_API_KEY.`;
  if (view.local) return `Agents use this machine (${view.effective}); no key is sent.`;
  return `Agents use ${view.effective}. The Ollama API key above is sent to this host only.`;
}

/** `PUT /api/settings/ollama` result. */
export type SaveEndpointResult = { readonly ok: true; readonly value: OllamaSettingsView } | { readonly ok: false; readonly error: string };

/** The calls the endpoint row makes. */
export function ollamaSettingsApi(base: string, doFetch: typeof fetch = fetch) {
  return {
    async get(): Promise<OllamaSettingsView | null> {
      try {
        const res = await doFetch(`${base}/api/settings/ollama`);
        return res.ok ? parseOllamaSettings(await res.json()) : null;
      } catch {
        return null;
      }
    },
    async save(endpoint: string): Promise<SaveEndpointResult> {
      try {
        const res = await doFetch(`${base}/api/settings/ollama`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: endpoint.trim() === "" ? null : endpoint.trim() }),
        });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, error: isRecord(body) && typeof body.error === "string" ? body.error : `Server returned ${res.status}` };
        const view = parseOllamaSettings(body);
        return view ? { ok: true, value: view } : { ok: false, error: "Unexpected response from the server." };
      } catch {
        return { ok: false, error: "Could not reach the Cortex server." };
      }
    },
  };
}
