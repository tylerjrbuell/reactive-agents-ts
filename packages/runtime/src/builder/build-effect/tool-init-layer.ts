/**
 * Tool init layer composition.
 *
 * Builds the side-effect-only layer that registers MCP servers,
 * custom tools, terminal tool, and agent-tool registrations into the
 * ToolService instance shared with the execution engine. Uses
 * `Layer.effectDiscard(...).pipe(Layer.provide(baseRuntime))` so
 * Effect's reference-identity memoization guarantees the engine and
 * the init effect see the same ToolService instance.
 *
 * Captures the resolved ToolService back to the caller via a setter
 * callback (`onToolServiceResolved`) so spawn-agent handlers can
 * proxy parent MCP tools without duplicating connections.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, Layer } from "effect";
import type { Context } from "effect";
import * as path from "node:path";
import { getRunSlot } from "@reactive-agents/core/internal/run-scope";
import { fileRootSlot } from "@reactive-agents/tools/internal/run-slots";
import { scopedShellConfig } from "@reactive-agents/tools";
import type {
  MCPServer,
  ShellExecuteConfig,
  ShellToolSurface,
  ToolDefinition,
} from "@reactive-agents/tools";
import type { ToolService as ToolServiceTag } from "@reactive-agents/tools";
import type { MCPServerConfig } from "../../runtime.js";
import type { ToolsOptions } from "../types.js";

/** Resolved ToolService interface (the second type parameter of the Tag). */
type ToolService = Context.Tag.Service<typeof ToolServiceTag>;

/** Registration entry — `(definition, handler)` pair for ToolService.register. */
export interface ToolInitRegistration {
  readonly def: ToolDefinition;
  readonly handler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, Error>;
}

type ShellHandler = (args: Record<string, unknown>) => Effect.Effect<unknown, Error>;

/**
 * `shell-execute` bound to the run's working directory. The run's file root
 * (`.withTools({ workspace })`, `run(task, { workspace })` or an ambient
 * `withFileRoot()`) is read at call time, so the shell and the file tools
 * share one root:
 *
 * - no root bound, `unrootedInHostCwd` and no `config.cwd`: the shell runs in
 *   `process.cwd()`, read at call time (a scoped preset without the terminal:
 *   the removed git-cli/gh-cli tools ran in the host process directory).
 * - no root bound otherwise: the configured handler, unchanged (its `cwd`,
 *   else a fresh /tmp sandbox dir).
 * - root, no `config.cwd`: the shell runs in the root.
 * - root and `config.cwd`: the cwd resolves against the root and must stay
 *   inside it; one that escapes is refused, unless `allowUnsafeCwd` is set
 *   (then it runs there).
 *
 * One handler per distinct directory, built on first use.
 */
export const runRootShellHandler = (
  factory: (config?: ShellExecuteConfig) => ShellHandler,
  config: ShellExecuteConfig | undefined,
  unrootedInHostCwd = false,
): ShellHandler => {
  const unrooted = factory(config);
  const byDir = new Map<string, ShellHandler>();
  const inDir = (dir: string): ShellHandler => {
    const existing = byDir.get(dir);
    if (existing !== undefined) return existing;
    const made = factory({ ...config, cwd: dir, allowUnsafeCwd: true });
    byDir.set(dir, made);
    return made;
  };
  return (args) =>
    Effect.flatMap(getRunSlot(fileRootSlot), (root) => {
      if (root === undefined) {
        if (unrootedInHostCwd && config?.cwd === undefined) return inDir(process.cwd())(args);
        return unrooted(args);
      }
      if (config?.cwd === undefined) return inDir(root)(args);
      const dir = path.resolve(root, config.cwd);
      const rel = path.relative(root, dir);
      const inside = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
      if (inside || config.allowUnsafeCwd === true) return inDir(dir)(args);
      return Effect.succeed({
        executed: false,
        success: false,
        error: `Working directory '${dir}' is outside the workspace '${root}'. Set terminal.allowUnsafeCwd to override.`,
      });
    });
};

type ScopedShellToolFor = (
  programs: readonly string[],
  base?: ShellExecuteConfig,
  surface?: ShellToolSurface,
) => ToolDefinition;

/** The one `shell-execute` an agent registers: its definition and handler config. */
export interface ShellRegistration {
  readonly definition: ToolDefinition;
  readonly config: ShellExecuteConfig | undefined;
  /**
   * With no workspace bound, run in `process.cwd()` instead of a /tmp sandbox.
   * True only for a scoped preset without the terminal (parity with the
   * removed CLI wrappers); the terminal keeps its own cwd rules.
   */
  readonly unrootedInHostCwd: boolean;
}

