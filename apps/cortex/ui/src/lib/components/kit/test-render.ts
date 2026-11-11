/**
 * Test-only helper: server-render a `.svelte` component under `bun test` and
 * return its HTML, so kit components get real rendering tests without a DOM.
 *
 * Registers a Bun loader once that compiles `.svelte` files with the Svelte
 * compiler (`generate: "server"`). Kit components import each other with
 * relative paths, so no `$lib` alias resolution is needed here.
 */
import { plugin } from "bun";
import { readFileSync } from "node:fs";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { createRawSnippet, type Component, type Snippet } from "svelte";

let registered = false;

function registerSvelteLoader(): void {
  if (registered) return;
  registered = true;
  plugin({
    name: "svelte-ssr-test-loader",
    setup(build) {
      build.onLoad({ filter: /\.svelte$/ }, ({ path }) => {
        const source = readFileSync(path, "utf8");
        const out = compile(source, { filename: path, generate: "server", css: "injected" });
        return { contents: out.js.code, loader: "js" };
      });
    },
  });
}

/** Server-render `file` (absolute path to a `.svelte` file) with `props`; returns the body HTML. */
export async function renderComponent(
  file: string,
  props: Record<string, unknown> = {},
): Promise<string> {
  registerSvelteLoader();
  const mod = (await import(file)) as { default: Component<Record<string, unknown>> };
  const { body } = render(mod.default, { props });
  return body;
}

/** A snippet that renders `html` (one element), for `children` and other snippet props in tests. */
export function htmlSnippet(html: string): Snippet {
  return createRawSnippet(() => ({ render: () => html }));
}
