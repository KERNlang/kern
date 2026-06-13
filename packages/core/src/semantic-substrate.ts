import { KERN_STDLIB, type StdlibEntry } from './codegen/kern-stdlib.js';
import {
  PORTABLE_LOGIC_PRIMITIVE_IDS,
  PORTABLE_LOGIC_PRIMITIVES,
  type PortableLogicPrimitiveId,
  type PortableLogicSupport,
  type PortableLogicTarget,
} from './codegen/portable-logic-primitives.js';
import {
  CORE_TYPE_CONTRACTS,
  type CoreOperationReturns,
  type CoreTypeContract,
  contractToGraphEdges,
} from './core-contracts/index.js';
import { type CoreShapeFacts, collectCoreShapeFacts } from './core-runtime/shape-validator.js';
import type { NodeContract } from './ir/semantics/index.js';
import { snapshotRegistry } from './ir/semantics/index.js';
import {
  type ClassSemanticFacts,
  collectClassSemanticFacts,
  collectRagSemanticFacts,
  RAG_MCP_RETRIEVE_OUTPUT_ITEM_SHAPE,
  RAG_MCP_RETRIEVE_OUTPUT_SHAPE,
  type RagSemanticFacts,
  type RagSemanticMcpRetrievalFact,
  type SemanticViolation,
  validateClassSemantics,
  validateRagSemantics,
} from './semantic-validator.js';
import type { IRNode } from './types.js';

export type KernSemanticSubstrateSource = 'codegen-from-ts' | 'native-kern';
export type KernSemanticSubstrateTarget = PortableLogicTarget;

export interface KernSemanticSupport {
  readonly ts: PortableLogicSupport;
  readonly python: PortableLogicSupport;
  readonly go: PortableLogicSupport;
}

export interface KernSemanticCoreOperation {
  readonly id: string;
  readonly kind: string;
  readonly args: readonly string[];
  readonly returns: readonly string[];
  readonly lowerings: Readonly<Record<string, string>>;
  readonly fixtureCount: number;
  readonly reviewSummary: string;
  readonly reviewTags: readonly string[];
}

export interface KernSemanticCoreType {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly strict: true;
  readonly operations: readonly KernSemanticCoreOperation[];
}

export interface KernSemanticPrimitive {
  readonly id: PortableLogicPrimitiveId;
  readonly kernName: string;
  readonly domain: string;
  readonly description: string;
  readonly intent: string;
  readonly purity: string;
  readonly hostPatterns: readonly string[];
  readonly portabilityNotes: readonly string[];
  readonly support: KernSemanticSupport;
}

export interface KernSemanticStdlibOperation {
  readonly id: string;
  readonly module: string;
  readonly method: string;
  readonly arity: number;
  readonly support: KernSemanticSupport;
}

export interface KernSemanticIrContract {
  readonly nodeType: string;
  readonly forbiddenRewrites: readonly string[];
  readonly fixtureCount: number;
}

export interface KernSemanticValidationSummary {
  readonly total: number;
  readonly byRule: Readonly<Record<string, number>>;
}

export type KernSemanticRagAnswerReviewStatus = 'ready' | 'incomplete' | 'invalid';

export interface KernSemanticRagAnswerReviewFact {
  readonly pipelineName: string;
  readonly retrieverName: string;
  readonly prompt?: string;
  readonly answer?: string;
  readonly citationsRequired: boolean;
  readonly groundingCount: number;
  readonly evalCount: number;
  readonly evalCaseCount: number;
  readonly answerContractCount: number;
  readonly mcpRetrievalCount: number;
  readonly compatibleMcpRetrievalCount: number;
  readonly provenanceRequired: boolean;
  readonly provenanceComplete: boolean;
  readonly validationStatus: KernSemanticRagAnswerReviewStatus;
  readonly issues: readonly string[];
}

export interface KernSemanticSubstrate {
  readonly schemaVersion: 1;
  readonly generatedBy: 'kern-semantic-substrate';
  readonly source: KernSemanticSubstrateSource;
  readonly coreTypes: readonly KernSemanticCoreType[];
  readonly coreGraphEdges: readonly {
    readonly from: string;
    readonly relation: string;
    readonly to: string;
    readonly operation?: string;
    readonly index?: number;
  }[];
  readonly portablePrimitives: readonly KernSemanticPrimitive[];
  readonly stdlibOperations: readonly KernSemanticStdlibOperation[];
  readonly irContracts: readonly KernSemanticIrContract[];
  readonly classFacts?: ClassSemanticFacts;
  readonly classValidationSummary?: KernSemanticValidationSummary;
  readonly ragFacts?: RagSemanticFacts;
  readonly ragValidationSummary?: KernSemanticValidationSummary;
  readonly ragAnswerReviewFacts?: readonly KernSemanticRagAnswerReviewFact[];
  readonly coreShapeFacts?: CoreShapeFacts;
}

