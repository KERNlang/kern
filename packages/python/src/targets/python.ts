import type { IRNode, ResolvedKernConfig, TranspileResult } from '@kernlang/core';
import { countTokens, serializeIR } from '@kernlang/core';
import { emitImports } from '../core/emit-imports.js';
import { emitModels } from '../core/emit-models.js';
import { collectFenceDiagnostics } from '../core/fence-diagnostics.js';

/**
 * First-class `python` transpiler target. Lowering KERN types and models to pure Python.
 */
export function transpilePython(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  const pythonModelBackend = config?.pythonModelBackend || 'auto';
  const emit = config?.emit || 'models'; // In Phase 1, target python implies models-only

  // 1. Demand-driven imports
  const { lines: preambleLines, imports } = emitImports(root, { pythonModelBackend });

  // 2. Core node render
  const { code: modelsCode } = emitModels(root, {
    pythonModelBackend,
    emit,
    target: 'python',
  });

  const lines: string[] = [];

  // Sort and print imports
  for (const imp of [...imports].sort()) {
    lines.push(imp);
  }
  lines.push('');

  // Stdlib preamble
  if (preambleLines.length > 0) {
    lines.push('');
    lines.push(...preambleLines);
  }

  // Model and type definitions
  if (modelsCode.trim().length > 0) {
    lines.push('');
    lines.push(modelsCode);
  }

  const output = lines.join('\n');
  const irText = serializeIR(root);
  const irTokenCount = countTokens(irText);
  const tsTokenCount = countTokens(output);
  const tokenReduction = Math.round((1 - irTokenCount / tsTokenCount) * 100);

  return {
    code: output,
    sourceMap: [],
    irTokenCount,
    tsTokenCount,
    tokenReduction,
    artifacts: [],
    diagnostics: collectFenceDiagnostics(root, config?.pythonFenceSeverity ?? 'warning'),
  };
}
