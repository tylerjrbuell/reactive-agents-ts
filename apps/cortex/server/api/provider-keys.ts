/**
 * /api/settings/keys — provider API keys saved through Settings · Providers.
 *
 * - GET    /                      every keyed provider's status (masked, never the key)
 * - PUT    /:provider             { apiKey, preferStored? } save or replace
 * - PATCH  /:provider             { preferStored } use the stored key over an env key, or not
 * - DELETE /:provider             remove the stored key
 * - POST   /:provider/test        { apiKey? } list the provider's models with that key
 *                                 (else the key agents would use); reports ok + model count
 *
 * Storage and precedence: `services/provider-key-store.ts`. Responses and logs never
 * contain a key; a test failure message is passed through `redactKey`.
 */
import { listProviderModels, type ListProviderModelsOptions } from "@reactive-agents/llm-provider";
import { Effect, Either } from "effect";
import { Elysia, t } from "elysia";
import { resolve } from "node:path";
import {
  bearerFetch,
  effectiveOllamaEndpoint,
  isLoopbackEndpoint,
  OLLAMA_AUTH_MESSAGE,
} from "../services/ollama-cloud.js";
import { listJudgmentCatalog, TYPESAFE_KEY_ID, type ListJudgmentCatalog } from "../services/cortex-judgment.js";
import {
  isKeyedProvider,
  redactKey,
  VOICE_STT_KEY_ID,
  VOICE_TTS_KEY_ID,
  type ProviderKeyStatus,
  type ProviderKeyStore,
  type ProviderKeyStoreError,
} from "../services/provider-key-store.js";

/** Result of `POST /api/settings/keys/:provider/test`. */
export interface ProviderKeyTestResult {
  readonly ok: boolean;
  /** Which key was tried: the one typed in the form, the stored one, or the env one. */
  readonly tried: "typed" | "stored" | "env" | "none";
  /** Chat models the provider listed (on success). */
  readonly models?: number;
  /** Why the call failed, with any key redacted. */
  readonly error?: string;
}

/** Lists models with an optional key; injectable for tests (no network). */
export type ListModelsWithKey = (
  provider: string,
  opts: ListProviderModelsOptions,
) => Promise<{ readonly ok: true; readonly count: number } | { readonly ok: false; readonly message: string }>;

const defaultListModels: ListModelsWithKey = (provider, opts) =>
  Effect.runPromise(
    Effect.either(listProviderModels(provider, { ...opts, timeoutMs: 8_000 })).pipe(
      Effect.map((r) =>
        Either.isRight(r)
          ? ({ ok: true, count: r.right.length } as const)
          : ({ ok: false, message: r.left.message } as const),
      ),
    ),
  );

const statusCodeOf = (e: ProviderKeyStoreError): number =>
  e.reason === "unknown-provider" || e.reason === "empty-key" ? 400 : e.reason === "not-found" ? 404 : 500;

/** Build the router over `store`; `listModels` lets tests replace the provider call. */
export function providerKeysRouter(
  store: ProviderKeyStore,
  listModels: ListModelsWithKey = defaultListModels,
  listCatalog: ListJudgmentCatalog = listJudgmentCatalog,
) {
  const reply = <A>(
    r: { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: ProviderKeyStoreError },
    set: { status?: number | string },
  ): A | { readonly error: string } => {
    if (r.ok) return r.value;
    set.status = statusCodeOf(r.error);
    return { error: r.error.message };
  };

  return new Elysia({ prefix: "/api/settings/keys" })
    .get("/", ({ set }) => {
      const r = store.list();
      if (!r.ok) return reply(r, set);
      return { providers: r.value as readonly ProviderKeyStatus[], dir: resolve(store.dir) };
    })
    .put(
      "/:provider",
      ({ params, body, set }) => reply(store.set(params.provider, body.apiKey, body.preferStored), set),
      { body: t.Object({ apiKey: t.String({ maxLength: 4096 }), preferStored: t.Optional(t.Boolean()) }) },
    )
    .patch(
      "/:provider",
      ({ params, body, set }) => reply(store.setPreferStored(params.provider, body.preferStored), set),
      { body: t.Object({ preferStored: t.Boolean() }) },
    )
    .delete("/:provider", ({ params, set }) => reply(store.remove(params.provider), set))
    .post(
      "/:provider/test",
      async ({ params, body, set }): Promise<ProviderKeyTestResult | { readonly error: string }> => {
        const provider = params.provider;
        if (!isKeyedProvider(provider)) {
          set.status = 400;
          return { error: `no stored key support for provider "${provider}"` };
        }
        // A voice endpoint's key is not an LLM provider's: its Test lives in Settings · Voice.
        if (provider === VOICE_STT_KEY_ID || provider === VOICE_TTS_KEY_ID) {
          return { ok: false, tried: "none", error: "Test voice keys with the Test button in Settings · Voice." };
        }
        const typed = body?.apiKey?.trim() || undefined;
        const status = store.status(provider);
        const agentKey = typed ? undefined : store.keyForAgent(provider);
        const apiKey = typed ?? agentKey;
        const tried: ProviderKeyTestResult["tried"] = typed
          ? "typed"
          : agentKey
            ? "stored"
            : status.ok && status.value.envSet
              ? "env"
              : "none";
        if (tried === "none") return { ok: false, tried, error: "No key to test: type one or save one first." };
        // The TypeSafe key is not an LLM provider's: test it by reading the Jev model
        // catalog (no `ask`, nothing billed). The env key is read by the framework itself.
        if (provider === TYPESAFE_KEY_ID) {
          const c = await listCatalog(apiKey ? { apiKey } : {});
          return c.ok
            ? { ok: true, tried, models: c.models.length }
            : { ok: false, tried, error: redactKey(c.message, apiKey) };
        }
        // Ollama: list the configured endpoint's models with the bearer on that host only (the
        // framework's Ollama listing sends no auth header). A rejected key reads plainly.
        if (provider === "ollama") {
          const endpoint = effectiveOllamaEndpoint();
          const key = apiKey ?? process.env.OLLAMA_API_KEY?.trim();
          if (isLoopbackEndpoint(endpoint)) {
            return { ok: false, tried, error: "The Ollama endpoint is this machine, which needs no key. Set the endpoint to Ollama Cloud first." };
          }
          const o = await listModels("ollama", {
            baseUrl: endpoint,
            ...(key ? { apiKey: key, fetch: bearerFetch(endpoint, key) } : {}),
          });
          if (o.ok) return { ok: true, tried, models: o.count };
          const msg = /\b40[13]\b|unauthori[sz]ed/i.test(o.message) ? OLLAMA_AUTH_MESSAGE : o.message;
          return { ok: false, tried, error: redactKey(msg, key) };
        }
        const r = await listModels(provider, apiKey ? { apiKey } : {});
        return r.ok
          ? { ok: true, tried, models: r.count }
          : { ok: false, tried, error: redactKey(r.message, apiKey) };
      },
      { body: t.Optional(t.Object({ apiKey: t.Optional(t.String({ maxLength: 4096 })) })) },
    );
}
