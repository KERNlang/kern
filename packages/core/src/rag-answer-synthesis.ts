import { inferRagAnswerGroundingSpansFromInlineCitations } from './rag-answer-citations.js';
import {
  assembleRagPromptContext,
  evaluateRagAnswerContract,
  type RagAnswerContractDiagnostic,
  type RagAnswerContractResult,
  type RagAnswerGroundingSpan,
  type RagPromptContext,
  type RetrievedChunk,
} from './rag-runtime.js';

export type RagAnswerTextGenerator = (prompt: string) => string | PromiseLike<string>;
export const DEFAULT_RAG_ANSWER_SYNTHESIS_MIN_GROUNDING_COVERAGE = 0.85;

export interface RagAnswerSynthesisOptions {
  readonly query: string;
  readonly chunks: readonly RetrievedChunk[];
  readonly complete: RagAnswerTextGenerator;
  readonly prompt?: string;
  readonly maxContextChars?: number;
  readonly requireCitations?: boolean;
  readonly minCitedChunks?: number;
  readonly minGroundingCoverage?: number;
}

export interface RagAnswerSynthesisResult {
  readonly query: string;
  readonly answer: string;
  readonly prompt: string;
  readonly context: RagPromptContext;
  readonly groundingSpans: readonly RagAnswerGroundingSpan[];
  readonly passed: boolean;
  readonly status: RagAnswerContractResult['status'];
  readonly groundingCoverage: number;
  readonly groundedChars: number;
  readonly answerChars: number;
  readonly evidenceSufficient: boolean;
  readonly abstained: boolean;
  readonly citedChunkIds: readonly string[];
  readonly sources: readonly string[];
  readonly diagnostics: readonly RagAnswerContractDiagnostic[];
}

export async function synthesizeRagAnswer(options: RagAnswerSynthesisOptions): Promise<RagAnswerSynthesisResult> {
  if (typeof options.query !== 'string' || options.query.trim() === '') {
    throw new Error('RAG answer synthesis query must be a non-empty string.');
  }
  if (typeof options.complete !== 'function') {
    throw new Error('RAG answer synthesis requires a completion function.');
  }
  if (!Array.isArray(options.chunks) || options.chunks.length === 0) {
    throw new Error('RAG answer synthesis requires at least one retrieved chunk.');
  }
  const context = assembleRagPromptContext(options.chunks, { maxChars: options.maxContextChars });
  const visibleChunks = contextChunksToRetrievedChunks(context);
  const prompt = options.prompt ?? defaultRagAnswerPrompt(options.query, context.text);
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('RAG answer synthesis prompt must be a non-empty string.');
  }
  const answer = await options.complete(prompt);
  if (typeof answer !== 'string' || answer.trim() === '') {
    throw new Error('RAG answer synthesis completion must be a non-empty string.');
  }
  const groundingSpans = inferRagAnswerGroundingSpansFromInlineCitations(
    answer,
    context.chunks.map((chunk) => toCitationChunkInput(chunk)),
  );
  const check = evaluateRagAnswerContract({
    query: options.query,
    answer,
    retrieval: { query: options.query, chunks: visibleChunks },
    groundingSpans,
    requireCitations: options.requireCitations,
    minCitedChunks: options.minCitedChunks,
    minGroundingCoverage: options.minGroundingCoverage ?? DEFAULT_RAG_ANSWER_SYNTHESIS_MIN_GROUNDING_COVERAGE,
  });
  return {
    query: check.query,
    answer,
    prompt,
    context,
    groundingSpans,
    passed: check.passed,
    status: check.status,
    groundingCoverage: check.groundingCoverage,
    groundedChars: check.groundedChars,
    answerChars: check.answerChars,
    evidenceSufficient: check.evidenceSufficient,
    abstained: check.abstained,
    citedChunkIds: check.citedChunkIds,
    sources: check.sources,
    diagnostics: check.diagnostics,
  };
}

function defaultRagAnswerPrompt(query: string, contextText: string): string {
  return [
    'Answer the question using only the retrieved context below.',
    'Every factual claim must include inline citations like [1] that refer to the numbered context chunks.',
    'Prefer exact wording from the context. If the context is insufficient, answer: I do not know.',
    '',
    `Question: ${query}`,
    '',
    'Retrieved context:',
    contextText,
    '',
    'Answer:',
  ].join('\n');
}

function toCitationChunkInput(chunk: RagPromptContext['chunks'][number]): { readonly id: string } {
  return { id: chunk.id };
}

function contextChunksToRetrievedChunks(context: RagPromptContext): readonly RetrievedChunk[] {
  return context.chunks.map((chunk) => ({
    id: chunk.id,
    text: chunk.renderedText,
    score: chunk.score,
    source: chunk.source,
    citation: chunk.citation,
  }));
}
