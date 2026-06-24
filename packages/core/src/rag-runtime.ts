import type {
  RagSemanticAnswerContractFact,
  RagSemanticEvalAssertFact,
  RagSemanticEvalCaseFact,
  RagSemanticEvalFact,
  RagSemanticMcpRetrievalFact,
} from './semantic-validator.js';
import { RAG_MCP_RETRIEVE_OUTPUT_ITEM_SHAPE, RAG_MCP_RETRIEVE_OUTPUT_SHAPE } from './semantic-validator.js';

export interface RagCitation {
  readonly uri?: string;
  readonly locator?: string;
}

export interface RagChunkInput {
  readonly id: string;
  readonly text: string;
  readonly source: string;
  readonly citation?: RagCitation;
  readonly metadata?: Record<string, unknown>;
}

export interface RetrievedChunk {
  readonly id: string;
  readonly text: string;
  readonly score: number;
  readonly source: string;
  readonly citation: RagCitation;
  readonly metadata?: Record<string, unknown>;
}

export interface RetrieveOptions {
  readonly topK?: number;
  readonly minScore?: number;
}

export interface RetrieveResult {
  readonly query: string;
  readonly chunks: readonly RetrievedChunk[];
}

export type InMemoryRagRetriever = (query: string, options?: RetrieveOptions) => RetrieveResult;
export type RagContractRetriever = (query: string, options?: RetrieveOptions) => RetrieveResult;
export type AsyncRagContractRetriever = (query: string, options?: RetrieveOptions) => Promise<RetrieveResult>;

export const MAX_IN_MEMORY_RAG_TOP_K = 1000;

export type RagRuntimeProvenanceStatus = 'success' | 'retriever_error' | 'eval_failed';

export interface RagRuntimeProvenance {
  readonly runId: string;
  readonly retrieverName?: string;
  readonly targetKind?: 'retriever' | 'rag';
  readonly targetName?: string;
  readonly query: string;
  readonly retrieveOptions: RetrieveOptions;
  readonly citationsRequired: boolean;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly chunkCount: number;
  readonly chunkHashes: readonly string[];
  readonly sources: readonly string[];
  readonly contractStatus: RagRuntimeProvenanceStatus;
}

export interface RagRuntimeProvenanceOptions {
  readonly runId?: string;
  readonly retrieverName?: string;
  readonly targetKind?: 'retriever' | 'rag';
  readonly targetName?: string;
  readonly retrieveOptions?: RetrieveOptions;
  readonly citationsRequired?: boolean;
  readonly startedAtMs?: number;
  readonly durationMs?: number;
  readonly contractStatus?: RagRuntimeProvenanceStatus;
}

export interface ProvenancedRetrieveResult extends RetrieveResult {
  readonly provenance: RagRuntimeProvenance;
}

export interface RagMcpRetrieveProvenanceMapping {
  readonly outputShape?: string;
  readonly outputItemShape?: string;
  readonly citationField?: string;
  readonly sourceField?: string;
  readonly scoreField?: string;
  readonly provenance?: string;
  readonly citationsRequired: boolean;
  readonly contractStatus: RagSemanticMcpRetrievalFact['contractStatus'];
  readonly compatible: boolean;
}

export type RagAnswerContractStatus = 'grounded' | 'partially_grounded' | 'ungrounded' | 'abstained' | 'invalid';

export type RagAnswerContractDiagnosticCode =
  | 'ANSWER_EMPTY'
  | 'ABSTAIN_ANSWER_MISMATCH'
  | 'ABSTAIN_EVIDENCE_POLICY_REQUIRED'
  | 'ABSTAIN_NOT_ALLOWED'
  | 'ABSTAIN_WITH_SUFFICIENT_EVIDENCE'
  | 'CITED_CHUNKS_BELOW_MINIMUM'
  | 'EVIDENCE_INSUFFICIENT'
  | 'QUERY_MISMATCH'
  | 'RETRIEVER_ERROR'
  | 'PROVENANCE_MISMATCH'
  | 'SPAN_INVALID'
  | 'SPAN_UNGROUNDED'
  | 'CHUNK_REF_UNKNOWN'
  | 'CITATION_REQUIRED'
  | 'GROUNDING_BELOW_THRESHOLD';

export interface RagAnswerGroundingSpan {
  readonly start: number;
  readonly end: number;
  readonly chunkIds: readonly string[];
  readonly required?: boolean;
}

export interface RagAnswerEvidencePolicy {
  readonly minRetrievedChunks?: number;
  readonly minTopScore?: number;
}

export interface RagAnswerContract {
  readonly id?: string;
  readonly ragName?: string;
  readonly prompt?: string;
  readonly query: string;
  readonly answer: string;
  readonly retrieval: RetrieveResult | ProvenancedRetrieveResult;
  readonly provenance?: RagRuntimeProvenance;
  readonly groundingSpans?: readonly RagAnswerGroundingSpan[];
  readonly requireCitations?: boolean;
  readonly minCitedChunks?: number;
  readonly minGroundingCoverage?: number;
  readonly evidencePolicy?: RagAnswerEvidencePolicy;
  readonly abstained?: boolean;
  readonly allowAbstain?: boolean;
  readonly abstainAnswer?: string;
}

export interface RagAnswerContractDiagnostic {
  readonly code: RagAnswerContractDiagnosticCode;
  readonly message: string;
  readonly spanIndex?: number;
  readonly chunkId?: string;
}

export interface RagAnswerContractResult {
  readonly id?: string;
  readonly ragName?: string;
  readonly query: string;
  readonly passed: boolean;
  readonly status: RagAnswerContractStatus;
  readonly groundingCoverage: number;
  readonly groundedChars: number;
  readonly answerChars: number;
  readonly evidenceSufficient: boolean;
  readonly abstained: boolean;
  readonly citedChunkIds: readonly string[];
  readonly sources: readonly string[];
  readonly provenance?: RagRuntimeProvenance;
  readonly diagnostics: readonly RagAnswerContractDiagnostic[];
}

export type RagEvalAssertionCode =
  | 'PASS'
  | 'ASSERTION_FAIL'
  | 'INVALID_ASSERTION'
  | 'RETRIEVER_ERROR'
  | 'UNSUPPORTED_ASSERTION';

export interface RagEvalContractOptions {
  readonly sourceGlobCaseSensitive?: boolean;
  readonly now?: () => number;
}

export interface RagEvalAssertionResult {
  readonly kind: string;
  readonly required?: boolean;
  readonly passed: boolean;
  readonly code: RagEvalAssertionCode;
  readonly message: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
}

export interface RagEvalCaseResult {
  readonly name: string;
  readonly query: string;
  readonly passed: boolean;
  readonly durationMs: number;
  readonly retrieveOptions: RetrieveOptions;
  readonly chunks: readonly RetrievedChunk[];
  readonly assertions: readonly RagEvalAssertionResult[];
}

