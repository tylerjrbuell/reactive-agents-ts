/** Authoring scanner: extract `{{token}}` names from every string field of a config object. */

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

export function scanTemplateVars(config: unknown): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const m of node.matchAll(TOKEN)) {
        const name = m[1]!;
        if (name.startsWith("secret.")) continue;
        if (!out.includes(name)) out.push(name);
      }
    } else if (Array.isArray(node)) {
      node.forEach(visit);
    } else if (node !== null && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach(visit);
    }
  };
  visit(config);
  return out;
}
