import type { InboundMessage, TriggerAgentConfig, TriggerDefinition } from "../types.js";

/**
 * In-memory trigger matching for inbound channel messages (bots, webhooks, MCP).
 * Webhook path routing is handled by the adapter before messages reach the registry.
 */
export class TriggerRegistry {
  private readonly triggers = new Map<string, TriggerDefinition>();
  private defaultAgent?: TriggerAgentConfig;

  register(trigger: TriggerDefinition): void {
    this.triggers.set(trigger.id, trigger);
  }

  unregister(triggerId: string): void {
    this.triggers.delete(triggerId);
  }

  setDefaultAgent(config: TriggerAgentConfig): void {
    this.defaultAgent = config;
  }

  getDefaultAgent(): TriggerAgentConfig | undefined {
    return this.defaultAgent;
  }

  /** First registered trigger that matches and passes permissions, or `null`. */
  evaluate(msg: InboundMessage): TriggerDefinition | null {
    for (const trigger of this.triggers.values()) {
      if (this.matchesTrigger(trigger, msg) && this.isPermitted(trigger, msg)) {
        return trigger;
      }
    }
    return null;
  }

  private matchesTrigger(trigger: TriggerDefinition, msg: InboundMessage): boolean {
    const match = trigger.match;
    switch (match.type) {
      case "keyword":
        return match.patterns.some((p) =>
          msg.content.toLowerCase().includes(p.toLowerCase()),
        );
      case "slash_command":
        return msg.content.startsWith(`/${match.command}`);
      case "mention":
        return /(@bot|@agent)/i.test(msg.content);
      case "reaction":
        return false;
      case "webhook":
        return false;
      case "custom":
        return match.evaluate(msg);
      default:
        return false;
    }
  }

  private isPermitted(trigger: TriggerDefinition, msg: InboundMessage): boolean {
    const perms = trigger.permissions;
    if (!perms) return true;
    if (perms.deniedUsers?.includes(msg.senderId)) return false;
    if (perms.allowedUsers && !perms.allowedUsers.includes(msg.senderId)) return false;
    return true;
  }
}
