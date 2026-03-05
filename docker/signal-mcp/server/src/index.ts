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

// ── Logging helper (stderr only — stdout is reserved for MCP protocol) ──────
function log(level: "info" | "warn" | "debug", msg: string, data?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const extra = data ? " " + JSON.stringify(data) : "";
  process.stderr.write(`[${ts}] [signal-mcp] [${level}] ${msg}${extra}\n`);
}

// ── Signal-CLI bridge (persistent jsonRpc subprocess) ───────────────────────
const bridge = new SignalCliBridge(userId, configDir);
bridge.start();
log("info", `signal-cli bridge started for ${userId}`);

// ── Recently-sent message tracker (prevents feedback loops) ─────────────────
// When the agent sends a message via send_message_to_user/group, we record it.
// When a syncMessage echo arrives with the same text, we skip it instead of
// forwarding it as a new inbound message.
const recentlySent = new Set<string>();
const SENT_TTL_MS = 60_000; // 60s window

function trackSentMessage(text: string): void {
  recentlySent.add(text);
  setTimeout(() => recentlySent.delete(text), SENT_TTL_MS);
}

// ── Push notifications for incoming messages ────────────────────────────────
bridge.onMessageCallback = (notification) => {
  const envelope = (notification.params as any)?.envelope;
  if (!envelope) {
    log("debug", "notification without envelope, skipping");
    return;
  }

  // Extract message from either path:
  // - dataMessage: inbound message from another user (or separate agent account)
  // - syncMessage.sentMessage: Note to Self or outbound echo
  const dataMsg = envelope.dataMessage?.message;
  const syncMsg = envelope.syncMessage?.sentMessage?.message;
  const message = dataMsg ?? syncMsg;
  const sender = envelope.source ?? envelope.sourceNumber ?? "unknown";
  const msgType = dataMsg ? "dataMessage" : syncMsg ? "syncMessage" : "other";

  log("debug", `raw notification`, {
    type: msgType,
    sender,
    hasDataMsg: !!dataMsg,
    hasSyncMsg: !!syncMsg,
    message: message?.slice(0, 80),
  });

  if (!message) {
    log("debug", `skipping non-text notification (${msgType})`, { sender });
    return;
  }

  // If this is a syncMessage, check if it's an echo of something WE just sent.
  // If so, skip it to prevent feedback loops.
  if (!dataMsg && syncMsg) {
    if (recentlySent.has(syncMsg)) {
      recentlySent.delete(syncMsg); // consume the entry
      log("info", `skipping outbound echo`, { message: syncMsg.slice(0, 80) });
      return;
    }
    log("info", `forwarding syncMessage (Note to Self)`, { sender, message: syncMsg.slice(0, 80) });
  } else {
    log("info", `forwarding dataMessage`, { sender, message: dataMsg!.slice(0, 80) });
  }

  // Send MCP notification to connected client via stdout (JSON-RPC, no id = notification)
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/message",
    params: {
      sender,
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
    log("info", `send_message_to_user`, { recipient, message: message.slice(0, 80) });
    try {
      trackSentMessage(message);
      await bridge.request("send", {
        recipient: [recipient],
        message,
      });
      log("info", `message sent to ${recipient}`);
      return {
        content: [{ type: "text" as const, text: `Message sent to ${recipient}` }],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log("warn", `send failed`, { recipient, error: errMsg });
      return {
        content: [{ type: "text" as const, text: `Failed to send: ${errMsg}` }],
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
    log("info", `send_message_to_group`, { groupId, message: message.slice(0, 80) });
    try {
      trackSentMessage(message);
      await bridge.request("send", {
        groupId,
        message,
      });
      log("info", `message sent to group ${groupId}`);
      return {
        content: [{ type: "text" as const, text: `Message sent to group ${groupId}` }],
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log("warn", `group send failed`, { groupId, error: errMsg });
      return {
        content: [{ type: "text" as const, text: `Failed to send: ${errMsg}` }],
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
        const formatted = formatMessages(msgs);
        log("info", `receive_message: ${formatted.length} message(s)`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(formatted, null, 2) }],
        };
      }
      await sleep(500);
    }

    // Final drain after timeout
    const msgs = bridge.drainNotifications();
    if (msgs.length > 0) {
      const formatted = formatMessages(msgs);
      log("info", `receive_message: ${formatted.length} message(s) (after timeout)`);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(formatted, null, 2) }],
      };
    }

    log("debug", "receive_message: no new messages");
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
  return notifications
    .filter((n) => {
      const envelope = (n.params as any)?.envelope;
      const msg = envelope?.dataMessage?.message ?? envelope?.syncMessage?.sentMessage?.message;
      if (!msg) return false;
      // Skip sync echoes of messages we sent
      if (!envelope?.dataMessage?.message && recentlySent.has(msg)) {
        recentlySent.delete(msg);
        return false;
      }
      return true;
    })
    .map((n) => {
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
  log("info", "shutting down...");
  await bridge.shutdown();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Start MCP transport ─────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
log("info", "MCP server ready, listening for messages");
