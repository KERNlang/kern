import type { ModuleKirArtifact } from '../kir-structural/module-types.js';

export const PROJECTION_BUDGET_KEYS = [
  'maxModules',
  'maxInstructionScalars',
  'maxWorkSteps',
  'maxNodes',
  'maxDepth',
  'maxCollectionLength',
  'maxStringCodePoints',
] as const;

export type KernProjectionBudgetName = (typeof PROJECTION_BUDGET_KEYS)[number];

export type KernProjectionBudgets = Readonly<Partial<Record<KernProjectionBudgetName, number>>>;

export interface KernProjectionModule {
  readonly moduleId: string;
  readonly source: string;
}

export interface KernProjectionRequest {
  readonly modules: readonly KernProjectionModule[];
  readonly budgets?: KernProjectionBudgets;
}

export interface KernProjectionDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly line?: number;
  readonly col?: number;
  readonly endLine?: number;
  readonly endCol?: number;
}

export interface KernProjectionReceipt {
  readonly format: 'kern.frontend.packaged-projection.1';
  readonly requestDigest: string;
  readonly artifactDigest: string | null;
  readonly f5PolicyDigest: string;
  readonly f5ReceiptFormat: string | null;
  readonly f5Status: 'projected' | 'rejected' | 'fatal';
  readonly compositionDigest: string;
  readonly assetManifestDigest: string;
  readonly workSteps: number;
  readonly terminalSeal: string;
}

export interface KernProjectedResult {
  readonly status: 'projected';
  readonly bytes: Uint8Array;
  readonly artifact: ModuleKirArtifact;
  readonly diagnostics: readonly [];
  readonly receipt: KernProjectionReceipt;
}

export interface KernProjectionFailure {
  readonly status: 'rejected' | 'fatal';
  readonly bytes: null;
  readonly artifact: null;
  readonly diagnostics: readonly KernProjectionDiagnostic[];
  readonly receipt: KernProjectionReceipt;
}

export type KernProjectionResult = KernProjectedResult | KernProjectionFailure;

declare const VERIFIED_KERN_PROJECTION: unique symbol;

export type VerifiedKernProjection = KernProjectedResult & {
  readonly [VERIFIED_KERN_PROJECTION]: true;
};

export interface NormalizedProjectionRequest {
  readonly modules: readonly KernProjectionModule[];
  readonly budgets: KernProjectionBudgets | undefined;
}

export interface ProjectionWrapperLimits {
  readonly maxModules: number;
  readonly maxModuleIdScalars: number;
  readonly maxModuleIdUtf8Bytes: number;
  readonly maxModuleIdSegments: number;
  readonly maxSourceScalars: number;
  readonly maxSourceUtf8Bytes: number;
  readonly maxAggregateInputScalars: number;
  readonly maxAggregateInputBytes: number;
}

type UnknownRecord = Record<string, unknown>;

function plainRecord(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label}: expected plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label}: expected plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    Reflect.ownKeys(value).some((key) => typeof key === 'symbol') ||
    Object.values(descriptors).some((descriptor) => descriptor.get || descriptor.set || !descriptor.enumerable)
  ) {
    throw new TypeError(`${label}: expected inspectable data properties`);
  }
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function exact(record: UnknownRecord, keys: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label}: expected exact fields ${expected.join(',')}`);
  }
}

function denseArray(value: unknown, label: string, maxLength: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label}: expected dense plain array`);
  }
  if (value.length > maxLength) throw new TypeError(`${label}: exceeds maximum length ${maxLength}`);
  if (Object.keys(value).length !== value.length) throw new TypeError(`${label}: expected dense plain array`);
  return value;
}

interface TextMeasure {
  readonly scalars: number;
  readonly utf8Bytes: number;
}

function measureText(value: string, label: string): TextMeasure {
  let scalars = 0;
  let utf8Bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    scalars += 1;
    if (unit <= 0x7f) utf8Bytes += 1;
    else if (unit <= 0x7ff) utf8Bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low < 0xdc00 || low > 0xdfff) throw new TypeError(`${label}: malformed UTF-16`);
      index += 1;
      utf8Bytes += 4;
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError(`${label}: malformed UTF-16`);
      utf8Bytes += 3;
    }
  }
  return { scalars, utf8Bytes };
}