export interface BuildKernSemanticSubstrateOptions {
  readonly source?: KernSemanticSubstrateSource;
  readonly irContracts?: ReadonlyMap<string, NodeContract>;
  readonly documentClasses?: IRNode | readonly IRNode[];
  readonly includeClassValidationSummary?: boolean;
  readonly documentRag?: IRNode | readonly IRNode[];
  readonly includeRagValidationSummary?: boolean;
  readonly documentShapes?: IRNode | readonly IRNode[];
}

export function buildKernSemanticSubstrate(options: BuildKernSemanticSubstrateOptions = {}): KernSemanticSubstrate {
  const ragFacts = options.documentRag ? collectRagSemanticFacts(options.documentRag) : undefined;
  // The registry guarantees every value is a CoreTypeContract; pin the element type so
  // Object.values does not widen to unknown/any under stricter tsconfig settings (ts18046).
  const coreContracts = Object.values(CORE_TYPE_CONTRACTS.types) as readonly CoreTypeContract[];
  const coreTypes = coreContracts.map((contract) => ({
    id: `core.type.${contract.name}`,
    name: contract.name,
    kind: contract.kind,
    strict: contract.strict,
    operations: contract.operations.map((operation) => ({
      id: operation.id,
      kind: operation.kind,
      args: [...operation.args],
      returns: normalizeReturns(operation.returns),
      lowerings: operation.lowers ? { ...operation.lowers } : {},
      fixtureCount: operation.fixtures.length,
      reviewSummary: operation.review.summary,
      reviewTags: [...operation.review.graph],
    })),
  }));

  return {
    schemaVersion: 1,
    generatedBy: 'kern-semantic-substrate',
    source: options.source ?? 'codegen-from-ts',
    coreTypes,
    coreGraphEdges: coreContracts.flatMap((contract) => contractToGraphEdges(contract)),
    portablePrimitives: PORTABLE_LOGIC_PRIMITIVE_IDS.map((id) => {
      const primitive = PORTABLE_LOGIC_PRIMITIVES[id];
      return {
        id,
        kernName: kernPrimitiveName(id),
        domain: id.split('.')[0],
        description: primitive.description,
        intent: primitive.intent,
        purity: primitive.purity,
        hostPatterns: [...primitive.hostPatterns],
        portabilityNotes: [...primitive.portabilityNotes],
        support: { ...primitive.targets },
      };
    }),
    stdlibOperations: stdlibOperationSummaries(),
    irContracts: options.irContracts
      ? snapshotRegistry(options.irContracts).contracts.map((contract) => ({
          nodeType: contract.nodeType,
          forbiddenRewrites: [...contract.forbiddenRewrites],
          fixtureCount: contract.fixtureCount,
        }))
      : [],
    ...(options.documentClasses ? { classFacts: collectClassSemanticFacts(options.documentClasses) } : {}),
    ...(options.documentClasses && options.includeClassValidationSummary
      ? { classValidationSummary: semanticValidationSummary(options.documentClasses) }
      : {}),
    ...(ragFacts ? { ragFacts, ragAnswerReviewFacts: buildRagAnswerReviewFacts(ragFacts) } : {}),
    ...(options.documentRag && options.includeRagValidationSummary
      ? { ragValidationSummary: ragValidationSummary(options.documentRag) }
      : {}),
    ...(options.documentShapes ? { coreShapeFacts: collectCoreShapeFacts(options.documentShapes) } : {}),
  };
}

export function lookupSemanticPrimitive(
  substrate: KernSemanticSubstrate,
  id: PortableLogicPrimitiveId,
): KernSemanticPrimitive {
  const primitive = substrate.portablePrimitives.find((candidate) => candidate.id === id);
  if (!primitive) {
    throw new Error(`KERN semantic substrate missing portable primitive '${id}'.`);
  }
  return primitive;
}

export function semanticPrimitiveSupportSummary(
  primitive: KernSemanticPrimitive,
  targets: readonly KernSemanticSubstrateTarget[],
): string {
  const bySupport: Record<PortableLogicSupport, string[]> = {
    preview: [],
    stable: [],
    unsupported: [],
  };
  for (const target of targets) {
    bySupport[semanticSupportForTarget(primitive.support, target)].push(target);
  }

  const parts: string[] = [];
  for (const support of ['stable', 'preview', 'unsupported'] satisfies PortableLogicSupport[]) {
    const targetNames = bySupport[support];
    if (targetNames.length > 0) parts.push(`${support}: ${targetNames.join(', ')}`);
  }
  return parts.join('; ');
}

