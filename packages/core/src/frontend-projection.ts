import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import {
  loadProjectionAssetState,
  ProjectionAssetError,
  type ProjectionAssetState,
} from './frontend-projection/assets.js';
import {
  inspectPlainRecord,
  type KernProjectedResult,
  type KernProjectionDiagnostic,
  type KernProjectionFailure,
  type KernProjectionReceipt,
  type KernProjectionRequest,
  type KernProjectionResult,
  type NormalizedProjectionRequest,
  normalizeProjectionRequest,
  type ProjectionWrapperLimits,
  type VerifiedKernProjection,
} from './frontend-projection/contracts.js';
import { deepFreeze, projectionRequestDigest, receiptSeal, sha256 } from './frontend-projection/integrity.js';
import type { ModuleKirArtifact } from './kir-structural/module-types.js';

interface ProjectionAssetAdapter {
  readonly limits: {
    readonly wrapper: ProjectionWrapperLimits;
  };
  project(
    modules: NormalizedProjectionRequest['modules'],
    budgets: NormalizedProjectionRequest['budgets'],
  ): Promise<unknown>;
  decode(bytes: string, canonicalLimits: ProjectionAssetState['canonicalLimits']): Promise<{ artifact: unknown }>;
}

const require = createRequire(import.meta.url);

function loadProjectionAssetAdapter(): ProjectionAssetAdapter {
  return require('./frontend-projection-assets/adapter.cjs') as ProjectionAssetAdapter;
}

export type {
  KernProjectedResult,
  KernProjectionBudgets,
  KernProjectionDiagnostic,
  KernProjectionFailure,
  KernProjectionModule,
  KernProjectionReceipt,
  KernProjectionRequest,
  KernProjectionResult,
  VerifiedKernProjection,
} from './frontend-projection/contracts.js';
export type { ModuleKirArtifact } from './kir-structural/module-types.js';

const EMPTY_DIGEST = sha256(new Uint8Array());
const RECEIPT_KEYS = [
  'format',
  'requestDigest',
  'artifactDigest',
  'f5PolicyDigest',
  'f5ReceiptFormat',
  'f5Status',
  'compositionDigest',
  'assetManifestDigest',
  'workSteps',
  'terminalSeal',
] as const;
const RESULT_KEYS = ['status', 'bytes', 'artifact', 'diagnostics', 'receipt'] as const;
const VERIFIED = new WeakMap<object, { artifactDigest: string; assetManifestDigest: string }>();
const ISSUED = new WeakMap<
  object,
  {
    readonly artifact: ModuleKirArtifact;
    readonly artifactDigest: string;
    readonly assetManifestDigest: string;
    readonly receipt: KernProjectionReceipt;
    readonly requestDigest: string;
    readonly normalizedRequest: NormalizedProjectionRequest;
  }
>();

interface PrivateDiagnostic {
  readonly code?: unknown;
  readonly severity?: unknown;
  readonly line?: unknown;
  readonly col?: unknown;
  readonly endLine?: unknown;
  readonly endCol?: unknown;
}

interface PrivateProjectionResult {
  readonly receipt: {
    readonly header: {
      readonly format: unknown;
      readonly policySha256: unknown;
      readonly terminalSeal: unknown;
    };
    readonly status: unknown;
    readonly diagnostics: readonly PrivateDiagnostic[];
    readonly workSteps: unknown;
  };
  readonly bytes: unknown;
  readonly artifact: unknown;
}

function receiptFields(
  state: ProjectionAssetState | undefined,
  requestDigest: string,
  artifactDigest: string | null,
  f5ReceiptFormat: string | null,
  f5Status: KernProjectionReceipt['f5Status'],
  workSteps: number,
): Omit<KernProjectionReceipt, 'terminalSeal'> {
  return {
    format: 'kern.frontend.packaged-projection.1',
    requestDigest,
    artifactDigest,
    f5PolicyDigest: state?.f5PolicyDigest ?? EMPTY_DIGEST,
    f5ReceiptFormat,
    f5Status,
    compositionDigest: state?.compositionDigest ?? EMPTY_DIGEST,
    assetManifestDigest: state?.manifestDigest ?? EMPTY_DIGEST,
    workSteps,
  };
}

function makeReceipt(
  state: ProjectionAssetState | undefined,
  requestDigest: string,
  artifactDigest: string | null,
  f5ReceiptFormat: string | null,
  f5Status: KernProjectionReceipt['f5Status'],
  workSteps: number,
  privateSeal: string,
): KernProjectionReceipt {
  const fields = receiptFields(state, requestDigest, artifactDigest, f5ReceiptFormat, f5Status, workSteps);
  return deepFreeze({ ...fields, terminalSeal: receiptSeal(fields, privateSeal) });
}

