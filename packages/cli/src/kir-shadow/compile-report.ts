import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  compileKernKirToJavaScriptEsm,
  KERN_KIR_JS_ESM_ARTIFACT_FORMAT,
  KERN_KIR_JS_ESM_COMPILER_FORMAT,
  KERN_KIR_JS_ESM_HOST_PROFILE,
  type KernKirJavaScriptEsmCompileResult,
} from '@kernlang/core/compiler/kir-js-esm';
import {
  compileKernKirToPython,
  KERN_KIR_PYTHON_ARTIFACT_FORMAT,
  KERN_KIR_PYTHON_COMPILER_FORMAT,
  KERN_KIR_PYTHON_HOST_PROFILE,
  type KernKirPythonCompileResult,
} from '@kernlang/core/compiler/kir-python';
import type { VerifiedKernProjection } from '@kernlang/core/frontend-projection';
import { KIR_SHADOW_LIMITS } from './limits.js';
import type { KirShadowEntry } from './types.js';
import { KirShadowUnavailableError } from './types.js';

const MANIFEST_KEYS = [
  'artifact',
  'artifactFormat',
  'canonicalization',
  'compilerFormat',
  'compilerRequestSha256',
  'entry',
  'hashAlgorithm',
  'hostProfile',
  'kernelSha256',
  'linkedProgramSha256',
  'projectionArtifactSha256',
  'runtimeFormat',
].sort();

type JavaScriptSuccess = Extract<KernKirJavaScriptEsmCompileResult, { outcome: 'success' }>;
type PythonSuccess = Extract<KernKirPythonCompileResult, { outcome: 'success' }>;

interface ManifestExpectations {
  readonly artifactFormat: string;
  readonly artifactPath: string;
  readonly compilerFormat: string;
  readonly hostProfile: string;
}

export interface ShadowCompilations {
  readonly javascriptEsm: JavaScriptSuccess;
  readonly python: PythonSuccess;
}

export interface ShadowTargetReport {
  readonly artifact: { readonly sha256: string };
  readonly deterministic: true;
  readonly manifest: { readonly sha256: string; readonly value: Record<string, unknown> };
  readonly outcome: 'success';
}