/**
 * Decide the agent's single `shell-execute`. Pure.
 *
 * - `terminal` set: the terminal shell, with its own approval/risk flags.
 *   Preset programs (`shellPrograms`) are added to its `additionalCommands`,
 *   so one tool runs both; `inheritGitConfig` defaults on when git is allowed.
 * - no terminal, `shellPrograms` non-empty: `shell-execute` scoped to exactly
 *   those programs (`scopedShellToolFor`; the handler config is the same
 *   allow-list via `scopedShellConfig`). With no workspace it runs in the host
 *   process cwd (`unrootedInHostCwd`), as the removed CLI wrappers did.
 * - neither: `undefined`, no shell.
 *
 * `allowedPrograms` (`allowedShellPrograms`: `allowedTools` names a preset but
 * not `shell-execute`) narrows either shell to exactly those programs. The
 * terminal keeps its sandbox settings and its own approval/risk flags.
 */
export const resolveShellRegistration = (
  terminal: boolean | ShellExecuteConfig | undefined,
  shellPrograms: readonly string[],
  scopedShellToolFor: ScopedShellToolFor,
  shellExecuteToolFor: (config?: ShellExecuteConfig, surface?: ShellToolSurface) => ToolDefinition,
  allowedPrograms?: readonly string[],
): ShellRegistration | undefined => {
  const surface: ShellToolSurface = { runWorkspace: true };
  if (terminal) {
    const base = terminal === true ? undefined : terminal;
    if (allowedPrograms !== undefined) {
      const config = scopedShellConfig(allowedPrograms, base);
      return { definition: shellExecuteToolFor(config, surface), config, unrootedInHostCwd: false };
    }
    if (shellPrograms.length === 0) {
      return { definition: shellExecuteToolFor(base, surface), config: base, unrootedInHostCwd: false };
    }
    const additionalCommands = [...new Set([...(base?.additionalCommands ?? []), ...shellPrograms])];
    // The terminal definition keeps its own approval/risk flags (a full shell
    // is not downgraded to the preset's). git reads the user's git config only
    // when git is allowed, as the scoped preset does; an explicit value wins.
    const config: ShellExecuteConfig = {
      ...base,
      additionalCommands,
      inheritGitConfig: base?.inheritGitConfig ?? additionalCommands.includes("git"),
    };
    return { definition: shellExecuteToolFor(config, surface), config, unrootedInHostCwd: false };
  }
  if (shellPrograms.length === 0) return undefined;
  const programs = allowedPrograms ?? shellPrograms;
  return {
    // The description must match the handler: unrooted, it runs in process.cwd().
    definition: scopedShellToolFor(programs, undefined, { ...surface, hostCwdWhenUnrooted: true }),
    config: scopedShellConfig(programs),
    unrootedInHostCwd: true,
  };
};

