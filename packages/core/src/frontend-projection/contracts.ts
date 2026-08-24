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

function denseArray(value: unknown, label: string): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.keys(value).length !== value.length
  ) {
    throw new TypeError(`${label}: expected dense plain array`);
  }
  return value;
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
): NormalizedProjectionRequest {
  const request = plainRecord(value, 'KERN projection request');
  const requestKeys = Object.hasOwn(request, 'budgets') ? ['modules', 'budgets'] : ['modules'];
  exact(request, requestKeys, 'KERN projection request');
  const modules = denseArray(request.modules, 'KERN projection modules');
  if (modules.length === 0) throw new TypeError('KERN projection modules: expected non-empty array');
  const acceptedModules = modules
    .map((value, index) => {
      const module = plainRecord(value, `KERN projection module ${index}`);
      exact(module, ['moduleId', 'source'], `KERN projection module ${index}`);
      if (typeof module.moduleId !== 'string' || typeof module.source !== 'string') {
        throw new TypeError(`KERN projection module ${index}: moduleId and source must be strings`);
      }
      return Object.freeze({ moduleId: module.moduleId, source: module.source });
    })
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
