import { Effect } from "effect";
import type { AgentContract, ViolationType, Severity } from "../types.js";
import type { DetectionResult } from "../detectors/injection-detector.js";

export const checkContract = (
  text: string,
  contract: AgentContract,
): Effect.Effect<DetectionResult, never> =>
  Effect.sync(() => {
    const lower = text.toLowerCase();

    // Check denied topics
    for (const topic of contract.deniedTopics) {
      if (lower.includes(topic.toLowerCase())) {
        return {
          detected: true,
          type: "contract-violation" as ViolationType,
          severity: "high" as Severity,
          message: `Denied topic referenced: "${topic}"`,
          details: `Contract prohibits this topic`,
        };
      }
    }

    // Check denied actions
    for (const action of contract.deniedActions) {
      if (lower.includes(action.toLowerCase())) {
        return {
          detected: true,
          type: "scope-violation" as ViolationType,
          severity: "high" as Severity,
          message: `Denied action referenced: "${action}"`,
          details: `Contract prohibits this action`,
        };
      }
    }

    // Check output length
    if (contract.maxOutputLength !== undefined && text.length > contract.maxOutputLength) {
      return {
        detected: true,
        type: "contract-violation" as ViolationType,
        severity: "medium" as Severity,
        message: `Output exceeds max length (${text.length} > ${contract.maxOutputLength})`,
      };
    }

    return {
      detected: false,
      type: "contract-violation" as ViolationType,
      severity: "low" as Severity,
      message: "Contract check passed",
    };
  });
