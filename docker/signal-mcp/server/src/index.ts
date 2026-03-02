#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SignalCliBridge, type SignalNotification } from "./signal-cli-bridge.js";

const userId = process.env.SIGNAL_USER_ID;
if (!userId) {
  process.stderr.write("SIGNAL_USER_ID environment variable is required\n");
  process.exit(1);
}

const configDir = process.env.SIGNAL_CLI_CONFIG ?? "/data";

// ── Signal-CLI bridge (persistent jsonRpc subprocess) ───────────────────────
const bridge = new SignalCliBridge(userId, configDir);
bridge.start();

// ── Push notifications for incoming messages ────────────────────────────────
bridge.onMessageCallback = (notification) => {
  const envelope = (notification.params as any)?.envelope;
  if (!envelope) return;

  const message = envelope.dataMessage?.message ?? envelope.syncMessage?.sentMessage?.message;
  if (!message) return; // Skip non-text notifications (receipts, typing, etc.)

  // Send MCP notification to connected client via stdout (JSON-RPC, no id = notification)
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      sender: envelope.source ?? envelope.sourceNumber ?? "unknown",
      message,
      timestamp: envelope.timestamp ?? Date.now(),
      groupId: envelope.dataMessage?.groupInfo?.groupId,
      platform: "signal",
    },
  });
  process.stdout.write(payload + "\n");
};

// ── MCP Server ──────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "signal",
  version: "1.0.0",
});

// ── Tool: send_message_to_user ──────────────────────────────────────────────
server.tool(
  "send_message_to_user",
  "Send a direct message to a Signal user by phone number",
  {
    recipient: z.string().describe("Phone number with country code (e.g. +12025551234)"),
    message: z.string().describe("Message text to send"),
  },
  async ({ recipient, message }) => {
    try {
      await bridge.request("send", {
        recipient: [recipient],
        message,
      });
      return {
        content: [{ type: "text" as const, text: `Message sent to ${recipient}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Failed to send: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// ── Tool: send_message_to_group ─────────────────────────────────────────────
server.tool(
  "send_message_to_group",
  "Send a message to a Signal group by group ID",
  {
    groupId: z.string().describe("Signal group ID (base64 encoded)"),
    message: z.string().describe("Message text to send"),
  },
  async ({ groupId, message }) => {
    try {
      await bridge.request("send", {
        groupId,
        message,
      });
      return {
        content: [{ type: "text" as const, text: `Message sent to group ${groupId}` }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Failed to send: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// ── Tool: receive_message ───────────────────────────────────────────────────
server.tool(
  "receive_message",
  "Receive pending Signal messages. Returns buffered notifications from the persistent signal-cli connection.",
  {
    timeout: z
      .number()
      .optional()
      .default(5)
      .describe("Seconds to wait for new messages (default: 5)"),
  },
  async ({ timeout }) => {
    // Wait up to `timeout` seconds for notifications to accumulate
    const waitMs = (timeout ?? 5) * 1000;
    const start = Date.now();
    while (Date.now() - start < waitMs) {
      const msgs = bridge.drainNotifications();
      if (msgs.length > 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify(formatMessages(msgs), null, 2) }],
        };
      }
      await sleep(500);
    }

    // Final drain after timeout
    const msgs = bridge.drainNotifications();
    if (msgs.length > 0) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(formatMessages(msgs), null, 2) }],
      };
    }

    return {
      content: [{ type: "text" as const, text: "No new messages" }],
    };
  },
);

// ── Tool: list_groups ───────────────────────────────────────────────────────
server.tool(
  "list_groups",
  "List all Signal groups the registered account belongs to",
  {},
  async () => {
    try {
      const result = await bridge.request("listGroups");
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Failed to list groups: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  },
);

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatMessages(notifications: SignalNotification[]): unknown[] {
  return notifications.map((n) => {
    const envelope = (n.params as any)?.envelope;
    if (!envelope) return n.params;
    return {
      source: envelope.source ?? envelope.sourceNumber,
      timestamp: envelope.timestamp,
      message: envelope.dataMessage?.message ?? envelope.syncMessage?.sentMessage?.message,
      groupId: envelope.dataMessage?.groupInfo?.groupId,
    };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Graceful shutdown ───────────────────────────────────────────────────────
async function shutdown() {
  process.stderr.write("Shutting down signal-mcp server...\n");
  await bridge.shutdown();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Start MCP transport ─────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("signal-mcp server started\n");
