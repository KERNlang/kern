import {
  validateCanonicalizerExceptionFlowImplementationHandoff,
} from './coverage-implementation-handoff.mjs';

export function formatM4140ExceptionFlowImplementationHandoffStatus(handoff) {
  const validated = validateCanonicalizerExceptionFlowImplementationHandoff(handoff?.record);
  if (handoff?.digest !== validated.digest) {
    throw new TypeError('M4.140 must freeze the exact M4.139 exception-flow implementation');
  }
  const targets = validated.record.targets.map(({ name }) => name).join('/');
  return 'M4.140 freezes the exact published M4.139 exception-flow implementation ' +
    `(canonicalizer ${validated.record.source.canonicalizerSha256}; ${targets} targets); ` +
    'the M4.137 base remains 109/112 and M4.141 owns exception-flow promotion.';
}
