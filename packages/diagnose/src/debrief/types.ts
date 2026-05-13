import type { Rationale } from "@reactive-agents/core";

export type DebriefStep = {
  readonly iter: number;
  /** "think" | "tool:<name>" | "terminate" */
  readonly action: string;
  readonly rationale?: Rationale;
};

export type DebriefAssumption = {
  readonly iter: number;
  readonly assumption: string;
  readonly rationale: Rationale;
};

export type DebriefCuratorAction = {
  readonly iter: number;
  readonly action: "kept" | "dropped" | "compressed" | "marked-untrusted";
  readonly targetRef: string;
  readonly rationale: Rationale;
};

export type DebriefAlternatives = {
  readonly iter: number;
  readonly chosen: string;
  readonly rejected: readonly { option: string; rejectedBecause: string }[];
};

export type Debrief = {
  readonly runId: string;
  readonly goal: string;
  readonly path: readonly DebriefStep[];
  readonly assumptions: readonly DebriefAssumption[];
  readonly curatorActions: readonly DebriefCuratorAction[];
  readonly alternatives: readonly DebriefAlternatives[];
  readonly termination: {
    readonly by: string;
    readonly rationale?: Rationale;
  };
  readonly verdict?: {
    readonly status: "success" | "failure" | "cancelled";
    readonly tokens: number;
    readonly durationMs: number;
  };
};
