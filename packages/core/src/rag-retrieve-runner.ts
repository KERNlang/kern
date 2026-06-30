import { createHash } from 'node:crypto';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseDocument } from './parser.js';
import { inferRagAnswerGroundingSpansFromInlineCitations } from './rag-answer-citations.js';
import {
  canonicalRagEmbedModel,
  defaultDimsForRagEmbedModel,
  type RagProviderEmbeddingOptions,
  resolveAsyncRagEmbedderForModel,
  resolveSyncRagEmbedderForModel,
} from './rag-embed-resolver.js';
import { type AsyncEmbedder, AsyncEmbeddingRagIndex, type Embedder, EmbeddingRagIndex } from './rag-embedding.js';
import { LocalPersistentRagVectorStoreAdapter } from './rag-embedding-node.js';
import { ingestRagDeclaredLocalSources, type RagIngestResult } from './rag-ingest.js';
import { cloneRagMetadataFilter } from './rag-metadata-filter.js';
import { type RagQueryTemplateParamValue, renderRagQueryTemplate } from './rag-query-template.js';
import {
  assembleRagPromptContext,
  evaluateRagAnswerContract,
  type RagAnswerContractResult,
  type RagAnswerGroundingSpan,
  type RagChunkInput,
  type RagPromptContext,
  type RetrievedChunk,
  type RetrieveOptions,
  type RetrieveResult,
} from './rag-runtime.js';
import type { RuntimeCapabilityProvider, RuntimeCapabilityValue } from './runner-capabilities.js';
import {
  collectRagSemanticFacts,
  type RagSemanticFacts,
  type RagSemanticIndexFact,
  type RagSemanticRuntimeRetrieveFact,
  type RagSemanticVectorStoreFact,
  type SemanticViolation,
  validateRagSemantics,
} from './semantic-validator.js';

export interface RagRetrieveDocumentOptions {
  readonly sourcePath: string;
  /** Global query fallback used when a ragRetrieve has queryParam but no matching queryParams entry. */
  readonly query?: string;
  /** Named runtime query inputs. Values here take precedence over the global query fallback. */
  readonly queryParams?: Readonly<Record<string, string | undefined>>;
  /** Typed named runtime values used by queryTemplate=. Falls back to queryParams when omitted. */
  readonly templateParams?: Readonly<Record<string, RagQueryTemplateParamValue | undefined>>;
  /** Optional internal filter for callers that synthesize a single runtime retrieval. */
  readonly runtimeRetrievalNames?: readonly string[];
  /** Override embedder for local, synchronous retrieval tests and tools. Provider-backed retrieval is future async work. */
  readonly embedder?: Embedder;
}

export interface RagRetrieveAsyncDocumentOptions extends Omit<RagRetrieveDocumentOptions, 'embedder'> {
  /** Override embedder for async provider-backed retrieval tests and tools. */
  readonly embedder?: AsyncEmbedder | Embedder;
  /** Provider options. Supplying OpenAI here is the only path that can make network calls. */
  readonly providers?: RagProviderEmbeddingOptions;
}

export type RagRetrieveIndexLifecycleStatus = 'indexed' | 'reused' | 'rebuilt';

export interface RagRetrieveIndexLifecycle {
  readonly indexName: string;
  readonly corpusName: string;
  readonly storeName: string;
  readonly storeKind: 'memory' | 'local-persistent';
  readonly chunkingName?: string;
  readonly status: RagRetrieveIndexLifecycleStatus;
  readonly chunkCount: number;
  readonly fingerprint?: string;
  readonly snapshotPath?: string;
}

export interface RagRetrieveDocumentEntry {
  readonly name: string;
  readonly indexName: string;
  readonly indexNames: readonly string[];
  readonly ragName?: string;
  readonly query: string;
  readonly retrieveOptions: RetrieveOptions;
  readonly result: RetrieveResult;
}

export interface RagRetrieveDocumentReport {
  readonly diagnostics: readonly SemanticViolation[];
  readonly indexes: readonly RagRetrieveIndexLifecycle[];
  readonly retrievals: readonly RagRetrieveDocumentEntry[];
  readonly ingestion?: RagIngestResult;
}

export interface LocalRagCapabilityOptions
  extends Omit<RagRetrieveDocumentOptions, 'query' | 'queryParams' | 'templateParams' | 'runtimeRetrievalNames'> {
  readonly sourcePath: string;
  readonly session?: LocalRagCapabilitySession;
}

export interface LocalRagCapabilitySession {
  readonly retrievedChunkQueriesByFingerprint: Map<string, Set<string>>;
}

export function createLocalRagCapabilitySession(): LocalRagCapabilitySession {
  return { retrievedChunkQueriesByFingerprint: new Map() };
}

export function assertLocalRagCapabilityChunksWereRetrieved(
  query: string,
  chunks: readonly RetrievedChunk[],
  session: LocalRagCapabilitySession,
): void {
  assertChunksWereReturnedByRetrieve(query, chunks, session.retrievedChunkQueriesByFingerprint);
}

interface PreparedRagRetrieval<TEmbedder extends Pick<Embedder, 'dims' | 'id'>> {
  readonly retrieval: RagSemanticRuntimeRetrieveFact;
  readonly targets: readonly PreparedRagRetrievalTarget<TEmbedder>[];
  readonly query: string;
}

interface PreparedRagRetrievalTarget<TEmbedder extends Pick<Embedder, 'dims' | 'id'>> {
  readonly index: RagSemanticIndexFact;
  readonly embedder: TEmbedder;
  readonly vectorStore: RagSemanticVectorStoreFact;
}

interface RetrievalIngestions {
  readonly byIndexKey: ReadonlyMap<string, RagIngestResult>;
  readonly combined: RagIngestResult;
}

interface LocalRagCapabilityInput {
  readonly query?: string;
  readonly retrieval?: string;
  readonly queryParams?: Readonly<Record<string, string>>;
  readonly templateParams?: Readonly<Record<string, RagQueryTemplateParamValue>>;
}

type RagCapabilityChunkValue = Readonly<Record<string, RuntimeCapabilityValue>>;
type RagPromptContextCapabilityValue = Readonly<Record<string, RuntimeCapabilityValue>>;
type RagCheckAnswerCapabilityValue = Readonly<Record<string, RuntimeCapabilityValue>>;

const MAX_LOCAL_RAG_RETRIEVE_CACHE_ENTRIES = 32;
const MAX_LOCAL_RAG_RETRIEVED_CHUNK_FINGERPRINTS = MAX_LOCAL_RAG_RETRIEVE_CACHE_ENTRIES * 1000;

interface LocalRagRetrieveCacheEntry {
  readonly query: string;
  readonly chunks: readonly RagCapabilityChunkValue[];
}

