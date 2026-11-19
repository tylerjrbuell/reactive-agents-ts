/**
 * A strategy that cannot work with an approval gate, caught before a run starts.
 *
 * Code Action runs its tool calls inside a sandbox worker, past the approval gate, so the
 * framework refuses (loudly, mid-run) to start it when its policy gates a tool the sandbox can
 * call. WHETHER that holds is the framework's call (`codeActionApprovalConflict` in
 * `@reactive-agents/reasoning`); ui-core cannot import it, so the server runs it and sends the
 * result, and this module only turns that result into a friendly message and the ways out.
 * The policy is never dropped silently: each resolution is a change the person chooses.
 */

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
  /** The tools the strategy can call that the approval policy gates (sorted). Empty when only a `requireFor` rule refuses. */
  readonly gatedTools: readonly string[];
  readonly resolutions: readonly ConflictResolution[];
}

/**
 * The framework's verdict (`CodeActionApprovalConflict`, same field names) plus the strategy and
 * how the gate was set. `refuse` is the framework's answer; nothing here re-derives it.
 */
export interface StrategyApprovalInput {
  readonly strategy: string;
  readonly gate: ApprovalGate;
  /** The framework's `refuse`: when false there is no conflict. */
  readonly refuse: boolean;
  /** The framework's `gatedCallable`. */
  readonly gatedCallable: readonly string[];
  /** The framework's `requireFor`. */
  readonly requireFor?: boolean;
}

/** `ApprovalGate` from the config fields a body or draft carries. */
export function approvalGateOf(cfg: { readonly hasExplicitPolicy: boolean; readonly askBeforeRiskyTools?: unknown }): ApprovalGate {
  if (cfg.hasExplicitPolicy) return "explicit";
  return cfg.askBeforeRiskyTools === false ? "none" : "default";
}

/**
 * The friendly conflict for the framework's verdict, or `undefined` when it does not refuse.
 * An explicit policy offers only a strategy switch (dropping rules the person wrote is their call,
 * made in the approvals settings); the default gate also offers turning approvals off.
 */
export function strategyApprovalConflictOf(input: StrategyApprovalInput): StrategyApprovalConflict | undefined {
  if (!input.refuse) return undefined;
  const switchTo: ConflictResolution = { id: "switch-strategy", label: "Use the reactive strategy", patch: { strategy: "reactive" } };
  const turnOff: ConflictResolution = { id: "turn-off-approvals", label: "Turn off approvals for risky tools", patch: { askBeforeRiskyTools: false } };
  const names = input.gatedCallable.join(", ");
  const explicit = input.gate === "explicit";
  const subject = names !== "" ? names : "some tool calls";
  return {
    strategy: input.strategy,
    gatedTools: [...input.gatedCallable],
    message: explicit
      ? `Code Action runs its tools inside a sandbox, past the approval gate, so it cannot honor your approval policy for ${subject}. Pick another strategy, or take ${names !== "" ? names : "those rules"} out of the approval settings.`
      : `Code Action runs its tools inside a sandbox, past the approval gate, so it cannot ask before ${subject}. Pick another strategy, or turn off approvals for this agent.`,
    resolutions: explicit ? [switchTo] : [switchTo, turnOff],
  };
}

/**
 * The line to show when a run died on the framework's own refusal text, so a mid-run failure
 * reads the same as the up-front note, naming the gated tools when the message lists them.
 * `undefined` for any other error.
 */
export function strategyConflictLineOf(error: string | undefined): string | undefined {
  if (!error || !/code-action cannot honor \.withApprovalPolicy/.test(error)) return undefined;
  const names = /gated tool\(s\) ([^;]+?)(?:;|, and its tool calls)/.exec(error)?.[1]?.trim();
  return names
    ? `Code Action cannot run with approval on ${names}. Pick another strategy, or turn off approval for ${names.includes(",") ? "them" : "it"}.`
    : "Code Action cannot run with an approval gate. Pick another strategy, or turn off approvals for this agent.";
}
