import type { ContentPart } from "@reactive-agents/core";
import { toolContent } from "../tool-content.js";

// Maps an MCP `tools/call` result to a tool return value (Plan 9 Phase 4
// stage E). Text-only results keep their exact legacy value (text items
// joined with "\n"). Image, audio and resource items become typed parts
// carried by `toolContent`; before this they were dropped.

/** The tool value of an MCP call result, or the error text when `isError` is set. */
export type McpToolResult =
  | { readonly kind: "value"; readonly value: unknown }
  | { readonly kind: "error"; readonly text: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const DEFAULT_MEDIA_TYPE = "application/octet-stream";

/** One MCP content item as a typed part. Unknown or malformed items map to nothing. */
const itemToPart = (item: Record<string, unknown>): ContentPart | undefined => {
  const data = str(item.data);
  const mimeType = str(item.mimeType) ?? DEFAULT_MEDIA_TYPE;
  switch (item.type) {
    case "text":
      return { type: "text", text: str(item.text) ?? "" };
    case "image":
      return data === undefined
        ? undefined
        : { type: "image", source: { type: "base64", media_type: mimeType, data } };
    case "audio":
      return data === undefined
        ? undefined
        : { type: "audio", source: { type: "base64", media_type: mimeType, data } };
    case "resource_link": {
      const uri = str(item.uri);
      if (uri === undefined) return undefined;
      const name = str(item.name);
      return { type: "file", ref: { uri, media_type: mimeType, ...(name !== undefined ? { name } : {}) } };
    }
    case "resource": {
      const res = item.resource;
      if (!isRecord(res)) return undefined;
      const uri = str(res.uri);
      if (uri === undefined) return undefined;
      const name = str(res.name) ?? str(res.title);
      return {
        type: "file",
        ref: { uri, media_type: str(res.mimeType) ?? DEFAULT_MEDIA_TYPE, ...(name !== undefined ? { name } : {}) },
      };
    }
    default:
      return undefined;
  }
};

/**
 * Map an MCP call result to a tool value.
 *
 * - No `content` array: the raw result, as before.
 * - `isError`: the joined text of the text items, as before.
 * - Only text items: the text joined with "\n", as before.
 * - Any image, audio or resource item: `toolContent(parts)`, in item order.
 * - No mappable items: the raw result, as before.
 */
export const mapMcpToolResult = (result: unknown): McpToolResult => {
  if (!isRecord(result) || !Array.isArray(result.content)) return { kind: "value", value: result };
  const parts = result.content.filter(isRecord).map(itemToPart).filter((p) => p !== undefined);
  const texts = parts.flatMap((p) => (p.type === "text" ? [p.text] : []));
  if (result.isError) return { kind: "error", text: texts.join("\n") };
  if (parts.some((p) => p.type !== "text")) return { kind: "value", value: toolContent(parts) };
  return { kind: "value", value: texts.length > 0 ? texts.join("\n") : result };
};
