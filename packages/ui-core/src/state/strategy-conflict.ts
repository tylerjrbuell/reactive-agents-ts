/**
 * A strategy that cannot work with an approval gate, caught before a run starts.
 *
 * Code Action runs its tool calls inside a sandbox worker, past the approval gate, so the
 * framework refuses (loudly, mid-run) to start it while a policy gates any tool. That refusal
 * stays; this module lets a UI or server say so up front, in plain words, with the ways out.
 * The policy is never dropped silently: each resolution is a change the person chooses.
 */

/** Strategies whose tool calls bypass the approval gate (framework: `code-action.ts` refusal). */
const GATE_INCOMPATIBLE: ReadonlySet<string> = new Set(["code-action"]);

/** How the agent's approval gate is set: none, the rule-less default most apps send, or an explicit policy. */
export type ApprovalGate = "none" | "default" | "explicit";

/** A way out of a conflict; `patch` is the config change that resolves it. */
export interface ConflictResolution {
  readonly id: "switch-strategy" | "turn-off-approvals";
  readonly label: string;
  readonly patch: { readonly strategy: string } | { readonly askBeforeRiskyTools: false };
}

/** What conflicts, why, and how to fix it. */
export interface StrategyApprovalConflict {
  readonly strategy: string;
  /** One friendly sentence naming the problem and the choice. */
  readonly message: string;
  readonly resolutions: readonly ConflictResolution[];
}

/** Inputs: the configured strategy and how the approval gate is set. */
export interface StrategyApprovalInput {
  readonly strategy?: string | undefined;
  readonly gate: ApprovalGate;
}

/** `ApprovalGate` from the config fields a body or draft carries. */
export function approvalGateOf(cfg: { readonly hasExplicitPolicy: boolean; readonly askBeforeRiskyTools?: unknown }): ApprovalGate {
  if (cfg.hasExplicitPolicy) return "explicit";
  return cfg.askBeforeRiskyTools === false ? "none" : "default";
}

/**
 * The conflict between a strategy and the approval gate, or `undefined` when there is none.
 * An explicit policy offers only a strategy switch (dropping rules the person wrote is their call,
 * made in the approvals settings); the default gate also offers turning approvals off.
 */
export function strategyApprovalConflictOf(input: StrategyApprovalInput): StrategyApprovalConflict | undefined {
  const strategy = input.strategy?.trim();
  if (!strategy || input.gate === "none" || !GATE_INCOMPATIBLE.has(strategy)) return undefined;
  const switchTo: ConflictResolution = { id: "switch-strategy", label: "Use the reactive strategy", patch: { strategy: "reactive" } };
  const turnOff: ConflictResolution = { id: "turn-off-approvals", label: "Turn off approvals for risky tools", patch: { askBeforeRiskyTools: false } };
  return {
    strategy,
    message:
      input.gate === "explicit"
        ? "Code Action runs its tools inside a sandbox, past the approval gate, so it cannot honor your approval policy. Pick another strategy, or change the policy in the approval settings."
        : "Code Action runs its tools inside a sandbox, past the approval gate, so it cannot ask before risky tools. Pick another strategy, or turn off approvals for this agent.",
    resolutions: input.gate === "explicit" ? [switchTo] : [switchTo, turnOff],
  };
}

/**
 * The line to show when a run died on the framework's own refusal text, so a mid-run failure
 * reads the same as the up-front note. `undefined` for any other error.
 */
export function strategyConflictLineOf(error: string | undefined): string | undefined {
  if (!error || !/code-action cannot honor \.withApprovalPolicy/.test(error)) return undefined;
  return "Code Action cannot run with an approval gate. Pick another strategy, or turn off approvals for this agent.";
}