export interface RagEvalGroundingMetrics {
  readonly passed: boolean;
  readonly passRate: number;
  readonly passedCaseCount: number;
  readonly failedCaseCount: number;
  readonly evaluatedCaseCount: number;
}

export interface RagEvalContractMetrics {
  readonly hitRate: number | null;
  readonly citationCoverage: number;
  readonly minRelevance: number | null;
  readonly grounding: RagEvalGroundingMetrics;
}

export interface RagEvalContractResult {
  readonly passed: boolean;
  readonly ragName?: string;
  readonly evalName?: string;
  readonly caseCount: number;
  readonly passedCaseCount: number;
  readonly assertionCount: number;
  readonly passedAssertionCount: number;
  readonly durationMs: number;
  readonly cases: readonly RagEvalCaseResult[];
  readonly metrics: RagEvalContractMetrics;
}

export interface RagSemanticAnswerContractOptions {
  readonly provenance?: RagRuntimeProvenance;
}

interface StoredRagChunk {
  readonly chunk: RagChunkInput;
  readonly terms: ReadonlySet<string>;
}

export class InMemoryRagCorpus {
  private readonly chunks = new Map<string, StoredRagChunk>();

  constructor(chunks: Iterable<RagChunkInput> = []) {
    for (const chunk of chunks) this.add(chunk);
  }

  get size(): number {
    return this.chunks.size;
  }

  add(chunk: RagChunkInput): void {
    if (typeof chunk.id !== 'string' || !chunk.id.trim()) {
      throw new Error('KERN RAG runtime chunk id must be a non-empty string.');
    }
    if (typeof chunk.text !== 'string' || !chunk.text.trim()) {
      throw new Error(`KERN RAG runtime chunk '${chunk.id}' text must be a non-empty string.`);
    }
    if (typeof chunk.source !== 'string' || !chunk.source.trim()) {
      throw new Error(`KERN RAG runtime chunk '${chunk.id}' source must be a non-empty string.`);
    }
    const storedChunk = {
      ...chunk,
      citation: chunk.citation ? { ...chunk.citation } : undefined,
      metadata: chunk.metadata ? cloneMetadata(chunk.metadata) : undefined,
    };
    this.chunks.set(chunk.id, { chunk: storedChunk, terms: tokenizeForRetrieval(storedChunk.text) });
  }

  get(id: string): RagChunkInput | undefined {
    const stored = this.chunks.get(id);
    return stored ? cloneChunkInput(stored.chunk) : undefined;
  }

  all(): RagChunkInput[] {
    return Array.from(this.chunks.values(), (stored) => cloneChunkInput(stored.chunk));
  }

  retrieve(query: string, options: RetrieveOptions = {}): RetrieveResult {
    if (typeof query !== 'string') throw new Error('KERN RAG runtime query must be a string.');
    const { topK, minScore } = normalizeRetrieveOptions(options);
    const queryTerms = tokenizeForRetrieval(query);
    if (queryTerms.size === 0) return { query, chunks: [] };

    const chunks = Array.from(this.chunks.values())
      .map((stored) => ({ chunk: stored.chunk, score: jaccardScore(queryTerms, stored.terms) }))
      .filter((candidate) => candidate.score > 0 && candidate.score >= minScore)
      .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
      .slice(0, topK)
      .map(({ chunk, score }) => retrievedChunk(chunk, score));

    return { query, chunks };
  }
}

export function createInMemoryRetriever(corpus: InMemoryRagCorpus): InMemoryRagRetriever {
  return (query: string, options: RetrieveOptions = {}): RetrieveResult => corpus.retrieve(query, options);
}

export function retrieveFromInMemoryCorpus(
  corpus: InMemoryRagCorpus,
  query: string,
  options: RetrieveOptions = {},
): RetrieveResult {
  return corpus.retrieve(query, options);
}

export function createRagRuntimeProvenance(
  result: RetrieveResult,
  options: RagRuntimeProvenanceOptions = {},
): RagRuntimeProvenance {
  const validResult = validateRetrieveResult(result);
  const retrieveOptions = normalizeProvenanceRetrieveOptions(options.retrieveOptions);
  const chunkHashes = validResult.chunks.map((chunk) => hashRetrievedChunkText(chunk.text));
  const chunkProvenance = validResult.chunks.map((chunk, index) => ({
    index,
    id: chunk.id,
    source: chunk.source,
    score: chunk.score,
    citation: { ...chunk.citation },
    textHash: chunkHashes[index],
  }));
  const sources = uniqueOrdered(validResult.chunks.map((chunk) => chunk.source));
  const startedAtMs = options.startedAtMs ?? Date.now();
  const durationMs = options.durationMs ?? 0;
  const contractStatus = options.contractStatus ?? 'success';
  return {
    runId:
      options.runId ??
      hashRetrievedChunkText(
        stableStringify({
          retrieverName: options.retrieverName,
          targetKind: options.targetKind,
          targetName: options.targetName,
          query: validResult.query,
          retrieveOptions,
          citationsRequired: options.citationsRequired ?? false,
          chunks: chunkProvenance,
          contractStatus,
        }),
      ),
    ...optionalStringValue('retrieverName', options.retrieverName),
    ...(options.targetKind ? { targetKind: options.targetKind } : {}),
    ...optionalStringValue('targetName', options.targetName),
    query: validResult.query,
    retrieveOptions,
    citationsRequired: options.citationsRequired ?? false,
    startedAtMs,
    durationMs,
    chunkCount: validResult.chunks.length,
    chunkHashes,
    sources,
    contractStatus,
  };
}

export function withRagRuntimeProvenance(
  result: RetrieveResult,
  options: RagRuntimeProvenanceOptions = {},
): ProvenancedRetrieveResult {
  const validResult = validateRetrieveResult(result);
  return {
    query: validResult.query,
    chunks: validResult.chunks.map(cloneRetrievedChunk),
    provenance: createRagRuntimeProvenance(validResult, options),
  };
}

export function ragMcpRetrieveProvenanceMapping(
  retrieval: RagSemanticMcpRetrievalFact | null | undefined,
): RagMcpRetrieveProvenanceMapping {
  if (!retrieval) throw new Error('KERN RAG MCP provenance mapping requires a retrieval fact.');
  return {
    ...optionalStringValue('outputShape', retrieval.outputShape),
    ...optionalStringValue('outputItemShape', retrieval.outputItemShape),
    ...optionalStringValue('citationField', retrieval.citationField),
    ...optionalStringValue('sourceField', retrieval.sourceField),
    ...optionalStringValue('scoreField', retrieval.scoreField),
    ...optionalStringValue('provenance', retrieval.provenance),
    citationsRequired: retrieval.effectiveRequiresCitations,
    contractStatus: retrieval.contractStatus,
    compatible:
      retrieval.contractStatus === 'valid' &&
      retrieval.outputShape === RAG_MCP_RETRIEVE_OUTPUT_SHAPE &&
      (retrieval.outputItemShape === undefined || retrieval.outputItemShape === RAG_MCP_RETRIEVE_OUTPUT_ITEM_SHAPE),
  };
}

