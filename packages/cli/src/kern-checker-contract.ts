// Private facts/result boundary shared by the packaged checker and bootstrap producer.
export const KERN_CHECKER_FACTS_FORMAT = 'kern.checker.facts.2';
export const KERN_CHECKER_RESULT_FORMAT = 'kern.checker.result.1';
export const KERN_CHECKER_NATIVE_WORK_FORMULA = 'kern.checker.native-work.1';

export const KERN_CHECKER_TABLES = Object.freeze([
  ['stmtKind', 'string'],
  ['stmtFn', 'string'],
  ['stmtParent', 'number'],
  ['stmtLine', 'number'],
  ['stmtCol', 'number'],
  ['stmtName', 'string'],
  ['stmtTarget', 'string'],
  ['stmtValue', 'string'],
  ['stmtTemplate', 'string'],
  ['stmtExprKind', 'string'],
  ['stmtExprName', 'string'],
  ['stmtExprLeftKind', 'string'],
  ['stmtExprLeftName', 'string'],
  ['stmtExprLeftNum', 'string'],
  ['stmtExprLeftMemberObject', 'string'],
  ['stmtExprLeftMemberProp', 'string'],
  ['stmtExprRightKind', 'string'],
  ['stmtExprRightName', 'string'],
  ['stmtExprRightNum', 'string'],
  ['stmtExprRightMemberObject', 'string'],
  ['stmtExprRightMemberProp', 'string'],
  ['stmtExprNum', 'string'],
  ['stmtExprCall', 'string'],
  ['stmtExprMemberObject', 'string'],
  ['stmtExprMemberProp', 'string'],
  ['stmtExprArgCount', 'number'],
  ['idxStmt', 'number'],
  ['idxFn', 'string'],
  ['idxLine', 'number'],
  ['idxCol', 'number'],
  ['idxIndexKind', 'string'],
  ['idxIndexName', 'string'],
  ['callStmt', 'number'],
  ['callFn', 'string'],
  ['callStmtKind', 'string'],
  ['callLine', 'number'],
  ['callCol', 'number'],
  ['callName', 'string'],
  ['callMemberObject', 'string'],
  ['callMemberProp', 'string'],
  ['callArgCount', 'number'],
  ['argCall', 'number'],
  ['argOrdinal', 'number'],
  ['argKind', 'string'],
  ['argName', 'string'],
  ['argNum', 'string'],
  ['argOp', 'string'],
  ['argLeftKind', 'string'],
  ['argLeftName', 'string'],
  ['argLeftNum', 'string'],
  ['argRightKind', 'string'],
  ['argRightName', 'string'],
  ['argRightNum', 'string'],
  ['paramFn', 'string'],
  ['paramName', 'string'],
  ['paramType', 'string'],
  ['paramOrdinal', 'number'],
  ['paramOwnerStmt', 'number'],
] as const);

export type KernCheckerTableName = (typeof KERN_CHECKER_TABLES)[number][0];
export type KernCheckerTables = Record<KernCheckerTableName, Array<string | number>>;

export interface KernCheckerFacts {
  readonly format: typeof KERN_CHECKER_FACTS_FORMAT;
  readonly path: string;
  readonly tables: KernCheckerTables;
}

export interface KernCheckerProfileLimits {
  readonly maxDiagnostics: number;
  readonly maxFactCells: number;
  readonly maxInputBytes: number;
  readonly maxPathBytes: number;
  readonly maxResultBytes: number;
  readonly maxRowsPerFamily: number;
}

export interface KernCheckerPolicyLike {
  readonly profileLimits: KernCheckerProfileLimits;
  readonly runtimeLimits: { readonly maxStringBytes: number };
}

const STATEMENT_TABLES = KERN_CHECKER_TABLES.slice(0, 26).map(([name]) => name);
const INDEX_TABLES = KERN_CHECKER_TABLES.slice(26, 32).map(([name]) => name);
const CALL_TABLES = KERN_CHECKER_TABLES.slice(32, 41).map(([name]) => name);
const ARGUMENT_TABLES = KERN_CHECKER_TABLES.slice(41, 53).map(([name]) => name);
const PARAMETER_TABLES = KERN_CHECKER_TABLES.slice(53).map(([name]) => name);
const TABLE_NAMES = KERN_CHECKER_TABLES.map(([name]) => name);
const textEncoder = new TextEncoder();

