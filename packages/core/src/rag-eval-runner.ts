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
import {
  createEmbeddingRetriever,
  DEFAULT_HASH_EMBEDDER_ID,
  type Embedder,
  EmbeddingRagIndex,
} from './rag-embedding.js';
import {
  evaluateRagEvalContract,
  type RagChunkInput,
  type RagEvalContractOptions,
  type RagEvalContractResult,
} from './rag-runtime.js';
import { collectRagSemanticFacts, type SemanticViolation, validateRagSemantics } from './semantic-validator.js';

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
  /** RAG semantic violations. Non-empty ⇒ the spec is invalid and no eval ran (fail-closed). */
  readonly diagnostics: readonly SemanticViolation[];
  readonly evals: readonly RagEvalDocumentEntry[];
  /** True only when the spec is valid, at least one eval ran, and every eval passed. */
  readonly passed: boolean;
}

/**
 * Parse `source`, build a cosine retriever over `chunks`, and execute every
 * `ragEval` contract declared in the document against it.
 *
 * Fails closed: if the RAG graph is semantically invalid (unresolved/duplicate
 * declarations, out-of-range params, …) no eval runs and `passed` is false —
 * running a contract against a broken spec would report a meaningless verdict.
 */
export function evaluateRagEvalDocument(
  source: string,
  chunks: Iterable<RagChunkInput>,
  options: RagEvalDocumentOptions = {},
): RagEvalDocumentReport {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) {
    return {
      embedderId: options.embedder?.id ?? DEFAULT_HASH_EMBEDDER_ID,
      diagnostics,
      evals: [],
      passed: false,
    };
  }

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
    diagnostics,
    evals,
    passed: evals.length > 0 && evals.every((entry) => entry.result.passed),
  };
}