function semanticSupportForTarget(
  support: KernSemanticSupport,
  target: KernSemanticSubstrateTarget,
): PortableLogicSupport {
  switch (target) {
    case 'ts':
      return support.ts;
    case 'python':
      return support.python;
    case 'go':
      return support.go;
  }
}

function stdlibOperationSummaries(): KernSemanticStdlibOperation[] {
  const stdlib: Record<string, Record<string, StdlibEntry>> = KERN_STDLIB;
  const operations: KernSemanticStdlibOperation[] = [];

  for (const module of Object.keys(stdlib)) {
    const entries = stdlib[module];
    if (!entries) continue;
    for (const method of Object.keys(entries)) {
      const entry = entries[method];
      if (!entry) continue;
      operations.push({
        id: `stdlib.${module}.${method}`,
        module,
        method,
        arity: entry.kind === 'property' ? 0 : (entry.arity ?? entry.minArity ?? 0),
        support: {
          ts: entry.ts ? 'stable' : 'unsupported',
          python: entry.py ? 'stable' : 'unsupported',
          go: 'unsupported',
        },
      });
    }
  }

  return operations;
}

function normalizeReturns(returns: CoreOperationReturns): readonly string[] {
  return typeof returns === 'string' ? [returns] : [...returns];
}

function semanticValidationSummary(root: IRNode | readonly IRNode[]): KernSemanticValidationSummary {
  return summarizeSemanticViolations(validateClassSemantics(root));
}

function ragValidationSummary(root: IRNode | readonly IRNode[]): KernSemanticValidationSummary {
  return summarizeSemanticViolations(validateRagSemantics(root));
}

function summarizeSemanticViolations(violations: readonly SemanticViolation[]): KernSemanticValidationSummary {
  const byRule: Record<string, number> = {};
  for (const violation of violations) {
    byRule[violation.rule] = (byRule[violation.rule] ?? 0) + 1;
  }
  return { total: violations.length, byRule };
}

function buildRagAnswerReviewFacts(facts: RagSemanticFacts): KernSemanticRagAnswerReviewFact[] {
  const unresolvedRetrievers = new Set(facts.unresolvedRetrieverRefs);
  return facts.pipelines.map((pipeline) => {
    const citationsRequired = pipeline.citations || pipeline.groundings.some((grounding) => grounding.requireCitations);
    const mcpRetrievals = facts.mcpRetrievals.filter(
      (retrieval) => retrieval.targetKind === 'rag' && retrieval.targetName === pipeline.name,
    );
    const compatibleMcpRetrievals = mcpRetrievals.filter((retrieval) =>
      isRagAnswerCompatibleMcpRetrieval(retrieval, citationsRequired),
    );
    const evalCaseCount = pipeline.evals.reduce((count, evaluation) => count + (evaluation.caseCount ?? 0), 0);
    const answerContractCount = pipeline.answerContracts.length;
    const issues = ragAnswerReviewIssues(
      facts,
      pipeline.name,
      pipeline.retrieverName,
      pipeline.prompt,
      pipeline.answer,
      answerContractCount,
      citationsRequired,
      pipeline.groundings.length,
      pipeline.groundings.some((grounding) => grounding.requireCitations),
      pipeline.evals.length,
      evalCaseCount,
      mcpRetrievals.length,
      compatibleMcpRetrievals.length,
      unresolvedRetrievers.has(pipeline.retrieverName),
    );
    return {
      pipelineName: pipeline.name,
      retrieverName: pipeline.retrieverName,
      ...optionalStringValue('prompt', pipeline.prompt),
      ...optionalStringValue('answer', pipeline.answer),
      citationsRequired,
      groundingCount: pipeline.groundings.length,
      evalCount: pipeline.evals.length,
      evalCaseCount,
      answerContractCount,
      mcpRetrievalCount: mcpRetrievals.length,
      compatibleMcpRetrievalCount: compatibleMcpRetrievals.length,
      provenanceRequired: citationsRequired || mcpRetrievals.some((retrieval) => retrieval.requireGrounding),
      provenanceComplete: mcpRetrievals.length === 0 || compatibleMcpRetrievals.length === mcpRetrievals.length,
      validationStatus: ragAnswerReviewStatus(issues),
      issues,
    };
  });
}

