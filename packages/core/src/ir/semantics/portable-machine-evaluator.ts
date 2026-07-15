import type { ValueIR } from '../../value-ir.js';
import { evalInternalMachineClassMember } from './internal-effect-machine-class-runtime.js';
import { evalInternalMachineHelperScalar } from './internal-effect-machine-helper-runtime.js';
import { createPortableEvaluator } from './portable-core-evaluator.js';
import { PORTABLE_EVAL_NOT_HANDLED, type PortableEvaluatorHost } from './portable-eval-types.js';
import type { SemanticEnv } from './semantic-env.js';

const machineHost: PortableEvaluatorHost = Object.freeze({
  classMember(node: Extract<ValueIR, { kind: 'member' }>, env: SemanticEnv) {
    const value = evalInternalMachineClassMember(node, env);
    return value === undefined ? PORTABLE_EVAL_NOT_HANDLED : value;
  },
  classMethod: () => PORTABLE_EVAL_NOT_HANDLED,
  functionCall: evalInternalMachineHelperScalar,
});

const machineEvaluator = createPortableEvaluator(machineHost);

export const evalPortableValue = machineEvaluator.evalPortableValue;
export const evalPortableBinary = machineEvaluator.evalPortableBinary;

export {
  evalRecordArrayFieldReferenceValue,
  isRecordLiteralExpression,
} from './portable-record-evaluator.js';
export {
  assertPortableScalar,
  isPortableBindingName,
  isPortableScalar,
  type PortableScalar,
  portableTruthy,
} from './portable-scalar-domain.js';
