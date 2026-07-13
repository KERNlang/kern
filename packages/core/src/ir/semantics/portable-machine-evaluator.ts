import { createPortableEvaluator } from './portable-core-evaluator.js';
import { PORTABLE_EVAL_NOT_HANDLED, type PortableEvaluatorHost } from './portable-eval-types.js';

const machineHost: PortableEvaluatorHost = Object.freeze({
  classMember: () => PORTABLE_EVAL_NOT_HANDLED,
  classMethod: () => PORTABLE_EVAL_NOT_HANDLED,
  functionCall(name: string) {
    throw new Error(`portable machine: function call "${name}" is outside the machine scalar domain`);
  },
});

const machineEvaluator = createPortableEvaluator(machineHost);

export const evalPortableValue = machineEvaluator.evalPortableValue;
export const evalPortableBinary = machineEvaluator.evalPortableBinary;

export {
  assertPortableScalar,
  isPortableBindingName,
  isPortableScalar,
  portableTruthy,
  type PortableScalar,
} from './portable-scalar-domain.js';
export {
  evalRecordArrayFieldReferenceValue,
  isRecordLiteralExpression,
} from './portable-record-evaluator.js';
