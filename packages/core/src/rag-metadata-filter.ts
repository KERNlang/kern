export const RAG_RETRIEVE_FILTER_PROP_TO_KEY = {
  filterCorpus: 'corpusName',
  filterSource: 'sourceName',
  filterUri: 'sourceUri',
  filterPath: 'relativePath',
  filterChunking: 'chunkingName',
} as const;

export type RagRetrieveFilterProp = keyof typeof RAG_RETRIEVE_FILTER_PROP_TO_KEY;
export type RagMetadataFilterKey = (typeof RAG_RETRIEVE_FILTER_PROP_TO_KEY)[RagRetrieveFilterProp];
export type RagMetadataFilter = Partial<Record<RagMetadataFilterKey, string>>;

export const RAG_METADATA_FILTER_KEY_TO_PROP = {
  corpusName: 'filterCorpus',
  sourceName: 'filterSource',
  sourceUri: 'filterUri',
  relativePath: 'filterPath',
  chunkingName: 'filterChunking',
} as const satisfies Record<RagMetadataFilterKey, RagRetrieveFilterProp>;

export interface RagMetadataFilterChunk {
  readonly source: string;
  readonly metadata?: Record<string, unknown>;
}

export const RAG_RETRIEVE_FILTER_PROPS = Object.keys(
  RAG_RETRIEVE_FILTER_PROP_TO_KEY,
) as readonly RagRetrieveFilterProp[];
export const RAG_METADATA_FILTER_KEYS = Object.values(
  RAG_RETRIEVE_FILTER_PROP_TO_KEY,
) as readonly RagMetadataFilterKey[];

export function ragMetadataFilterFromProps(
  stringPropFor: (prop: RagRetrieveFilterProp) => string | undefined,
): RagMetadataFilter | undefined {
  const filter: RagMetadataFilter = {};
  for (const prop of RAG_RETRIEVE_FILTER_PROPS) {
    const value = stringPropFor(prop);
    if (typeof value === 'string' && value.trim().length > 0) filter[RAG_RETRIEVE_FILTER_PROP_TO_KEY[prop]] = value;
  }
  return normalizeRagMetadataFilter(filter);
}

export function mergeRagMetadataFilters(
  profileFilter: RagMetadataFilter | undefined,
  localFilter: RagMetadataFilter | undefined,
): RagMetadataFilter | undefined {
  const merged: RagMetadataFilter = { ...(normalizeRagMetadataFilter(profileFilter) ?? {}) };
  const local = normalizeRagMetadataFilter(localFilter);
  if (local) {
    for (const [key, value] of Object.entries(local) as [RagMetadataFilterKey, string][]) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return hasRagMetadataFilter(merged) ? merged : undefined;
}

export function hasRagMetadataFilter(filter: RagMetadataFilter | undefined): filter is RagMetadataFilter {
  return filter !== undefined && Object.values(filter).some((value) => typeof value === 'string' && value.length > 0);
}

export function matchesRagMetadataFilter(chunk: RagMetadataFilterChunk, filter: RagMetadataFilter | undefined): boolean {
  if (!hasRagMetadataFilter(filter)) return true;
  for (const [key, expected] of Object.entries(filter)) {
    if (expected === undefined) continue;
    if (!isRagMetadataFilterKey(key)) throw new Error(`KERN RAG metadataFilter key '${key}' is not supported.`);
    if (ragChunkMetadataFilterValue(chunk, key) !== expected) return false;
  }
  return true;
}

export function cloneRagMetadataFilter(filter: RagMetadataFilter | undefined): RagMetadataFilter | undefined {
  return normalizeRagMetadataFilter(filter);
}

export function normalizeRagMetadataFilter(
  filter: unknown,
  label = 'KERN RAG metadataFilter',
): RagMetadataFilter | undefined {
  if (filter === undefined) return undefined;
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    throw new Error(`${label} must be an object with string metadata constraints.`);
  }
  const out: RagMetadataFilter = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (!isRagMetadataFilterKey(key)) {
      throw new Error(`${label} key '${key}' is not supported.`);
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${label}.${key} must be a non-empty string.`);
    }
    out[key] = normalizeRagMetadataFilterValue(key, value);
  }
  return hasRagMetadataFilter(out) ? out : undefined;
}

function ragChunkMetadataFilterValue(chunk: RagMetadataFilterChunk, key: RagMetadataFilterKey): string | undefined {
  if (key === 'relativePath') {
    const value = stringMetadataValue(chunk.metadata?.relativePath) ?? chunk.source;
    return normalizeRagMetadataPathValue(value);
  }
  return stringMetadataValue(chunk.metadata?.[key]);
}

function stringMetadataValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isRagMetadataFilterKey(key: string): key is RagMetadataFilterKey {
  return (RAG_METADATA_FILTER_KEYS as readonly string[]).includes(key);
}

function normalizeRagMetadataFilterValue(key: RagMetadataFilterKey, value: string): string {
  const trimmed = value.trim();
  if (key !== 'relativePath') return trimmed;
  return normalizeRagMetadataPathValue(trimmed);
}

function normalizeRagMetadataPathValue(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '');
}
