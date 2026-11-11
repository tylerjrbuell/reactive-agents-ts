/**
 * The `builtins` option of `.withTools()`: one namespace for every spelling.
 *
 * `builtins: "<name>"` is sugar for `builtins: ["<name>"]`. A name is
 * resolved by `resolveBuiltinNames` (`@reactive-agents/tools`) against the
 * toolset aliases in `BUILTIN_TOOLSET_ALIASES`, `"*"` / `"all"`, or an exact
 * built-in tool name, the same way array entries already are. The runtime
 * owns no member lists of its own, so a name means the same thing in both
 * spellings (parent decision 2026-11-06 on spec §12.8 Q1).
 *
 * The only difference between the spellings is validation: a scalar name that
 * is not an alias, an all-token or a built-in tool name is a
 * `ToolsOptionError` at the wither. Array entries keep their historical
 * behavior (an unmatched entry is a literal name that matches nothing).
 */
import { Either } from "effect";
import {
  BUILTIN_TOOL_NAMES,
  BUILTIN_TOOLSET_ALIASES,
  DEPRECATED_CLI_TOOLS,
  REMOVED_BUILTIN_NAMES,
  resolveBuiltinSelection,
} from "@reactive-agents/tools";
import type { BuiltinSelection } from "@reactive-agents/tools";
import { ToolsOptionError } from "../errors.js";
import type { ToolsOptions } from "./types.js";

const ALL_TOKENS: ReadonlySet<string> = new Set(["*", "all"]);

/**
 * Whether `name` resolves to at least one built-in (alias, all-token or tool
 * name). A removed name counts too, so the scalar spelling warns like the
 * array one: `gh-cli` / `git-cli` resolve to a scoped `shell-execute`;
 * `workspace` / `gws-cli` select no tool. Both report a deprecation.
 */
export const isKnownBuiltinName = (name: string): boolean => {
  const token = name.toLowerCase();
  return (
    ALL_TOKENS.has(token) ||
    Object.prototype.hasOwnProperty.call(BUILTIN_TOOLSET_ALIASES, token) ||
    Object.prototype.hasOwnProperty.call(DEPRECATED_CLI_TOOLS, token) ||
    Object.prototype.hasOwnProperty.call(REMOVED_BUILTIN_NAMES, token) ||
    BUILTIN_TOOL_NAMES.has(name)
  );
};

/**
 * Names of the tools the agent registers itself, known at build time: custom
 * tools (`.withTools({ tools })`) and agent tools (`.withAgentTool`). In
 * `allowedTools` / `requiredTools` these stay literal, never read as aliases.
 */
export const ownToolNames = (
  toolsOptions: ToolsOptions | undefined,
  agentToolNames: readonly string[] = [],
): ReadonlySet<string> =>
  new Set([...(toolsOptions?.tools ?? []).map((t) => t.definition.name), ...agentToolNames]);

/**
 * The built-in selection one agent's tool options imply: the `builtins` list
 * plus every `allowedTools` and `requiredTools` name, resolved by the
 * tools-owned `resolveBuiltinSelection`. `builtins: true` adds the capability
 * built-ins only; like `"all"`, it never grants a shell. A list name that is
 * one of the agent's own tools (`own`, default: its custom tools) is not an
 * alias and selects nothing here.
 *
 * `shellPrograms` non-empty means the agent gets a `shell-execute` scoped to
 * those programs (or, with `terminal` on, those programs added to the
 * terminal). `deprecations` lists removed names that were requested.
 */
export const builtinSelectionFor = (
  toolsOptions: ToolsOptions | undefined,
  requiredTools?: readonly string[],
  own: ReadonlySet<string> = ownToolNames(toolsOptions),
): BuiltinSelection => {
  const builtins = builtinsAsList(toolsOptions?.builtins);
  const notOwn = (n: string): boolean => !own.has(n);
  return resolveBuiltinSelection([
    ...(Array.isArray(builtins) ? builtins : []),
    ...(toolsOptions?.allowedTools ?? []).filter(notOwn),
    ...(requiredTools ?? []).filter(notOwn),
  ]);
};

/**
 * The programs `allowedTools` limits the agent's one `shell-execute` to, or
 * `undefined` when it does not limit the shell.
 *
 * An allow-list never widens the shell. `allowedTools: ["git"]` resolves to
 * `shell-execute` for the name filter, so without this the terminal
 * (`terminal: true`) would pass whole, and `builtins: ["git"]` plus
 * `allowedTools: ["gh-cli"]` would keep git. When the list names a shell preset
 * or removed CLI name (`git`, `gh-cli`) but not `shell-execute` itself, the
 * shell runs exactly those programs. Naming `shell-execute` keeps the shell as
 * registered. The agent's own tool names (`own`) are not aliases.
 */
export const allowedShellPrograms = (
  toolsOptions: ToolsOptions | undefined,
  own: ReadonlySet<string> = ownToolNames(toolsOptions),
): readonly string[] | undefined => {
  const allowed = (toolsOptions?.allowedTools ?? []).filter((n) => !own.has(n));
  if (allowed.length === 0 || allowed.includes("shell-execute")) return undefined;
  const programs = resolveBuiltinSelection(allowed).shellPrograms;
  return programs.length > 0 ? programs : undefined;
};

/**
 * One build warning per removed CLI tool name in the selection (deduplicated:
 * the same name in `builtins` and `allowedTools` warns once).
 */
export const builtinDeprecationWarnings = (selection: BuiltinSelection): readonly string[] => [
  ...new Set(selection.deprecations.map((d) => d.message)),
];

/**
 * The `builtins` value in the `boolean | string[]` shape every reader uses:
 * a scalar name becomes a one-entry list; booleans and arrays pass through.
 */
export const builtinsAsList = (
  builtins: ToolsOptions["builtins"],
): boolean | readonly string[] | undefined => (typeof builtins === "string" ? [builtins] : builtins);

/**
 * Validate and normalize `.withTools({ builtins })`. A scalar name that
 * resolves to no built-in fails with `ToolsOptionError` naming the valid
 * names; everything else is {@link builtinsAsList}.
 */
export const normalizeBuiltinsOption = (
  builtins: ToolsOptions["builtins"],
): Either.Either<boolean | readonly string[] | undefined, ToolsOptionError> => {
  if (typeof builtins === "string" && !isKnownBuiltinName(builtins)) {
    return Either.left(
      new ToolsOptionError({
        option: "builtins",
        message:
          `withTools({ builtins: "${builtins}" }): unknown name. Use a toolset ` +
          `(${Object.keys(BUILTIN_TOOLSET_ALIASES).map((a) => `"${a}"`).join(", ")}), ` +
          `"all", a built-in tool name, true, or an array of names.`,
      }),
    );
  }
  return Either.right(builtinsAsList(builtins));
};

/**
 * The fix line of the zero-capability-tools notice, rendered from the live
 * alias table so it never names a toolset or member the run lacks.
 */
export const builtinsFixHint = (): string => {
  const shown = ["read", "research"] as const;
  const toolsets = shown.map((a) => `builtins: "${a}" (${BUILTIN_TOOLSET_ALIASES[a].join(", ")})`);
  return [...toolsets, `a list such as builtins: ["file-read"]`, `or your own tools: [...]`].join(", ");
};
