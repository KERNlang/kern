import type { VerifiedKernProjection } from '../../frontend-projection/contracts.js';
import type { KernKirLimits } from '../../kir-runtime/contracts.js';
import type { KernKirLinkCode } from '../../kir-runtime/linked-kir-program/index.js';

export const KERN_KIR_JS_ESM_COMPILER_OWNER = 'kern.compiler.kir-js-esm.owner.v1' as const;
export const KERN_KIR_JS_ESM_COMPILER_FORMAT = 'kern.compiler.kir-js-esm.v1' as const;
export const KERN_KIR_JS_ESM_ARTIFACT_FORMAT = 'kern.target.kir-js-esm.v1' as const;
export const KERN_KIR_JS_ESM_HOST_PROFILE = 'kern.javascript-esm.node.v1' as const;

export interface KernKirJavaScriptEsmCompileRequest {
  readonly format: typeof KERN_KIR_JS_ESM_COMPILER_FORMAT;
  readonly entry: { readonly moduleId: string; readonly handlerName: string };
  readonly limits: KernKirLimits;
}

export type KernKirJavaScriptEsmCompileFailureCode =
  | KernKirLinkCode
  | 'invalid-compiler-request'
  | 'artifact-emission-failure';

interface OutputFile {
  readonly path: 'entry.mjs' | 'manifest.json';
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export type KernKirJavaScriptEsmCompileResult =
  | {
      readonly format: typeof KERN_KIR_JS_ESM_COMPILER_FORMAT;
      readonly outcome: 'success';
      readonly target: 'javascript-esm';
      readonly artifact: OutputFile & { readonly path: 'entry.mjs' };
      readonly manifest: OutputFile & { readonly path: 'manifest.json' };
    }
  | {
      readonly format: typeof KERN_KIR_JS_ESM_COMPILER_FORMAT;
      readonly outcome: 'failure';
      readonly code: KernKirJavaScriptEsmCompileFailureCode;
    };

export type CompileKernKirToJavaScriptEsm = (
  projection: VerifiedKernProjection,
  request: KernKirJavaScriptEsmCompileRequest,
) => KernKirJavaScriptEsmCompileResult;
