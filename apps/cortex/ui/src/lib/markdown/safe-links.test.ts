import { describe, expect, test } from "bun:test";
import { linkPolicy } from "./safe-links.js";

describe("linkPolicy", () => {
  test("http and https links open externally", () => {
    expect(linkPolicy("https://example.com/a?b=1")).toEqual({ href: "https://example.com/a?b=1", external: true });
    expect(linkPolicy("http://example.com")).toMatchObject({ external: true });
  });

  test("mailto and in-page anchors stay, not external", () => {
    expect(linkPolicy("mailto:a@b.com")).toEqual({ href: "mailto:a@b.com", external: false });
    expect(linkPolicy("#section")).toEqual({ href: "#section", external: false });
  });

  test("script, data and file schemes lose their href, including disguised ones", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "data:text/html,<script>1</script>", "file:///etc/passwd", "vbscript:x"]) {
      expect(linkPolicy(bad)).toEqual({ href: null, external: false });
    }
  });

  test("relative paths would navigate the desk: removed", () => {
    expect(linkPolicy("/api/runs")).toEqual({ href: null, external: false });
    expect(linkPolicy("../x")).toEqual({ href: null, external: false });
    expect(linkPolicy(null)).toEqual({ href: null, external: false });
  });
});
