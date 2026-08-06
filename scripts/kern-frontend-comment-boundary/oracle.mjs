import { normalizeLexicalOracle } from '../kern-frontend-lexical/oracle.mjs';

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function partitionCheckpoint(checkpoint) {
  if (checkpoint.markerOffset === null) {
    return {
      ...checkpoint,
      markerKind: 'none',
      markerText: '',
      rawPayload: '',
    };
  }
  const scalars = [...checkpoint.content];
  const first = scalars[checkpoint.markerOffset];
  const markerText = first === '#' ? '#' : scalars.slice(checkpoint.markerOffset, checkpoint.markerOffset + 2).join('');
  if (markerText !== '#' && markerText !== '//') {
    throw new TypeError('frontend comment boundary oracle received a non-marker checkpoint');
  }
  const markerWidth = markerText === '#' ? 1 : 2;
  return {
    ...checkpoint,
    markerKind: markerText === '#' ? 'hash' : 'slash-slash',
    markerText,
    rawPayload: scalars.slice(checkpoint.markerOffset + markerWidth).join(''),
  };
}

export function normalizeCommentBoundaryOracle(
  source,
  rawTypes,
  limits = {},
  lexical = normalizeLexicalOracle(source, rawTypes, limits),
) {
  const maxPartitions = limits.maxPartitions ?? Number.MAX_SAFE_INTEGER;
  if (maxPartitions <= 0) return failure('INVALID_LIMITS');
  if ('status' in lexical) return lexical;
  if (lexical.checkpoints.length > maxPartitions) return failure('PARTITION_LIMIT');
  return {
    format: 'kern.frontend.inline-comment-boundary-shadow.1',
    partitions: lexical.checkpoints.map((checkpoint, partitionIndex) => ({
      ...partitionCheckpoint(checkpoint),
      partitionIndex,
    })),
  };
}