function fail(detail: string): never {
  throw new TypeError(`KERN checker facts rejection: ${detail}`);
}

function exactKeys(
  value: unknown,
  expected: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${label} must be a plain record`);
  if (Object.getOwnPropertySymbols(value).length > 0) fail(`${label} must not contain symbol fields`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some((item) => item.get || item.set || !item.enumerable || !('value' in item))) {
    fail(`${label} must contain inspectable data fields`);
  }
  const actual = Object.keys(descriptors).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    fail(`${label} must contain exactly ${sorted.join(',')}`);
  }
}

function denseArray(value: unknown, label: string): Array<string | number> {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${label} must be a plain array`);
  if (Object.getOwnPropertySymbols(value).length > 0) fail(`${label} must not contain symbol fields`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors);
  const lengthDescriptor = (descriptors as Record<string, PropertyDescriptor>).length;
  if (keys.length !== value.length + 1 || lengthDescriptor?.value !== value.length) fail(`${label} must be dense`);
  for (let index = 0; index < value.length; index += 1) {
    const item = descriptors[String(index)];
    if (!item || item.get || item.set || !item.enumerable || !('value' in item)) fail(`${label} must be inspectable`);
  }
  return value as Array<string | number>;
}

function tableLength(tables: KernCheckerTables, names: readonly KernCheckerTableName[], label: string): number {
  const length = tables[names[0]].length;
  if (names.some((name) => tables[name].length !== length)) fail(`${label} table lengths must match`);
  return length;
}

function earlierReference(value: string | number, index: number, label: string): void {
  if (!Number.isSafeInteger(value) || Number(value) < -1 || Number(value) >= index) {
    fail(`${label}[${index}] must reference an earlier statement or -1`);
  }
}

function domainReference(value: string | number, size: number, label: string, index: number): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= size) {
    fail(`${label}[${index}] is outside its reference domain`);
  }
}

function jsonBytes(value: string | number): number {
  return textEncoder.encode(JSON.stringify(value)).length;
}

function inputByteCounter(limit: number): { add: (bytes: number) => void; value: () => number } {
  let total = 0;
  return {
    add(bytes) {
      total += bytes;
      if (total > limit) fail('facts exceed maxInputBytes');
    },
    value: () => total,
  };
}

export function estimateKernCheckerNativeWork(
  facts: KernCheckerFacts,
  maxNativeWork = Number.MAX_SAFE_INTEGER - 1,
): number {
  if (!Number.isSafeInteger(maxNativeWork) || maxNativeWork <= 0 || maxNativeWork >= Number.MAX_SAFE_INTEGER) {
    fail('maxNativeWork must be a positive safe integer below Number.MAX_SAFE_INTEGER');
  }
  const tables = facts.tables;
  const s = BigInt(tables.stmtKind.length);
  const i = BigInt(tables.idxFn.length);
  const c = BigInt(tables.callName.length);
  const a = BigInt(tables.argCall.length);
  const p = BigInt(tables.paramFn.length);
  const f = BigInt(Object.values(tables).reduce((total, table) => total + table.length, 0));
  const b = BigInt(textEncoder.encode(JSON.stringify(facts)).length);
  const entryWork = b + f + 4n * s + 2n * c + a + p;
  const statementWork = s + 12n * s * s + 4n * s * p;
  const callWork = c * (s + 4n * a + 32n) + c * c * (3n * a + s + 32n);
  const indexWork = i * (6n * s + 2n * p + 2n * a + 32n + c * (a + 6n * s + 4n * p + 32n));
  const work = entryWork + statementWork + callWork + indexWork;
  const ceiling = BigInt(maxNativeWork) + 1n;
  return Number(work > ceiling ? ceiling : work);
}

function validateCanonicalArguments(tables: KernCheckerTables, callCount: number, argumentCount: number): void {
  let cursor = 0;
  for (let call = 0; call < callCount; call += 1) {
    const declared = Number(tables.callArgCount[call]);
    if (!Number.isSafeInteger(declared) || declared < 0) fail(`callArgCount[${call}] must be non-negative`);
    for (let ordinal = 0; ordinal < declared; ordinal += 1) {
      if (cursor >= argumentCount || tables.argCall[cursor] !== call || tables.argOrdinal[cursor] !== ordinal) {
        fail('argument tables must contain canonical argument rows');
      }
      cursor += 1;
    }
  }
  if (cursor !== argumentCount) fail('argument tables must contain canonical argument rows');
}

