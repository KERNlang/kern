import { KernKirFault, type KernKirLimits } from '../../kir-runtime/contracts.js';
import { RuntimeMeter } from '../../kir-runtime/inspect.js';
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
