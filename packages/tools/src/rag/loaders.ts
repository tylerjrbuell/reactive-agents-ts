/**
 * Document loaders for the RAG pipeline.
 *
 * Each loader parses a specific format and returns an array of DocumentChunks
 * with appropriate metadata. The `detectAndLoad` function auto-detects format.
 */

import type { DocumentChunk } from "./types.js";
import { chunkDocument } from "./chunker.js";
import type { ChunkConfig } from "./types.js";

const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  maxChunkSize: 1000,
  chunkOverlap: 200,
  strategy: "paragraph",
};

/**
 * Load plain text content, chunking it with the given (or default) config.
 */
export function loadText(
  content: string,
  source: string,
  config?: ChunkConfig,
): DocumentChunk[] {
  const chunks = chunkDocument(content, config ?? DEFAULT_CHUNK_CONFIG);
  return chunks.map((c, i) => ({
    content: c,
    metadata: {
      source,
      format: "text",
      chunkIndex: i,
      totalChunks: chunks.length,
    },
  }));
}

/**
 * Load markdown content, using markdown-sections strategy by default.
 * Extracts the first heading as the title.
 */
export function loadMarkdown(
  content: string,
  source: string,
  config?: ChunkConfig,
): DocumentChunk[] {
  const mdConfig: ChunkConfig = config ?? {
    ...DEFAULT_CHUNK_CONFIG,
    strategy: "markdown-sections",
  };

  // Extract title from first heading
  const titleMatch = content.match(/^#{1,6}\s+(.+)$/m);
  const title = titleMatch?.[1]?.trim();

  const chunks = chunkDocument(content, mdConfig);
  return chunks.map((c, i) => ({
    content: c,
    metadata: {
      source,
      format: "markdown",
      chunkIndex: i,
      totalChunks: chunks.length,
      ...(title ? { title } : {}),
    },
  }));
}

/**
 * Load JSON content. For arrays, each element becomes a chunk.
 * For objects, the entire content is treated as text.
 */
export function loadJSON(
  content: string,
  source: string,
  config?: ChunkConfig,
): DocumentChunk[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // If JSON is invalid, treat as plain text
    return loadText(content, source, config);
  }

  if (Array.isArray(parsed)) {
    // Each array element becomes its own chunk (stringified if needed)
    const items = parsed.map((item) =>
      typeof item === "string" ? item : JSON.stringify(item, null, 2),
    );

    // Group small items or split large ones
    const grouped: string[] = [];
    const maxSize = config?.maxChunkSize ?? DEFAULT_CHUNK_CONFIG.maxChunkSize!;
    let current = "";

    for (const item of items) {
      if (current.length + item.length + 1 > maxSize && current.length > 0) {
        grouped.push(current.trim());
        current = item;
      } else {
        current = current ? current + "\n" + item : item;
      }
    }
    if (current.trim().length > 0) grouped.push(current.trim());

    return grouped.map((c, i) => ({
      content: c,
      metadata: {
        source,
        format: "json" as const,
        chunkIndex: i,
        totalChunks: grouped.length,
      },
    }));
  }

  // Object — stringify and chunk as text
  const text = JSON.stringify(parsed, null, 2);
  const chunks = chunkDocument(text, config ?? DEFAULT_CHUNK_CONFIG);
  return chunks.map((c, i) => ({
    content: c,
    metadata: {
      source,
      format: "json" as const,
      chunkIndex: i,
      totalChunks: chunks.length,
    },
  }));
}

/**
 * Load CSV content. Each row (after header) becomes a chunk,
 * with the header prepended for context.
 */
export function loadCSV(
  content: string,
  source: string,
  config?: ChunkConfig,
): DocumentChunk[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) return [];
  const lines = trimmed.split("\n");

  const header = lines[0]!;
  const rows = lines.slice(1).filter((r) => r.trim().length > 0);

  if (rows.length === 0) {
    return [{
      content: header,
      metadata: { source, format: "csv", chunkIndex: 0, totalChunks: 1 },
    }];
  }

  // Group rows into chunks that fit within maxSize
  const maxSize = config?.maxChunkSize ?? DEFAULT_CHUNK_CONFIG.maxChunkSize!;
  const grouped: string[] = [];
  let current = header; // Each chunk starts with the header

  for (const row of rows) {
    if (current.length + row.length + 1 > maxSize && current !== header) {
      grouped.push(current);
      current = header + "\n" + row;
    } else {
      current = current + "\n" + row;
    }
  }
  if (current.length > header.length) grouped.push(current);

  return grouped.map((c, i) => ({
    content: c,
    metadata: {
      source,
      format: "csv" as const,
      chunkIndex: i,
      totalChunks: grouped.length,
    },
  }));
}

/**
 * Load HTML content by stripping tags and chunking the resulting text.
 * Simple tag stripping — no full DOM parser needed for v1.
 */
export function loadHTML(
  content: string,
  source: string,
  config?: ChunkConfig,
): DocumentChunk[] {
  // Extract title from <title> tag
  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim();

  // Strip HTML tags
  let text = content
    // Remove script and style blocks
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    // Convert block elements to newlines
    .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|pre|hr)[^>]*>/gi, "\n")
    // Strip remaining tags
    .replace(/<[^>]+>/g, "")
    // Decode common HTML entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Collapse whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length === 0) return [];

  const chunks = chunkDocument(text, config ?? DEFAULT_CHUNK_CONFIG);
  return chunks.map((c, i) => ({
    content: c,
    metadata: {
      source,
      format: "html" as const,
      chunkIndex: i,
      totalChunks: chunks.length,
      ...(title ? { title } : {}),
    },
  }));
}

/**
 * Auto-detect document format from source path extension or content heuristics,
 * then load using the appropriate loader.
 */
export function detectAndLoad(
  content: string,
  source: string,
  config?: ChunkConfig,
): DocumentChunk[] {
  const format = detectFormat(content, source);

  switch (format) {
    case "markdown":
      return loadMarkdown(content, source, config);
    case "json":
      return loadJSON(content, source, config);
    case "csv":
      return loadCSV(content, source, config);
    case "html":
      return loadHTML(content, source, config);
    default:
      return loadText(content, source, config);
  }
}

/**
 * Detect the document format from the source extension or content heuristics.
 */
function detectFormat(
  content: string,
  source: string,
): "text" | "markdown" | "json" | "csv" | "html" {
  // Check file extension first
  const ext = source.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
    case "markdown":
      return "markdown";
    case "json":
    case "jsonl":
      return "json";
    case "csv":
    case "tsv":
      return "csv";
    case "html":
    case "htm":
      return "html";
    case "txt":
      return "text";
  }

  // Content heuristics
  const trimmed = content.trim();

  // JSON: starts with { or [
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // Not valid JSON, continue
    }
  }

  // HTML: starts with <
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html") || trimmed.startsWith("<")) {
    if (/<[a-z]+[\s>]/i.test(trimmed)) {
      return "html";
    }
  }

  // Markdown: has headings or links
  if (/^#{1,6}\s/m.test(trimmed) || /\[.+\]\(.+\)/.test(trimmed)) {
    return "markdown";
  }

  // CSV: multiple lines with consistent comma/tab separators
  const lines = trimmed.split("\n").slice(0, 5);
  if (lines.length >= 2) {
    const firstCommas = (lines[0]!.match(/,/g) ?? []).length;
    if (firstCommas >= 1) {
      const consistent = lines.every(
        (l) => (l.match(/,/g) ?? []).length === firstCommas,
      );
      if (consistent) return "csv";
    }
  }

  return "text";
}
