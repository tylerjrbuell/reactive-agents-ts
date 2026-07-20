/**
 * RAG document pre-ingestion + meta-tool back-fill.
 *
 * Resolves the shared module-level `ragMemoryStore` Map from
 * @reactive-agents/tools, pre-populates it with documents specified
 * via `.withDocuments()`, and back-fills meta-tools staticBriefInfo
 * with the indexed-document inventory so brief/recall meta-tools see
 * up-to-date document metadata at runtime.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect } from "effect";
import type { RagMemoryStore } from "@reactive-agents/tools";
import type { KernelMetaToolsConfig } from "@reactive-agents/reasoning";
import type { MCPServerConfig } from "../../runtime.js";
import type { DocumentSpec } from "../../context-ingestion.js";
import type { AgentToolOptions, ToolsOptions } from "../types.js";

export interface RagIngestionDeps {
  readonly documents: readonly DocumentSpec[];
  readonly toolsOptions: ToolsOptions | undefined;
  readonly agentTools: readonly AgentToolOptions[];
  readonly allowDynamicSubAgents: boolean;
  readonly mcpServers: readonly MCPServerConfig[];
  readonly kernelMetaTools: KernelMetaToolsConfig | false | undefined;
}

/**
 * Resolve the shared RAG store, pre-ingest declared documents, and
 * back-fill meta-tools staticBriefInfo.
 *
 * Returns the resolved `ragStore` (or `undefined` if no condition triggered
 * its resolution — i.e., no documents, no tools, no agent tools, no dynamic
 * sub-agents, and no MCP servers).
 */
export const ingestRagDocuments = (
  deps: RagIngestionDeps,
): Effect.Effect<RagMemoryStore | undefined, never> =>
  Effect.gen(function* () {
    const {
      documents,
      toolsOptions,
      agentTools,
      allowDynamicSubAgents,
      mcpServers,
      kernelMetaTools,
    } = deps;

    // Resolve the shared RAG store for runtime ingestion support.
    // The ragMemoryStore is a module-level Map searched by the `find` tool's handler.
    // We eagerly resolve it when tools are enabled so agent.ingest() works at runtime.
    let ragStore: RagMemoryStore | undefined;
    if (
      documents.length > 0 ||
      toolsOptions ||
      agentTools.length > 0 ||
      allowDynamicSubAgents ||
      mcpServers.length > 0
    ) {
      const { ragMemoryStore: sharedStore } = yield* Effect.promise(
        () => import("@reactive-agents/tools"),
      );
      ragStore = sharedStore;

      // Pre-populate RAG store with documents provided via .withDocuments()
      if (documents.length > 0) {
        const { ingestDocuments } = yield* Effect.promise(
          () => import("../../context-ingestion.js"),
        );
        yield* ingestDocuments(documents as DocumentSpec[], sharedStore);
      }

      // Back-fill meta-tools staticBriefInfo with actual document index
      if (kernelMetaTools && kernelMetaTools.staticBriefInfo && ragStore) {
        const indexedDocuments = [
          ...(ragStore as Map<string, unknown[]>).entries(),
        ].map(([source, chunks]) => ({
          source,
          chunkCount: chunks.length,
          format:
            (chunks[0] as { metadata?: { format?: string } })?.metadata
              ?.format ?? "text",
        }));
        type StaticBriefBackfill = {
          indexedDocuments: Array<{
            source: string;
            chunkCount: number;
            format: string;
          }>;
          readonly availableSkills: readonly {
            readonly name: string;
            readonly purpose: string;
          }[];
          readonly memoryBootstrap: {
            readonly semanticLines: number;
            readonly episodicEntries: number;
          };
        };
        (
          kernelMetaTools.staticBriefInfo as StaticBriefBackfill
        ).indexedDocuments = indexedDocuments;
      }
    }

    return ragStore;
  });
