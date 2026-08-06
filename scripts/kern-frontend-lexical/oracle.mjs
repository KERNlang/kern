import { normalizeStitchOracle } from '../kern-frontend-stitcher/oracle.mjs';

function failure(code) {
  return { code, detail: '', status: 'failure' };
}

function scanRecord(content, state, maxDepth) {
  const scalars = [...content];
  let escapePending = false;
  for (let index = 0; index < scalars.length; index += 1) {
    const ch = scalars[index];
    const next = scalars[index + 1] ?? '';
    const prev = scalars[index - 1] ?? '';

    if (state.quote !== 'none') {
      if (ch === '\\') {
        if (index + 1 < scalars.length) index += 1;
        else escapePending = true;
        continue;
      }
      if ((state.quote === 'double' && ch === '"') || (state.quote === 'single' && ch === "'")) {
        state.quote = 'none';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      state.quote = ch === '"' ? 'double' : 'single';
      continue;
    }
    if (ch === '{' && next === '{') {
      state.expressionDepth += 1;
      if (state.expressionDepth > maxDepth) return { failure: failure('LEXICAL_DEPTH_LIMIT') };
      index += 1;
      continue;
    }
    if (ch === '}' && next === '}' && state.expressionDepth > 0) {
      state.expressionDepth -= 1;
      index += 1;
      continue;
    }
    if (state.expressionDepth > 0) continue;

    if (ch === '{') {
      state.styleDepth += 1;
      if (state.styleDepth > maxDepth) return { failure: failure('LEXICAL_DEPTH_LIMIT') };
      continue;
    }
    if (ch === '}' && state.styleDepth > 0) {
      state.styleDepth -= 1;
      continue;
    }
    if (state.styleDepth > 0) continue;

    const precededByAsciiWhitespace = prev === ' ' || prev === '\t';
    if (precededByAsciiWhitespace && (ch === '#' || (ch === '/' && next === '/'))) {
      return { escapePending: false, markerOffset: index, stop: 'eligible-marker' };
    }
  }
  return { escapePending, markerOffset: null, stop: 'record-end' };
}

export function normalizeLexicalOracle(
  source,
  rawTypes,
  limits = {},
  stitch = normalizeStitchOracle(source, rawTypes),
) {
  const maxCheckpoints = limits.maxCheckpoints ?? Number.MAX_SAFE_INTEGER;
  const maxLexicalDepth = limits.maxLexicalDepth ?? Number.MAX_SAFE_INTEGER;
  if (maxCheckpoints <= 0 || maxLexicalDepth <= 0) return failure('INVALID_LIMITS');
  if ('status' in stitch) return stitch;
  const checkpoints = [];
  for (const [groupIndex, group] of stitch.groups.entries()) {
    if (group.termination !== 'complete') continue;
    const state = { expressionDepth: 0, quote: 'none', styleDepth: 0 };
    for (const [groupRecordIndex, physicalIndex] of group.physicalIndexes.entries()) {
      if (checkpoints.length >= maxCheckpoints) return failure('CHECKPOINT_LIMIT');
      const content = stitch.physical[physicalIndex].content;
      const scanned = scanRecord(content, state, maxLexicalDepth);
      if (scanned.failure) return scanned.failure;
      checkpoints.push({
        checkpointIndex: checkpoints.length,
        content,
        escapePending: scanned.escapePending,
        expressionDepth: state.expressionDepth,
        groupIndex,
        groupRecordIndex,
        markerOffset: scanned.markerOffset,
        physicalIndex,
        quote: state.quote,
        stop: scanned.stop,
        styleDepth: state.styleDepth,
      });
      // The exact joined source has one LF between adjacent group records. A
      // pending quote escape consumes that LF and therefore never carries to
      // the first scalar of the next physical record.
    }
  }
  return { checkpoints, format: 'kern.frontend.lexical-checkpoint-shadow.1' };
}