export function createLocalRagCapability(
  source: string,
  options: LocalRagCapabilityOptions,
): RuntimeCapabilityProvider {
  if (!options.sourcePath.trim()) {
    throw new Error('Local RAG capability requires a non-empty sourcePath.');
  }
  const retrieveCache = new Map<string, LocalRagRetrieveCacheEntry>();
  const session = options.session ?? createLocalRagCapabilitySession();
  return {
    checkAnswer(call) {
      if (call.namespace !== 'rag' || call.operation !== 'checkAnswer') {
        throw new Error(`Local RAG capability cannot handle ${String(call.namespace)}.${String(call.operation)}.`);
      }
      const input = localRagCheckAnswerInput(call.input);
      assertLocalRagCapabilityChunksWereRetrieved(input.query, input.chunks, session);
      const result = evaluateRagAnswerContract({
        query: input.query,
        answer: input.answer,
        retrieval: { query: input.query, chunks: input.chunks },
        groundingSpans: input.groundingSpans,
        requireCitations: input.requireCitations,
        minCitedChunks: input.minCitedChunks,
        minGroundingCoverage: input.minGroundingCoverage,
      });
      if (!result.passed) {
        throw new Error(
          `RAG answer check failed: ${result.diagnostics
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join('; ')}`,
        );
      }
      return ragCheckAnswerCapabilityValue(result);
    },
    promptContext(call) {
      if (call.namespace !== 'rag' || call.operation !== 'promptContext') {
        throw new Error(`Local RAG capability cannot handle ${String(call.namespace)}.${String(call.operation)}.`);
      }
      const input = localRagPromptContextInput(call.input);
      return ragPromptContextCapabilityValue(assembleRagPromptContext(input.chunks, { maxChars: input.maxChars }));
    },
    retrieve(call) {
      if (call.namespace !== 'rag' || call.operation !== 'retrieve') {
        throw new Error(`Local RAG capability cannot handle ${String(call.namespace)}.${String(call.operation)}.`);
      }
      const input = localRagCapabilityInput(call.input);
      const cacheKey = stableCapabilityJson(input);
      const cached = retrieveCache.get(cacheKey);
      if (cached) {
        rememberRetrievedChunks(
          cached.query,
          cached.chunks.map(ragCachedCapabilityValueChunk),
          session.retrievedChunkQueriesByFingerprint,
        );
        return cloneRagCapabilityChunks(cached.chunks);
      }
      const report = retrieveRagDocument(source, {
        ...options,
        query: input.query,
        queryParams: input.queryParams,
        templateParams: input.templateParams,
        runtimeRetrievalNames: input.retrieval ? [input.retrieval] : undefined,
      });
      if (report.diagnostics.length > 0) {
        throw new Error(report.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
      }
      if (report.retrievals.length === 0) {
        throw new Error(
          input.retrieval
            ? `RAG retrieval ${JSON.stringify(input.retrieval)} produced no result.`
            : 'RAG retrieval produced no result.',
        );
      }
      if (report.retrievals.length > 1) {
        throw new Error(
          'RAG capability retrieve input must name one retrieval when the document declares multiple ragRetrieve nodes.',
        );
      }
      const retrievalResult = report.retrievals[0].result;
      rememberRetrievedChunks(
        retrievalResult.query,
        retrievalResult.chunks,
        session.retrievedChunkQueriesByFingerprint,
      );
      const chunks = retrievalResult.chunks.map(ragChunkCapabilityValue);
      if (retrieveCache.size >= MAX_LOCAL_RAG_RETRIEVE_CACHE_ENTRIES) {
        const oldestKey = retrieveCache.keys().next().value;
        if (oldestKey !== undefined) retrieveCache.delete(oldestKey);
      }
      retrieveCache.set(cacheKey, { query: retrievalResult.query, chunks });
      return cloneRagCapabilityChunks(chunks);
    },
  };
}

export function createAsyncLocalRagRetrieveCapability(
  source: string,
  options: LocalRagCapabilityOptions,
): { readonly retrieveAsync: (call: { readonly input?: RuntimeCapabilityValue }) => Promise<RuntimeCapabilityValue> } {
  if (typeof options.sourcePath !== 'string' || !options.sourcePath.trim()) {
    throw new Error('Async local RAG retrieve capability requires a non-empty sourcePath.');
  }
  const retrieveCache = new Map<string, LocalRagRetrieveCacheEntry>();
  const session = options.session ?? createLocalRagCapabilitySession();
  return {
    async retrieveAsync(call) {
      const input = localRagCapabilityInput(call.input);
      const cacheKey = stableCapabilityJson(input);
      const cached = retrieveCache.get(cacheKey);
      if (cached) {
        rememberRetrievedChunks(
          cached.query,
          cached.chunks.map(ragCachedCapabilityValueChunk),
          session.retrievedChunkQueriesByFingerprint,
        );
        return cloneRagCapabilityChunks(cached.chunks);
      }
      const report = await retrieveRagDocumentAsync(source, {
        ...options,
        query: input.query,
        queryParams: input.queryParams,
        templateParams: input.templateParams,
        runtimeRetrievalNames: input.retrieval ? [input.retrieval] : undefined,
      });
      if (report.diagnostics.length > 0) {
        throw new Error(report.diagnostics.map((diagnostic) => diagnostic.message).join('; '));
      }
      if (report.retrievals.length === 0) {
        throw new Error(
          input.retrieval
            ? `RAG retrieval ${JSON.stringify(input.retrieval)} produced no result.`
            : 'RAG retrieval produced no result.',
        );
      }
      if (report.retrievals.length > 1) {
        throw new Error(
          'RAG capability retrieveAsync input must name one retrieval when the document declares multiple ragRetrieve nodes.',
        );
      }
      const retrievalResult = report.retrievals[0].result;
      rememberRetrievedChunks(
        retrievalResult.query,
        retrievalResult.chunks,
        session.retrievedChunkQueriesByFingerprint,
      );
      const chunks = retrievalResult.chunks.map(ragChunkCapabilityValue);
      if (retrieveCache.size >= MAX_LOCAL_RAG_RETRIEVE_CACHE_ENTRIES) {
        const oldestKey = retrieveCache.keys().next().value;
        if (oldestKey !== undefined) retrieveCache.delete(oldestKey);
      }
      retrieveCache.set(cacheKey, { query: retrievalResult.query, chunks });
      return cloneRagCapabilityChunks(chunks);
    },
  };
}

function localRagCheckAnswerInput(input: RuntimeCapabilityValue | undefined): {
  readonly query: string;
  readonly answer: string;
  readonly chunks: readonly RetrievedChunk[];
  readonly groundingSpans: readonly RagAnswerGroundingSpan[];
  readonly requireCitations?: boolean;
  readonly minCitedChunks?: number;
  readonly minGroundingCoverage?: number;
} {
  if (!isPlainRecordInput(input)) {
    throw new Error('RAG capability checkAnswer input must be a record.');
  }
  const query = requiredOperationStringField(input, 'query', 'checkAnswer');
  const answer = requiredOperationStringValueField(input, 'answer', 'checkAnswer');
  const chunksValue = input.chunks;
  if (!Array.isArray(chunksValue)) {
    throw new Error("RAG capability checkAnswer input field 'chunks' must be an array.");
  }
  const chunks = chunksValue.map((chunk, index) => ragCapabilityValueChunk(chunk, index));
  const requireCitations = optionalBooleanField(input, 'requireCitations', 'checkAnswer');
  const minCitedChunks = optionalNonNegativeIntegerField(input, 'minCitedChunks', 'checkAnswer');
  const minGroundingCoverage = optionalRatioField(input, 'minGroundingCoverage', 'checkAnswer');
  const groundingSpans = localRagGroundingSpans(input, answer, chunks, {
    inferInlineCitations: requireCitations === true || (minCitedChunks ?? 0) > 0 || minGroundingCoverage !== undefined,
  });
  return {
    query,
    answer,
    chunks,
    groundingSpans,
    ...(requireCitations !== undefined ? { requireCitations } : {}),
    ...(minCitedChunks !== undefined ? { minCitedChunks } : {}),
    ...(minGroundingCoverage !== undefined ? { minGroundingCoverage } : {}),
  };
}

function localRagGroundingSpans(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  answer: string,
  chunks: readonly RetrievedChunk[],
  options: { readonly inferInlineCitations: boolean },
): readonly RagAnswerGroundingSpan[] {
  const value = input.groundingSpans;
  if (value === undefined || value === null) {
    return options.inferInlineCitations
      ? inferRagAnswerGroundingSpansFromInlineCitations(answer, chunks, {
          errorPrefix: 'RAG capability checkAnswer answer citation',
        })
      : [];
  }
  if (!Array.isArray(value)) {
    throw new Error("RAG capability checkAnswer input field 'groundingSpans' must be an array.");
  }
  return value.map((span, index) => localRagGroundingSpan(span, index, answer, chunks));
}

function localRagGroundingSpan(
  value: RuntimeCapabilityValue,
  index: number,
  answer: string,
  chunks: readonly RetrievedChunk[],
): RagAnswerGroundingSpan {
  if (!isPlainRecord(value) || Array.isArray(value)) {
    throw new Error(`RAG capability checkAnswer input field 'groundingSpans[${index}]' must be a record.`);
  }
  const start = requiredNonNegativeIntegerField(value, 'start', `groundingSpans[${index}]`, 'checkAnswer');
  const end = requiredNonNegativeIntegerField(value, 'end', `groundingSpans[${index}]`, 'checkAnswer');
  if (end <= start || end > answer.length) {
    throw new Error(
      `RAG capability checkAnswer input field 'groundingSpans[${index}]' must have start < end within the answer length.`,
    );
  }
  const chunkIds = groundingSpanChunkIds(value, index, chunks);
  const required = optionalBooleanField(value, 'required', 'checkAnswer');
  return {
    start,
    end,
    chunkIds,
    ...(required !== undefined ? { required } : {}),
  };
}

function groundingSpanChunkIds(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  spanIndex: number,
  chunks: readonly RetrievedChunk[],
): readonly string[] {
  const chunkIdsValue = input.chunkIds;
  if (chunkIdsValue !== undefined && chunkIdsValue !== null) {
    if (!Array.isArray(chunkIdsValue)) {
      throw new Error(
        `RAG capability checkAnswer input field 'groundingSpans[${spanIndex}].chunkIds' must be an array.`,
      );
    }
    return chunkIdsValue.map((item, chunkIndex) => {
      if (typeof item !== 'string') {
        throw new Error(
          `RAG capability checkAnswer input field 'groundingSpans[${spanIndex}].chunkIds[${chunkIndex}]' must be a string.`,
        );
      }
      if (!chunks.some((chunk) => chunk.id === item)) {
        throw new Error(
          `RAG capability checkAnswer input field 'groundingSpans[${spanIndex}].chunkIds[${chunkIndex}]' must reference an existing chunk.`,
        );
      }
      return item;
    });
  }
  const chunkIndexesValue = input.chunkIndexes;
  if (!Array.isArray(chunkIndexesValue)) {
    throw new Error(
      `RAG capability checkAnswer input field 'groundingSpans[${spanIndex}]' must include chunkIds or chunkIndexes.`,
    );
  }
  return chunkIndexesValue.map((item, chunkIndex) => {
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0 || item >= chunks.length) {
      throw new Error(
        `RAG capability checkAnswer input field 'groundingSpans[${spanIndex}].chunkIndexes[${chunkIndex}]' must be an in-bounds chunk index.`,
      );
    }
    const chunk = chunks[item];
    if (!chunk) {
      throw new Error(
        `RAG capability checkAnswer input field 'groundingSpans[${spanIndex}].chunkIndexes[${chunkIndex}]' must reference an existing chunk.`,
      );
    }
    return chunk.id;
  });
}

