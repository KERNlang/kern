import { KernKirFault, type KernKirLimits } from '../../kir-runtime/contracts.js';
import { RuntimeMeter } from '../../kir-runtime/inspect.js';
import type {
  LinkedKernKirExpression,
  LinkedKernKirProgram,
  LinkedKernKirStatement,
} from '../../kir-runtime/linked-kir-program/index.js';
import { KERN_KIR_PYTHON_COMPILER_FORMAT, type KernKirPythonCompileRequest } from './contracts.js';

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;
const LIMIT_KEYS = [
  'maxBytes',
  'maxCollectionLength',
  'maxDepth',
  'maxDiagnostics',
  'maxEvents',
  'maxSteps',
  'maxStringBytes',
] as const;

type UnknownRecord = Record<string, unknown>;

export type KirPythonLoweringState = 'lowered' | 'deferred';

export const KIR_PYTHON_STATEMENT_LOWERING = Object.freeze({
  assign: 'lowered',
  break: 'deferred',
  capability: 'lowered',
  continue: 'deferred',
  for: 'lowered',
  if: 'lowered',
  let: 'lowered',
  print: 'lowered',
  return: 'lowered',
  throw: 'deferred',
  try: 'deferred',
  while: 'deferred',
}) satisfies Record<LinkedKernKirStatement['kind'], KirPythonLoweringState>;

export const KIR_PYTHON_EXPRESSION_LOWERING = Object.freeze({
  binary: 'lowered',
  identifier: 'lowered',
  'json-call': 'lowered',
  list: 'lowered',
  literal: 'lowered',
  member: 'lowered',
  record: 'lowered',
  unary: 'lowered',
  'user-call': 'lowered',
}) satisfies Record<LinkedKernKirExpression['kind'], KirPythonLoweringState>;

export const KIR_PYTHON_LOWERING = Object.freeze({
  expression: KIR_PYTHON_EXPRESSION_LOWERING,
  statement: KIR_PYTHON_STATEMENT_LOWERING,
});

export type KirPythonLowering = {
  readonly expression: Record<LinkedKernKirExpression['kind'], KirPythonLoweringState>;
  readonly statement: Record<LinkedKernKirStatement['kind'], KirPythonLoweringState>;
};

function expressionDeferral(
  expression: LinkedKernKirExpression,
  lowering: KirPythonLowering,
): LinkedKernKirExpression['kind'] | undefined {
  if (lowering.expression[expression.kind] === 'deferred') return expression.kind;
  switch (expression.kind) {
    case 'binary':
      return expressionDeferral(expression.left, lowering) ?? expressionDeferral(expression.right, lowering);
    case 'unary':
    case 'json-call':
      return expressionDeferral(expression.argument, lowering);
    case 'list': {
      for (const item of expression.items) {
        const deferred = expressionDeferral(item, lowering);
        if (deferred !== undefined) return deferred;
      }
      return undefined;
    }
    case 'record': {
      for (const entry of expression.entries) {
        const deferred = expressionDeferral(entry.value, lowering);
        if (deferred !== undefined) return deferred;
      }
      return undefined;
    }
    case 'member':
      return expressionDeferral(expression.object, lowering);
    case 'user-call': {
      for (const argument of expression.arguments) {
        const deferred = expressionDeferral(argument, lowering);
        if (deferred !== undefined) return deferred;
      }
      return undefined;
    }
    case 'identifier':
    case 'literal':
      return undefined;
    default: {
      const exhaustive: never = expression;
      throw new TypeError(`unhandled kir-python expression kind: ${(exhaustive as { kind: string }).kind}`);
    }
  }
}

