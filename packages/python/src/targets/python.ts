import type { IRNode, ResolvedKernConfig, TranspileResult } from '@kernlang/core';
import { countTokens, serializeIR } from '@kernlang/core';
import { emitImports } from '../core/emit-imports.js';
import { emitModels } from '../core/emit-models.js';
import { collectFenceDiagnostics } from '../core/fence-diagnostics.js';
import { emitPureHandlers } from '../core/handlers/index.js';
import { findServerNode } from '../fastapi-utils.js';

/**
 * First-class `python` transpiler target. Lowering KERN types and models to pure Python.
 */
export function transpilePython(root: IRNode, config?: ResolvedKernConfig): TranspileResult {
  const pythonModelBackend = config?.pythonModelBackend || 'auto';
  const emit = config?.emit || 'models'; // In Phase 1, target python implies models-only

  // 1. Demand-driven imports
  const { lines: preambleLines, imports } = emitImports(root, { pythonModelBackend });

  // 2. Pure route handlers — emit only when caller requested `emit: 'backend'`.
  // The existing models-only path (the default) must stay byte-identical whether
  // a server node is present or not; `python-target.test.ts:60` (`route
  // invariance (decl-driven emit-models)`) is the canonical contract.
  const serverNode = emit === 'backend' ? findServerNode(root) : undefined;
  let handlersCode = '';
  if (serverNode) {
    const handlers = emitPureHandlers(serverNode, imports, root);
    if (handlers.length > 0) {
      const dotDictCode = `class __DotDict(dict):
    def __getattr__(self, name):
        try:
            val = self[name]
        except KeyError:
            camel = ''.join(x.capitalize() or '_' for x in name.split('_'))
            camel = camel[0].lower() + camel[1:] if camel else ''
            if camel in self:
                val = self[camel]
            else:
                raise AttributeError(name)
        if isinstance(val, dict):
            return __DotDict(val)
        if isinstance(val, list):
            return [__DotDict(x) if isinstance(x, dict) else x for x in val]
        return val

    def __setattr__(self, name, value):
        self[name] = value

    def __delattr__(self, name):
        try:
            del self[name]
        except KeyError:
            raise AttributeError(name)
`;
      const handlerBlocks = handlers.map((h) => `${h.signature}\n${h.bodyLines.join('\n')}`).join('\n\n');
      handlersCode = `\n${dotDictCode}\n\n${handlerBlocks}\n`;
    }
  }

  // 3. Core node render
  const { code: modelsCode } = emitModels(root, {
    pythonModelBackend,
    emit,
    target: 'python',
  });

  const lines: string[] = [];

  // Sort and print imports
  let filteredImports = [...imports];
  if (emit === 'backend') {
    filteredImports = filteredImports.filter((imp) => {
      const lower = imp.toLowerCase();
      return (
        !lower.includes('pydantic') &&
        !lower.includes('fastapi') &&
        !lower.includes('django') &&
        !lower.includes('httpexception') &&
        !lower.includes('jsonresponse') &&
        !lower.includes('depends(')
      );
    });
  }
  for (const imp of filteredImports.sort()) {
    lines.push(imp);
  }
  lines.push('');

  // Stdlib preamble
  if (preambleLines.length > 0) {
    lines.push('');
    lines.push(...preambleLines);
  }

  // Model and type definitions
  if (emit !== 'backend' && modelsCode.trim().length > 0) {
    lines.push('');
    lines.push(modelsCode);
  }

  // Pure handlers (additive)
  if (handlersCode) {
    lines.push('');
    lines.push(handlersCode);
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
