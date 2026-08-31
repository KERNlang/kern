import type { VerifiedKernProjection } from '../../frontend-projection/contracts.js';
import { KERN_KIR_RUNTIME_FORMAT, KernKirFault } from '../../kir-runtime/contracts.js';
import { canonicalJson, sha256 } from '../../kir-runtime/digest.js';
import { type KernKirLinkCode, linkVerifiedKernKirProgramOrThrow } from '../../kir-runtime/linked-kir-program/index.js';
import {
  KERN_KIR_JS_ESM_ARTIFACT_FORMAT,
  KERN_KIR_JS_ESM_COMPILER_FORMAT,
  KERN_KIR_JS_ESM_HOST_PROFILE,
  type KernKirJavaScriptEsmCompileFailureCode,
  type KernKirJavaScriptEsmCompileRequest,
  type KernKirJavaScriptEsmCompileResult,
} from './contracts.js';
import { emitJavaScriptEsm, TARGET_KERNEL_SHA256, type TargetManifestBase } from './emitter.js';
import { inspectCompilerRequest, invalidCompilerRequest } from './request.js';

const encoder = new TextEncoder();
const LINK_CODES: readonly KernKirLinkCode[] = [
  'projection-authentication-error',
  'handler-entry-not-found',
  'handler-entry-ambiguous',
  'handler-entry-unsupported',
  'handler-link-error',
];

function failure(code: KernKirJavaScriptEsmCompileFailureCode): KernKirJavaScriptEsmCompileResult {
  return Object.freeze({ format: KERN_KIR_JS_ESM_COMPILER_FORMAT, outcome: 'failure', code });
}

export function compileKernKirToJavaScriptEsm(
  projection: VerifiedKernProjection,
  input: KernKirJavaScriptEsmCompileRequest,
): KernKirJavaScriptEsmCompileResult {
  let inspected: ReturnType<typeof inspectCompilerRequest>;
  try {
    inspected = inspectCompilerRequest(input);
  } catch (error) {
    if (invalidCompilerRequest(error)) return failure('invalid-compiler-request');
    throw error;
  }

  let linked;
  try {
    linked = linkVerifiedKernKirProgramOrThrow(projection, inspected.request.entry, inspected.meter);
  } catch (error) {
    if (error instanceof KernKirFault) {
      const code = LINK_CODES.includes(error.code as KernKirLinkCode)
        ? (error.code as KernKirLinkCode)
        : 'handler-link-error';
      return failure(code);
    }
    throw error;
  }

  const compilerRequestSha256 = sha256(canonicalJson(inspected.request));
  const manifestBase: TargetManifestBase = Object.freeze({
    artifactFormat: KERN_KIR_JS_ESM_ARTIFACT_FORMAT,
    canonicalization: 'kern.canonical-json.v1',
    compilerFormat: KERN_KIR_JS_ESM_COMPILER_FORMAT,
    compilerRequestSha256,
    entry: inspected.request.entry,
    hashAlgorithm: 'sha256',
    hostProfile: KERN_KIR_JS_ESM_HOST_PROFILE,
    kernelSha256: TARGET_KERNEL_SHA256,
    linkedProgramSha256: linked.sha256,
    projectionArtifactSha256: linked.projectionArtifactSha256,
    runtimeFormat: KERN_KIR_RUNTIME_FORMAT,
  });

  let artifactBytes: Uint8Array;
  try {
    artifactBytes = emitJavaScriptEsm(linked, manifestBase);
  } catch {
    return failure('artifact-emission-failure');
  }
  const artifactSha256 = sha256(artifactBytes);
  const manifestValue = Object.freeze({
    artifact: Object.freeze({ path: 'entry.mjs' as const, sha256: artifactSha256 }),
    ...manifestBase,
  });
  const manifestBytes = encoder.encode(canonicalJson(manifestValue));
  return Object.freeze({
    format: KERN_KIR_JS_ESM_COMPILER_FORMAT,
    outcome: 'success',
    target: 'javascript-esm',
    artifact: Object.freeze({ path: 'entry.mjs', bytes: artifactBytes, sha256: artifactSha256 }),
    manifest: Object.freeze({ path: 'manifest.json', bytes: manifestBytes, sha256: sha256(manifestBytes) }),
  });
}
