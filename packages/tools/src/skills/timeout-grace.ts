/**
 * Margin between a handler's own kill timeout and its definition `timeoutMs`.
 *
 * ToolService races every handler against the definition timeout. A handler
 * that kills its process at the same instant ties that race, and when the
 * outer race wins the handler's result (partial output, its own timeout
 * message) is dropped for a bare timeout error. Definitions therefore set
 * `timeoutMs` to the handler's kill time plus this margin.
 */
export const HANDLER_TIMEOUT_GRACE_MS = 2_000;

/** Kill timeout used by the CLI built-ins (git-cli, gh-cli, gws-cli). */
export const CLI_KILL_TIMEOUT_MS = 30_000;
