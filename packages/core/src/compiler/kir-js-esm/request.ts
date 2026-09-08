import { KernKirFault, type KernKirLimits, type KernKirValue } from '../../kir-runtime/contracts.js';
import { canonicalJson } from '../../kir-runtime/digest.js';
import { RuntimeMeter } from '../../kir-runtime/inspect.js';
import { KERN_KIR_JS_ESM_COMPILER_FORMAT, type KernKirJavaScriptEsmCompileRequest } from './contracts.js';

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

export function jsString(value: string): string {
  return canonicalJson(value);
}

export function encodedText(value: string): string {
  return `__chars([${Array.from(value, (character) => character.codePointAt(0) as number).join(',')}])`;
}

export function valueSource(value: KernKirValue): string {
  if (value.tag === 'null') return `Object.freeze({tag:'null'})`;
  if (value.tag === 'boolean') return `Object.freeze({tag:'boolean',value:${String(value.value)}})`;
  if (value.tag === 'text' || value.tag === 'integer' || value.tag === 'decimal') {
    return `Object.freeze({tag:${jsString(value.tag)},value:${jsString(value.value)}})`;
  }
  if (value.tag === 'list') {
    return `Object.freeze({tag:'list',value:Object.freeze([${value.value.map(valueSource).join(',')}])})`;
  }
  return `Object.freeze({tag:'record',value:Object.freeze([${value.value
    .map((entry) => `Object.freeze({key:${jsString(entry.key)},value:${valueSource(entry.value)}})`)
    .join(',')}])})`;
}

export function dataSource(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return jsString(value);
  if (Array.isArray(value)) return `[${value.map(dataSource).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${jsString(key)}:${dataSource(record[key])}`)
    .join(',')}}`;
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
  readonly request: KernKirJavaScriptEsmCompileRequest;
  readonly meter: RuntimeMeter;
} {
  const input = plain(value);
  exact(input, ['format', 'entry', 'limits']);
  if (input.format !== KERN_KIR_JS_ESM_COMPILER_FORMAT) throw new TypeError('unsupported compiler format');
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
    request: Object.freeze({ format: KERN_KIR_JS_ESM_COMPILER_FORMAT, entry, limits }),
    meter,
  };
}

export function invalidCompilerRequest(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof KernKirFault && error.code === 'runtime-limit-exceeded');
}
