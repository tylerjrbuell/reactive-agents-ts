import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CAUSE_ATTRIBUTION, TURN_LEVEL_REASONS } from "../src/taxonomy.js";

// Drift pin: the `rax diagnose attribute` Reasons table in the CLI reference must
// list every turn-level attribution reason, in rule order, and nothing else; the
// "(failure cause)" row must name every reason CAUSE_ATTRIBUTION maps to.

const CLI_DOC = resolve(import.meta.dir, "../../../apps/docs/src/content/docs/reference/cli.md");

/** Rows of the table that follows "Reasons, first match wins:", as [first cell, second cell]. */
function reasonsTable(): readonly (readonly [string, string])[] {
  const lines = readFileSync(CLI_DOC, "utf8").split("\n");
  const start = lines.findIndex((l) => l.includes("Reasons, first match wins:"));
  if (start < 0) throw new Error("cli.md: no 'Reasons, first match wins:' table");
  const rows: (readonly [string, string])[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" && rows.length > 0) break;
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells[0] === "Reason" || /^-+$/.test(cells[0] ?? "")) continue;
    rows.push([cells[0] ?? "", cells.slice(1).join("|")]);
  }
  return rows;
}

/** `owner:{a, b}` groups and plain `owner:id` spans in a cell, expanded to reasons. */
const reasonsIn = (cell: string): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const [, span] of cell.matchAll(/`([^`]+)`/g)) {
    const group = /^([a-z]+):\{([^}]+)\}$/.exec(span!);
    if (group) for (const id of group[2]!.split(",")) out.add(`${group[1]}:${id.trim()}`);
    else if (/^[a-z]+:[a-z-]+$/.test(span!)) out.add(span!);
  }
  return out;
};

describe("cli.md attribution Reasons table", () => {
  const rows = reasonsTable();
  const named = rows.flatMap(([c]) => {
    const m = /^`([^`]+)`$/.exec(c);
    return m && m[1] !== "unattributed" ? [m[1]!] : [];
  });

  it("lists every turn-level reason in rule order, and no other", () => {
    expect(named).toEqual([...TURN_LEVEL_REASONS]);
  });

  it("the (failure cause) row names every reason CAUSE_ATTRIBUTION maps to", () => {
    const row = rows.find(([c]) => c === "(failure cause)");
    expect(row).toBeDefined();
    const inRow = reasonsIn(row![1]);
    const mapped = [...new Set(Object.values(CAUSE_ATTRIBUTION))].filter((r) => r !== "unattributed");
    expect(mapped.filter((r) => !inRow.has(r))).toEqual([]);
    expect([...inRow].filter((r) => !mapped.includes(r as (typeof mapped)[number]))).toEqual([]);
  });

  it("ends with the unattributed row", () => {
    expect(rows.at(-1)?.[0]).toBe("`unattributed`");
  });
});
