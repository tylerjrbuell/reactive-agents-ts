import { writable, derived } from "svelte/store";

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly shortcut?: string;
  readonly action: () => void | Promise<void>;
  readonly keywords?: string[];
}

const registered = writable<Command[]>([]);

export const commandPaletteQuery = writable("");
export const commandPaletteOpen = writable(false);

export const commandPaletteFiltered = derived([registered, commandPaletteQuery], ([$commands, $q]) => {
  if (!$q.trim()) return $commands.slice(0, 12);
  const q = $q.toLowerCase();
  return $commands
    .filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q) ||
        c.keywords?.some((k) => k.toLowerCase().includes(q)),
    )
    .slice(0, 12);
});

export const commandPalette = {
  open: () => {
    commandPaletteOpen.set(true);
    commandPaletteQuery.set("");
  },
  close: () => {
    commandPaletteOpen.set(false);
    commandPaletteQuery.set("");
  },
  toggle: () => {
    commandPaletteOpen.update((v) => !v);
    commandPaletteQuery.set("");
  },
  register: (commands: Command[]) => {
    registered.update((existing) => {
      const ids = new Set(commands.map((c) => c.id));
      return [...existing.filter((c) => !ids.has(c.id)), ...commands];
    });
    return () => {
      registered.update((existing) => existing.filter((c) => !commands.some((nc) => nc.id === c.id)));
    };
  },
};