export function evaluateRagAnswerContract(contract: RagAnswerContract): RagAnswerContractResult {
  const base = {
    ...optionalStringValue('id', contract.id),
    ...optionalStringValue('ragName', contract.ragName),
    query: typeof contract.query === 'string' ? contract.query : '',
  };
  let retrieval: RetrieveResult;
  try {
    retrieval = validateRetrieveResult(contract.retrieval);
  } catch (error) {
    return {
      ...base,
      passed: false,
      status: 'invalid',
      groundingCoverage: 0,
      groundedChars: 0,
      answerChars: 0,
      evidenceSufficient: false,
      abstained: contract.abstained === true,
      citedChunkIds: [],
      sources: [],
      ...(contract.provenance ? { provenance: contract.provenance } : {}),
      diagnostics: [
        {
          code: 'RETRIEVER_ERROR',
          message: `RAG answer contract retrieval failed: ${error instanceof Error ? error.message : String(error)}.`,
        },
      ],
    };
  }

  const answer = typeof contract.answer === 'string' ? contract.answer : '';
  const answerChars = countAnswerChars(answer);
  const diagnostics: RagAnswerContractDiagnostic[] = [];
  if (typeof contract.answer !== 'string' || answerChars === 0) {
    diagnostics.push({ code: 'ANSWER_EMPTY', message: 'RAG answer contract answer must be a non-empty string.' });
  }

  const minGroundingCoverage = normalizeGroundingCoverageThreshold(contract.minGroundingCoverage);
  const minCitedChunks = normalizeNonNegativeInteger(contract.minCitedChunks, 'minCitedChunks');
  const evidencePolicy = normalizeEvidencePolicy(contract.evidencePolicy);
  const evidenceDiagnostics = evaluateEvidencePolicy(evidencePolicy, retrieval);
  const evidenceSufficient = evidenceDiagnostics.length === 0;
  const hasStrictEvidencePolicy =
    contract.evidencePolicy !== undefined && (evidencePolicy.minRetrievedChunks > 0 || evidencePolicy.minTopScore > 0);
  const abstained = contract.abstained === true;
  const allowAbstain = contract.allowAbstain === true;
  const provenance = contract.provenance ?? retrieveResultProvenance(contract.retrieval);
  if (contract.query !== retrieval.query) {
    diagnostics.push({
      code: 'QUERY_MISMATCH',
      message: 'RAG answer contract query does not match the retrieval result query.',
    });
  }
  if (provenance && !provenanceMatchesRetrieval(provenance, retrieval)) {
    diagnostics.push({
      code: 'PROVENANCE_MISMATCH',
      message: 'RAG answer contract provenance does not match the retrieval result.',
    });
  }

  const chunkById = new Map(retrieval.chunks.map((chunk) => [chunk.id, chunk]));
  const grounded = new Array(answer.length).fill(false) as boolean[];
  const citedChunkIds = new Set<string>();
  const citationBearingChunkIds = new Set<string>();
  const groundingSpans = Array.isArray(contract.groundingSpans) ? contract.groundingSpans : [];
  if (contract.groundingSpans !== undefined && !Array.isArray(contract.groundingSpans)) {
    diagnostics.push({
      code: 'SPAN_INVALID',
      message: 'RAG answer contract groundingSpans must be an array.',
    });
  }

  for (const [spanIndex, span] of groundingSpans.entries()) {
    if (!isValidGroundingSpan(span, answer.length)) {
      diagnostics.push({
        code: 'SPAN_INVALID',
        spanIndex,
        message: `RAG answer grounding span at index ${spanIndex} is invalid or outside the answer text.`,
      });
      continue;
    }

    const validChunkIds: string[] = [];
    let spanHasCitation = false;
    for (const chunkId of span.chunkIds) {
      if (chunkById.has(chunkId)) {
        validChunkIds.push(chunkId);
        citedChunkIds.add(chunkId);
        if (chunkHasCitation(chunkById.get(chunkId))) {
          spanHasCitation = true;
          citationBearingChunkIds.add(chunkId);
        }
      } else {
        diagnostics.push({
          code: 'CHUNK_REF_UNKNOWN',
          spanIndex,
          chunkId,
          message: `RAG answer grounding span at index ${spanIndex} references unknown chunk '${chunkId}'.`,
        });
      }
    }

    if (validChunkIds.length === 0) {
      diagnostics.push({
        code: span.required ? 'CITATION_REQUIRED' : 'SPAN_UNGROUNDED',
        spanIndex,
        message: `RAG answer grounding span at index ${spanIndex} has no valid retrieved chunk citation.`,
      });
      continue;
    }

    if (contract.requireCitations && !spanHasCitation) {
      diagnostics.push({
        code: 'CITATION_REQUIRED',
        spanIndex,
        message: `RAG answer grounding span at index ${spanIndex} requires a non-empty retrieved chunk citation.`,
      });
      continue;
    }

    for (let index = span.start; index < span.end; index += 1) grounded[index] = true;
  }

  const groundedChars = countGroundedAnswerChars(answer, grounded);
  const groundingCoverage = answerChars === 0 ? 0 : groundedChars / answerChars;
  if (abstained) {
    if (!allowAbstain) {
      diagnostics.push({
        code: 'ABSTAIN_NOT_ALLOWED',
        message: 'RAG answer contract abstained but the contract does not allow abstention.',
      });
    }
    if (typeof contract.abstainAnswer !== 'string' || contract.abstainAnswer.trim().length === 0) {
      diagnostics.push({
        code: 'ABSTAIN_ANSWER_MISMATCH',
        message: 'RAG answer contract abstention requires a non-empty abstainAnswer.',
      });
    } else if (answer.trim() !== contract.abstainAnswer.trim()) {
      diagnostics.push({
        code: 'ABSTAIN_ANSWER_MISMATCH',
        message: 'RAG answer contract abstention answer does not match the configured abstainAnswer.',
      });
    }
    if (!hasStrictEvidencePolicy) {
      diagnostics.push({
        code: 'ABSTAIN_EVIDENCE_POLICY_REQUIRED',
        message: 'RAG answer contract abstention requires a strict evidence policy.',
      });
    } else if (evidenceSufficient) {
      diagnostics.push({
        code: 'ABSTAIN_WITH_SUFFICIENT_EVIDENCE',
        message: 'RAG answer contract abstained even though retrieved evidence satisfies the evidence policy.',
      });
    }
  } else {
    diagnostics.push(...evidenceDiagnostics);
    if (
      answerChars > 0 &&
      contract.requireCitations &&
      citationBearingChunkIds.size === 0 &&
      groundingSpans.length === 0
    ) {
      diagnostics.push({
        code: 'CITATION_REQUIRED',
        message: 'RAG answer contract requires citations but no retrieved chunks were cited.',
      });
    }
    if (answerChars > 0 && citedChunkIds.size < minCitedChunks) {
      diagnostics.push({
        code: 'CITED_CHUNKS_BELOW_MINIMUM',
        message: `RAG answer cited ${citedChunkIds.size} retrieved chunks but requires at least ${minCitedChunks}.`,
      });
    }
    if (answerChars > 0 && groundingCoverage < minGroundingCoverage) {
      diagnostics.push({
        code: 'GROUNDING_BELOW_THRESHOLD',
        message: `RAG answer grounding coverage ${groundingCoverage.toFixed(3)} is below required threshold ${minGroundingCoverage.toFixed(3)}.`,
      });
    }
  }

  const passed = diagnostics.length === 0;
  return {
    ...base,
    passed,
    status: passed ? (abstained ? 'abstained' : 'grounded') : ragAnswerStatus(diagnostics, groundingCoverage),
    groundingCoverage,
    groundedChars,
    answerChars,
    evidenceSufficient,
    abstained,
    citedChunkIds: [...citedChunkIds].sort(stableStringCompare),
    sources: uniqueOrdered([...citedChunkIds].map((chunkId) => chunkById.get(chunkId)?.source).filter(isString)),
    ...(provenance ? { provenance } : {}),
    diagnostics,
  };
}