function ragAnswerReviewIssues(
  facts: RagSemanticFacts,
  pipelineName: string,
  retrieverName: string,
  prompt: string | undefined,
  answer: string | undefined,
  answerContractCount: number,
  citationsRequired: boolean,
  groundingCount: number,
  hasCitationGrounding: boolean,
  evalCount: number,
  evalCaseCount: number,
  mcpRetrievalCount: number,
  compatibleMcpRetrievalCount: number,
  unresolvedRetriever: boolean,
): string[] {
  const issues: string[] = [];
  if (unresolvedRetriever) issues.push(`unresolved-retriever:${retrieverName}`);
  if (!prompt && !answer && answerContractCount === 0) issues.push('missing-answer-surface');
  if (citationsRequired && groundingCount === 0) issues.push('missing-grounding');
  if (citationsRequired && !hasCitationGrounding) issues.push('missing-citation-grounding');
  if (evalCount === 0) issues.push('missing-eval');
  if (evalCount > 0 && evalCaseCount === 0) issues.push('missing-eval-case');
  if (
    facts.mcpRetrievals.some(
      (retrieval) =>
        retrieval.targetKind === 'rag' &&
        retrieval.targetName === pipelineName &&
        retrieval.contractStatus === 'invalid',
    )
  ) {
    issues.push('invalid-mcp-retrieve-contract');
  }
  if (mcpRetrievalCount > 0 && compatibleMcpRetrievalCount === 0) issues.push('missing-compatible-mcp-retrieve');
  return issues;
}

function ragAnswerReviewStatus(issues: readonly string[]): KernSemanticRagAnswerReviewStatus {
  if (issues.some((issue) => INVALID_RAG_ANSWER_REVIEW_ISSUES.has(issue.split(':', 1)[0] ?? ''))) return 'invalid';
  return issues.length === 0 ? 'ready' : 'incomplete';
}

function isRagAnswerCompatibleMcpRetrieval(
  retrieval: RagSemanticMcpRetrievalFact,
  citationsRequired: boolean,
): boolean {
  if (retrieval.contractStatus !== 'valid') return false;
  if (retrieval.outputShape !== RAG_MCP_RETRIEVE_OUTPUT_SHAPE) return false;
  if (retrieval.outputItemShape !== undefined && retrieval.outputItemShape !== RAG_MCP_RETRIEVE_OUTPUT_ITEM_SHAPE) {
    return false;
  }
  if (citationsRequired || retrieval.effectiveRequiresCitations) {
    return (
      !!retrieval.citationField &&
      (!!retrieval.sourceField || retrieval.provenance === 'source' || retrieval.provenance === 'citation')
    );
  }
  return true;
}

function optionalStringValue(key: string, value: string | undefined): Record<string, string> {
  return value === undefined ? {} : { [key]: value };
}

const INVALID_RAG_ANSWER_REVIEW_ISSUES = new Set(['unresolved-retriever', 'invalid-mcp-retrieve-contract']);

const KERN_PRIMITIVE_NAMES: Record<PortableLogicPrimitiveId, string> = {
  'collection.has': 'includes',
  'collection.count': 'count',
  'collection.filter': 'filter',
  'collection.compact': 'compact',
  'collection.pluck': 'pluck',
  'collection.take': 'take',
  'collection.drop': 'drop',
  'collection.slice': 'slice',
  'collection.reverse': 'reverse',
  'collection.at': 'at',
  'collection.join': 'join',
  'collection.concat': 'concat',
  'collection.includes': 'includes',
  'collection.indexOf': 'indexOf',
  'collection.lastIndexOf': 'lastIndexOf',
  'collection.sort': 'sort',
  'collection.uniqueBy': 'uniqueBy',
  'collection.groupBy': 'groupBy',
  'collection.partition': 'partition',
  'collection.indexBy': 'indexBy',
  'collection.countBy': 'countBy',
  'logic.firstTruthy': 'firstTruthy',
  'logic.coalesce': 'coalesce',
  'time.epochMs': 'epochMs',
  'logic.not': 'not',
  'number.clamp': 'clamp',
  'object.keys': 'objectKeys',
  'object.values': 'objectValues',
  'object.entries': 'objectEntries',
  'object.merge': 'objectMerge',
  'object.omit': 'objectOmit',
  'object.pick': 'objectPick',
  'string.trim': 'trim',
  'string.split': 'split',
  'string.replaceFirst': 'replaceFirst',
  'string.replaceAll': 'replaceAll',
  'logic.firstDefined': 'firstDefined',
  'string.coerce': 'string',
};

function kernPrimitiveName(id: PortableLogicPrimitiveId): string {
  const name = KERN_PRIMITIVE_NAMES[id];
  if (!name) throw new Error(`KERN semantic substrate missing KERN primitive name for '${id}'.`);
  return name;
}