function validateCanonicalParameters(tables: KernCheckerTables, statementCount: number, parameterCount: number): void {
  let cursor = 0;
  for (let statement = 0; statement < statementCount; statement += 1) {
    if (tables.stmtKind[statement] !== 'fn') continue;
    let ordinal = 0;
    while (cursor < parameterCount && tables.paramOwnerStmt[cursor] === statement) {
      if (tables.paramFn[cursor] !== tables.stmtName[statement] || tables.paramOrdinal[cursor] !== ordinal) {
        fail('parameter tables must contain canonical parameter rows');
      }
      cursor += 1;
      ordinal += 1;
    }
  }
  if (cursor !== parameterCount) fail('parameter tables must contain canonical parameter rows');
}

export function validateKernCheckerFacts(input: unknown, policy: KernCheckerPolicyLike): KernCheckerFacts {
  exactKeys(input, ['format', 'path', 'tables'], 'facts');
  if (input.format !== KERN_CHECKER_FACTS_FORMAT) fail('format is unsupported');
  if (typeof input.path !== 'string' || input.path.length === 0) fail('path must be non-empty text');
  if (/[\u0000-\u001f\u007f]/u.test(input.path)) fail('path must not contain control characters');
  if (textEncoder.encode(input.path).length > policy.profileLimits.maxPathBytes) fail('path exceeds maxPathBytes');
  exactKeys(input.tables, TABLE_NAMES, 'tables');

  const bytes = inputByteCounter(policy.profileLimits.maxInputBytes);
  bytes.add(textEncoder.encode('{"format":').length + jsonBytes(input.format));
  bytes.add(textEncoder.encode(',"path":').length + jsonBytes(input.path));
  bytes.add(textEncoder.encode(',"tables":{').length);
  const tables = input.tables as KernCheckerTables;
  let cells = 0;
  for (let tableIndex = 0; tableIndex < KERN_CHECKER_TABLES.length; tableIndex += 1) {
    const [name, type] = KERN_CHECKER_TABLES[tableIndex];
    const table = denseArray(tables[name], name);
    if (table.length > policy.profileLimits.maxRowsPerFamily) fail(`${name} exceeds maxRowsPerFamily`);
    bytes.add((tableIndex === 0 ? 0 : 1) + jsonBytes(name) + 2);
    for (let index = 0; index < table.length; index += 1) {
      const value = table[index];
      if (type === 'string' && typeof value !== 'string') fail(`${name}[${index}] must be text`);
      if (type === 'number' && !Number.isSafeInteger(value)) fail(`${name}[${index}] must be a safe integer`);
      if (typeof value === 'string' && textEncoder.encode(value).length > policy.runtimeLimits.maxStringBytes) {
        fail(`${name}[${index}] exceeds runtime maxStringBytes`);
      }
      bytes.add((index === 0 ? 0 : 1) + jsonBytes(value));
    }
    bytes.add(1);
    cells += table.length;
  }
  bytes.add(2);
  if (cells > policy.profileLimits.maxFactCells) fail('facts exceed maxFactCells');

  const statementCount = tableLength(tables, STATEMENT_TABLES, 'statement');
  const indexCount = tableLength(tables, INDEX_TABLES, 'index');
  const callCount = tableLength(tables, CALL_TABLES, 'call');
  const argumentCount = tableLength(tables, ARGUMENT_TABLES, 'argument');
  const parameterCount = tableLength(tables, PARAMETER_TABLES, 'parameter');
  tables.stmtParent.forEach((value, index) => earlierReference(value, index, 'stmtParent'));
  tables.idxStmt.forEach((value, index) => domainReference(value, statementCount, 'idxStmt', index));
  tables.callStmt.forEach((value, index) => domainReference(value, statementCount, 'callStmt', index));
  tables.stmtExprArgCount.forEach((value, index) => {
    if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`stmtExprArgCount[${index}] must be non-negative`);
  });
  validateCanonicalArguments(tables, callCount, argumentCount);
  validateCanonicalParameters(tables, statementCount, parameterCount);
  if (indexCount !== tables.idxFn.length || bytes.value() <= 0) fail('internal table count mismatch');
  return structuredClone(input) as unknown as KernCheckerFacts;
}
