import { resolveCanonical } from "@reactive-agents/llm-provider";
import { capabilitySourcePreflight } from "@reactive-agents/core";
import type {
  ContractCapability as Capability,
  TaskContract,
} from "@reactive-agents/core";

type ProviderName = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test" | "custom";

const PROVIDER_API_KEY_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  litellm: "OPENAI_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

const PROVIDER_MODEL_PREFIXES: Record<string, string[]> = {
  anthropic: ["claude"],
  openai: ["gpt", "o1", "o3", "chatgpt"],
  gemini: ["gemini"],
  ollama: [],
  litellm: [],
  test: ["test"],
};

const NO_KEY_PROVIDERS = new Set(["ollama", "test"]);

export interface BuildValidationResult {
  warnings: string[];
  errors: string[];
  resolvedModel: string;
}

/**
 * Optional task-contract inputs for `validateBuild`. When `contract` is set,
 * the build is also validated against the task's tool + capability floor
 * requirements (realization-plan P2 / Drift S7). The results merge into the
 * SAME `errors[]`/`warnings[]` arrays `validateBuild` already returns, so the
 * existing strict-throw path in `build()` enforces the contract — no parallel
 * enforcement path.
 */
export interface TaskContractValidationInput {
  /** The TaskContract declared via `ReactiveAgentBuilder.withContract()`. */
  readonly contract: TaskContract;
  /**
   * The statically-knowable set of tool names the agent will expose: custom
   * `tools[].definition.name` ∪ resolved builtins ∪ (`shell-execute` if
   * terminal enabled), already narrowed by `allowedTools` if set. Computed by
   * the builder (`builder/contract-tool-set.ts`).
   */
  readonly exposedToolNames: readonly string[];
  /**
   * Whether MCP servers are configured. When true, the exposed-tool set is
   * INCOMPLETE at build time (MCP tools are discovered at buildEffect connect
   * time), so a missing `required` tool is downgraded to a warning even under
   * strict — it cannot be verified statically (avoids false-positive throws on
   * valid MCP-backed production agents).
   */
  readonly hasMcpServers?: boolean;
}

/**
 * Validate a TaskContract against the agent's statically-knowable exposed-tool
 * set and the resolved model capability. Pushes into the provided
 * `errors[]`/`warnings[]` arrays — strict → error, non-strict → warning,
 * mirroring the existing capability-source honesty pattern.
 *
 *  - every `required` tool must be in the exposed set (downgraded to warning
 *    when MCP is configured — see {@link TaskContractValidationInput.hasMcpServers});
 *  - any `forbidden` tool present in the exposed set is an error/warning;
 *  - `modelFloor` (window / thinking / nativeFC) is checked against the
 *    already-resolved Capability (no re-resolution). When the capability is
 *    unavailable (test/custom provider, or no model), the floor cannot be
 *    enforced and is skipped — it does not crash.
 */
export function validateTaskContract(
  contract: TaskContract,
  exposedToolNames: readonly string[],
  resolvedCapability: Capability | undefined,
  hasMcpServers: boolean,
  strict: boolean,
  warnings: string[],
  errors: string[],
): void {
  const exposed = new Set(exposedToolNames);
  const push = (msg: string, demoteToWarning = false) => {
    if (strict && !demoteToWarning) errors.push(msg);
    else warnings.push(msg);
  };

  for (const req of contract.tools) {
    // `required` and `available` both demand the tool be EXPOSED to the LLM
    // (available's contract: "MUST be visible"). `toolsToExpose()` bundles both
    // for the same reason, so the build-time exposure check is identical.
    if (req.kind === "required" || req.kind === "available") {
      if (!exposed.has(req.name)) {
        if (hasMcpServers) {
          push(
            `Task contract ${req.kind === "required" ? "requires" : "expects available"} ` +
              `tool "${req.name}" but it is not in the statically-known ` +
              `exposed-tool set. MCP servers are configured, so it may be ` +
              `provided at connect time — cannot verify statically.`,
            /* demoteToWarning */ true,
          );
        } else {
          push(
            `Task contract ${req.kind === "required" ? "requires" : "expects available"} ` +
              `tool "${req.name}" but it is not exposed to the agent. Register it ` +
              `(e.g. withTools({ builtins: ["${req.name}"] }) or a custom tool) or ` +
              `remove the requirement.`,
          );
        }
      }
    } else if (req.kind === "forbidden") {
      if (exposed.has(req.name)) {
        push(
          `Task contract forbids tool "${req.name}" but it is exposed to the ` +
            `agent. Remove it from the agent's tool set or the contract.`,
        );
      }
    }
  }

  const floor = contract.modelFloor;
  if (floor && resolvedCapability) {
    if (
      typeof floor.window === "number" &&
      resolvedCapability.effectiveWindowChars < floor.window
    ) {
      push(
        `Task contract modelFloor.window (${floor.window} chars) exceeds the ` +
          `resolved model's effective window (${resolvedCapability.effectiveWindowChars} chars) ` +
          `for ${resolvedCapability.provider}/${resolvedCapability.model}.`,
      );
    }
    if (floor.thinking === true && !resolvedCapability.supports.thinking) {
      push(
        `Task contract modelFloor.thinking requires native thinking-mode, but ` +
          `${resolvedCapability.provider}/${resolvedCapability.model} does not support it.`,
      );
    }
    if (floor.nativeFC === true && resolvedCapability.dialect !== "native-fc") {
      push(
        `Task contract modelFloor.nativeFC requires native function-calling, but ` +
          `${resolvedCapability.provider}/${resolvedCapability.model} uses dialect ` +
          `"${resolvedCapability.dialect}".`,
      );
    }
  }
}

