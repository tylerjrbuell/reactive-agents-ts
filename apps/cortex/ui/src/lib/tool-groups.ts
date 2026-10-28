/** Repeated calls of one tool collapse to a single chip (`name ×n`), keeping first-seen order and a unique key. */
export function groupToolNames(names: readonly string[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}