export function ragAnswerContractFromSemanticFact(
  fact: RagSemanticAnswerContractFact,
  retrieval: RetrieveResult | ProvenancedRetrieveResult,
  options: RagSemanticAnswerContractOptions = {},
): RagAnswerContract {
  return {
    id: fact.name,
    ...optionalStringValue('ragName', fact.ragName),
    ...optionalStringValue('prompt', fact.prompt),
    query: fact.query,
    answer: fact.answer,
    retrieval,
    ...(options.provenance ? { provenance: options.provenance } : {}),
    groundingSpans: fact.spans.map((span) => ({
      start: span.start,
      end: span.end,
      chunkIds: [...span.chunkIds],
      ...(span.required ? { required: true } : {}),
    })),
    requireCitations: fact.requireCitations,
    ...optionalNumberValue('minGroundingCoverage', fact.minGroundingCoverage),
    ...optionalNumberValue('minCitedChunks', fact.minCitedChunks),
    ...(fact.evidencePolicy ? { evidencePolicy: { ...fact.evidencePolicy } } : {}),
    ...(fact.abstained !== undefined ? { abstained: fact.abstained } : {}),
    ...(fact.allowAbstain !== undefined ? { allowAbstain: fact.allowAbstain } : {}),
    ...optionalStringValue('abstainAnswer', fact.abstainAnswer),
  };
}

export function evaluateRagSemanticAnswerContract(
  fact: RagSemanticAnswerContractFact,
  retrieval: RetrieveResult | ProvenancedRetrieveResult,
  options: RagSemanticAnswerContractOptions = {},
): RagAnswerContractResult {
  return evaluateRagAnswerContract(ragAnswerContractFromSemanticFact(fact, retrieval, options));
}

export function evaluateRagEvalContract(
  evaluation: RagSemanticEvalFact,
  retriever: RagContractRetriever,
  options: RagEvalContractOptions = {},
): RagEvalContractResult {
  const startedAt = runtimeNow(options);
  const cases = (evaluation.cases ?? []).map((evaluationCase) =>
    evaluateRagCase(evaluation, evaluationCase, retriever, options),
  );
  const assertionCount = cases.reduce((count, evaluationCase) => count + evaluationCase.assertions.length, 0);
  const passedAssertionCount = cases.reduce(
    (count, evaluationCase) => count + evaluationCase.assertions.filter((assertion) => assertion.passed).length,
    0,
  );
  return {
    // Empty eval contracts fail closed; a vacuous pass would hide unconfigured evals.
    passed: cases.length > 0 && cases.every((evaluationCase) => evaluationCase.passed),
    ...optionalStringValue('ragName', evaluation.ragName),
    ...optionalStringValue('evalName', evaluation.name),
    caseCount: cases.length,
    passedCaseCount: cases.filter((evaluationCase) => evaluationCase.passed).length,
    assertionCount,
    passedAssertionCount,
    durationMs: runtimeNow(options) - startedAt,
    cases,
    metrics: ragEvalMetrics(cases),
  };
}

export async function evaluateRagEvalContractAsync(
  evaluation: RagSemanticEvalFact,
  retriever: AsyncRagContractRetriever,
  options: RagEvalContractOptions = {},
): Promise<RagEvalContractResult> {
  const startedAt = runtimeNow(options);
  const cases = await Promise.all(
    (evaluation.cases ?? []).map((evaluationCase) =>
      evaluateRagCaseAsync(evaluation, evaluationCase, retriever, options),
    ),
  );
  const assertionCount = cases.reduce((count, evaluationCase) => count + evaluationCase.assertions.length, 0);
  const passedAssertionCount = cases.reduce(
    (count, evaluationCase) => count + evaluationCase.assertions.filter((assertion) => assertion.passed).length,
    0,
  );
  return {
    passed: cases.length > 0 && cases.every((evaluationCase) => evaluationCase.passed),
    ...optionalStringValue('ragName', evaluation.ragName),
    ...optionalStringValue('evalName', evaluation.name),
    caseCount: cases.length,
    passedCaseCount: cases.filter((evaluationCase) => evaluationCase.passed).length,
    assertionCount,
    passedAssertionCount,
    durationMs: runtimeNow(options) - startedAt,
    cases,
    metrics: ragEvalMetrics(cases),
  };
}

export function hashRetrievedChunkText(text: string): string {
  let left = 0xcbf29ce484222325n;
  let right = 0x84222325cbf29ce4n;
  for (const byte of new TextEncoder().encode(text)) {
    const value = BigInt(byte);
    left ^= value;
    left = BigInt.asUintN(64, left * 0x100000001b3n);
    right ^= value + 0x9en;
    right = BigInt.asUintN(64, right * 0x100000001b3n);
  }
  return `${left.toString(16).padStart(16, '0')}${right.toString(16).padStart(16, '0')}`;
}

function normalizeRetrieveOptions(options: RetrieveOptions): Required<RetrieveOptions> {
  const topK = options.topK ?? 5;
  const minScore = options.minScore ?? 0;
  if (!Number.isInteger(topK) || topK <= 0 || topK > MAX_IN_MEMORY_RAG_TOP_K) {
    throw new Error(`KERN RAG runtime topK must be a positive integer up to ${MAX_IN_MEMORY_RAG_TOP_K}.`);
  }
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new Error('KERN RAG runtime minScore must be between 0 and 1.');
  }
  return { topK, minScore };
}

function normalizeGroundingCoverageThreshold(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('KERN RAG answer contract minGroundingCoverage must be between 0 and 1.');
  }
  return value;
}

