import { ulid } from "ulid";
import type { AgentId } from "./types/agent.js";
import type { TaskId } from "./types/task.js";
import type { MessageId } from "./types/message.js";

/** Generate a new AgentId (ULID — sortable, globally unique). */
export const generateAgentId = (): AgentId => ulid() as AgentId;

/** Generate a new TaskId. */
export const generateTaskId = (): TaskId => ulid() as TaskId;

/** Generate a new MessageId. */
export const generateMessageId = (): MessageId => ulid() as MessageId;