function inspectModuleId(value: string, limits: ProjectionWrapperLimits, label: string): TextMeasure {
  const measured = measureText(value, label);
  if (
    measured.scalars > limits.maxModuleIdScalars ||
    measured.utf8Bytes > limits.maxModuleIdUtf8Bytes ||
    value.length === 0 ||
    !value.endsWith('.kern') ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.includes(':') ||
    value.includes('//') ||
    value.endsWith('/')
  ) {
    throw new TypeError(`${label}: expected bounded normalized relative POSIX .kern id`);
  }
  let segments = 1;
  let segmentStart = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index !== value.length && value.charCodeAt(index) !== 0x2f) continue;
    const length = index - segmentStart;
    if (
      length === 0 ||
      (length === 1 && value.charCodeAt(segmentStart) === 0x2e) ||
      (length === 2 && value.charCodeAt(segmentStart) === 0x2e && value.charCodeAt(segmentStart + 1) === 0x2e)
    ) {
      throw new TypeError(`${label}: module id must remain inside the artifact root`);
    }
    if (index !== value.length) segments += 1;
    segmentStart = index + 1;
  }
  if (segments > limits.maxModuleIdSegments) throw new TypeError(`${label}: too many path segments`);
  return measured;
}

export function compareCodePoints(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const b = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return (a[index] as number) - (b[index] as number);
  }
  return a.length - b.length;
}

export function normalizeProjectionRequest(
  value: unknown,
  profileLimits: Readonly<Record<KernProjectionBudgetName, number>>,
  wrapperLimits: ProjectionWrapperLimits,
): NormalizedProjectionRequest {
  const request = plainRecord(value, 'KERN projection request');
  const requestKeys = Object.hasOwn(request, 'budgets') ? ['modules', 'budgets'] : ['modules'];
  exact(request, requestKeys, 'KERN projection request');
  const modules = denseArray(request.modules, 'KERN projection modules', wrapperLimits.maxModules);
  if (modules.length === 0) throw new TypeError('KERN projection modules: expected non-empty array');
  const inspectedModules: { moduleId: string; source: string }[] = [];
  let aggregateScalars = 0;
  let aggregateBytes = 0;
  for (let index = 0; index < modules.length; index += 1) {
    const module = plainRecord(modules[index], `KERN projection module ${index}`);
    exact(module, ['moduleId', 'source'], `KERN projection module ${index}`);
    if (typeof module.moduleId !== 'string' || typeof module.source !== 'string') {
      throw new TypeError(`KERN projection module ${index}: moduleId and source must be strings`);
    }
    const idMeasure = inspectModuleId(module.moduleId, wrapperLimits, `KERN projection module ${index}`);
    const sourceMeasure = measureText(module.source, `KERN projection module ${index} source`);
    if (
      sourceMeasure.scalars > wrapperLimits.maxSourceScalars ||
      sourceMeasure.utf8Bytes > wrapperLimits.maxSourceUtf8Bytes
    ) {
      throw new TypeError(`KERN projection module ${index}: source exceeds admission limits`);
    }
    aggregateScalars += idMeasure.scalars + sourceMeasure.scalars;
    aggregateBytes += idMeasure.utf8Bytes + sourceMeasure.utf8Bytes;
    if (
      aggregateScalars > wrapperLimits.maxAggregateInputScalars ||
      aggregateBytes > wrapperLimits.maxAggregateInputBytes
    ) {
      throw new TypeError('KERN projection modules: aggregate input exceeds admission limits');
    }
    inspectedModules.push({ moduleId: module.moduleId, source: module.source });
  }
  const acceptedModules = inspectedModules
    .map((module) => Object.freeze({ ...module }))
    .sort((left, right) => compareCodePoints(left.moduleId, right.moduleId));

  let budgets: KernProjectionBudgets | undefined;
  if (Object.hasOwn(request, 'budgets')) {
    const supplied = plainRecord(request.budgets, 'KERN projection budgets');
    for (const key of Object.keys(supplied)) {
      if (!(PROJECTION_BUDGET_KEYS as readonly string[]).includes(key)) {
        throw new TypeError(`KERN projection budgets: unknown field ${key}`);
      }
      const value = supplied[key];
      const ceiling = profileLimits[key as KernProjectionBudgetName];
      if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > ceiling) {
        throw new TypeError(`KERN projection budgets: ${key} must be a positive integer at most ${ceiling}`);
      }
    }
    budgets = Object.freeze({ ...supplied }) as KernProjectionBudgets;
  }
  return Object.freeze({ modules: Object.freeze(acceptedModules), budgets });
}

export function inspectPlainRecord(value: unknown, keys: readonly string[], label: string): UnknownRecord {
  const record = plainRecord(value, label);
  exact(record, keys, label);
  return record;
}
