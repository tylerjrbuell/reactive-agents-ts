import { describe, it, expect } from "bun:test";

import {
  loadText,
  loadMarkdown,
  loadJSON,
  loadCSV,
  loadHTML,
  detectAndLoad,
} from "../../src/rag/loaders.js";

// ═══════════════════════════════════════════════════════════════════════
// loadText
// ═══════════════════════════════════════════════════════════════════════

describe("loadText", () => {
  it("should return chunks with correct metadata", () => {
    const content = "Hello world. This is a test document.";
    const chunks = loadText(content, "test.txt");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.metadata.source).toBe("test.txt");
    expect(chunks[0]!.metadata.format).toBe("text");
    expect(chunks[0]!.metadata.chunkIndex).toBe(0);
    expect(chunks[0]!.metadata.totalChunks).toBe(chunks.length);
  });

  it("should handle empty content", () => {
    const chunks = loadText("", "test.txt");
    expect(chunks).toEqual([]);
  });

  it("should handle whitespace-only content", () => {
    const chunks = loadText("   \n\n  ", "test.txt");
    expect(chunks).toEqual([]);
  });

  it("should chunk long documents into multiple pieces", () => {
    const content = Array(50).fill("This is a paragraph of reasonable length.").join("\n\n");
    const chunks = loadText(content, "long.txt", { maxChunkSize: 200 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.metadata.totalChunks).toBe(chunks.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// loadMarkdown
// ═══════════════════════════════════════════════════════════════════════

describe("loadMarkdown", () => {
  it("should extract title from first heading", () => {
    const content = "# My Document\n\nSome content here.\n\n## Section 2\n\nMore content.";
    const chunks = loadMarkdown(content, "doc.md");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.metadata.title).toBe("My Document");
    expect(chunks[0]!.metadata.format).toBe("markdown");
  });

  it("should use markdown-sections strategy by default", () => {
    const content = "# Title\n\nIntro paragraph.\n\n## Section A\n\nContent A.\n\n## Section B\n\nContent B.";
    const chunks = loadMarkdown(content, "doc.md");
    // Should split on headings
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("should handle markdown without headings", () => {
    const content = "Just some plain text without any headings.\n\nAnother paragraph.";
    const chunks = loadMarkdown(content, "doc.md");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.metadata.format).toBe("markdown");
  });

  it("should not set title when no heading is present", () => {
    const content = "No heading here, just text.";
    const chunks = loadMarkdown(content, "doc.md");
    expect(chunks[0]!.metadata.title).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// loadJSON
// ═══════════════════════════════════════════════════════════════════════

describe("loadJSON", () => {
  it("should handle JSON arrays", () => {
    const content = JSON.stringify([
      { name: "Alice", age: 30 },
      { name: "Bob", age: 25 },
      { name: "Charlie", age: 35 },
    ]);
    const chunks = loadJSON(content, "data.json");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.metadata.format).toBe("json");
  });

  it("should handle JSON objects", () => {
    const content = JSON.stringify({ key: "value", nested: { a: 1, b: 2 } });
    const chunks = loadJSON(content, "config.json");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.metadata.format).toBe("json");
  });

  it("should handle invalid JSON as text fallback", () => {
    const content = "this is not { valid json";
    const chunks = loadJSON(content, "bad.json");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // Falls back to text loading
  });

  it("should handle large JSON arrays by grouping items", () => {
    const items = Array(100).fill(null).map((_, i) => ({
      id: i,
      name: `Item ${i}`,
      description: "A".repeat(50),
    }));
    const chunks = loadJSON(JSON.stringify(items), "large.json", { maxChunkSize: 500 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("should handle empty JSON array", () => {
    const chunks = loadJSON("[]", "empty.json");
    expect(chunks).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// loadCSV
// ═══════════════════════════════════════════════════════════════════════

describe("loadCSV", () => {
  it("should include header in each chunk", () => {
    const content = "name,age,city\nAlice,30,NYC\nBob,25,LA\nCharlie,35,Chicago";
    const chunks = loadCSV(content, "data.csv");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.metadata.format).toBe("csv");
    // Each chunk should start with the header
    for (const chunk of chunks) {
      expect(chunk.content.startsWith("name,age,city")).toBe(true);
    }
  });

  it("should handle CSV with only header", () => {
    const content = "name,age,city";
    const chunks = loadCSV(content, "header-only.csv");
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.content).toBe("name,age,city");
  });

  it("should handle empty CSV", () => {
    const chunks = loadCSV("", "empty.csv");
    expect(chunks).toEqual([]);
  });

  it("should group rows into chunks respecting maxChunkSize", () => {
    const rows = Array(50).fill(null).map((_, i) => `item${i},${i},description${i}`);
    const content = "name,id,desc\n" + rows.join("\n");
    const chunks = loadCSV(content, "large.csv", { maxChunkSize: 200 });
    expect(chunks.length).toBeGreaterThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// loadHTML
// ═══════════════════════════════════════════════════════════════════════

describe("loadHTML", () => {
  it("should strip HTML tags", () => {
    const content = "<html><body><p>Hello <b>world</b></p></body></html>";
    const chunks = loadHTML(content, "page.html");
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks[0]!.content).not.toContain("<");
    expect(chunks[0]!.content).toContain("Hello");
    expect(chunks[0]!.content).toContain("world");
  });

  it("should extract title from <title> tag", () => {
    const content = "<html><head><title>My Page</title></head><body><p>Content</p></body></html>";
    const chunks = loadHTML(content, "page.html");
    expect(chunks[0]!.metadata.title).toBe("My Page");
    expect(chunks[0]!.metadata.format).toBe("html");
  });

  it("should remove script and style blocks", () => {
    const content = `
      <html>
        <script>alert('xss')</script>
        <style>.red { color: red; }</style>
        <body><p>Safe content</p></body>
      </html>
    `;
    const chunks = loadHTML(content, "page.html");
    const text = chunks.map((c) => c.content).join(" ");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color");
    expect(text).toContain("Safe content");
  });

  it("should decode HTML entities", () => {
    const content = "<p>A &amp; B &lt; C &gt; D &quot;E&quot; F&#39;s</p>";
    const chunks = loadHTML(content, "entities.html");
    const text = chunks[0]!.content;
    expect(text).toContain("A & B");
    expect(text).toContain("< C >");
    expect(text).toContain('"E"');
    expect(text).toContain("F's");
  });

  it("should handle empty HTML", () => {
    const content = "<html><body></body></html>";
    const chunks = loadHTML(content, "empty.html");
    expect(chunks).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// detectAndLoad
// ═══════════════════════════════════════════════════════════════════════

describe("detectAndLoad", () => {
  it("should detect markdown by file extension", () => {
    const chunks = detectAndLoad("# Title\n\nContent.", "readme.md");
    expect(chunks[0]!.metadata.format).toBe("markdown");
  });

  it("should detect JSON by file extension", () => {
    const chunks = detectAndLoad('{"key": "value"}', "data.json");
    expect(chunks[0]!.metadata.format).toBe("json");
  });

  it("should detect CSV by file extension", () => {
    const chunks = detectAndLoad("a,b,c\n1,2,3", "data.csv");
    expect(chunks[0]!.metadata.format).toBe("csv");
  });

  it("should detect HTML by file extension", () => {
    const chunks = detectAndLoad("<p>Hello</p>", "page.html");
    expect(chunks[0]!.metadata.format).toBe("html");
  });

  it("should detect text by .txt extension", () => {
    const chunks = detectAndLoad("plain text", "notes.txt");
    expect(chunks[0]!.metadata.format).toBe("text");
  });

  it("should detect JSON by content heuristic", () => {
    const chunks = detectAndLoad('{"name": "test"}', "unknown-file");
    expect(chunks[0]!.metadata.format).toBe("json");
  });

  it("should detect markdown by content heuristic (heading)", () => {
    const chunks = detectAndLoad("## Section Title\n\nSome content.", "unknown-file");
    expect(chunks[0]!.metadata.format).toBe("markdown");
  });

  it("should detect HTML by content heuristic", () => {
    const chunks = detectAndLoad("<!DOCTYPE html><html><body>Hello</body></html>", "unknown-file");
    expect(chunks[0]!.metadata.format).toBe("html");
  });

  it("should detect CSV by content heuristic", () => {
    const chunks = detectAndLoad("name,age,city\nAlice,30,NYC\nBob,25,LA", "unknown-file");
    expect(chunks[0]!.metadata.format).toBe("csv");
  });

  it("should fall back to text for unknown content", () => {
    const chunks = detectAndLoad("Just some random text without any structure", "unknown-file");
    expect(chunks[0]!.metadata.format).toBe("text");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// loadHTML — main-content extraction
// ═══════════════════════════════════════════════════════════════════════

const DOCS_CHROME = `<!doctype html><html><head><title>Code-Action Strategy | Reactive Agents</title>
<style>.x{color:red}</style><script>window.THEME_BOOT=1</script></head>
<body>
<a href="#_top">Skip to content</a>
<header class="header"><span>Reactive Agents</span><starlight-search><button>Search CtrlK Cancel</button></starlight-search>
<nav><a>Playground</a><a>GitHub</a><a>Discord</a></nav>
<select><option>Select theme</option><option>DarkLightAuto</option></select></header>
<aside class="sidebar"><nav><ul><li>Get Started</li><li>Introduction Install</li></ul></nav></aside>
<noscript>enable javascript please</noscript>
SIDEBAR_FALLBACK_MARKER`;

const DOCS_MAIN = `<main><article><h1 id="top">Code-Action Strategy</h1>
<h2>Overview<a class="anchor"><span class="sr-only">Section titled Overview</span></a></h2>
<p>The agent writes <code>TypeScript</code> &amp; runs it.</p>
<ul><li>First point</li><li>Second point</li></ul>
<pre><code>const x = 1;\nconsole.log(x);</code></pre>
<svg><text>ICON_TEXT</text></svg></article></main>
<footer><p>Edit page</p><p>Built with Starlight</p></footer></body></html>`;

describe("loadHTML main-content extraction", () => {
  it("keeps <main> content and drops site chrome", () => {
    const chunks = loadHTML(`${DOCS_CHROME}${DOCS_MAIN}`, "https://docs.example/x/");
    const text = chunks.map((c) => c.content).join("\n");
    expect(text).toContain("Code-Action Strategy");
    expect(text).toContain("Overview");
    expect(text).toContain("The agent writes TypeScript & runs it.");
    expect(text).toContain("First point");
    expect(text).toContain("const x = 1;");
    for (const noise of [
      "Skip to content", "Search CtrlK", "Playground", "Select theme", "Get Started",
      "Introduction Install", "Edit page", "Built with Starlight", "THEME_BOOT",
      "color:red", "ICON_TEXT", "Section titled", "SIDEBAR_FALLBACK_MARKER",
      "enable javascript", "Reactive Agents",
    ]) {
      expect(text).not.toContain(noise);
    }
    expect(chunks[0]!.metadata.title).toBe("Code-Action Strategy | Reactive Agents");
  });

  it("without <main>/<article> keeps body text minus script/style/nav/chrome", () => {
    const html = `<html><head><title>T</title><script>boot()</script></head><body>
<header>Site Header</header><nav>Nav Links</nav>
<div><h1>Heading</h1><p>Body paragraph.</p></div>
<footer>Foot</footer><style>.a{}</style></body></html>`;
    const text = loadHTML(html, "p.html").map((c) => c.content).join("\n");
    expect(text).toContain("Heading");
    expect(text).toContain("Body paragraph.");
    for (const n of ["Site Header", "Nav Links", "Foot", "boot()", ".a{}"]) {
      expect(text).not.toContain(n);
    }
  });

  it("falls back to <article> when no <main>", () => {
    const html = `<body><div>OUTSIDE</div><article><p>Inside article</p></article></body>`;
    const text = loadHTML(html, "a.html").map((c) => c.content).join("\n");
    expect(text).toContain("Inside article");
    expect(text).not.toContain("OUTSIDE");
  });

  it("leaves markdown and text paths unchanged", () => {
    const md = "# Title\n\nSome <nav>kept</nav> text.";
    expect(loadMarkdown(md, "a.md").map((c) => c.content).join("\n")).toContain("<nav>kept</nav>");
    expect(loadText(md, "a.txt").map((c) => c.content).join("\n")).toContain("<nav>kept</nav>");
  });
});
