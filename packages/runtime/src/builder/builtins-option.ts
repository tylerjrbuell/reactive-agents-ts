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
import { BUILTIN_TOOL_NAMES, BUILTIN_TOOLSET_ALIASES } from "@reactive-agents/tools";
import { ToolsOptionError } from "../errors.js";
import type { ToolsOptions } from "./types.js";

const ALL_TOKENS: ReadonlySet<string> = new Set(["*", "all"]);

/** Whether `name` resolves to at least one built-in (alias, all-token or tool name). */
export const isKnownBuiltinName = (name: string): boolean => {
  const token = name.toLowerCase();
  return (
    ALL_TOKENS.has(token) ||
    Object.prototype.hasOwnProperty.call(BUILTIN_TOOLSET_ALIASES, token) ||
    BUILTIN_TOOL_NAMES.has(name)
  );
};

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