function normalizeNonNegativeInteger(value: number | undefined, fieldName: string): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`KERN RAG answer contract ${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function normalizeEvidencePolicy(policy: RagAnswerEvidencePolicy | undefined): Required<RagAnswerEvidencePolicy> {
  const minRetrievedChunks = normalizeNonNegativeInteger(
    policy?.minRetrievedChunks,
    'evidencePolicy.minRetrievedChunks',
  );
  const minTopScore = policy?.minTopScore ?? 0;
  if (!Number.isFinite(minTopScore) || minTopScore < 0 || minTopScore > 1) {
    throw new Error('KERN RAG answer contract evidencePolicy.minTopScore must be between 0 and 1.');
  }
  return { minRetrievedChunks, minTopScore };
}

function evaluateEvidencePolicy(
  policy: Required<RagAnswerEvidencePolicy>,
  retrieval: RetrieveResult,
): RagAnswerContractDiagnostic[] {
  const diagnostics: RagAnswerContractDiagnostic[] = [];
  if (retrieval.chunks.length < policy.minRetrievedChunks) {
    diagnostics.push({
      code: 'EVIDENCE_INSUFFICIENT',
      message: `RAG answer retrieved ${retrieval.chunks.length} chunks but requires at least ${policy.minRetrievedChunks}.`,
    });
  }
  const topScore = retrieval.chunks.reduce((maxScore, chunk) => Math.max(maxScore, chunk.score), 0);
  if (topScore < policy.minTopScore) {
    diagnostics.push({
      code: 'EVIDENCE_INSUFFICIENT',
      message: `RAG answer top retrieval score ${topScore.toFixed(3)} is below required evidence threshold ${policy.minTopScore.toFixed(3)}.`,
    });
  }
  return diagnostics;
}

function retrieveResultProvenance(
  result: RetrieveResult | ProvenancedRetrieveResult,
): RagRuntimeProvenance | undefined {
  return result && typeof result === 'object' && 'provenance' in result ? result.provenance : undefined;
}

function provenanceMatchesRetrieval(provenance: RagRuntimeProvenance, retrieval: RetrieveResult): boolean {
  if (
    !provenance ||
    typeof provenance.query !== 'string' ||
    typeof provenance.chunkCount !== 'number' ||
    !Array.isArray(provenance.chunkHashes) ||
    !Array.isArray(provenance.sources)
  ) {
    return false;
  }
  const chunkHashes = retrieval.chunks.map((chunk) => hashRetrievedChunkText(chunk.text));
  const sources = uniqueOrdered(retrieval.chunks.map((chunk) => chunk.source));
  return (
    provenance.query === retrieval.query &&
    provenance.chunkCount === retrieval.chunks.length &&
    arraysEqual(provenance.chunkHashes, chunkHashes) &&
    arraysEqual(provenance.sources, sources)
  );
}

function chunkHasCitation(chunk: RetrievedChunk | undefined): boolean {
  return (
    !!chunk &&
    ((typeof chunk.citation.uri === 'string' && chunk.citation.uri.trim().length > 0) ||
      (typeof chunk.citation.locator === 'string' && chunk.citation.locator.trim().length > 0))
  );
}

function isValidGroundingSpan(span: RagAnswerGroundingSpan, answerLength: number): boolean {
  return (
    !!span &&
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start &&
    span.end <= answerLength &&
    Array.isArray(span.chunkIds) &&
    span.chunkIds.every(isString)
  );
}

function countAnswerChars(answer: string): number {
  if (typeof answer !== 'string') return 0;
  let count = 0;
  for (let index = 0; index < answer.length; index += 1) {
    if (!/\s/u.test(answer[index] ?? '')) count += 1;
  }
  return count;
}

function countGroundedAnswerChars(answer: string, grounded: readonly boolean[]): number {
  let count = 0;
  for (let index = 0; index < answer.length; index += 1) {
    if (grounded[index] && !/\s/u.test(answer[index] ?? '')) count += 1;
  }
  return count;
}

function ragAnswerStatus(
  diagnostics: readonly RagAnswerContractDiagnostic[],
  groundingCoverage: number,
): RagAnswerContractStatus {
  if (
    diagnostics.some((diagnostic) =>
      [
        'ANSWER_EMPTY',
        'ABSTAIN_ANSWER_MISMATCH',
        'ABSTAIN_EVIDENCE_POLICY_REQUIRED',
        'ABSTAIN_NOT_ALLOWED',
        'ABSTAIN_WITH_SUFFICIENT_EVIDENCE',
        'CITED_CHUNKS_BELOW_MINIMUM',
        'EVIDENCE_INSUFFICIENT',
        'CITATION_REQUIRED',
        'QUERY_MISMATCH',
        'RETRIEVER_ERROR',
        'PROVENANCE_MISMATCH',
        'SPAN_INVALID',
        'CHUNK_REF_UNKNOWN',
      ].includes(diagnostic.code),
    )
  ) {
    return 'invalid';
  }
  if (groundingCoverage === 0) return 'ungrounded';
  return 'partially_grounded';
}

function evaluateRagCase(
  evaluation: RagSemanticEvalFact,
  evaluationCase: RagSemanticEvalCaseFact,
  retriever: RagContractRetriever,
  options: RagEvalContractOptions,
): RagEvalCaseResult {
  const retrieveOptions = caseRetrieveOptions(evaluationCase);
  const startedAt = runtimeNow(options);
  let chunks: readonly RetrievedChunk[] = [];
  let assertions: RagEvalAssertionResult[] = [];
  try {
    chunks = validateRetrieveResult(retriever(evaluationCase.query, retrieveOptions)).chunks;
  } catch (error) {
    assertions = [
      {
        kind: 'retriever',
        passed: false,
        code: 'RETRIEVER_ERROR',
        message: `RAG eval case '${evaluationCase.name}' retriever failed: ${error instanceof Error ? error.message : String(error)}.`,
      },
    ];
  }
  const durationMs = runtimeNow(options) - startedAt;
  if (assertions.length === 0) {
    assertions = [
      ...evaluateExpectedCaseContracts(evaluationCase, chunks),
      ...(evaluationCase.asserts ?? []).map((assertion) =>
        evaluateRagAssertion(evaluation, evaluationCase, assertion, chunks, durationMs, options),
      ),
    ];
  }
  return {
    name: evaluationCase.name,
    query: evaluationCase.query,
    passed: assertions.every(isPassingOrAdvisoryAssertion),
    durationMs,
    retrieveOptions,
    chunks,
    assertions,
  };
}

async function evaluateRagCaseAsync(
  evaluation: RagSemanticEvalFact,
  evaluationCase: RagSemanticEvalCaseFact,
  retriever: AsyncRagContractRetriever,
  options: RagEvalContractOptions,
): Promise<RagEvalCaseResult> {
  const retrieveOptions = caseRetrieveOptions(evaluationCase);
  const startedAt = runtimeNow(options);
  let chunks: readonly RetrievedChunk[] = [];
  let assertions: RagEvalAssertionResult[] = [];
  try {
    chunks = validateRetrieveResult(await retriever(evaluationCase.query, retrieveOptions)).chunks;
  } catch (error) {
    assertions = [
      {
        kind: 'retriever',
        passed: false,
        code: 'RETRIEVER_ERROR',
        message: `RAG eval case '${evaluationCase.name}' retriever failed: ${error instanceof Error ? error.message : String(error)}.`,
      },
    ];
  }
  const durationMs = runtimeNow(options) - startedAt;
  if (assertions.length === 0) {
    assertions = [
      ...evaluateExpectedCaseContracts(evaluationCase, chunks),
      ...(evaluationCase.asserts ?? []).map((assertion) =>
        evaluateRagAssertion(evaluation, evaluationCase, assertion, chunks, durationMs, options),
      ),
    ];
  }
  return {
    name: evaluationCase.name,
    query: evaluationCase.query,
    passed: assertions.every(isPassingOrAdvisoryAssertion),
    durationMs,
    retrieveOptions,
    chunks,
    assertions,
  };
}

function caseRetrieveOptions(evaluationCase: RagSemanticEvalCaseFact): RetrieveOptions {
  return {
    ...optionalNumberValue('topK', evaluationCase.expected?.topK),
    ...optionalNumberValue('minScore', evaluationCase.expected?.minScore),
  };
}

function ragEvalMetrics(cases: readonly RagEvalCaseResult[]): RagEvalContractMetrics {
  const totalChunks = cases.reduce((count, evaluationCase) => count + evaluationCase.chunks.length, 0);
  const citedChunks = cases.reduce(
    (count, evaluationCase) => count + evaluationCase.chunks.filter(chunkHasCitation).length,
    0,
  );
  const relevanceAssertions = cases.flatMap((evaluationCase) =>
    evaluationCase.assertions.filter(isRetrievalHitAssertion),
  );
  const groundingCases = cases
    .map((evaluationCase) => evaluationCase.assertions.filter(isGroundingAssertion))
    .filter((assertions) => assertions.length > 0);
  const groundingPassedCaseCount = cases.filter(
    (evaluationCase) =>
      evaluationCase.assertions.some(isGroundingAssertion) &&
      evaluationCase.assertions.filter(isGroundingAssertion).every((assertion) => assertion.passed),
  ).length;
  return {
    hitRate:
      relevanceAssertions.length > 0
        ? ratio(relevanceAssertions.filter((assertion) => assertion.passed).length, relevanceAssertions.length)
        : null,
    citationCoverage: ratio(citedChunks, totalChunks),
    minRelevance: minRetrievedScore(cases),
    grounding: {
      passed: groundingCases.length > 0 && groundingPassedCaseCount === groundingCases.length,
      passRate: ratio(groundingPassedCaseCount, groundingCases.length),
      passedCaseCount: groundingPassedCaseCount,
      failedCaseCount: groundingCases.length - groundingPassedCaseCount,
      evaluatedCaseCount: groundingCases.length,
    },
  };
}

const RAG_RETRIEVAL_HIT_ASSERTION_KINDS = new Set([
  'expected.minScore',
  'expected.chunkCount',
  'expected.sources',
  'scoreGte',
  'scoreLte',
  'contains',
  'sourceEq',
  'sourceGlob',
  'uniqueSourcesGte',
  'chunkCountEq',
  'chunkHash',
]);

function isRetrievalHitAssertion(assertion: RagEvalAssertionResult): boolean {
  if (assertion.code !== 'PASS' && assertion.code !== 'ASSERTION_FAIL') return false;
  // Count only evaluated relevance/source checks as retrieval hits; structural
  // or vacuous count checks should not make an eval look successful.
  if (isVacuousRetrievalHitAssertion(assertion)) return false;
  return RAG_RETRIEVAL_HIT_ASSERTION_KINDS.has(assertion.kind);
}

function isVacuousRetrievalHitAssertion(assertion: RagEvalAssertionResult): boolean {
  return (
    typeof assertion.expected === 'number' &&
    assertion.expected === 0 &&
    (assertion.kind === 'expected.chunkCount' ||
      assertion.kind === 'chunkCountEq' ||
      assertion.kind === 'uniqueSourcesGte')
  );
}

function isGroundingAssertion(assertion: RagEvalAssertionResult): boolean {
  return assertion.kind === 'citesRequired';
}

function minRetrievedScore(cases: readonly RagEvalCaseResult[]): number | null {
  let minScore: number | undefined;
  for (const evaluationCase of cases) {
    for (const chunk of evaluationCase.chunks) {
      minScore = minScore === undefined ? chunk.score : Math.min(minScore, chunk.score);
    }
  }
  return minScore ?? null;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function evaluateExpectedCaseContracts(
  evaluationCase: RagSemanticEvalCaseFact,
  chunks: readonly RetrievedChunk[],
): RagEvalAssertionResult[] {
  const results: RagEvalAssertionResult[] = [];
  const { topK, minScore, chunkCount, sources } = evaluationCase.expected ?? {};
  if (topK !== undefined) {
    results.push(
      assertionResult('expected.topK', chunks.length <= topK, `expected at most ${topK} chunks`, topK, chunks.length),
    );
  }
  if (minScore !== undefined) {
    const actual =
      chunks.length === 0
        ? 0
        : chunks.reduce((minimumScore, chunk) => Math.min(minimumScore, chunk.score), Number.POSITIVE_INFINITY);
    results.push(
      assertionResult(
        'expected.minScore',
        chunks.length > 0 && chunks.every((chunk) => chunk.score >= minScore),
        `expected all retrieved chunks to score >= ${minScore}`,
        minScore,
        actual,
      ),
    );
  }
  if (chunkCount !== undefined) {
    results.push(
      assertionResult(
        'expected.chunkCount',
        chunks.length === chunkCount,
        `expected ${chunkCount} chunks`,
        chunkCount,
        chunks.length,
      ),
    );
  }
  if (sources?.length) {
    const actualSources = [...new Set(chunks.map((chunk) => chunk.source))].sort();
    const expectedSources = [...sources].sort();
    const allowed = new Set(expectedSources);
    results.push(
      assertionResult(
        'expected.sources',
        expectedSources.every((source) => actualSources.includes(source)) &&
          chunks.every((chunk) => allowed.has(chunk.source)),
        `expected retrieved chunks to cover only sources ${expectedSources.join(', ')}`,
        expectedSources,
        actualSources,
      ),
    );
  }
  return results;
}

function evaluateRagAssertion(
  evaluation: RagSemanticEvalFact,
  evaluationCase: RagSemanticEvalCaseFact,
  assertion: RagSemanticEvalAssertFact,
  chunks: readonly RetrievedChunk[],
  durationMs: number,
  options: RagEvalContractOptions,
): RagEvalAssertionResult {
  switch (assertion.kind) {
    case 'scoreGte':
      return withRagAssertRequired(
        assertion,
        numericChunkAssertion(assertion, chunks, (chunk, value) => chunk.score >= value, 'score >='),
      );
    case 'scoreLte':
      return withRagAssertRequired(
        assertion,
        numericChunkAssertion(assertion, chunks, (chunk, value) => chunk.score <= value, 'score <='),
      );
    case 'contains':
      return withRagAssertRequired(
        assertion,
        stringChunkAssertion(
          assertion,
          chunks,
          'text',
          (chunk, value) => chunk.text.toLowerCase().includes(value.toLowerCase()),
          'text contains',
        ),
      );
    case 'sourceEq':
      return withRagAssertRequired(
        assertion,
        stringChunkAssertion(assertion, chunks, 'source', (chunk, value) => chunk.source === value, 'source equals'),
      );
    case 'sourceGlob':
      return withRagAssertRequired(
        assertion,
        stringChunkAssertion(
          assertion,
          chunks,
          'source',
          (chunk, value) => globMatches(value, chunk.source, options.sourceGlobCaseSensitive ?? false),
          'source matches',
        ),
      );
    case 'uniqueSourcesGte': {
      const expected = numberAssertionValue(assertion);
      if (expected === undefined) return invalidAssertionResult(assertion, 'requires numeric value.');
      const actual = new Set(chunks.map((chunk) => chunk.source)).size;
      return withRagAssertRequired(
        assertion,
        assertionResult(
          assertion.kind,
          actual >= expected,
          `expected at least ${expected} unique sources`,
          expected,
          actual,
        ),
      );
    }
    case 'chunkCountEq': {
      const expected = numberAssertionValue(assertion);
      if (expected === undefined) return invalidAssertionResult(assertion, 'requires numeric value.');
      return withRagAssertRequired(
        assertion,
        assertionResult(
          assertion.kind,
          chunks.length === expected,
          `expected exactly ${expected} chunks`,
          expected,
          chunks.length,
        ),
      );
    }
    case 'citesRequired': {
      const actual = chunks.length > 0 && chunks.every((chunk) => !!chunk.citation.uri || !!chunk.citation.locator);
      return withRagAssertRequired(
        assertion,
        assertionResult(assertion.kind, actual, 'expected every chunk to carry citation data', true, actual),
      );
    }
    case 'factId': {
      const expected = stringAssertionValue(assertion);
      if (expected === undefined) return invalidAssertionResult(assertion, 'requires string value.');
      const actual = ragEvalCaseFactId(evaluation, evaluationCase);
      return withRagAssertRequired(
        assertion,
        assertionResult(assertion.kind, actual === expected, `expected fact id ${expected}`, expected, actual),
      );
    }
    case 'chunkHash': {
      const expected = stringAssertionValue(assertion);
      if (expected === undefined) return invalidAssertionResult(assertion, 'requires string value.');
      const actual = chunks.map((chunk) => hashRetrievedChunkText(chunk.text));
      return withRagAssertRequired(
        assertion,
        assertionResult(
          assertion.kind,
          actual.includes(expected),
          `expected retrieved chunk hash ${expected}`,
          expected,
          actual,
        ),
      );
    }
    case 'latencyLte': {
      const expected = numberAssertionValue(assertion);
      if (expected === undefined) return invalidAssertionResult(assertion, 'requires numeric value.');
      return withRagAssertRequired(
        assertion,
        assertionResult(
          assertion.kind,
          durationMs <= expected,
          `expected retrieval latency <= ${expected}ms`,
          expected,
          durationMs,
        ),
      );
    }
    default:
      return {
        kind: assertion.kind,
        required: assertion.required,
        passed: false,
        code: 'UNSUPPORTED_ASSERTION',
        message: `Unsupported RAG eval assertion kind '${assertion.kind}'.`,
      };
  }
}

function numericChunkAssertion(
  assertion: RagSemanticEvalAssertFact,
  chunks: readonly RetrievedChunk[],
  check: (chunk: RetrievedChunk, value: number) => boolean,
  label: string,
): RagEvalAssertionResult {
  const expected = numberAssertionValue(assertion);
  if (expected === undefined) return invalidAssertionResult(assertion, 'requires numeric value.');
  const actual = chunks.map((chunk) => chunk.score);
  return assertionResult(
    assertion.kind,
    chunks.length > 0 && chunks.every((chunk) => check(chunk, expected)),
    `expected every retrieved chunk ${label} ${expected}`,
    expected,
    actual,
  );
}

function stringChunkAssertion(
  assertion: RagSemanticEvalAssertFact,
  chunks: readonly RetrievedChunk[],
  actualField: 'source' | 'text',
  check: (chunk: RetrievedChunk, value: string) => boolean,
  label: string,
): RagEvalAssertionResult {
  const expected = stringAssertionValue(assertion);
  if (expected === undefined) return invalidAssertionResult(assertion, 'requires non-empty string value.');
  const actual = chunks.map((chunk) => (actualField === 'source' ? chunk.source : chunk.text));
  return assertionResult(
    assertion.kind,
    chunks.some((chunk) => check(chunk, expected)),
    `expected a retrieved chunk ${label} ${expected}`,
    expected,
    actual,
  );
}

function invalidAssertionResult(assertion: RagSemanticEvalAssertFact, reason: string): RagEvalAssertionResult {
  return {
    kind: assertion.kind,
    required: assertion.required,
    passed: false,
    code: 'INVALID_ASSERTION',
    message: `RAG eval assertion kind=${assertion.kind} ${reason}`,
  };
}

function assertionResult(
  kind: string,
  passed: boolean,
  message: string,
  expected?: unknown,
  actual?: unknown,
): RagEvalAssertionResult {
  return {
    kind,
    passed,
    code: passed ? 'PASS' : 'ASSERTION_FAIL',
    message,
    ...optionalAssertionValue('expected', expected),
    ...optionalAssertionValue('actual', actual),
  };
}

function numberAssertionValue(assertion: RagSemanticEvalAssertFact): number | undefined {
  return typeof assertion.value === 'number' && Number.isFinite(assertion.value) ? assertion.value : undefined;
}

function stringAssertionValue(assertion: RagSemanticEvalAssertFact): string | undefined {
  return typeof assertion.value === 'string' && assertion.value.length > 0 ? assertion.value : undefined;
}

function withRagAssertRequired(
  assertion: RagSemanticEvalAssertFact,
  result: RagEvalAssertionResult,
): RagEvalAssertionResult {
  return { ...result, required: assertion.required };
}

function isPassingOrAdvisoryAssertion(assertion: RagEvalAssertionResult): boolean {
  return assertion.passed || (assertion.required === false && assertion.code === 'ASSERTION_FAIL');
}

function ragEvalCaseFactId(evaluation: RagSemanticEvalFact, evaluationCase: RagSemanticEvalCaseFact): string {
  return [evaluationCase.ragName ?? evaluation.ragName, evaluationCase.evalName ?? evaluation.name, evaluationCase.name]
    .filter((part): part is string => !!part)
    .join(':');
}

function globMatches(pattern: string, value: string, caseSensitive: boolean): boolean {
  const normalizedPattern = caseSensitive ? pattern : pattern.toLowerCase();
  const normalizedValue = caseSensitive ? value : value.toLowerCase();
  return wildcardMatches(normalizedPattern, normalizedValue);
}

function wildcardMatches(pattern: string, value: string): boolean {
  let patternIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let starValueIndex = 0;
  while (valueIndex < value.length) {
    if (
      patternIndex < pattern.length &&
      (pattern[patternIndex] === '?' || pattern[patternIndex] === value[valueIndex])
    ) {
      patternIndex += 1;
      valueIndex += 1;
    } else if (patternIndex < pattern.length && pattern[patternIndex] === '*') {
      starIndex = patternIndex;
      starValueIndex = valueIndex;
      patternIndex += 1;
    } else if (starIndex !== -1) {
      patternIndex = starIndex + 1;
      starValueIndex += 1;
      valueIndex = starValueIndex;
    } else {
      return false;
    }
  }
  while (patternIndex < pattern.length && pattern[patternIndex] === '*') patternIndex += 1;
  return patternIndex === pattern.length;
}

function runtimeNow(options: RagEvalContractOptions): number {
  return options.now?.() ?? Date.now();
}

function optionalStringValue(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

function optionalNumberValue(key: string, value: number | undefined): Record<string, number> {
  return value === undefined ? {} : { [key]: value };
}

function optionalAssertionValue(key: 'expected' | 'actual', value: unknown): Record<string, unknown> {
  return value === undefined ? {} : { [key]: value };
}

function normalizeProvenanceRetrieveOptions(options: RetrieveOptions | undefined): RetrieveOptions {
  if (options === undefined) return {};
  const out: { topK?: number; minScore?: number } = {};
  if (options.topK !== undefined) {
    if (!Number.isInteger(options.topK) || options.topK <= 0 || options.topK > MAX_IN_MEMORY_RAG_TOP_K) {
      throw new Error(`KERN RAG runtime topK must be a positive integer up to ${MAX_IN_MEMORY_RAG_TOP_K}.`);
    }
    out.topK = options.topK;
  }
  if (options.minScore !== undefined) {
    if (!Number.isFinite(options.minScore) || options.minScore < 0 || options.minScore > 1) {
      throw new Error('KERN RAG runtime minScore must be between 0 and 1.');
    }
    out.minScore = options.minScore;
  }
  return out;
}

function uniqueOrdered(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableJsonValue(value, new WeakSet<object>()));
}

function stableJsonValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.description ?? value.toString();
  if (typeof value === 'function') return `[Function:${value.name || 'anonymous'}]`;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => stableJsonValue(item, seen));
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value.toString();
    if (value instanceof Map) {
      return Array.from(value.entries())
        .map(([key, entry]) => [stableJsonValue(key, seen), stableJsonValue(entry, seen)] as const)
        .sort(([left], [right]) => stableStringCompare(left, right));
    }
    if (value instanceof Set) {
      return Array.from(value.values())
        .map((entry) => stableJsonValue(entry, seen))
        .sort(stableStringCompare);
    }
    if (isPlainMetadataObject(value)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value).sort()) {
        const entry = value[key];
        if (entry !== undefined) out[key] = stableJsonValue(entry, seen);
      }
      return out;
    }
    return String(value);
  } finally {
    seen.delete(value);
  }
}

function stableStringCompare(left: unknown, right: unknown): number {
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateRetrieveResult(result: RetrieveResult): RetrieveResult {
  if (!result || typeof result.query !== 'string' || !Array.isArray(result.chunks)) {
    throw new Error('retriever result must include query string and chunks array.');
  }
  for (const [index, chunk] of result.chunks.entries()) {
    if (
      chunk &&
      typeof chunk.score === 'number' &&
      (!Number.isFinite(chunk.score) || chunk.score < 0 || chunk.score > 1)
    ) {
      throw new Error(`retriever chunk at index ${index} score must be between 0 and 1.`);
    }
    if (
      !chunk ||
      typeof chunk.id !== 'string' ||
      typeof chunk.text !== 'string' ||
      typeof chunk.score !== 'number' ||
      !Number.isFinite(chunk.score) ||
      chunk.score < 0 ||
      chunk.score > 1 ||
      typeof chunk.source !== 'string' ||
      !isValidCitation(chunk.citation)
    ) {
      throw new Error(`retriever chunk at index ${index} is not a RetrievedChunk.`);
    }
  }
  const chunkIds = new Set<string>();
  for (const [index, chunk] of result.chunks.entries()) {
    if (chunkIds.has(chunk.id)) {
      throw new Error(`retriever chunk at index ${index} duplicates chunk id '${chunk.id}'.`);
    }
    chunkIds.add(chunk.id);
  }
  return result;
}

function isValidCitation(value: unknown): value is RagCitation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const citation = value as RagCitation;
  return (
    (citation.uri === undefined || typeof citation.uri === 'string') &&
    (citation.locator === undefined || typeof citation.locator === 'string')
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function tokenizeForRetrieval(value: string): ReadonlySet<string> {
  return new Set(
    value
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? [],
  );
}

function jaccardScore(queryTerms: ReadonlySet<string>, chunkTerms: ReadonlySet<string>): number {
  if (queryTerms.size === 0 || chunkTerms.size === 0) return 0;
  let intersection = 0;
  for (const term of queryTerms) {
    if (chunkTerms.has(term)) intersection += 1;
  }
  const union = queryTerms.size + chunkTerms.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function retrievedChunk(chunk: RagChunkInput, score: number): RetrievedChunk {
  return {
    id: chunk.id,
    text: chunk.text,
    score,
    source: chunk.source,
    citation: chunk.citation ? { ...chunk.citation } : { uri: chunk.source },
    ...(chunk.metadata ? { metadata: cloneMetadata(chunk.metadata) } : {}),
  };
}

function cloneRetrievedChunk(chunk: RetrievedChunk): RetrievedChunk {
  return {
    ...chunk,
    citation: { ...chunk.citation },
    ...(chunk.metadata ? { metadata: cloneMetadata(chunk.metadata) } : {}),
  };
}

function cloneChunkInput(chunk: RagChunkInput): RagChunkInput {
  return {
    ...chunk,
    citation: chunk.citation ? { ...chunk.citation } : undefined,
    metadata: chunk.metadata ? cloneMetadata(chunk.metadata) : undefined,
  };
}

function cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return cloneMetadataValue(metadata, new WeakMap<object, unknown>()) as Record<string, unknown>;
}

function cloneMetadataValue(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (Array.isArray(value)) {
    const existing = seen.get(value);
    if (existing) return existing;
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) out.push(cloneMetadataValue(item, seen));
    return out;
  }
  if (isPlainMetadataObject(value)) {
    const existing = seen.get(value);
    if (existing) return existing;
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      out[key] = cloneMetadataValue(entry, seen);
    }
    return out;
  }
  return value;
}

function isPlainMetadataObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
