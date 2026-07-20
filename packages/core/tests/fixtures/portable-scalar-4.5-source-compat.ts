import { CAUGHT_ERROR_TAG as caughtErrorTag } from '../../src/ir/semantics/caught-error.js';
import type { RunnerClassInstanceValue, SemanticEnv } from '../../src/ir/semantics/index.js';
import * as api from '../../src/ir/semantics/portable-scalar.js';
import {
  type CaughtErrorValue,
  type DecimalValue,
  DECIMAL_VALUE_TAG as decimalValueTag,
  type EvalRecordLiteralOptions,
  type PortableRecord,
  type PortableRecordEntry,
  type PortableScalar,
  type RunnerFunctionValue,
  type RunnerPortableArrayValue,
  type RunnerPortableValue,
} from '../../src/ir/semantics/portable-scalar.js';
import type { Trace } from '../../src/ir/semantics/trace.js';
import type { IRNode } from '../../src/types.js';
import type { ValueIR } from '../../src/value-ir.js';

type TypeEqual<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <Value>() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;

type Assert<Condition extends true> = Condition;

interface PortableScalar45ValueApi {
  readonly CAUGHT_ERROR_TAG: typeof caughtErrorTag;
  readonly DECIMAL_VALUE_TAG: typeof decimalValueTag;
  readonly IDENT_RE: RegExp;
  readonly RESERVED_NAMES: Set<string>;
  readonly assertArithmeticResultNotFloatCollapsed: (
    left: number,
    right: number,
    result: PortableScalar,
    op: string,
  ) => PortableScalar;
  readonly assertPortableRecordEntry: (
    entry: PortableRecordEntry | { kind: 'spread'; argument: ValueIR },
    out: Record<string, unknown>,
  ) => PortableRecordEntry;
  readonly assertPortableScalar: (value: unknown, label: string) => PortableScalar;
  readonly assertRunnerPortableValue: (value: unknown, label: string) => RunnerPortableValue;
  readonly assertSingleUseFreshArrayRecordSources: (node: ValueIR, env: SemanticEnv) => void;
  readonly assignRunnerClassMember: (
    target: string,
    valueExpr: ValueIR,
    env: SemanticEnv,
    mutate?: boolean,
  ) => PortableScalar | undefined;
  readonly coerceToString: (value: PortableScalar) => string;
  readonly decimalNamespaceMethod: (node: ValueIR) => string | null;
  readonly evalDecimalExpression: (node: ValueIR, env?: SemanticEnv) => string;
  readonly evalNumberBinary: (
    op: string,
    left: PortableScalar,
    right: PortableScalar,
    env: SemanticEnv,
  ) => PortableScalar;
  readonly evalOrderedComparison: (op: string, left: string | number, right: string | number) => boolean;
  readonly evalPlusOperator: (left: PortableScalar, right: PortableScalar, env: SemanticEnv) => PortableScalar;
  readonly evalPortableBinary: (node: Extract<ValueIR, { kind: 'binary' }>, env: SemanticEnv) => PortableScalar;
  readonly evalPortableValue: (node: ValueIR, env: SemanticEnv) => PortableScalar;
  readonly evalRecordArrayFieldReferenceValue: (
    value: ValueIR,
    env: SemanticEnv,
  ) => RunnerPortableArrayValue | undefined;
  readonly evalRecordArrayFieldValue: (
    value: ValueIR,
    env: SemanticEnv,
    options?: EvalRecordLiteralOptions,
  ) => RunnerPortableArrayValue | undefined;
  readonly evalRecordLiteralValue: (
    node: ValueIR,
    env: SemanticEnv,
    options?: EvalRecordLiteralOptions,
  ) => PortableRecord;
  readonly evalRunnerClassMethodScalarWithArguments: (
    node: Extract<ValueIR, { kind: 'call' }>,
    env: SemanticEnv,
    args: readonly unknown[],
  ) => PortableScalar | undefined;
  readonly evalRunnerClassMethodScalarWithArgumentsAsync: (
    node: Extract<ValueIR, { kind: 'call' }>,
    env: SemanticEnv,
    args: readonly unknown[],
    runBody: (body: readonly IRNode[], env: SemanticEnv) => Promise<Trace>,
  ) => Promise<PortableScalar | undefined>;
  readonly evalRunnerClassNewValue: (node: ValueIR, env: SemanticEnv) => RunnerClassInstanceValue;
  readonly evalRunnerClassNewValueWithArguments: (
    node: ValueIR,
    env: SemanticEnv,
    args: readonly unknown[],
  ) => RunnerClassInstanceValue;
  readonly evalRunnerClassNewValueWithArgumentsAsync: (
    node: ValueIR,
    env: SemanticEnv,
    args: readonly unknown[],
    runBody: (body: readonly IRNode[], env: SemanticEnv) => Promise<Trace>,
  ) => Promise<RunnerClassInstanceValue>;
  readonly evalRunnerFunctionArgumentValue: (node: ValueIR, env: SemanticEnv) => RunnerFunctionValue;
  readonly evalRunnerFunctionValue: (fnName: string, args: readonly ValueIR[], env: SemanticEnv) => RunnerFunctionValue;
  readonly evalRunnerNativeDecimalScalarCall: (
    node: Extract<ValueIR, { kind: 'call' }>,
    env: SemanticEnv,
  ) => PortableScalar | undefined;
  readonly isCanonicalDecimalLiteralFailure: (error: unknown) => boolean;
  readonly isCaughtErrorValue: (value: unknown) => value is CaughtErrorValue;
  readonly isDecimalExpression: (node: ValueIR) => boolean;
  readonly isDecimalNamespaceCall: (node: ValueIR) => node is Extract<ValueIR, { kind: 'call' }>;
  readonly isDecimalValue: (value: unknown) => value is DecimalValue;
  readonly isDecimalValueExpression: (node: ValueIR) => boolean;
  readonly isIntProvenancedExpr: (node: ValueIR, env: SemanticEnv) => boolean;
  readonly isPortableBindingName: (name: unknown) => name is string;
  readonly isPortableRecordValue: (value: unknown) => value is PortableRecord;
  readonly isPortableScalar: (value: unknown) => value is PortableScalar;
  readonly isRecordLiteralExpression: (node: ValueIR) => node is Extract<ValueIR, { kind: 'objectLit' }>;
  readonly isRunnerClassInstanceValue: (value: unknown) => value is RunnerClassInstanceValue;
  readonly isRunnerNativeDecimalFailClose: (error: unknown) => boolean;
  readonly isRunnerPortableArrayValue: (value: unknown, seen?: WeakSet<object>) => value is RunnerPortableArrayValue;
  readonly isSafeIntegerLiteralIndex: (node: ValueIR) => boolean;
  readonly makeDecimalValue: (canonical: string) => DecimalValue;
  readonly portableTruthy: (value: PortableScalar) => boolean;
  readonly sameType: (a: PortableScalar, b: PortableScalar) => boolean;
}