function diagnostic(code: string): KernProjectionDiagnostic {
  return Object.freeze({ code, severity: 'error' });
}

function normalizedDiagnostics(value: unknown): readonly KernProjectionDiagnostic[] {
  if (!Array.isArray(value)) throw new TypeError('F5 diagnostics must be an array');
  return Object.freeze(
    value.map((item) => {
      const input = item as PrivateDiagnostic;
      if (!input || typeof input !== 'object' || typeof input.code !== 'string') {
        throw new TypeError('F5 diagnostic shape');
      }
      const severity = input.severity === 'warning' || input.severity === 'info' ? input.severity : 'error';
      const output: {
        code: string;
        severity: KernProjectionDiagnostic['severity'];
        line?: number;
        col?: number;
        endLine?: number;
        endCol?: number;
      } = { code: input.code, severity };
      for (const key of ['line', 'col', 'endLine', 'endCol'] as const) {
        const coordinate = input[key];
        if (coordinate !== undefined) {
          if (!Number.isSafeInteger(coordinate) || (coordinate as number) < 1)
            throw new TypeError('F5 diagnostic coordinate');
          output[key] = coordinate as number;
        }
      }
      return Object.freeze(output);
    }),
  );
}

function failure(
  status: KernProjectionFailure['status'],
  code: string,
  state?: ProjectionAssetState,
  requestDigest = EMPTY_DIGEST,
): KernProjectionFailure {
  const receipt = makeReceipt(state, requestDigest, null, null, status, 0, 'failure');
  return Object.freeze({
    status,
    bytes: null,
    artifact: null,
    diagnostics: Object.freeze([diagnostic(code)]),
    receipt,
  });
}

function inspectPrivateResult(value: unknown, state: ProjectionAssetState): PrivateProjectionResult {
  const result = value as PrivateProjectionResult;
  if (
    !result ||
    typeof result !== 'object' ||
    !result.receipt ||
    typeof result.receipt !== 'object' ||
    !result.receipt.header ||
    typeof result.receipt.header !== 'object' ||
    result.receipt.header.policySha256 !== state.f5PolicyDigest ||
    result.receipt.header.format !== 'kern.frontend.f5-projection.1' ||
    !['projected', 'rejected', 'fatal'].includes(String(result.receipt.status)) ||
    !Number.isSafeInteger(result.receipt.workSteps) ||
    (result.receipt.workSteps as number) < 0 ||
    typeof result.receipt.header.terminalSeal !== 'string'
  ) {
    throw new ProjectionAssetError('private F5 receipt identity');
  }
  return result;
}

function projectWithBudgets(adapter: ProjectionAssetAdapter, request: NormalizedProjectionRequest): Promise<unknown> {
  return adapter.project(request.modules, request.budgets);
}

function projectedResult(
  request: NormalizedProjectionRequest,
  state: ProjectionAssetState,
  privateResult: PrivateProjectionResult,
): KernProjectionResult {
  const status = privateResult.receipt.status as KernProjectionReceipt['f5Status'];
  const workSteps = privateResult.receipt.workSteps as number;
  const requestDigest = projectionRequestDigest(request);
  const privateSeal = privateResult.receipt.header.terminalSeal as string;
  const f5ReceiptFormat = privateResult.receipt.header.format as string;
  const inherited = normalizedDiagnostics(privateResult.receipt.diagnostics);
  if (status !== 'projected') {
    const diagnostics = inherited.length === 0 ? Object.freeze([diagnostic('projection-rejected')]) : inherited;
    const receipt = makeReceipt(state, requestDigest, null, f5ReceiptFormat, status, workSteps, privateSeal);
    return Object.freeze({ status, bytes: null, artifact: null, diagnostics, receipt });
  }
  if (
    typeof privateResult.bytes !== 'string' ||
    privateResult.bytes === '' ||
    privateResult.artifact === null ||
    typeof privateResult.artifact !== 'object'
  ) {
    throw new ProjectionAssetError('private F5 projected evidence');
  }
  const bytes = Uint8Array.from(Buffer.from(privateResult.bytes, 'base64'));
  const artifact = deepFreeze(privateResult.artifact as ModuleKirArtifact);
  const artifactDigest = sha256(bytes);
  const receipt = makeReceipt(state, requestDigest, artifactDigest, f5ReceiptFormat, status, workSteps, privateSeal);
  return Object.freeze({ status, bytes, artifact, diagnostics: Object.freeze([]) as readonly [], receipt });
}