function statementDeferral(
  statement: LinkedKernKirStatement,
  lowering: KirPythonLowering,
): LinkedKernKirStatement['kind'] | LinkedKernKirExpression['kind'] | undefined {
  if (lowering.statement[statement.kind] === 'deferred') return statement.kind;
  switch (statement.kind) {
    case 'if':
      return (
        expressionDeferral(statement.condition, lowering) ??
        statementsDeferral(statement.thenBranch, lowering) ??
        statementsDeferral(statement.elseBranch ?? [], lowering)
      );
    case 'for':
      return (
        expressionDeferral(statement.from, lowering) ??
        expressionDeferral(statement.to, lowering) ??
        expressionDeferral(statement.step, lowering) ??
        statementsDeferral(statement.body, lowering)
      );
    case 'capability':
      return statement.input === undefined ? undefined : expressionDeferral(statement.input, lowering);
    case 'assign':
    case 'let':
    case 'print':
    case 'return':
      return expressionDeferral(statement.value, lowering);
    case 'while':
      return expressionDeferral(statement.condition, lowering) ?? statementsDeferral(statement.body, lowering);
    case 'break':
    case 'continue':
    case 'throw':
    case 'try':
      return undefined;
    default: {
      const exhaustive: never = statement;
      throw new TypeError(`unhandled kir-python statement kind: ${(exhaustive as { kind: string }).kind}`);
    }
  }
}

function statementsDeferral(
  statements: readonly LinkedKernKirStatement[],
  lowering: KirPythonLowering,
): LinkedKernKirStatement['kind'] | LinkedKernKirExpression['kind'] | undefined {
  for (const statement of statements) {
    const deferred = statementDeferral(statement, lowering);
    if (deferred !== undefined) return deferred;
  }
  return undefined;
}

export function pythonLoweringDeferral(
  linked: LinkedKernKirProgram,
  lowering: KirPythonLowering = KIR_PYTHON_LOWERING,
): LinkedKernKirStatement['kind'] | LinkedKernKirExpression['kind'] | undefined {
  const entryDeferral = statementsDeferral(linked.program.statements, lowering);
  if (entryDeferral !== undefined) return entryDeferral;
  for (const helper of linked.helpers ?? []) {
    const deferred = statementsDeferral(helper.handler.statements, lowering);
    if (deferred !== undefined) return deferred;
  }
  return undefined;
}

function plain(value: unknown): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('expected plain data');
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('expected plain data');
    const output: UnknownRecord = Object.create(null) as UnknownRecord;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError('symbol fields are forbidden');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError('accessors are forbidden');
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    throw new TypeError('compiler request must be safely inspectable plain data');
  }
}

function exact(record: UnknownRecord, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new TypeError('unexpected fields');
  }
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError('expected positive safe integer');
  return value as number;
}

export function inspectCompilerRequest(value: unknown): {
  readonly request: KernKirPythonCompileRequest;
  readonly meter: RuntimeMeter;
} {
  const input = plain(value);
  exact(input, ['format', 'entry', 'limits']);
  if (input.format !== KERN_KIR_PYTHON_COMPILER_FORMAT) throw new TypeError('unsupported compiler format');
  const limitInput = plain(input.limits);
  exact(limitInput, LIMIT_KEYS);
  const limits: KernKirLimits = Object.freeze({
    maxBytes: positive(limitInput.maxBytes),
    maxCollectionLength: positive(limitInput.maxCollectionLength),
    maxDepth: positive(limitInput.maxDepth),
    maxDiagnostics: positive(limitInput.maxDiagnostics),
    maxEvents: positive(limitInput.maxEvents),
    maxSteps: positive(limitInput.maxSteps),
    maxStringBytes: positive(limitInput.maxStringBytes),
  });
  const meter = new RuntimeMeter(limits);
  const entryInput = plain(input.entry);
  exact(entryInput, ['moduleId', 'handlerName']);
  if (typeof entryInput.moduleId !== 'string' || !entryInput.moduleId.endsWith('.kern')) {
    throw new TypeError('invalid module id');
  }
  if (typeof entryInput.handlerName !== 'string' || !IDENTIFIER.test(entryInput.handlerName)) {
    throw new TypeError('invalid handler name');
  }
  const entry = Object.freeze({
    moduleId: meter.text(entryInput.moduleId, 'compiler request module id'),
    handlerName: meter.text(entryInput.handlerName, 'compiler request handler name'),
  });
  meter.collection(3, 'compiler request');
  return {
    request: Object.freeze({ format: KERN_KIR_PYTHON_COMPILER_FORMAT, entry, limits }),
    meter,
  };
}

export function invalidCompilerRequest(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof KernKirFault && error.code === 'runtime-limit-exceeded');
}
