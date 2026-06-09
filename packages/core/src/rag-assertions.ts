export const RAG_ASSERTION_KINDS = [
  'factId',
  'chunkHash',
  'scoreGte',
  'scoreLte',
  'contains',
  'sourceEq',
  'sourceGlob',
  'uniqueSourcesGte',
  'chunkCountEq',
  'latencyLte',
  'citesRequired',
] as const;

export type RagAssertionKind = (typeof RAG_ASSERTION_KINDS)[number];

export const RAG_ASSERTION_KIND_SET: ReadonlySet<string> = new Set(RAG_ASSERTION_KINDS);