export async function projectKernModules(request: KernProjectionRequest): Promise<KernProjectionResult> {
  let state: ProjectionAssetState;
  let adapter: ProjectionAssetAdapter;
  try {
    state = loadProjectionAssetState();
    adapter = loadProjectionAssetAdapter();
  } catch {
    return failure('fatal', 'projection-assets-invalid');
  }
  let normalized: NormalizedProjectionRequest;
  try {
    normalized = normalizeProjectionRequest(request, state.profileLimits, adapter.limits.wrapper);
  } catch {
    return failure('rejected', 'projection-request-invalid', state);
  }
  const requestDigest = projectionRequestDigest(normalized);
  try {
    const privateResult = inspectPrivateResult(await projectWithBudgets(adapter, normalized), state);
    const result = projectedResult(normalized, state, privateResult);
    if (result.status === 'projected') {
      ISSUED.set(result, {
        artifact: result.artifact,
        artifactDigest: result.receipt.artifactDigest as string,
        assetManifestDigest: state.manifestDigest,
        receipt: result.receipt,
        requestDigest,
        normalizedRequest: normalized,
      });
    }
    return result;
  } catch (error) {
    return failure(
      'fatal',
      error instanceof ProjectionAssetError ? 'projection-assets-invalid' : 'projection-fatal',
      state,
      requestDigest,
    );
  }
}

function verifiedReceipt(
  receipt: Record<string, unknown>,
  state: ProjectionAssetState,
  requestDigest: string,
  artifactDigest: string,
): KernProjectionReceipt {
  if (!Number.isSafeInteger(receipt.workSteps) || (receipt.workSteps as number) < 0) {
    throw new TypeError('KERN projection receipt workSteps');
  }
  const fields = receiptFields(
    state,
    requestDigest,
    artifactDigest,
    'kern.frontend.f5-projection.1',
    'projected',
    receipt.workSteps as number,
  );
  return { ...fields, terminalSeal: receiptSeal(fields, 'projection:closed') };
}

export async function verifyKernProjection(
  request: KernProjectionRequest,
  result: KernProjectionResult,
): Promise<VerifiedKernProjection> {
  const state = loadProjectionAssetState();
  const adapter = loadProjectionAssetAdapter();
  const normalized = normalizeProjectionRequest(request, state.profileLimits, adapter.limits.wrapper);
  const requestDigest = projectionRequestDigest(normalized);
  const inspected = inspectPlainRecord(result, RESULT_KEYS, 'KERN projection result');
  if (
    inspected.status !== 'projected' ||
    !(inspected.bytes instanceof Uint8Array) ||
    !Array.isArray(inspected.diagnostics) ||
    inspected.diagnostics.length !== 0
  ) {
    throw new TypeError('KERN projection verification requires a projected result');
  }
  const issued = ISSUED.get(result);
  if (
    issued === undefined ||
    issued.requestDigest !== requestDigest ||
    !isDeepStrictEqual(issued.normalizedRequest, normalized) ||
    issued.assetManifestDigest !== state.manifestDigest ||
    issued.artifact !== inspected.artifact ||
    issued.receipt !== inspected.receipt
  ) {
    throw new TypeError('KERN projection result was not issued for this request');
  }
  const receipt = inspectPlainRecord(inspected.receipt, RECEIPT_KEYS, 'KERN projection receipt');
  const bytes = new Uint8Array(inspected.bytes);
  const artifactDigest = sha256(bytes);
  if (artifactDigest !== issued.artifactDigest) throw new TypeError('KERN projection bytes detachment');
  const decoded = await adapter.decode(Buffer.from(bytes).toString('base64'), state.canonicalLimits);
  const artifact = deepFreeze(decoded.artifact as ModuleKirArtifact);
  if (!isDeepStrictEqual(artifact, inspected.artifact)) throw new TypeError('KERN projection artifact detachment');
  const expectedReceipt = verifiedReceipt(receipt, state, requestDigest, artifactDigest);
  if (!isDeepStrictEqual(expectedReceipt, receipt)) throw new TypeError('KERN projection receipt detachment');
  const verified = Object.freeze({
    status: 'projected' as const,
    bytes,
    artifact,
    diagnostics: Object.freeze([]),
    receipt: deepFreeze(expectedReceipt),
  }) as VerifiedKernProjection;
  VERIFIED.set(verified, { artifactDigest, assetManifestDigest: state.manifestDigest });
  return verified;
}

export function isVerifiedKernProjection(value: unknown): value is VerifiedKernProjection {
  if (value === null || typeof value !== 'object') return false;
  const evidence = VERIFIED.get(value);
  if (evidence === undefined) return false;
  try {
    const projected = value as KernProjectedResult;
    const state = loadProjectionAssetState();
    return (
      state.manifestDigest === evidence.assetManifestDigest &&
      projected.bytes instanceof Uint8Array &&
      sha256(projected.bytes) === evidence.artifactDigest &&
      Object.isFrozen(projected) &&
      Object.isFrozen(projected.artifact) &&
      Object.isFrozen(projected.receipt)
    );
  } catch {
    return false;
  }
}
