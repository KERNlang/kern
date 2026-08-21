import { __test } from './worker.mjs';

const STAGES = ['f1', 'f2b', 'f3'];
const TRANSPORT_FIELDS = {
  f1: ['recordKinds', 'recordFlags', 'recordStarts', 'recordEnds', 'f1RecordTape'],
  f2b: [
    'segmentFirstRecords', 'segmentLastRecords', 'segmentOuterStarts', 'segmentOuterEnds',
    'segmentBodyStarts', 'segmentBodyEnds', 'segmentBodies', 'segmentBodyDigests',
    'segmentRecordDigests', 'f2bExpectedFields',
  ],
  f3: [
    'f3ExpectedFields', 'lineFirstRecords', 'lineLastRecords', 'lineStarts', 'lineEnds',
    'lineFirstPhysical', 'lineLastPhysical', 'lineIndents', 'lineContentStarts', 'lineRoles',
    'lineFirstSegments', 'lineSegmentCounts', 'edgeChildren', 'edgeParents', 'edgeChildIndents',
    'edgeParentIndents', 'decoratorFirsts', 'decoratorLasts', 'decoratorSuccessors',
    'decoratorDispositions', 'rawOwners', 'rawOpeners', 'rawClosers', 'rawBodyStarts',
    'rawBodyEnds', 'rawInlineFlags', 'rawTypes',
  ],
};

export function attempt(call) {
  try {
    return { kind: 'receipt', result: call() };
  } catch (error) {
    return { kind: 'exception', message: String(error?.message ?? error) };
  }
}

export function runRequestVerdict(moduleId, source, states, { mutation } = {}) {
  if (!Array.isArray(states) || states.length !== STAGES.length ||
      states.some((state) => !['available', 'failed', 'not-attempted'].includes(state))) {
    throw new Error('request verdict state shape');
  }
  const result = __test.runDocumentWithTestInput(moduleId, source, {
    prerequisiteStates: states,
    mutation,
    mutateInput(input) {
      for (const [index, stage] of STAGES.entries()) {
        if (states[index] === 'available') continue;
        for (const field of TRANSPORT_FIELDS[stage]) input[field] = field === 'f1RecordTape' ? '' : [];
      }
    },
  });
  return result;
}

export function observeF3ThroughF4(moduleId, source, f3Options) {
  const stages = [];
  const result = attempt(() => __test.runDocumentWithF3Options(moduleId, source, f3Options, (stage) => {
    stages.push(stage);
  }));
  return { ...result, stages };
}
