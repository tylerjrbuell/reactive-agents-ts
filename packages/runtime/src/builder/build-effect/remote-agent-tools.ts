/**
 * Remote A2A agent tool registration helper.
 *
 * Builds a `(toolDef, handler)` registration pair for a remote agent
 * accessible via the A2A JSON-RPC protocol (`message/send`,
 * `tasks/get`). The handler wraps `executeRemoteAgentTool` from
 * `@reactive-agents/tools` with a `RemoteAgentClient` instance that
 * speaks JSON-RPC over `fetch`.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect } from "effect";
import { assertPublicUrl } from "@reactive-agents/runtime-shim";
import type {
  RemoteAgentClient,
  TaskResult,
  ToolDefinition,
} from "@reactive-agents/tools";

/**
 * Egress guard for A2A peer URLs (F15). These are operator-configured, and
 * local peers (loopback / RFC-1918) are a legitimate multi-agent pattern, so
 * private targets are allowed by default; cloud-metadata / link-local is always
 * blocked. Set RA_AGENT_STRICT_EGRESS=1 to also refuse private targets.
 */
const agentEgressGuard = () => ({
  allowPrivate: process.env.RA_AGENT_STRICT_EGRESS !== "1",
});

export interface RemoteAgentToolRegistration {
  readonly def: ToolDefinition;
  readonly handler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, Error>;
}

export interface RemoteAgentToolDeps {
  readonly createRemoteAgentTool: (
    name: string,
    agentCardUrl: string,
    baseUrl: string,
  ) => ToolDefinition;
  readonly executeRemoteAgentTool: (
    tool: ToolDefinition,
    input: Record<string, unknown>,
    client: RemoteAgentClient,
    agentCardUrl: string,
  ) => Promise<TaskResult>;
}

export const createRemoteAgentToolRegistration = (
  agentTool: { readonly name: string; readonly remoteUrl: string },
  deps: RemoteAgentToolDeps,
): RemoteAgentToolRegistration => {
  const { createRemoteAgentTool, executeRemoteAgentTool } = deps;

  // Remote A2A agent tool
  const toolDef = createRemoteAgentTool(
    agentTool.name,
    `${agentTool.remoteUrl}/.well-known/agent.json`,
    agentTool.remoteUrl,
  );
  const remoteUrl = agentTool.remoteUrl;
  const remoteClient: RemoteAgentClient = {
    sendMessage: (params: {
      message: { role: string; content: string };
      agentCardUrl: string;
    }) =>
      Effect.tryPromise({
        try: async () => {
          await assertPublicUrl(remoteUrl, agentEgressGuard());
          return fetch(remoteUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "message/send",
              params: {
                message: {
                  role: params.message.role,
                  parts: [
                    {
                      kind: "text",
                      text: params.message.content,
                    },
                  ],
                },
              },
              id: crypto.randomUUID(),
            }),
          })
            .then((r) => r.json())
            .then(
              (d: Record<string, unknown>) =>
                d.result as {
                  taskId: string;
                },
            );
        },
        catch: (e) => new Error(String(e)),
      }),
    getTask: (params: { id: string }) =>
      Effect.tryPromise({
        try: async () => {
          await assertPublicUrl(remoteUrl, agentEgressGuard());
          return fetch(remoteUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "tasks/get",
              params: { id: params.id },
              id: crypto.randomUUID(),
            }),
          })
            .then((r) => r.json())
            .then(
              (d: Record<string, unknown>) =>
                d.result as {
                  status: string;
                  result: unknown;
                },
            );
        },
        catch: (e) => new Error(String(e)),
      }),
  };
  const handler = (args: Record<string, unknown>) =>
    Effect.tryPromise({
      try: () =>
        executeRemoteAgentTool(
          toolDef,
          args,
          remoteClient,
          `${remoteUrl}/.well-known/agent.json`,
        ),
      catch: (e) => new Error(String(e)),
    });
  return { def: toolDef, handler };
};
