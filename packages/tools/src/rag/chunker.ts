/**
 * Document chunking strategies for the RAG pipeline.
 *
 * Splits text into overlapping chunks suitable for embedding and retrieval.
 */

import type { ChunkConfig } from "./types.js";

const DEFAULT_MAX_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Chunk a document according to the given configuration.
 *
 * Dispatches to the appropriate strategy (fixed, sentence, paragraph, or markdown-sections).
 */
export function chunkDocument(content: string, config?: ChunkConfig): string[] {
  if (!content || content.trim().length === 0) return [];

  const maxSize = config?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  const rawOverlap = config?.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  // Clamp overlap to less than maxSize to prevent infinite loops
  const overlap = Math.min(rawOverlap, Math.floor(maxSize * 0.5));
  const strategy = config?.strategy ?? "paragraph";

  switch (strategy) {
    case "fixed":
      return chunkFixed(content, maxSize, overlap);
    case "sentence":
      return chunkBySentences(content, maxSize, overlap);
    case "paragraph":
      return chunkByParagraphs(content, maxSize, overlap);
    case "markdown-sections":
      return chunkByMarkdownSections(content, maxSize);
    default:
      return chunkByParagraphs(content, maxSize, overlap);
  }
}

/**
 * Fixed-size chunking with character-level overlap.
 */
function chunkFixed(content: string, maxSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < content.length) {
    const end = Math.min(start + maxSize, content.length);
    const chunk = content.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    if (end >= content.length) break;
    start = end - overlap;
    if (start >= content.length) break;
  }
  return chunks;
}

/**
 * Split text on sentence boundaries, grouping sentences into chunks
 * that fit within maxSize while preserving overlap.
 */
export function chunkBySentences(content: string, maxSize: number, overlap: number): string[] {
  // Split on sentence-ending punctuation followed by whitespace
  const sentences = content.match(/[^.!?]+[.!?]+[\s]*/g) ?? [content];
  return groupSegments(sentences, maxSize, overlap);
}

/**
 * Split text on paragraph boundaries (double newlines), grouping
 * paragraphs into chunks that fit within maxSize with overlap.
 */
function chunkByParagraphs(content: string, maxSize: number, overlap: number): string[] {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  return groupSegments(paragraphs, maxSize, overlap);
}

/**
 * Split markdown content on heading boundaries (## and above).
 * Each section becomes one chunk. Sections exceeding maxSize are
 * sub-chunked by paragraph.
 */
export function chunkByMarkdownSections(content: string, maxSize: number = DEFAULT_MAX_CHUNK_SIZE): string[] {
  // Split on markdown headings (lines starting with # at any level)
  const sections: string[] = [];
  const lines = content.split("\n");
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      const section = current.join("\n").trim();
      if (section.length > 0) sections.push(section);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    const section = current.join("\n").trim();
    if (section.length > 0) sections.push(section);
  }

  // Sub-chunk oversized sections
  const result: string[] = [];
  for (const section of sections) {
    if (section.length <= maxSize) {
      result.push(section);
    } else {
      // Fall back to paragraph chunking for oversized sections
      const subChunks = chunkByParagraphs(section, maxSize, 0);
      result.push(...subChunks);
    }
  }

  return result;
}

/**
 * Group an array of text segments (sentences or paragraphs) into chunks
 * that fit within maxSize, with overlap expressed as trailing segments
 * from the previous chunk prepended to the next.
 */
function groupSegments(segments: string[], maxSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let currentChunk = "";
  let currentSegments: string[] = [];

  for (const segment of segments) {
    const candidate = currentChunk.length > 0
      ? currentChunk + "\n\n" + segment
      : segment;

    if (candidate.length > maxSize && currentChunk.length > 0) {
      // Flush current chunk
      chunks.push(currentChunk.trim());

      // Compute overlap: take trailing segments that fit within overlap budget
      if (overlap > 0) {
        let overlapText = "";
        const overlapSegments: string[] = [];
        for (let i = currentSegments.length - 1; i >= 0; i--) {
          const candidate = currentSegments[i]! + (overlapText ? "\n\n" + overlapText : "");
          if (candidate.length > overlap) break;
          overlapText = candidate;
          overlapSegments.unshift(currentSegments[i]!);
        }
        currentChunk = overlapText ? overlapText + "\n\n" + segment : segment;
        currentSegments = [...overlapSegments, segment];
      } else {
        currentChunk = segment;
        currentSegments = [segment];
      }
    } else {
      currentChunk = candidate;
      currentSegments.push(segment);
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
