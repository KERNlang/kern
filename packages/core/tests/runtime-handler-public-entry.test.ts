import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
  KernRuntimeHandlerError,
} from '@kernlang/core/runtime/handler';

describe('@kernlang/core/runtime/handler package entry', () => {
  test('resolves the additive public export', () => {
    expect(KERN_RUNTIME_HANDLER_ABI).toBe('kern.runtime.handler.v1');
    expect(typeof executeKernRuntimeHandlerSync).toBe('function');
    expect(new KernRuntimeHandlerError('invalid-abi', 'test').code).toBe('invalid-abi');
  });

  test('emits a self-contained public declaration surface', () => {
    const declaration = readFileSync(join(process.cwd(), 'dist/runtime-handler.d.ts'), 'utf8');
    expect(declaration).toContain('KernRuntimeHandlerRequest');
    expect(declaration).toContain('KernRuntimeHandlerCapabilities');
    expect(declaration).not.toMatch(/\bInternal[A-Za-z]*/u);
    expect(declaration).not.toContain('SemanticEnv');
    expect(declaration).not.toContain('KernRunner');
    expect(declaration).not.toContain('runner-capabilities');
    expect(declaration).not.toContain('kern.runtime.internal.r0');
  });
});
