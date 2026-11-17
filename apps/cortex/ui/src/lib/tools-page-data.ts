/**
 * Lab > Tools: every server call the page makes, in one typed client, so the `.svelte` files hold
 * state and wiring only. Each call takes the Cortex base URL and an optional `fetch` (tests pass a
 * fake). Calls never throw: they answer `{ ok: true, value }` or `{ ok: false, error }` with a
 * sentence a person can read.
 */
import type { CatalogEntry, CatalogParam, McpListRow, McpToolDetail } from "./tool-workshop.js";
import type { TestReply } from "./mcp-servers-view.js";

/** A call's outcome. */
export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

/** What a call needs: where Cortex is, and how to fetch. */
export interface ApiCtx {
  readonly base: string;
  readonly fetchFn?: typeof fetch;
}

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

async function call<T>(ctx: ApiCtx, path: string, init: RequestInit | undefined, read: (j: Record<string, unknown>) => T): Promise<ApiResult<T>> {
  try {
    const res = await (ctx.fetchFn ?? fetch)(`${ctx.base}${path}`, init);
    const text = await res.text();
    let json: unknown = {};
    try {
      json = text === "" ? {} : JSON.parse(text);
    } catch {
      return { ok: false, error: `The server answered with something that is not JSON (HTTP ${res.status}). Restart Cortex and reload the page.` };
    }
    const body = json !== null && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : { value: json };
    if (!res.ok) return { ok: false, error: typeof body.error === "string" ? body.error : `HTTP ${res.status}` };
    return { ok: true, value: read(body) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body !== undefined ? { headers: JSON_HEADERS, body: JSON.stringify(body) } : {}) });
const asList = <T>(j: Record<string, unknown>): T[] => (Array.isArray(j.value) ? (j.value as T[]) : []);

/** GET /api/mcp-servers: every saved server with its state and tool names. */
export const fetchServers = (ctx: ApiCtx): Promise<ApiResult<McpListRow[]>> => call(ctx, "/api/mcp-servers", undefined, asList<McpListRow>);

/** GET /api/tools/catalog: built-in, meta, MCP and custom tools. */
export const fetchCatalog = (ctx: ApiCtx): Promise<ApiResult<CatalogEntry[]>> => call(ctx, "/api/tools/catalog", undefined, asList<CatalogEntry>);

/** GET /api/mcp-servers/:id/tools: the cached tools with their input schemas. */
export const fetchServerTools = (ctx: ApiCtx, serverId: string): Promise<ApiResult<McpToolDetail[]>> =>
  call(ctx, `/api/mcp-servers/${encodeURIComponent(serverId)}/tools`, undefined, (j) => (Array.isArray(j.tools) ? (j.tools as McpToolDetail[]) : []));

/** POST /:id/test: connect, list and release. Never writes the tool cache; a failed test is an answer, not an error. */
export const testServer = (ctx: ApiCtx, serverId: string, opts: { readonly timeoutMs?: number; readonly signal?: AbortSignal } = {}): Promise<ApiResult<TestReply>> =>
  call(
    ctx,
    `/api/mcp-servers/${encodeURIComponent(serverId)}/test${opts.timeoutMs !== undefined ? `?timeoutMs=${Math.floor(opts.timeoutMs)}` : ""}`,
    { ...send("POST"), ...(opts.signal !== undefined ? { signal: opts.signal } : {}) },
    (j): TestReply =>
    j.ok === true
      ? { ok: true, toolCount: typeof j.toolCount === "number" ? j.toolCount : 0, checkedAt: typeof j.checkedAt === "number" ? j.checkedAt : Date.now() }
      : { ok: false, error: typeof j.error === "string" ? j.error : "The test failed." },
  );

/** POST /:id/refresh-tools: list the tools again and store them. Answers the tool count. */
export const refreshServerTools = (ctx: ApiCtx, serverId: string): Promise<ApiResult<number>> =>
  call(ctx, `/api/mcp-servers/${encodeURIComponent(serverId)}/refresh-tools`, send("POST"), (j) => (Array.isArray(j.tools) ? j.tools.length : 0));

/** PATCH /:id/enabled: switch a server on or off. */
export const setServerEnabled = (ctx: ApiCtx, serverId: string, enabled: boolean): Promise<ApiResult<boolean>> =>
  call(ctx, `/api/mcp-servers/${encodeURIComponent(serverId)}/enabled`, send("PATCH", { enabled }), (j) => j.enabled === true);

