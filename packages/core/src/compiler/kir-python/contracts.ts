import type { VerifiedKernProjection } from '../../frontend-projection/contracts.js';
import type { KernKirLimits } from '../../kir-runtime/contracts.js';
import type { KernKirLinkCode } from '../../kir-runtime/linked-kir-program/index.js';

export const KERN_KIR_PYTHON_COMPILER_OWNER = 'kern.compiler.kir-python.owner.v1' as const;
export const KERN_KIR_PYTHON_COMPILER_FORMAT = 'kern.compiler.kir-python.v1' as const;
export const KERN_KIR_PYTHON_ARTIFACT_FORMAT = 'kern.target.kir-python.v1' as const;
export const KERN_KIR_PYTHON_HOST_PROFILE = 'kern.python.asyncio.v1' as const;

export interface KernKirPythonCompileRequest {
  readonly format: typeof KERN_KIR_PYTHON_COMPILER_FORMAT;
  readonly entry: { readonly moduleId: string; readonly handlerName: string };
  readonly limits: KernKirLimits;
}

export type KernKirPythonCompileFailureCode =
  | KernKirLinkCode
  | 'invalid-compiler-request'
  | 'artifact-emission-failure';

interface OutputFile {
  readonly path: 'entry.py' | 'manifest.json';
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export type KernKirPythonCompileResult =
  | {
      readonly format: typeof KERN_KIR_PYTHON_COMPILER_FORMAT;
      readonly outcome: 'success';
      readonly target: 'python';
      readonly artifact: OutputFile & { readonly path: 'entry.py' };
      readonly manifest: OutputFile & { readonly path: 'manifest.json' };
    }
  | {
      readonly format: typeof KERN_KIR_PYTHON_COMPILER_FORMAT;
      readonly outcome: 'failure';
      readonly code: KernKirPythonCompileFailureCode;
    };

export type CompileKernKirToPython = (
  projection: VerifiedKernProjection,
  request: KernKirPythonCompileRequest,
) => KernKirPythonCompileResult;
