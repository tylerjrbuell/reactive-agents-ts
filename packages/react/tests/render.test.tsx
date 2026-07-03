import { describe, expect, test, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { render } from "@testing-library/react";
import * as React from "react";
import { AgentSurface, uiTreeSchema, type UiNode, type ComponentRegistry } from "../src/components/render/AgentSurface.js";

beforeAll(() => {
  if (!globalThis.document) GlobalRegistrator.register();
});

const registry: ComponentRegistry = {
  card: ({ children }) => <section data-ra-node="card">{children}</section>,
  text: ({ node }) => <p data-ra-node="text">{String(node.props?.value ?? "")}</p>,
};

describe("Render", () => {
  test("uiTreeSchema constrains type to registry keys", () => {
    const schema = uiTreeSchema(registry);
    const json = JSON.stringify(schema);
    expect(json).toContain("card");
    expect(json).toContain("text");
  });

  test("AgentSurface renders a registered tree progressively", () => {
    const tree: UiNode = { type: "card", children: [{ type: "text", props: { value: "hi" } }] };
    const { getByText } = render(<AgentSurface tree={tree} registry={registry} />);
    expect(getByText("hi")).toBeDefined();
  });

  test("unknown node type renders a safe placeholder, not markup", () => {
    const tree = { type: "script", props: { value: "<img onerror=alert(1)>" } };
    const { container } = render(<AgentSurface tree={tree} registry={registry} />);
    expect(container.querySelector("[data-ra-unknown]")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  test("partial/incomplete tree does not throw", () => {
    const partial = { type: "card", children: [{ type: "text" }, {}] };
    const { container } = render(<AgentSurface tree={partial} registry={registry} />);
    expect(container).toBeDefined();
  });
});
