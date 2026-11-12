/**
 * /api/settings/ollama — the Ollama endpoint Cortex uses for runs, chat, utility agents,
 * the model list and the capability probe (Settings · Providers; Ollama Cloud preset).
 *
 * - GET /   { endpoint: saved | null, effective, cloud, cloudEndpoint, local }
 * - PUT /   { endpoint: string | null }   save (http/https URL, or a bare host:port) or clear
 *
 * The saved value is applied as `OLLAMA_ENDPOINT` (see `services/ollama-cloud.ts`). The API
 * key is a separate setting (`/api/settings/keys/ollama`) and is never returned here.
 */
import { Elysia, t } from "elysia";
import { checkOutboundUrl, type HostResolver } from "../outbound-url.js";
import {
  applyOllamaEndpoint,
  effectiveOllamaEndpoint,
  isLoopbackEndpoint,
  isOllamaCloud,
  normalizeOllamaEndpoint,
  OLLAMA_CLOUD_ENDPOINT,
  type OllamaEndpointStore,
} from "../services/ollama-cloud.js";

/** Body of `GET /api/settings/ollama`. */
export interface OllamaSettingsView {
  /** The endpoint saved in Cortex, or null (the framework's env / localhost default applies). */
  readonly endpoint: string | null;
  /** The endpoint agents actually use. */
  readonly effective: string;
  /** The effective endpoint is Ollama Cloud. */
  readonly cloud: boolean;
  /** The effective endpoint is this machine (no key is sent). */
  readonly local: boolean;
  /** The Ollama Cloud preset. */
  readonly cloudEndpoint: string;
}

/** Build the router over the endpoint store. */
export function ollamaSettingsRouter(store: OllamaEndpointStore, resolveHost?: HostResolver) {
  const view = (): OllamaSettingsView => {
    const effective = effectiveOllamaEndpoint();
    return {
      endpoint: store.get() ?? null,
      effective,
      cloud: isOllamaCloud(effective),
      local: isLoopbackEndpoint(effective),
      cloudEndpoint: OLLAMA_CLOUD_ENDPOINT,
    };
  };
  return new Elysia({ prefix: "/api/settings/ollama" })
    .get("/", () => view())
    .put(
      "/",
      async ({ body, set }) => {
        const raw = body.endpoint;
        const endpoint = raw === null || raw.trim() === "" ? undefined : normalizeOllamaEndpoint(raw);
        if (raw !== null && raw.trim() !== "" && endpoint === undefined) {
          set.status = 400;
          return { error: "Endpoint must be an http(s) URL such as http://localhost:11434 or https://ollama.com." };
        }
        // The saved endpoint receives the Ollama key and every model call: refuse link-local /
        // cloud-metadata hosts, credentials in the URL, and names that resolve to such an address.
        if (endpoint !== undefined) {
          const checked = await checkOutboundUrl(endpoint, resolveHost);
          if (!checked.ok) {
            set.status = 400;
            return { error: `That endpoint is not allowed: ${checked.reason}.` };
          }
        }
        if (!store.set(endpoint)) {
          set.status = 500;
          return { error: "Could not save the Ollama endpoint." };
        }
        applyOllamaEndpoint();
        return view();
      },
      { body: t.Object({ endpoint: t.Union([t.String({ maxLength: 2048 }), t.Null()]) }) },
    );
}