function localRagPromptContextInput(input: RuntimeCapabilityValue | undefined): {
  readonly chunks: readonly RetrievedChunk[];
  readonly maxChars?: number;
} {
  if (!isPlainRecordInput(input)) {
    throw new Error('RAG capability promptContext input must be a record.');
  }
  const chunksValue = input.chunks;
  if (!Array.isArray(chunksValue)) {
    throw new Error("RAG capability promptContext input field 'chunks' must be an array.");
  }
  const maxChars = optionalPositiveIntegerField(input, 'maxChars', 'promptContext');
  return {
    chunks: chunksValue.map((chunk, index) => ragCapabilityValueChunk(chunk, index)),
    ...(maxChars !== undefined ? { maxChars } : {}),
  };
}

function localRagCapabilityInput(input: RuntimeCapabilityValue | undefined): LocalRagCapabilityInput {
  if (input === undefined) return {};
  if (!isPlainRecord(input) || Array.isArray(input)) {
    throw new Error('RAG capability retrieve input must be a record.');
  }
  const query = optionalStringField(input, 'query');
  const retrieval = optionalStringField(input, 'retrieval') ?? optionalStringField(input, 'retrievalName');
  const queryParams = localRagQueryParams(input);
  const templateParams = localRagTemplateParams(input);
  return {
    ...(query !== undefined ? { query } : {}),
    ...(retrieval !== undefined ? { retrieval } : {}),
    ...(Object.keys(queryParams).length > 0 ? { queryParams } : {}),
    ...(Object.keys(templateParams).length > 0 ? { templateParams } : {}),
  };
}