type _ValueExportNamesStayExact = Assert<TypeEqual<keyof typeof api, keyof PortableScalar45ValueApi>>;

const portableScalar45Api: PortableScalar45ValueApi = api;
const currentPortableScalarApi: typeof api = portableScalar45Api;
void portableScalar45Api;
void currentPortableScalarApi;

type _PortableScalar = Assert<TypeEqual<PortableScalar, string | number | boolean | null>>;
type _DecimalValue = Assert<
  TypeEqual<
    DecimalValue,
    {
      readonly [decimalValueTag]: true;
      readonly canonical: string;
    }
  >
>;
type _EvalOptions = Assert<TypeEqual<EvalRecordLiteralOptions, { readonly captureFreshArrayBindings?: boolean }>>;
type _RecordEntry = Assert<TypeEqual<PortableRecordEntry, { key: string; rawKey?: string; value: ValueIR }>>;
type _RunnerArray = Assert<
  TypeEqual<RunnerPortableArrayValue, ReadonlyArray<PortableScalar | RunnerPortableArrayValue>>
>;
type _PortableRecord = Assert<
  TypeEqual<PortableRecord, Readonly<Record<string, PortableScalar | RunnerPortableArrayValue>>>
>;
type _RunnerValue = Assert<TypeEqual<RunnerPortableValue, PortableScalar | PortableRecord | RunnerPortableArrayValue>>;
type _RunnerFunctionValue = Assert<TypeEqual<RunnerFunctionValue, RunnerPortableValue | RunnerClassInstanceValue>>;
type _CaughtError = Assert<
  TypeEqual<
    CaughtErrorValue,
    {
      readonly [caughtErrorTag]: true;
      readonly kind: string;
      readonly message: string;
    }
  >
>;

void (null as unknown as _ValueExportNamesStayExact);
void (null as unknown as _PortableScalar);
void (null as unknown as _DecimalValue);
void (null as unknown as _EvalOptions);
void (null as unknown as _RecordEntry);
void (null as unknown as _RunnerArray);
void (null as unknown as _PortableRecord);
void (null as unknown as _RunnerValue);
void (null as unknown as _RunnerFunctionValue);
void (null as unknown as _CaughtError);
