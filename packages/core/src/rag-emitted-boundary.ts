export const RAG_EMITTED_BOUNDARY_VERSION = 'kern-rag-emitted-boundary-v1';

export const RAG_RUNNER_ONLY_NODE_TYPES = [
  'corpus',
  'source',
  'chunking',
  'embed',
  'vectorStore',
  'ragIndex',
  'retriever',
  'retrievalProfile',
  'rag',
  'ragRetrieve',
  'grounding',
  'ragEval',
  'ragCase',
  'ragAssert',
  'ragAnswerContract',
  'answerSpan',
] as const;

export type RagRunnerOnlyNodeType = (typeof RAG_RUNNER_ONLY_NODE_TYPES)[number];
export type RagEmittedBoundaryMode = 'runner-only';

export interface RagEmittedBoundary {
  readonly version: typeof RAG_EMITTED_BOUNDARY_VERSION;
  readonly mode: RagEmittedBoundaryMode;
  readonly runnerOps: readonly string[];
  readonly runnerOnlyNodeTypes: readonly RagRunnerOnlyNodeType[];
  readonly targetNativeCodegen: Readonly<Record<'ts' | 'python' | 'go', false>>;
  readonly adapterExtension: {
    readonly namespace: 'rag.adapter';
    readonly status: 'reserved';
    readonly configSchemaVersion: 'kern-rag-adapter-config-v0';
    readonly consumes: readonly string[];
  };
}

export const RAG_RUNNER_ONLY_DIAGNOSTIC_REASON =
  'rag-runner-only-boundary: RAG declarations are consumed by the KERN RAG runner; emitted targets do not generate target-native retrieval adapters yet.';

export const RAG_EMITTED_BOUNDARY: RagEmittedBoundary = {
  version: RAG_EMITTED_BOUNDARY_VERSION,
  mode: 'runner-only',
  runnerOps: ['rag.index', 'rag.retrieve', 'rag.eval'],
  runnerOnlyNodeTypes: RAG_RUNNER_ONLY_NODE_TYPES,
  targetNativeCodegen: { ts: false, python: false, go: false },
  adapterExtension: {
    namespace: 'rag.adapter',
    status: 'reserved',
    configSchemaVersion: 'kern-rag-adapter-config-v0',
    consumes: ['rag.semantic-facts', 'rag.runtime-retrievals', 'rag.vector-store-adapters'],
  },
};

const RAG_RUNNER_ONLY_NODE_TYPE_SET = new Set<string>(RAG_RUNNER_ONLY_NODE_TYPES);
const RAG_TOP_LEVEL_RUNNER_ONLY_NODE_TYPES = new Set<string>([
  'corpus',
  'chunking',
  'embed',
  'vectorStore',
  'ragIndex',
  'retriever',
  'retrievalProfile',
  'rag',
  'ragRetrieve',
  'grounding',
  'ragEval',
  'ragAnswerContract',
]);
const RAG_CHILD_RUNNER_ONLY_PARENT_TYPES: Readonly<Record<string, readonly string[]>> = {
  source: ['corpus'],
  chunking: ['corpus'],
  grounding: ['rag'],
  ragRetrieve: ['rag'],
  ragEval: ['rag'],
  ragAnswerContract: ['rag'],
  ragCase: ['ragEval'],
  ragAssert: ['ragCase'],
  answerSpan: ['ragAnswerContract'],
};

export function isRagRunnerOnlyNodeType(type: string): type is RagRunnerOnlyNodeType {
  return RAG_RUNNER_ONLY_NODE_TYPE_SET.has(type);
}

export function isRagRunnerOnlyNodeInContext(type: string, parentType?: string): type is RagRunnerOnlyNodeType {
  if (!isRagRunnerOnlyNodeType(type)) return false;
  if (parentType && RAG_CHILD_RUNNER_ONLY_PARENT_TYPES[type]?.includes(parentType)) return true;
  return !parentType && RAG_TOP_LEVEL_RUNNER_ONLY_NODE_TYPES.has(type);
}