export function validateBuild(
  provider: ProviderName,
  model: string | undefined,
  defaultModel: string,
  strict: boolean,
  taskContract?: TaskContractValidationInput,
): BuildValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const resolvedModel = model ?? defaultModel;
  let resolvedCapability: Capability | undefined;

  if (!NO_KEY_PROVIDERS.has(provider)) {
    const keyName = PROVIDER_API_KEY_MAP[provider];
    if (keyName && !process.env[keyName]) {
      const msg = `Missing ${keyName} for provider "${provider}". Set it in your environment or .env file.`;
      if (strict) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  if (model && provider !== "ollama" && provider !== "litellm" && provider !== "test") {
    const prefixes = PROVIDER_MODEL_PREFIXES[provider] ?? [];
    if (prefixes.length > 0) {
      const modelLower = model.toLowerCase();
      const matches = prefixes.some((p) => modelLower.startsWith(p));
      if (!matches) {
        warnings.push(
          `Model "${model}" may not be compatible with provider "${provider}". ` +
            `Expected model prefix: ${prefixes.join(", ")}. ` +
            `The provider's default model will be used if this model is unavailable.`,
        );
      }
    }
  }

  // Capability-source honesty gate — runtime consumer of the canonical PreFlight
  // contract (`@reactive-agents/core` contracts/preflight.ts), shared with the
  // bench gate. When the canonical resolver finds no probe/cache/static-table
  // entry it returns a conservative 2048-ctx fallback that silently under-sizes
  // every downstream context budget (root cause of the 2026-06-02 claude-haiku-4-5
  // baseline regression). Surface it loudly — warning by default, error under
  // strictValidation — rather than running silently degraded (anti-mission #4).
  // `provider: "test"`/"custom" are exempt (no real capability to resolve).
  if (model && provider !== "test" && provider !== "custom") {
    const cap = resolveCanonical(provider, model);
    resolvedCapability = cap;
    const violation = capabilitySourcePreflight({
      provider,
      model,
      source: cap.source,
      recommendedNumCtx: cap.recommendedNumCtx,
    });
    if (violation) {
      const msg = `${violation.message} Build with strict validation to make this an error.`;
      if (strict) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  // Task-contract enforcement (realization-plan P2 / Drift S7). Reuses the
  // capability resolved above — no second resolution. Merges into the same
  // errors[]/warnings[] arrays so build()'s existing strict-throw enforces it.
  if (taskContract) {
    validateTaskContract(
      taskContract.contract,
      taskContract.exposedToolNames,
      resolvedCapability,
      taskContract.hasMcpServers ?? false,
      strict,
      warnings,
      errors,
    );
  }

  return { warnings, errors, resolvedModel };
}

/**
 * Pre-flight connection check for local providers (e.g. Ollama).
 * Verifies the service is reachable before building the agent.
 */
export async function validateProviderConnection(
  provider: ProviderName,
  ollamaEndpoint?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (provider === "ollama") {
    const endpoint = ollamaEndpoint ?? process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434";
    try {
      const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        return { ok: false, error: `Ollama returned HTTP ${res.status}. Is the service running at ${endpoint}?` };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: `Cannot connect to Ollama at ${endpoint}. Is the Ollama service running?\n  Start it with: ollama serve`,
      };
    }
  }
  return { ok: true };
}

export function logBuildInfo(provider: ProviderName, resolvedModel: string): void {
  const keyName = PROVIDER_API_KEY_MAP[provider];
  const hasKey = keyName ? !!process.env[keyName] : false;
  const keyDisplay =
    hasKey && keyName
      ? `${process.env[keyName]!.slice(0, 8)}...***`
      : NO_KEY_PROVIDERS.has(provider)
        ? "(not required)"
        : "(missing)";

  console.log(`✓ Provider: ${provider} | Model: ${resolvedModel} | API key: ${keyDisplay}`);
}
