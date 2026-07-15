import { evalInternalMachineHelperScalar } from './internal-effect-machine-helper-runtime.js';
import { createPortableEvaluator } from './portable-core-evaluator.js';
import { PORTABLE_EVAL_NOT_HANDLED, type PortableEvaluatorHost } from './portable-eval-types.js';

const machineHost: PortableEvaluatorHost = Object.freeze({
  classMember: () => PORTABLE_EVAL_NOT_HANDLED,
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
