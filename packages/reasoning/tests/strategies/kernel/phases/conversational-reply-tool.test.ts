// Run: bun test packages/reasoning/tests/strategies/kernel/phases/conversational-reply-tool.test.ts --timeout 15000
//
// Classifier for "conversational reply" tools — the channel's MCP-prefixed
// messaging surface (Signal/Telegram/Slack send/reply/DM tools). These are
// repeatable output channels, NOT once-only mutations: the gateway guidance
// explicitly tells the model to call them more than once (ack, then answer).
import { describe, it, expect } from "bun:test";
import { isConversationalReplyTool } from "../../../../src/kernel/capabilities/decide/tool-gating.js";

describe("isConversationalReplyTool", () => {
  it("recognizes the Signal channel reply tools", () => {
    expect(isConversationalReplyTool("signal/send_message_to_user")).toBe(true);
    expect(isConversationalReplyTool("signal/reply_to_last_sender")).toBe(true);
    expect(isConversationalReplyTool("signal/send_message_to_group")).toBe(true);
  });

  it("recognizes other channel messaging surfaces by name pattern", () => {
    expect(isConversationalReplyTool("telegram/send_message")).toBe(true);
    expect(isConversationalReplyTool("slack/post_message")).toBe(true);
    expect(isConversationalReplyTool("discord/send_dm")).toBe(true);
    expect(isConversationalReplyTool("reply_to_message")).toBe(true);
  });

  it("does NOT classify once-only mutations as conversational", () => {
    // send-email is the canonical once-only side effect — sending twice is a bug.
    expect(isConversationalReplyTool("send-email")).toBe(false);
    expect(isConversationalReplyTool("file-write")).toBe(false);
    expect(isConversationalReplyTool("create-issue")).toBe(false);
    expect(isConversationalReplyTool("delete-file")).toBe(false);
    expect(isConversationalReplyTool("git-cli")).toBe(false);
  });

  it("does NOT classify read-only tools as conversational", () => {
    expect(isConversationalReplyTool("web-search")).toBe(false);
    expect(isConversationalReplyTool("crypto-price")).toBe(false);
    expect(isConversationalReplyTool("http-get")).toBe(false);
    expect(isConversationalReplyTool("find")).toBe(false);
  });
});
