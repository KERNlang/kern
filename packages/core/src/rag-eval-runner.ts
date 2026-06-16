/**
 * Document-level RAG eval runner (P1.2).
 *
 * Ties the three already-existing layers together so a `.kern` RAG spec becomes
 * an executable, self-testing artifact:
 *   parse → `collectRagSemanticFacts` → run each `ragEval` against a REAL
 *   {@link EmbeddingRagIndex} retriever via the existing
 *   `evaluateRagEvalContract` seam.
 *
 * This is the dbt-test shape: retrieval + verification run in the KERN toolchain
 * (single implementation, one engine), not in emitted target code — so there is
 * no TS↔Python surface here. The corpus is supplied by the caller; on-disk
 * ingestion (`source uri=…` globs) lands in P1.5.
 */

import { parseDocument } from './parser.js';
import { createEmbeddingRetriever, type Embedder, EmbeddingRagIndex } from './rag-embedding.js';
import {
  evaluateRagEvalContract,
  type RagChunkInput,
  type RagEvalContractOptions,
  type RagEvalContractResult,
} from './rag-runtime.js';
import { collectRagSemanticFacts } from './semantic-validator.js';

export interface RagEvalDocumentOptions extends RagEvalContractOptions {
  /** Embedder behind the retrieval seam. Defaults to the deterministic hash embedder. */
  readonly embedder?: Embedder;
}

export interface RagEvalDocumentEntry {
  readonly ragName: string;
  readonly evalName?: string;
  readonly result: RagEvalContractResult;
}

export interface RagEvalDocumentReport {
  /** Identity of the embedder used, recorded for reproducibility. */
  readonly embedderId: string;
  readonly evals: readonly RagEvalDocumentEntry[];
  /** True only when at least one eval ran and every eval passed. */
  readonly passed: boolean;
}

/**
 * Parse `source`, build a cosine retriever over `chunks`, and execute every
 * `ragEval` contract declared in the document against it.
 */
export function evaluateRagEvalDocument(
  source: string,
  chunks: Iterable<RagChunkInput>,
  options: RagEvalDocumentOptions = {},
): RagEvalDocumentReport {
  const root = parseDocument(source);
  const facts = collectRagSemanticFacts(root);
  const index = new EmbeddingRagIndex(chunks, { embedder: options.embedder });
  const retriever = createEmbeddingRetriever(index);

  const evals: RagEvalDocumentEntry[] = facts.pipelines.flatMap((pipeline) =>
    pipeline.evals.map((evaluation) => ({
      ragName: pipeline.name,
      ...(evaluation.name !== undefined ? { evalName: evaluation.name } : {}),
      result: evaluateRagEvalContract(evaluation, retriever, options),
    })),
  );

  return {
    embedderId: index.embedderId,
    evals,
    passed: evals.length > 0 && evals.every((entry) => entry.result.passed),
  };
}