function optionalStringField(input: Readonly<Record<string, RuntimeCapabilityValue>>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`RAG capability retrieve input field '${key}' must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new Error(`RAG capability retrieve input field '${key}' must be a non-empty string.`);
  }
  return trimmed;
}

function optionalPositiveIntegerField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
  operation: string,
): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`RAG capability ${operation} input field '${key}' must be a positive integer.`);
  }
  return value;
}

function requiredOperationStringField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
  operation: string,
): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`RAG capability ${operation} input field '${key}' must be a non-empty string.`);
  }
  return value;
}

function requiredOperationStringValueField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
  operation: string,
): string {
  const value = input[key];
  if (typeof value !== 'string') {
    throw new Error(`RAG capability ${operation} input field '${key}' must be a string.`);
  }
  return value;
}

function optionalBooleanField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
  operation: string,
): boolean | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new Error(`RAG capability ${operation} input field '${key}' must be a boolean.`);
  }
  return value;
}

function optionalNonNegativeIntegerField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
  operation: string,
): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`RAG capability ${operation} input field '${key}' must be a non-negative integer.`);
  }
  return value;
}

function requiredNonNegativeIntegerField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
  path: string,
  operation: string,
): number {
  const value = input[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`RAG capability ${operation} input field '${path}.${key}' must be a non-negative integer.`);
  }
  return value;
}

function optionalRatioField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
  operation: string,
): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`RAG capability ${operation} input field '${key}' must be between 0 and 1.`);
  }
  return value;
}

function localRagQueryParams(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      key === 'query' ||
      key === 'retrieval' ||
      key === 'retrievalName' ||
      key === 'queryParams' ||
      key === 'templateParams'
    )
      continue;
    if (typeof value === 'string') out[key] = value;
  }
  Object.assign(out, stringRecordField(input, 'queryParams'));
  return out;
}

function localRagTemplateParams(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
): Readonly<Record<string, RagQueryTemplateParamValue>> {
  const out: Record<string, RagQueryTemplateParamValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      key === 'query' ||
      key === 'retrieval' ||
      key === 'retrievalName' ||
      key === 'queryParams' ||
      key === 'templateParams'
    )
      continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  Object.assign(out, templateParamRecordField(input, 'templateParams'));
  return out;
}

function stringRecordField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
): Readonly<Record<string, string>> {
  const value = input[key];
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value) || Array.isArray(value)) {
    throw new Error(`RAG capability retrieve input field '${key}' must be a record.`);
  }
  const out: Record<string, string> = {};
  for (const [field, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new Error(`RAG capability retrieve input field '${key}.${field}' must be a string.`);
    }
    out[field] = item;
  }
  return out;
}

function templateParamRecordField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
): Readonly<Record<string, RagQueryTemplateParamValue>> {
  const value = input[key];
  if (value === undefined || value === null) return {};
  if (!isPlainRecord(value) || Array.isArray(value)) {
    throw new Error(`RAG capability retrieve input field '${key}' must be a record.`);
  }
  const out: Record<string, RagQueryTemplateParamValue> = {};
  for (const [field, item] of Object.entries(value)) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      throw new Error(`RAG capability retrieve input field '${key}.${field}' must be a string, number, or boolean.`);
    }
    out[field] = item;
  }
  return out;
}

function isPlainRecord(value: RuntimeCapabilityValue): value is Readonly<Record<string, RuntimeCapabilityValue>> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isPlainRecordInput(
  value: RuntimeCapabilityValue | undefined,
): value is Readonly<Record<string, RuntimeCapabilityValue>> {
  return value !== undefined && isPlainRecord(value);
}

function ragChunkCapabilityValue(chunk: RetrieveResult['chunks'][number]): RagCapabilityChunkValue {
  return {
    id: chunk.id,
    text: chunk.text,
    score: chunk.score,
    source: chunk.source,
    citationUri: chunk.citation?.uri ?? null,
    citationLocator: chunk.citation?.locator ?? null,
  };
}

function ragCapabilityValueChunk(value: RuntimeCapabilityValue, index: number): RetrievedChunk {
  if (!isPlainRecord(value) || Array.isArray(value)) {
    throw new Error(`RAG capability promptContext input field 'chunks[${index}]' must be a record.`);
  }
  return {
    id: requiredStringField(value, 'id', index),
    text: requiredStringField(value, 'text', index),
    score: requiredScoreField(value, index),
    source: requiredStringField(value, 'source', index),
    citation: ragCapabilityValueCitation(value, index),
  };
}

function ragCachedCapabilityValueChunk(value: RagCapabilityChunkValue, index: number): RetrievedChunk {
  return ragCapabilityValueChunk(value, index);
}

function requiredStringField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
  index: number,
): string {
  const value = input[key];
  if (typeof value !== 'string') {
    throw new Error(`RAG capability promptContext input field 'chunks[${index}].${key}' must be a string.`);
  }
  return value;
}

function requiredScoreField(input: Readonly<Record<string, RuntimeCapabilityValue>>, index: number): number {
  const value = input.score;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`RAG capability promptContext input field 'chunks[${index}].score' must be a finite number.`);
  }
  return value;
}

function ragCapabilityValueCitation(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  index: number,
): RetrievedChunk['citation'] {
  const citation = input.citation;
  if (citation !== undefined && citation !== null) {
    if (!isPlainRecord(citation) || Array.isArray(citation)) {
      throw new Error(`RAG capability promptContext input field 'chunks[${index}].citation' must be a record.`);
    }
    const uri = optionalStringCapabilityField(citation, 'uri', `chunks[${index}].citation`);
    const locator = optionalStringCapabilityField(citation, 'locator', `chunks[${index}].citation`);
    return {
      ...(uri !== undefined ? { uri } : {}),
      ...(locator !== undefined ? { locator } : {}),
    };
  }
  const uri = optionalStringCapabilityField(input, 'citationUri', `chunks[${index}]`);
  const locator = optionalStringCapabilityField(input, 'citationLocator', `chunks[${index}]`);
  return {
    ...(uri !== undefined ? { uri } : {}),
    ...(locator !== undefined ? { locator } : {}),
  };
}

function optionalStringCapabilityField(
  input: Readonly<Record<string, RuntimeCapabilityValue>>,
  key: string,
  parentPath: string,
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`RAG capability promptContext input field '${parentPath}.${key}' must be a string.`);
  }
  return value;
}

function ragPromptContextCapabilityValue(context: RagPromptContext): RagPromptContextCapabilityValue {
  return {
    text: context.text,
    includedCount: context.includedCount,
    omittedCount: context.omittedCount,
    truncated: context.truncated,
    maxChars: context.maxChars,
    chunks: context.chunks.map((chunk) => ({
      index: chunk.index,
      id: chunk.id,
      source: chunk.source,
      score: chunk.score,
      citationUri: chunk.citation.uri ?? null,
      citationLocator: chunk.citation.locator ?? null,
      text: chunk.text,
      renderedText: chunk.renderedText,
      truncated: chunk.truncated,
    })),
  };
}

function ragCheckAnswerCapabilityValue(result: RagAnswerContractResult): RagCheckAnswerCapabilityValue {
  return {
    passed: result.passed,
    status: result.status,
    groundingCoverage: result.groundingCoverage,
    groundedChars: result.groundedChars,
    answerChars: result.answerChars,
    evidenceSufficient: result.evidenceSufficient,
    abstained: result.abstained,
    citedChunkIds: [...result.citedChunkIds],
    sources: [...result.sources],
    diagnostics: result.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      spanIndex: diagnostic.spanIndex ?? null,
      chunkId: diagnostic.chunkId ?? null,
    })),
  };
}

function rememberRetrievedChunks(
  query: string,
  chunks: readonly RetrievedChunk[],
  queriesByFingerprint: Map<string, Set<string>>,
): void {
  for (const chunk of chunks) {
    const fingerprint = retrievedChunkFingerprint(chunk);
    const queries = queriesByFingerprint.get(fingerprint);
    if (queries) {
      queries.add(query);
    } else {
      if (queriesByFingerprint.size >= MAX_LOCAL_RAG_RETRIEVED_CHUNK_FINGERPRINTS) {
        const oldest = queriesByFingerprint.keys().next().value;
        if (oldest !== undefined) queriesByFingerprint.delete(oldest);
      }
      queriesByFingerprint.set(fingerprint, new Set([query]));
    }
  }
}

function assertChunksWereReturnedByRetrieve(
  query: string,
  chunks: readonly RetrievedChunk[],
  queriesByFingerprint: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  for (const [index, chunk] of chunks.entries()) {
    const queries = queriesByFingerprint.get(retrievedChunkFingerprint(chunk));
    if (!queries) {
      throw new Error(
        `RAG capability checkAnswer input field 'chunks[${index}]' must match a chunk previously returned by rag.retrieve.`,
      );
    }
    if (!queries.has(query)) {
      throw new Error(
        `RAG capability checkAnswer input field 'chunks[${index}]' must match a chunk previously returned by rag.retrieve for the same query.`,
      );
    }
  }
}

function retrievedChunkFingerprint(chunk: RetrievedChunk): string {
  return stableCapabilityJson({
    id: chunk.id,
    text: chunk.text,
    score: chunk.score,
    source: chunk.source,
    citationUri: chunk.citation?.uri ?? null,
    citationLocator: chunk.citation?.locator ?? null,
  });
}

function cloneRagCapabilityChunks(chunks: readonly RagCapabilityChunkValue[]): RagCapabilityChunkValue[] {
  return chunks.map((chunk) => ({ ...chunk }));
}

function stableCapabilityJson(value: unknown): string {
  if (value === undefined) return '{"$kernUndefined":true}';
  if (Array.isArray(value)) return `[${value.map(stableCapabilityJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableCapabilityJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Execute runtime ragRetrieve declarations over declared local sources.
 * The current synchronous path supports memory and local-persistent vector stores
 * over declared local sources. Provider vector stores remain future async work.
 */
export function retrieveRagDocument(source: string, options: RagRetrieveDocumentOptions): RagRetrieveDocumentReport {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) return { diagnostics, indexes: [], retrievals: [] };

  const facts = collectRagSemanticFacts(root);
  const preparedRetrievals = prepareRuntimeRetrievals(
    facts,
    options,
    (index) => options.embedder ?? embedderForIndex(facts, index),
  );
  if (preparedRetrievals.length === 0) return { diagnostics, indexes: [], retrievals: [] };

  const { byIndexKey, combined: ingestion } = ingestForPreparedRetrievals(root, preparedRetrievals, options.sourcePath);
  const embeddingIndexByKey = new Map<string, EmbeddingRagIndex>();
  const persistentStoreByKey = new Map<
    string,
    { readonly fingerprint: string; readonly store: LocalPersistentRagVectorStoreAdapter }
  >();
  const indexLifecycleByName = new Map<string, RagRetrieveIndexLifecycle>();
  let retrievals: RagRetrieveDocumentEntry[] = [];
  let retrievalError: unknown;
  let closeError: unknown;
  try {
    retrievals = preparedRetrievals.map(({ retrieval, targets, query }) => {
      const retrieveOptions = retrieveOptionsForFact(retrieval);
      const perIndexRetrieveOptions =
        targets.length > 1 ? perIndexOptionsForMergedRetrieval(retrieveOptions) : retrieveOptions;
      const queryVectorByEmbedder = new Map<string, Float64Array>();
      const results = targets.map(({ index, embedder, vectorStore }) => {
        const corpusChunks = chunksForIndex(byIndexKey, index);
        if ((vectorStore.kind ?? 'memory') === 'local-persistent') {
          const config = localPersistentStoreConfig(vectorStore, index, embedder, corpusChunks, options.sourcePath);
          let entry = persistentStoreByKey.get(config.physicalKey);
          if (entry && entry.fingerprint !== config.fingerprint) {
            throw new Error(
              `KERN RAG vectorStore '${vectorStore.name}' resolves to local snapshot '${config.fileName}' with multiple incompatible fingerprints. Use distinct namespace or path values for each local-persistent index.`,
            );
          }
          if (!entry) {
            entry = {
              fingerprint: config.fingerprint,
              store: new LocalPersistentRagVectorStoreAdapter({
                directory: config.directory,
                fileName: config.fileName,
                fingerprint: config.fingerprint,
                dims: embedder.dims,
                rebuildOnFingerprintMismatch: true,
              }),
            };
            persistentStoreByKey.set(config.physicalKey, entry);
          }
          const { fingerprint, store } = entry;
          const status = ensureLocalPersistentStoreIndexed(
            store,
            fingerprint,
            embedder,
            corpusChunks,
            config.snapshotExists,
          );
          indexLifecycleByName.set(index.name, indexLifecycleEntry(index, vectorStore, corpusChunks, status, config));
          return store.search(
            query,
            cachedSyncQueryVector(queryVectorByEmbedder, embedder, query),
            perIndexRetrieveOptions,
            fingerprint,
          );
        }
        const cacheKey = JSON.stringify([index.corpusName, index.chunkingName ?? '', embedder.id, embedder.dims]);
        let embeddingIndex = embeddingIndexByKey.get(cacheKey);
        let status: RagRetrieveIndexLifecycleStatus = 'reused';
        if (!embeddingIndex) {
          embeddingIndex = new EmbeddingRagIndex(corpusChunks, { embedder });
          embeddingIndexByKey.set(cacheKey, embeddingIndex);
          status = 'indexed';
        }
        indexLifecycleByName.set(index.name, indexLifecycleEntry(index, vectorStore, corpusChunks, status));
        return embeddingIndex.retrieve(query, perIndexRetrieveOptions);
      });
      return {
        name: retrieval.name,
        indexName: retrieval.indexName,
        indexNames: retrieval.indexNames,
        ...(retrieval.ragName ? { ragName: retrieval.ragName } : {}),
        query,
        retrieveOptions,
        result:
          targets.length > 1
            ? mergeRetrieveResults(query, results, retrieveOptions)
            : (results[0] ?? { query, chunks: [] }),
      };
    });
  } catch (error) {
    retrievalError = error;
  } finally {
    closeError = closeLocalPersistentStores(persistentStoreByKey.values());
  }
  if (retrievalError) {
    throw errorWithCloseError(retrievalError, closeError);
  }
  if (closeError) throw closeError;

  return { diagnostics, indexes: Array.from(indexLifecycleByName.values()), retrievals, ingestion };
}

export async function retrieveRagDocumentAsync(
  source: string,
  options: RagRetrieveAsyncDocumentOptions,
): Promise<RagRetrieveDocumentReport> {
  const root = parseDocument(source);
  const diagnostics = validateRagSemantics(root);
  if (diagnostics.length > 0) return { diagnostics, indexes: [], retrievals: [] };

  const facts = collectRagSemanticFacts(root);
  const preparedRetrievals = prepareRuntimeRetrievals(facts, options, (index) =>
    options.embedder ? ensureAsyncEmbedder(options.embedder) : safeAsyncEmbedderForIndex(facts, index, options),
  );
  if (preparedRetrievals.length === 0) return { diagnostics, indexes: [], retrievals: [] };

  const { byIndexKey, combined: ingestion } = ingestForPreparedRetrievals(root, preparedRetrievals, options.sourcePath);
  const embeddingIndexByKey = new Map<string, AsyncEmbeddingRagIndex>();
  const persistentStoreByKey = new Map<
    string,
    { readonly fingerprint: string; readonly store: LocalPersistentRagVectorStoreAdapter }
  >();
  const indexLifecycleByName = new Map<string, RagRetrieveIndexLifecycle>();
  const retrievals: RagRetrieveDocumentEntry[] = [];
  let retrievalError: unknown;
  let closeError: unknown;
  try {
    for (const { retrieval, targets, query } of preparedRetrievals) {
      const retrieveOptions = retrieveOptionsForFact(retrieval);
      const perIndexRetrieveOptions =
        targets.length > 1 ? perIndexOptionsForMergedRetrieval(retrieveOptions) : retrieveOptions;
      const queryVectorByEmbedder = new Map<string, Float64Array>();
      const results: RetrieveResult[] = [];
      for (const { index, embedder, vectorStore } of targets) {
        const corpusChunks = chunksForIndex(byIndexKey, index);
        if ((vectorStore.kind ?? 'memory') === 'local-persistent') {
          const config = localPersistentStoreConfig(vectorStore, index, embedder, corpusChunks, options.sourcePath);
          let entry = persistentStoreByKey.get(config.physicalKey);
          if (entry && entry.fingerprint !== config.fingerprint) {
            throw new Error(
              `KERN RAG vectorStore '${vectorStore.name}' resolves to local snapshot '${config.fileName}' with multiple incompatible fingerprints. Use distinct namespace or path values for each local-persistent index.`,
            );
          }
          if (!entry) {
            entry = {
              fingerprint: config.fingerprint,
              store: new LocalPersistentRagVectorStoreAdapter({
                directory: config.directory,
                fileName: config.fileName,
                fingerprint: config.fingerprint,
                dims: embedder.dims,
                rebuildOnFingerprintMismatch: true,
              }),
            };
            persistentStoreByKey.set(config.physicalKey, entry);
          }
          const { fingerprint, store } = entry;
          let queryVector: Float64Array;
          let status: RagRetrieveIndexLifecycleStatus;
          try {
            status = await ensureLocalPersistentStoreIndexedAsync(
              store,
              fingerprint,
              embedder,
              corpusChunks,
              config.snapshotExists,
            );
            queryVector = await cachedAsyncQueryVector(queryVectorByEmbedder, embedder, query);
          } catch (error) {
            throw providerError(error, index, embedder);
          }
          indexLifecycleByName.set(index.name, indexLifecycleEntry(index, vectorStore, corpusChunks, status, config));
          results.push(store.search(query, queryVector, perIndexRetrieveOptions, fingerprint));
        } else {
          const cacheKey = JSON.stringify([index.corpusName, index.chunkingName ?? '', embedder.id, embedder.dims]);
          let embeddingIndex = embeddingIndexByKey.get(cacheKey);
          let status: RagRetrieveIndexLifecycleStatus = 'reused';
          try {
            if (!embeddingIndex) {
              embeddingIndex = await AsyncEmbeddingRagIndex.create(corpusChunks, { embedder });
              embeddingIndexByKey.set(cacheKey, embeddingIndex);
              status = 'indexed';
            }
            results.push(await embeddingIndex.retrieve(query, perIndexRetrieveOptions));
          } catch (error) {
            throw providerError(error, index, embedder);
          }
          indexLifecycleByName.set(index.name, indexLifecycleEntry(index, vectorStore, corpusChunks, status));
        }
      }
      retrievals.push({
        name: retrieval.name,
        indexName: retrieval.indexName,
        indexNames: retrieval.indexNames,
        ...(retrieval.ragName ? { ragName: retrieval.ragName } : {}),
        query,
        retrieveOptions,
        result:
          targets.length > 1
            ? mergeRetrieveResults(query, results, retrieveOptions)
            : (results[0] ?? { query, chunks: [] }),
      });
    }
  } catch (error) {
    retrievalError = error;
  } finally {
    closeError = closeLocalPersistentStores(persistentStoreByKey.values());
  }
  if (retrievalError) {
    throw errorWithCloseError(retrievalError, closeError);
  }
  if (closeError) throw closeError;

  return { diagnostics, indexes: Array.from(indexLifecycleByName.values()), retrievals, ingestion };
}

function prepareRuntimeRetrievals<TEmbedder extends Pick<Embedder, 'dims' | 'id'>>(
  facts: RagSemanticFacts,
  options: Pick<RagRetrieveDocumentOptions, 'query' | 'queryParams' | 'runtimeRetrievalNames'>,
  embedderFor: (index: RagSemanticIndexFact) => TEmbedder,
): PreparedRagRetrieval<TEmbedder>[] {
  const indexByName = new Map<string, RagSemanticIndexFact>(facts.indexes.map((index) => [index.name, index]));
  const vectorStoreByName = new Map<string, RagSemanticVectorStoreFact>(
    facts.vectorStores.map((store) => [store.name, store]),
  );
  const runtimeRetrievalNames =
    options.runtimeRetrievalNames === undefined ? undefined : new Set(options.runtimeRetrievalNames);
  return facts.runtimeRetrievals
    .filter((retrieval) => runtimeRetrievalNames?.has(retrieval.name) ?? true)
    .map((retrieval) => {
      const query = queryForRuntimeRetrieval(retrieval, options);
      if (retrieval.indexNames.length === 0) {
        throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' must target at least one index.`);
      }
      const targets = retrieval.indexNames.map((indexName) => {
        const index = indexByName.get(indexName);
        if (!index) throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' references missing index.`);
        const vectorStore = vectorStoreByName.get(index.storeName);
        if (!vectorStore) {
          throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' references missing vector store.`);
        }
        const vectorStoreKind = vectorStore.kind ?? 'memory';
        if (vectorStoreKind !== 'memory' && vectorStoreKind !== 'local-persistent') {
          throw new Error(
            `KERN RAG runtime retrieval '${retrieval.name}' references vectorStore '${vectorStore.name}' kind='${vectorStoreKind}', but the ragRetrieve runner only supports kind=memory and kind=local-persistent.`,
          );
        }
        return { index, embedder: embedderFor(index), vectorStore };
      });
      return { retrieval, targets, query };
    });
}

function ingestForPreparedRetrievals(
  root: ReturnType<typeof parseDocument>,
  preparedRetrievals: readonly PreparedRagRetrieval<Pick<Embedder, 'dims' | 'id'>>[],
  sourcePath: string,
): RetrievalIngestions {
  const byIndexKey = new Map<string, RagIngestResult>();
  for (const { targets } of preparedRetrievals) {
    for (const { index } of targets) {
      const key = indexIngestionKey(index);
      if (byIndexKey.has(key)) continue;
      byIndexKey.set(
        key,
        ingestRagDeclaredLocalSources(root, {
          sourcePath,
          corpusNames: [index.corpusName],
          chunkingNameByCorpus: {
            [index.corpusName]: index.chunkingName,
          },
        }),
      );
    }
  }
  const chunks = Array.from(byIndexKey.values())
    .flatMap((ingestion) => ingestion.chunks)
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  const sources = Array.from(byIndexKey.values())
    .flatMap((ingestion) => ingestion.sources)
    .sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  return {
    byIndexKey,
    combined: {
      chunks,
      sources,
      corpusSha256: sha256(stableCorpusHashInput(chunks)),
    },
  };
}

function chunksForIndex(
  byIndexKey: ReadonlyMap<string, RagIngestResult>,
  index: RagSemanticIndexFact,
): readonly RagChunkInput[] {
  const ingestion = byIndexKey.get(indexIngestionKey(index));
  if (!ingestion) {
    throw new Error(
      `KERN RAG runtime retrieval index '${index.name}' could not prepare corpus '${index.corpusName}'` +
        `${index.chunkingName ? ` with chunking '${index.chunkingName}'` : ''}.`,
    );
  }
  return ingestion.chunks.filter((chunk) => chunk.metadata?.corpusName === index.corpusName);
}

function indexIngestionKey(index: RagSemanticIndexFact): string {
  return JSON.stringify([index.corpusName, index.chunkingName ?? '']);
}

function indexLifecycleEntry(
  index: RagSemanticIndexFact,
  vectorStore: RagSemanticVectorStoreFact,
  chunks: readonly RagChunkInput[],
  status: RagRetrieveIndexLifecycleStatus,
  config?: ReturnType<typeof localPersistentStoreConfig>,
): RagRetrieveIndexLifecycle {
  return {
    indexName: index.name,
    corpusName: index.corpusName,
    storeName: vectorStore.name,
    storeKind: (vectorStore.kind ?? 'memory') as 'memory' | 'local-persistent',
    ...(index.chunkingName ? { chunkingName: index.chunkingName } : {}),
    status,
    chunkCount: chunks.length,
    ...(config
      ? { fingerprint: config.fingerprint, snapshotPath: localPersistentDisplayPath(vectorStore, config) }
      : {}),
  };
}

function localPersistentDisplayPath(
  vectorStore: RagSemanticVectorStoreFact,
  config: ReturnType<typeof localPersistentStoreConfig>,
): string {
  const base = vectorStore.path?.replace(/\\/gu, '/').replace(/\/+$/u, '') ?? '.';
  return `${base}/${config.fileName}`.replace(/^\.\//u, '');
}

function queryForRuntimeRetrieval(
  retrieval: RagSemanticRuntimeRetrieveFact,
  options: Pick<RagRetrieveDocumentOptions, 'query' | 'queryParams' | 'templateParams'>,
): string {
  if (retrieval.query !== undefined) {
    if (retrieval.queryKind === 'expression') {
      throw new Error(
        `KERN RAG runtime retrieval '${retrieval.name}' uses dynamic query=<expr>; use queryParam=<name> for runtime queries.`,
      );
    }
    if (!retrieval.query.trim()) {
      throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' fixed query cannot be empty.`);
    }
    return retrieval.query;
  }
  if (retrieval.queryParam) {
    if (options.queryParams && Object.hasOwn(options.queryParams, retrieval.queryParam)) {
      const value = options.queryParams[retrieval.queryParam];
      if (value !== undefined) {
        if (typeof value === 'string') return value;
        throw new Error(
          `KERN RAG runtime retrieval '${retrieval.name}' requires queryParam '${retrieval.queryParam}' to be a string.`,
        );
      }
    }
    if (options.query !== undefined) return options.query;
    throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' requires queryParam '${retrieval.queryParam}'.`);
  }
  if (retrieval.queryTemplate) {
    return renderRagQueryTemplate(
      retrieval.queryTemplate,
      runtimeTemplateParams(options),
      `KERN RAG runtime retrieval '${retrieval.name}' queryTemplate`,
    );
  }
  throw new Error(`KERN RAG runtime retrieval '${retrieval.name}' has no query source.`);
}

function runtimeTemplateParams(
  options: Pick<RagRetrieveDocumentOptions, 'queryParams' | 'templateParams'>,
): Readonly<Record<string, RagQueryTemplateParamValue | undefined>> | undefined {
  if (!options.queryParams) return options.templateParams;
  if (!options.templateParams) return options.queryParams;
  const merged: Record<string, RagQueryTemplateParamValue | undefined> = { ...options.queryParams };
  for (const [key, value] of Object.entries(options.templateParams)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

function retrieveOptionsForFact(retrieval: RagSemanticRuntimeRetrieveFact): RetrieveOptions {
  const metadataFilter = cloneRagMetadataFilter(retrieval.metadataFilter);
  return {
    ...(retrieval.topK !== undefined ? { topK: retrieval.topK } : {}),
    ...(retrieval.minScore !== undefined ? { minScore: retrieval.minScore } : {}),
    ...(metadataFilter !== undefined ? { metadataFilter } : {}),
  };
}

function perIndexOptionsForMergedRetrieval(options: RetrieveOptions): RetrieveOptions {
  return { ...options, topK: mergedRetrievalTopK(options) };
}

function mergeRetrieveResults(
  query: string,
  results: readonly RetrieveResult[],
  options: RetrieveOptions,
): RetrieveResult {
  const bestChunkById = new Map<string, RetrieveResult['chunks'][number]>();
  for (const chunk of results.flatMap((result) => result.chunks)) {
    const prev = bestChunkById.get(chunk.id);
    if (!prev || compareRetrievedChunks(chunk, prev) < 0) bestChunkById.set(chunk.id, chunk);
  }
  const chunks = Array.from(bestChunkById.values()).sort(compareRetrievedChunks).slice(0, mergedRetrievalTopK(options));
  return { query, chunks };
}

function mergedRetrievalTopK(options: RetrieveOptions): number {
  return options.topK ?? 5;
}

function compareRetrievedChunks(a: RetrieveResult['chunks'][number], b: RetrieveResult['chunks'][number]): number {
  return (
    b.score - a.score ||
    compareCodePoint(a.id, b.id) ||
    compareCodePoint(a.source, b.source) ||
    compareCodePoint(a.text, b.text)
  );
}

function cachedSyncQueryVector(
  queryVectorByEmbedder: Map<string, Float64Array>,
  embedder: Embedder,
  query: string,
): Float64Array {
  const key = JSON.stringify([embedder.id, embedder.dims, query]);
  const cached = queryVectorByEmbedder.get(key);
  if (cached) return cached;
  const vector = embedder.embed(query);
  queryVectorByEmbedder.set(key, vector);
  return vector;
}

async function cachedAsyncQueryVector(
  queryVectorByEmbedder: Map<string, Float64Array>,
  embedder: AsyncEmbedder,
  query: string,
): Promise<Float64Array> {
  const key = JSON.stringify([embedder.id, embedder.dims, query]);
  const cached = queryVectorByEmbedder.get(key);
  if (cached) return cached;
  const vector = await embedder.embed(query);
  queryVectorByEmbedder.set(key, vector);
  return vector;
}

function localPersistentStoreConfig(
  vectorStore: RagSemanticVectorStoreFact,
  index: RagSemanticIndexFact,
  embedder: Pick<Embedder, 'dims' | 'id'>,
  chunks: readonly RagChunkInput[],
  sourcePath: string,
): {
  readonly physicalKey: string;
  readonly directory: string;
  readonly fileName: string;
  readonly snapshotPath: string;
  readonly snapshotExists: boolean;
  readonly fingerprint: string;
} {
  if (!vectorStore.path?.trim()) {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent requires path=<index directory>.`,
    );
  }
  if (isAbsolute(vectorStore.path)) {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent requires a relative path inside the declaring .kern directory.`,
    );
  }
  const baseDir = dirname(resolve(sourcePath));
  const directory = resolve(baseDir, vectorStore.path);
  const relativeDirectory = relative(baseDir, directory);
  if (relativeDirectory.startsWith('..') || isAbsolute(relativeDirectory)) {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent path must stay inside the declaring .kern directory.`,
    );
  }
  const confinedDirectory = confinedRealDirectory(vectorStore, baseDir, directory);
  const fileName = `${safeLocalStoreFileName(vectorStore.namespace ?? index.name)}.json`;
  const snapshotPath = resolve(confinedDirectory, fileName);
  const fingerprint = localPersistentFingerprint(vectorStore, index, embedder, chunks);
  return {
    physicalKey: JSON.stringify([confinedDirectory, fileName]),
    directory: confinedDirectory,
    fileName,
    snapshotPath,
    snapshotExists: existsSync(snapshotPath),
    fingerprint,
  };
}

function ensureLocalPersistentStoreIndexed(
  store: LocalPersistentRagVectorStoreAdapter,
  fingerprint: string,
  embedder: Embedder,
  chunks: readonly RagChunkInput[],
  snapshotExists: boolean,
): RagRetrieveIndexLifecycleStatus {
  const snapshot = store.snapshot();
  const actualChunks = snapshot.entries.map((entry) => entry.chunk);
  if (
    snapshot.fingerprint === fingerprint &&
    snapshot.entries.length === chunks.length &&
    stableChunkDigest(actualChunks) === stableChunkDigest(chunks)
  ) {
    return 'reused';
  }
  store.replaceAll(
    chunks.map((chunk) => ({
      chunk,
      vector: embedder.embed(chunk.text),
      fingerprint,
    })),
  );
  return snapshotExists || snapshot.entries.length > 0 ? 'rebuilt' : 'indexed';
}

async function ensureLocalPersistentStoreIndexedAsync(
  store: LocalPersistentRagVectorStoreAdapter,
  fingerprint: string,
  embedder: AsyncEmbedder,
  chunks: readonly RagChunkInput[],
  snapshotExists: boolean,
): Promise<RagRetrieveIndexLifecycleStatus> {
  const snapshot = store.snapshot();
  const actualChunks = snapshot.entries.map((entry) => entry.chunk);
  if (
    snapshot.fingerprint === fingerprint &&
    snapshot.entries.length === chunks.length &&
    stableChunkDigest(actualChunks) === stableChunkDigest(chunks)
  ) {
    return 'reused';
  }
  const vectors = await embedManyForRetrieve(
    embedder,
    chunks.map((chunk) => chunk.text),
  );
  if (vectors.length !== chunks.length) {
    throw new Error(`KERN async embedder returned ${vectors.length} vectors for ${chunks.length} inputs.`);
  }
  store.replaceAll(
    chunks.map((chunk, index) => ({
      chunk,
      vector: vectors[index],
      fingerprint,
    })),
  );
  return snapshotExists || snapshot.entries.length > 0 ? 'rebuilt' : 'indexed';
}

function closeLocalPersistentStores(
  entries: Iterable<{ readonly store: LocalPersistentRagVectorStoreAdapter }>,
): unknown {
  let firstError: unknown;
  for (const { store } of entries) {
    try {
      store.close();
    } catch (error) {
      firstError ??= error;
    }
  }
  return firstError;
}

function errorWithCloseError(error: unknown, closeError: unknown): unknown {
  if (!closeError) return error;
  const primary = error instanceof Error ? error : new Error(String(error));
  (primary as Error & { closeError?: unknown }).closeError = closeError;
  return primary;
}

function localPersistentFingerprint(
  vectorStore: RagSemanticVectorStoreFact,
  index: RagSemanticIndexFact,
  embedder: Pick<Embedder, 'dims' | 'id'>,
  chunks: readonly RagChunkInput[],
): string {
  return sha256(
    JSON.stringify({
      version: 'kern-rag-local-persistent-retrieve-v1',
      corpusName: index.corpusName,
      indexName: index.name,
      chunkingName: index.chunkingName ?? '',
      storeName: vectorStore.name,
      embedderId: embedder.id,
      dims: embedder.dims,
      chunks: stableChunkDigest(chunks),
    }),
  );
}

function stableChunkDigest(chunks: readonly RagChunkInput[]): string {
  return sha256(
    chunks
      .map((chunk) => stableJson(chunk))
      .sort(compareCodePoint)
      .join('\n'),
  );
}

function stableCorpusHashInput(chunks: readonly RagChunkInput[]): string {
  return chunks
    .map((chunk) => `${chunk.id}\0${chunk.source}\0${chunk.text}`)
    .sort(compareCodePoint)
    .join('\n');
}

function compareCodePoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function confinedRealDirectory(vectorStore: RagSemanticVectorStoreFact, baseDir: string, directory: string): string {
  const baseReal = realpathSync(baseDir);
  const existingAncestor = nearestExistingPath(directory);
  let ancestorReal: string;
  try {
    ancestorReal = realpathSync(existingAncestor);
  } catch {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent path must stay inside the declaring .kern directory.`,
    );
  }
  const targetReal = resolve(ancestorReal, relative(existingAncestor, directory));
  if (!isPathInside(targetReal, baseReal)) {
    throw new Error(
      `KERN RAG vectorStore '${vectorStore.name}' kind=local-persistent path must stay inside the declaring .kern directory.`,
    );
  }
  return targetReal;
}

function nearestExistingPath(path: string): string {
  let current = path;
  while (!pathExistsOrSymlink(current)) {
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function pathExistsOrSymlink(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isPathInside(path: string, base: string): boolean {
  const rel = relative(base, path);
  const [firstSegment] = rel.split(/[\\/]/u);
  return rel === '' || (firstSegment !== '..' && !isAbsolute(rel));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function safeLocalStoreFileName(name: string): string {
  return name.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'index';
}

function embedderForIndex(facts: RagSemanticFacts, index: RagSemanticIndexFact): Embedder {
  const embed = embedFactForIndex(facts, index);
  const model = canonicalRagEmbedModel(embed?.model);
  const dims = embed?.dims ?? defaultDimsForRagEmbedModel(model);
  return resolveSyncRagEmbedderForModel(model, dims);
}

function asyncEmbedderForIndex(
  facts: RagSemanticFacts,
  index: RagSemanticIndexFact,
  options: Pick<RagRetrieveAsyncDocumentOptions, 'providers'>,
): AsyncEmbedder {
  const embed = embedFactForIndex(facts, index);
  const model = canonicalRagEmbedModel(embed?.model);
  const dims = embed?.dims ?? defaultDimsForRagEmbedModel(model);
  return resolveAsyncRagEmbedderForModel(model, dims, options);
}

function safeAsyncEmbedderForIndex(
  facts: RagSemanticFacts,
  index: RagSemanticIndexFact,
  options: Pick<RagRetrieveAsyncDocumentOptions, 'providers'>,
): AsyncEmbedder {
  try {
    return asyncEmbedderForIndex(facts, index, options);
  } catch (error) {
    throw providerError(error, index, { id: index.embedName ?? 'unresolved' });
  }
}

function ensureAsyncEmbedder(embedder: AsyncEmbedder | Embedder): AsyncEmbedder {
  return {
    id: embedder.id,
    dims: embedder.dims,
    embed: async (text: string) => embedder.embed(text),
    embedMany: async (texts: readonly string[]) => {
      const maybeBatch = (embedder as AsyncEmbedder).embedMany;
      if (maybeBatch) return maybeBatch.call(embedder, texts);
      return Promise.all(texts.map((text) => embedder.embed(text)));
    },
  };
}

function embedFactForIndex(facts: RagSemanticFacts, index: RagSemanticIndexFact) {
  const embed = index.embedName
    ? facts.corpora
        .filter((corpus) => corpus.name === index.corpusName)
        .flatMap((corpus) => corpus.embeds)
        .find((entry) => entry.name === index.embedName)
    : undefined;
  if (index.embedName && !embed) throw new Error(`KERN RAG embed '${index.embedName}' not found.`);
  return embed;
}

async function embedManyForRetrieve(
  embedder: AsyncEmbedder,
  texts: readonly string[],
): Promise<readonly Float64Array[]> {
  return embedder.embedMany ? embedder.embedMany(texts) : Promise.all(texts.map((text) => embedder.embed(text)));
}

class KernRagProviderError extends Error {
  readonly code = 'KERN_RAG_PROVIDER_ERROR';

  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message);
    if (options && 'cause' in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

function providerError(error: unknown, index: RagSemanticIndexFact, embedder: Pick<AsyncEmbedder, 'id'>): Error {
  if (error instanceof KernRagProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new KernRagProviderError(
    `KERN RAG provider-backed retrieval failed for index '${index.name}' using embedder '${embedder.id}': ${sanitizeProviderMessage(message)}`,
    { cause: error },
  );
}

function sanitizeProviderMessage(message: string): string {
  const redacted = message
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer ***')
    .replace(/\b(?:sk|pk|rk|api[_-]?key|token)[-_][A-Za-z0-9._~+/=-]{8,}/giu, (match) => {
      const [prefix] = match.split(/[-_]/u);
      return `${prefix}-***`;
    })
    .replace(/\b[A-Za-z0-9._~+/=-]{40,}\b/gu, '***');
  return redacted.length > 240 ? `${redacted.slice(0, 237)}...` : redacted;
}

export function ragRetrieveCorpusSourceSummary(report: RagRetrieveDocumentReport): string {
  const ingestion = report.ingestion;
  if (!ingestion) return '0 chunks';
  return `${ingestion.chunks.length} chunks, sha256=${ingestion.corpusSha256}`;
}