/** Inputs needed to compose the init layer. */
export interface ToolInitLayerDeps {
  /** Dynamically imported `@reactive-agents/tools` module (provides ToolService Tag). */
  readonly toolsMod: {
    readonly ToolService: typeof ToolServiceTag;
  };
  readonly mcpServers: readonly MCPServerConfig[];
  readonly toolsOptions: ToolsOptions | undefined;
  readonly registrations: readonly ToolInitRegistration[];
  /**
   * Builds the `shell-execute` definition from the resolved terminal config.
   * The description is what the model reads about where commands run, so it
   * is built per config (`runWorkspace: true`: the handler below runs in the
   * run's workspace when one is bound), never a static default.
   */
  readonly shellExecuteToolFor: (
    config?: ShellExecuteConfig,
    surface?: ShellToolSurface,
  ) => ToolDefinition;
  /** Builds the scoped `shell-execute` definition (`@reactive-agents/tools`). */
  readonly scopedShellToolFor: ScopedShellToolFor;
  /**
   * Programs a scoped `shell-execute` must allow, from
   * `builtinSelectionFor(...).shellPrograms`. Empty or absent: no preset.
   */
  readonly shellPrograms?: readonly string[];
  /**
   * Programs `allowedTools` limits the shell to (`allowedShellPrograms`).
   * Absent: the shell is not narrowed.
   */
  readonly allowedShellPrograms?: readonly string[];
  readonly shellExecuteHandler: (
    config?: ShellExecuteConfig,
  ) => (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, Error>;
  /** Called when the ToolService is resolved inside the init effect, so the
   *  caller can capture it for sub-agent MCP proxying. */
  readonly onToolServiceResolved: (ts: ToolService) => void;
}

/**
 * Build the side-effect-only ToolService init layer.
 *
 * Runs an `Effect.gen` that yields `ToolService` from the surrounding
 * runtime, then connects MCP servers, registers custom tools, the
 * terminal tool (if enabled), and finally all agent-tool registrations.
 * Captures the resolved instance via `onToolServiceResolved`.
 *
 * Returned layer is `Layer.effectDiscard(initEffect).pipe(Layer.provide(baseRuntime))`
 * — same instance as engine via reference-identity memoization.
 */
export const buildToolInitLayer = (
  baseRuntime: Layer.Layer<unknown, unknown, unknown>,
  deps: ToolInitLayerDeps,
): Layer.Layer<never, unknown, unknown> => {
  const {
    toolsMod,
    mcpServers,
    toolsOptions,
    registrations,
    shellExecuteToolFor,
    scopedShellToolFor,
    shellExecuteHandler,
    onToolServiceResolved,
  } = deps;
  const shellPrograms = deps.shellPrograms ?? [];

  /**
   * Adapt a handler's `Error` channel to the `ToolExecutionError` channel that
   * `ToolService.register` expects. Errors flow through unchanged at runtime —
   * the cast only widens the static signature so the registration payload
   * matches the Tag's declared type without `(ts as any)`.
   */
  type RegisterParams = Parameters<ToolService["register"]>;
  const adaptHandler = (
    handler: (
      args: Record<string, unknown>,
    ) => Effect.Effect<unknown, Error>,
  ): RegisterParams[1] =>
    handler as unknown as RegisterParams[1];

  const inferMcpTransport = (
    config: MCPServerConfig,
  ): MCPServer["transport"] => {
    if (config.transport) return config.transport;
    if (config.command) return "stdio";
    if (config.endpoint) {
      try {
        const pathname =
          new URL(config.endpoint).pathname.toLowerCase().replace(/\/+$/, "") ||
          "/";
        return pathname === "/mcp" || pathname.endsWith("/mcp")
          ? "streamable-http"
          : "sse";
      } catch {
        return "sse";
      }
    }
    return "stdio";
  };

  const initEffect = Effect.gen(function* () {
    const ts: ToolService = yield* toolsMod.ToolService;
    // Connect MCP servers inside the managed runtime scope so the engine's
    // ToolService and the MCP-connected ToolService are the same instance.
    for (const mcp of mcpServers) {
      yield* ts.connectMCPServer({
        ...mcp,
        transport: inferMcpTransport(mcp),
      });
    }
    // Register custom tools
    if (toolsOptions?.tools) {
      for (const tool of toolsOptions.tools) {
        yield* ts.register(tool.definition, adaptHandler(tool.handler));
      }
    }
    // Register shell-execute: the terminal, or a scoped shell for a preset
    // (`builtins: ["git"]`) or removed CLI name (`gh-cli`). Never both: with
    // the terminal on, the preset's programs join its additionalCommands.
    const shell = resolveShellRegistration(
      toolsOptions?.terminal,
      shellPrograms,
      scopedShellToolFor,
      shellExecuteToolFor,
      deps.allowedShellPrograms,
    );
    const hasCustomShellExecute = (toolsOptions?.tools ?? []).some(
      (tool: { readonly definition: ToolDefinition }) =>
        tool.definition.name === "shell-execute",
    );
    if (shell !== undefined && !hasCustomShellExecute) {
      // runWorkspace: runRootShellHandler runs in the run's workspace when bound,
      // so a scoped git shell sees the repo, not a /tmp sandbox.
      yield* ts.register(
        shell.definition,
        adaptHandler(runRootShellHandler(shellExecuteHandler, shell.config, shell.unrootedInHostCwd)),
      );
    }
    // Capture parent ToolService ref so spawn-agent can proxy MCP tools
    onToolServiceResolved(ts);
    // Register agent tools
    for (const { def, handler } of registrations) {
      yield* ts.register(def, adaptHandler(handler));
    }
  });

  // Layer.effectDiscard wraps the init as a side-effect layer (no service output).
  // Layer.provide(baseRuntime) satisfies the ToolService requirement.
  // Effect memoizes baseRuntime by reference so both the engine and the init
  // effect share the same ToolService instance.
  return Layer.effectDiscard(initEffect).pipe(Layer.provide(baseRuntime));
};
