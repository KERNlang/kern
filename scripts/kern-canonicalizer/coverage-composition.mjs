import { createHash } from 'node:crypto';

import {
  canonicalCompositionRecordBytes,
  verifyCanonicalizerComposition,
} from './composition.mjs';
import { loadCanonicalizerSelectionProvenance } from './coverage-selection-provenance.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Authenticate the exact composite before it becomes coverage evidence. */
export function loadCanonicalizerCoverageEvidence() {
  const verified = verifyCanonicalizerComposition();
  return {
    composition: {
      digest: digest(canonicalCompositionRecordBytes(verified.record)),
      record: verified.record,
    },
    selectionProvenance: loadCanonicalizerSelectionProvenance(),
    source: verified.compositeBytes,
  };
}
