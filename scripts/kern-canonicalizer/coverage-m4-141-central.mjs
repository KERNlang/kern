import {
  loadCanonicalizerExceptionFlowImplementationHandoff,
} from './coverage-implementation-handoff.mjs';
import {
  loadCanonicalizerExceptionFlowPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import {
  formatM4141ExceptionFlowPromotionStatus,
} from './coverage-status-m4-141.mjs';

export function assertM4141ExceptionFlowPromotion(coverage, prerequisite) {
  return formatM4141ExceptionFlowPromotionStatus(
    coverage,
    prerequisite,
    loadCanonicalizerExceptionFlowPrerequisiteProvenance(),
    loadCanonicalizerExceptionFlowImplementationHandoff(),
  );
}
