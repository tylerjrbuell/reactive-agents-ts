/**
 * Per-agent document store: creation, `.withDocuments()` pre-ingestion,
 * run binding, and meta-tool back-fill.
 *
 * Each built agent owns a document store (`createDocumentStore()` from
 * @reactive-agents/tools) unless the builder was given a shared one via
 * `.withDocuments(docs, { store })`. Documents from `.withDocuments()` are
 * pre-ingested into it, `agent.ingest()` writes into it, and
 * {@link documentStoreLayer} provides it as the agent's `AgentDocumentStore`,
 * which every run entry binds into the run's document-store slot
 * (`engine/start-run.ts`), so the `find` tool searches only this agent's store.
 * The meta-tools staticBriefInfo is back-filled with the indexed-document
 * inventory so brief/recall meta-tools see it.
 *
 * Lifted from builder.ts pre-W25 (6,232-LOC checkpoint).
 */

import { Effect, type Layer } from "effect";
import { createDocumentStore, type RagMemoryStore } from "@reactive-agents/tools";
import { AgentDocumentStore, agentDocumentStoreLayer } from "../../engine/start-run.js";
import type { KernelMetaToolsConfig } from "@reactive-agents/reasoning";
import type { MCPServerConfig } from "../../runtime.js";
import type { DocumentSpec } from "../../context-ingestion.js";
import type { AgentToolOptions, ToolsOptions } from "../types.js";

export interface RagIngestionDeps {
  readonly documents: readonly DocumentSpec[];
  /** Shared store from `.withDocuments(docs, { store })`; absent = a fresh per-agent store. */
  readonly store?: RagMemoryStore;
  /** `.withTools()` / `.withDocuments()` was called (tools layer enabled). */
  readonly enableTools: boolean;
  readonly toolsOptions: ToolsOptions | undefined;
  readonly agentTools: readonly AgentToolOptions[];
  readonly allowDynamicSubAgents: boolean;
  readonly mcpServers: readonly MCPServerConfig[];
  readonly kernelMetaTools: KernelMetaToolsConfig | false | undefined;
}

/**
 * Provide `store` as the agent's `AgentDocumentStore`. Each run entry
 * (`startRun`: run, runEffect, runStream, chat, durable facades, gateway
 * events) binds it into the run scope, so every fiber of the run searches
 * this store. A Layer-level FiberRef binding would not survive: the run
 * scope replaces it at each entry.
 */
export const documentStoreLayer = (store: RagMemoryStore): Layer.Layer<AgentDocumentStore> =>
  agentDocumentStoreLayer(store);

/**
 * Resolve the agent's document store, pre-ingest declared documents, and
 * back-fill meta-tools staticBriefInfo.
 *
 * Returns the agent's store, or `undefined` when the agent has no tool
 * surface at all (no tools, documents, agent tools, dynamic sub-agents, MCP
 * servers, or supplied store): such an agent has no `find` tool to read it.
 */
export const ingestRagDocuments = (
  deps: RagIngestionDeps,
): Effect.Effect<RagMemoryStore | undefined, never> =>
  Effect.gen(function* () {
    const {
      documents,
      store,
      enableTools,
      toolsOptions,
      agentTools,
      allowDynamicSubAgents,
      mcpServers,
      kernelMetaTools,
    } = deps;

    // Resolved eagerly whenever the agent has a tool surface so agent.ingest()
    // works at runtime even without build-time documents.
    let ragStore: RagMemoryStore | undefined;
    if (
      enableTools ||
      store !== undefined ||
      documents.length > 0 ||
      toolsOptions ||
      agentTools.length > 0 ||
      allowDynamicSubAgents ||
      mcpServers.length > 0
    ) {
      const agentStore = store ?? createDocumentStore();
      ragStore = agentStore;

      // Pre-populate the agent's store with documents provided via .withDocuments()
      if (documents.length > 0) {
        const { ingestDocuments } = yield* Effect.promise(
          () => import("../../context-ingestion.js"),
        );
        yield* ingestDocuments(documents as DocumentSpec[], agentStore);
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