/** PUT /:id/secrets: write-only credential edits. Answers the key names now stored. */
export const saveServerSecrets = (
  ctx: ApiCtx,
  serverId: string,
  payload: Record<string, unknown>,
): Promise<ApiResult<{ env: string[]; headers: string[] }>> =>
  call(ctx, `/api/mcp-servers/${encodeURIComponent(serverId)}/secrets`, send("PUT", payload), (j) => ({
    env: Array.isArray(j.env) ? (j.env as string[]) : [],
    headers: Array.isArray(j.headers) ? (j.headers as string[]) : [],
  }));

/** POST (new) or PATCH (existing) /api/mcp-servers from the form's body. Answers the server id. */
export const saveServer = (ctx: ApiCtx, body: Record<string, unknown>, serverId?: string): Promise<ApiResult<string>> =>
  call(ctx, serverId === undefined ? "/api/mcp-servers" : `/api/mcp-servers/${encodeURIComponent(serverId)}`, send(serverId === undefined ? "POST" : "PATCH", body), (j) =>
    typeof j.serverId === "string" ? j.serverId : (serverId ?? ""),
  );

/** DELETE /api/mcp-servers/:id. */
export const deleteServer = (ctx: ApiCtx, serverId: string): Promise<ApiResult<true>> =>
  call(ctx, `/api/mcp-servers/${encodeURIComponent(serverId)}`, send("DELETE"), () => true as const);

/** One server an import created. */
export interface ImportedServer {
  readonly serverId: string;
  readonly name: string;
}

/** POST /api/mcp-servers/import-json: the pasted JSON as the server reads it. */
export const importServersJson = (ctx: ApiCtx, json: string): Promise<ApiResult<ImportedServer[]>> =>
  call(ctx, "/api/mcp-servers/import-json", send("POST", { json }), (j) => (Array.isArray(j.created) ? (j.created as ImportedServer[]) : []));

/** POST /api/tools/lab-custom: a new custom tool. Answers its tool id. */
export const createCustomTool = (ctx: ApiCtx, body: { name: string; description: string; parameters: CatalogParam[] }): Promise<ApiResult<string>> =>
  call(ctx, "/api/tools/lab-custom", send("POST", body), (j) => (typeof j.toolId === "string" ? j.toolId : ""));

/** PATCH /api/tools/lab-custom/:id: edit name, description, parameters or the disabled switch. */
export const patchCustomTool = (
  ctx: ApiCtx,
  toolId: string,
  body: { name?: string; description?: string; parameters?: CatalogParam[]; disabled?: boolean },
): Promise<ApiResult<true>> => call(ctx, `/api/tools/lab-custom/${encodeURIComponent(toolId)}`, send("PATCH", body), () => true as const);

/** DELETE /api/tools/lab-custom/:id. */
export const deleteCustomTool = (ctx: ApiCtx, toolId: string): Promise<ApiResult<true>> =>
  call(ctx, `/api/tools/lab-custom/${encodeURIComponent(toolId)}`, send("DELETE"), () => true as const);

/** What POST /api/tools/invoke answers (a 409 carries `approvalRequired`). */
export interface InvokeReply {
  readonly status: number;
  readonly error?: string;
  readonly approvalRequired?: boolean;
  readonly success?: boolean;
  readonly result?: unknown;
  readonly executionTimeMs?: number;
}

/** POST /api/tools/invoke. A refusal (409 until a person approves) is a reply, not a failure. */
export async function invokeTool(ctx: ApiCtx, toolId: string, args: Record<string, unknown>, approved: boolean): Promise<ApiResult<InvokeReply>> {
  try {
    const res = await (ctx.fetchFn ?? fetch)(`${ctx.base}/api/tools/invoke`, send("POST", { toolId, arguments: args, ...(approved ? { approved: true } : {}) }));
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return {
      ok: true,
      value: {
        status: res.status,
        ...(typeof j.error === "string" ? { error: j.error } : {}),
        ...(j.approvalRequired === true ? { approvalRequired: true } : {}),
        ...(typeof j.success === "boolean" ? { success: j.success } : {}),
        ...("result" in j ? { result: j.result } : {}),
        ...(typeof j.executionTimeMs === "number" ? { executionTimeMs: j.executionTimeMs } : {}),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
