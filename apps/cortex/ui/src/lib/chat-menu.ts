/** One row in the chat slash menu: a command, or a second-level choice for /model, /skills, … */
export type MenuItem = {
  key: string;
  icon: string;
  label: string;
  hint?: string;
  detail?: string;
  active?: boolean;
  /** Small icon after the label, e.g. the brain on thinking models (survives the "current" check mark). */
  badge?: string;
  run: () => void | Promise<void>;
  complete?: () => void;
};
