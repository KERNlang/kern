import { createHash } from 'node:crypto';

import {
  canonicalCompositionRecordBytes,
  verifyCanonicalizerComposition,
} from './composition.mjs';
import {
  loadCanonicalizerSelectionProvenanceChain,
} from './coverage-selection-provenance.mjs';
import { loadCanonicalizerPrerequisiteProvenanceChain } from './coverage-prerequisite-provenance.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Authenticate the exact composite before it becomes coverage evidence. */
export function loadCanonicalizerCoverageEvidence() {
  const verified = verifyCanonicalizerComposition();
  const selectionEvidence = loadCanonicalizerSelectionProvenanceChain();
  const prerequisiteProvenances = loadCanonicalizerPrerequisiteProvenanceChain();
  return {
    composition: {
      digest: digest(canonicalCompositionRecordBytes(verified.record)),
      record: verified.record,
    },
    prerequisiteProvenances,
    ...selectionEvidence,
    source: verified.compositeBytes,
  };
}
