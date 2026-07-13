/** Thin source-compatibility facade for the reference portable evaluator. */

export { CAUGHT_ERROR_TAG, type CaughtErrorValue, isCaughtErrorValue } from './caught-error.js';
export {
  coerceToString,
  evalNumberBinary,
  evalOrderedComparison,
  evalPlusOperator,
} from './portable-core-evaluator.js';
export {
  decimalNamespaceMethod,
  evalDecimalExpression,
  evalRunnerNativeDecimalScalarCall,
  isCanonicalDecimalLiteralFailure,
  isDecimalExpression,
  isDecimalNamespaceCall,
  isDecimalValueExpression,
  isRunnerNativeDecimalFailClose,
} from './portable-decimal-evaluator.js';
export type { PortableRecordEntry } from './portable-record-evaluator.js';
export {
  assertPortableRecordEntry,
  assertSingleUseFreshArrayRecordSources,
  evalRecordArrayFieldReferenceValue,
  isRecordLiteralExpression,
} from './portable-record-evaluator.js';
export {
  assignRunnerClassMember,
  evalPortableBinary,
  evalPortableValue,
  evalRecordArrayFieldValue,
  evalRecordLiteralValue,
  evalRunnerClassMethodScalarWithArguments,
  evalRunnerClassMethodScalarWithArgumentsAsync,
  evalRunnerClassNewValue,
  evalRunnerClassNewValueWithArguments,
  evalRunnerClassNewValueWithArgumentsAsync,
  evalRunnerFunctionArgumentValue,
  evalRunnerFunctionValue,
} from './portable-reference-evaluator.js';
export type {
  DecimalValue,
  EvalRecordLiteralOptions,
  PortableRecord,
  PortableScalar,
  RunnerFunctionValue,
  RunnerPortableArrayValue,
  RunnerPortableValue,
} from './portable-scalar-domain.js';
export {
  assertArithmeticResultNotFloatCollapsed,
  assertPortableScalar,
  assertRunnerPortableValue,
  DECIMAL_VALUE_TAG,
  IDENT_RE,
  isDecimalValue,
  isIntProvenancedExpr,
  isPortableBindingName,
  isPortableRecordValue,
  isPortableScalar,
  isRunnerClassInstanceValue,
  isRunnerPortableArrayValue,
  isSafeIntegerLiteralIndex,
  makeDecimalValue,
  portableTruthy,
  RESERVED_NAMES,
  sameType,
} from './portable-scalar-domain.js';
