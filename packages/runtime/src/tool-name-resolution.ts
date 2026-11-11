/**
 * Resolve tool-name lists (`allowedTools`, `requiredTools`, contract tool
 * names) the way `builtins` resolves: a toolset alias (`git`, `web`) or a
 * removed CLI name (`gh-cli`) becomes its concrete tools (`shell-execute`,
 * `web-search` + `http-get`).
 *
 * A name the agent registers itself (a custom or agent tool) stays literal:
 * `allowedTools: ["web"]` with a custom tool named `web` means that tool, not
 * the `web` toolset. MCP tools never collide: they are named `server/tool`.
 *
 * Shared by the builder (config construction, build-time checks) and the
 * engine (pre-loop, where the registered names are known), so both read a
 * name the same way.
 */
import { resolveBuiltinSelection } from "@reactive-agents/tools";

const NO_NAMES: ReadonlySet<string> = new Set();

/**
 * `names` with every alias / removed CLI name expanded, except names in
 * `ownToolNames`, which stay as written. Deduplicated, order kept. Idempotent.
 * `undefined` stays `undefined`.
 */
export const resolveToolNameList = (
  names: readonly string[] | undefined,
  ownToolNames: ReadonlySet<string> = NO_NAMES,
): readonly string[] | undefined => {
  if (names === undefined) return undefined;
  const out = new Set<string>();
  for (const name of names) {
    if (ownToolNames.has(name)) out.add(name);
    else for (const n of resolveBuiltinSelection([name]).names) out.add(n);
  }
  return [...out];
};

/**
 * A `requiredTools` config with its `tools` list resolved by
 * {@link resolveToolNameList}; other fields unchanged.
 */
export const resolveRequiredToolNames = <C extends { readonly tools?: readonly string[] }>(
  config: C | undefined,
  ownToolNames: ReadonlySet<string> = NO_NAMES,
): C | undefined =>
  config?.tools === undefined ? config : { ...config, tools: resolveToolNameList(config.tools, ownToolNames) };
