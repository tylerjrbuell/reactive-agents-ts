/** Context key: set inside the Lab builder, where sections render flat (always open, no collapse head). */
export const ACP_FLAT_CONTEXT = "cortex:agent-config-flat";

/** The flat context: whether the current nav entry shows one section (its heading then repeats the page's, so it is visually hidden). */
export interface AcpFlatContext {
  readonly single: boolean;
}