function manifestValue(
  compiled: JavaScriptSuccess | PythonSuccess,
  entry: KirShadowEntry,
  projectionArtifactSha256: string,
  expected: ManifestExpectations,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(compiled.manifest.bytes));
  } catch {
    throw new KirShadowUnavailableError('compiler-manifest-malformed');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new KirShadowUnavailableError('compiler-manifest-malformed');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (!isDeepStrictEqual(keys, MANIFEST_KEYS)) throw new KirShadowUnavailableError('compiler-manifest-malformed');
  const artifact = record.artifact as Record<string, unknown> | undefined;
  const artifactSha256 = sha256(compiled.artifact.bytes);
  const manifestSha256 = sha256(compiled.manifest.bytes);
  const compilerRequestSha256 = sha256(
    canonicalJson({ entry, format: expected.compilerFormat, limits: KIR_SHADOW_LIMITS }),
  );
  if (
    !artifact ||
    Object.keys(artifact).length !== 2 ||
    artifact.path !== expected.artifactPath ||
    artifact.sha256 !== artifactSha256 ||
    compiled.artifact.sha256 !== artifactSha256 ||
    compiled.manifest.sha256 !== manifestSha256 ||
    record.artifactFormat !== expected.artifactFormat ||
    record.compilerFormat !== expected.compilerFormat ||
    record.compilerRequestSha256 !== compilerRequestSha256 ||
    record.hostProfile !== expected.hostProfile ||
    record.projectionArtifactSha256 !== projectionArtifactSha256 ||
    !isDeepStrictEqual(record.entry, entry) ||
    record.canonicalization !== 'kern.canonical-json.v1' ||
    record.hashAlgorithm !== 'sha256' ||
    record.runtimeFormat !== 'kern.runtime.kir.v1' ||
    !['kernelSha256', 'linkedProgramSha256', 'projectionArtifactSha256'].every(
      (key) => typeof record[key] === 'string' && /^[a-f0-9]{64}$/u.test(record[key]),
    ) ||
    new TextDecoder().decode(compiled.manifest.bytes) !== canonicalJson(record)
  ) {
    throw new KirShadowUnavailableError('compiler-manifest-binding-failed');
  }
  return record;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new KirShadowUnavailableError('compiler-manifest-malformed');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new KirShadowUnavailableError('compiler-manifest-malformed');
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function javascriptPair(
  projection: VerifiedKernProjection,
  entry: KirShadowEntry,
): [JavaScriptSuccess, JavaScriptSuccess] {
  const request = { entry, format: KERN_KIR_JS_ESM_COMPILER_FORMAT, limits: KIR_SHADOW_LIMITS };
  const first = compileKernKirToJavaScriptEsm(projection, request);
  const second = compileKernKirToJavaScriptEsm(projection, request);
  if (first.outcome !== 'success' || second.outcome !== 'success') {
    throw new KirShadowUnavailableError(
      first.outcome === 'failure'
        ? first.code
        : second.outcome === 'failure'
          ? second.code
          : 'javascript-compiler-failed',
    );
  }
  return [first, second];
}

function pythonPair(projection: VerifiedKernProjection, entry: KirShadowEntry): [PythonSuccess, PythonSuccess] {
  const request = { entry, format: KERN_KIR_PYTHON_COMPILER_FORMAT, limits: KIR_SHADOW_LIMITS };
  const first = compileKernKirToPython(projection, request);
  const second = compileKernKirToPython(projection, request);
  if (first.outcome !== 'success' || second.outcome !== 'success') {
    throw new KirShadowUnavailableError(
      first.outcome === 'failure' ? first.code : second.outcome === 'failure' ? second.code : 'python-compiler-failed',
    );
  }
  return [first, second];
}

function deterministic(first: JavaScriptSuccess | PythonSuccess, second: JavaScriptSuccess | PythonSuccess): boolean {
  return (
    first.artifact.sha256 === second.artifact.sha256 &&
    first.manifest.sha256 === second.manifest.sha256 &&
    isDeepStrictEqual(first.artifact.bytes, second.artifact.bytes) &&
    isDeepStrictEqual(first.manifest.bytes, second.manifest.bytes)
  );
}

export function compileShadowTargets(
  projection: VerifiedKernProjection,
  entry: KirShadowEntry,
  projectionArtifactSha256: string,
): {
  readonly compilations: ShadowCompilations;
  readonly report: { javascriptEsm: ShadowTargetReport; python: ShadowTargetReport };
} {
  const [javascriptEsm, javascriptTwin] = javascriptPair(projection, entry);
  const [python, pythonTwin] = pythonPair(projection, entry);
  if (!deterministic(javascriptEsm, javascriptTwin))
    throw new KirShadowUnavailableError('javascript-compiler-nondeterministic');
  if (!deterministic(python, pythonTwin)) throw new KirShadowUnavailableError('python-compiler-nondeterministic');
  const javascriptManifest = manifestValue(javascriptEsm, entry, projectionArtifactSha256, {
    artifactFormat: KERN_KIR_JS_ESM_ARTIFACT_FORMAT,
    artifactPath: 'entry.mjs',
    compilerFormat: KERN_KIR_JS_ESM_COMPILER_FORMAT,
    hostProfile: KERN_KIR_JS_ESM_HOST_PROFILE,
  });
  const pythonManifest = manifestValue(python, entry, projectionArtifactSha256, {
    artifactFormat: KERN_KIR_PYTHON_ARTIFACT_FORMAT,
    artifactPath: 'entry.py',
    compilerFormat: KERN_KIR_PYTHON_COMPILER_FORMAT,
    hostProfile: KERN_KIR_PYTHON_HOST_PROFILE,
  });
  return {
    compilations: { javascriptEsm, python },
    report: {
      javascriptEsm: {
        artifact: { sha256: javascriptEsm.artifact.sha256 },
        deterministic: true,
        manifest: { sha256: javascriptEsm.manifest.sha256, value: javascriptManifest },
        outcome: 'success',
      },
      python: {
        artifact: { sha256: python.artifact.sha256 },
        deterministic: true,
        manifest: { sha256: python.manifest.sha256, value: pythonManifest },
        outcome: 'success',
      },
    },
  };
}
