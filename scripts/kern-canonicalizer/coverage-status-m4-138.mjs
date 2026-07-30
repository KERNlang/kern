import {
  validateCanonicalizerExceptionFlowPrerequisiteHandoff,
} from './coverage-prerequisite-provenance.mjs';

export function formatM4138ExceptionFlowHandoffStatus(handoff) {
  const validated = validateCanonicalizerExceptionFlowPrerequisiteHandoff(handoff?.record);
  const snapshot = validated.record.snapshot;
  if (handoff?.digest !== validated.digest) {
    throw new TypeError('M4.138 must freeze the exact exception-flow prerequisite');
  }
  const selected = snapshot.selectedPrerequisite;
  const closure = snapshot.winningClosure;
  return 'M4.138 freezes the exact M4.137 exception-flow prerequisite ' +
    `(${selected.catalogFacts} catalog facts/${selected.occurrences} occurrences; ` +
    `${snapshot.minimumFamilyCount}-family canonicalize closure with ` +
    `${closure.completeFunctions} function/${closure.migratedParameterRows} rows); ` +
    'M4.139 owns bounded exception-flow implementation.';
}
