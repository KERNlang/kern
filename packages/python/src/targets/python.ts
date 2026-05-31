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
      // Python name-mangling caveat: an identifier with two leading underscores inside a
      // class body gets rewritten to `_ClassName__name`, so `return __DotDict(val)` inside
      // this class's methods would resolve to `_DotDict__DotDict` (NameError). We dodge it
      // by routing recursion through `type(self)` — the original class object, regardless
      // of the name it's bound to in the enclosing scope. Surfaced by the Wave 3 parity
      // suite when a route's `path_params`/`query` (always dicts) triggered the dict-branch
      // recursion; phase2 smokes only exercised scalar `body.value` so the bug stayed latent.
      //
      // Wave 3 agon-review follow-ups (all from agy 2026-05-31):
      //   1. Cache wrapped values back into the parent (`self[name] = val`). Otherwise every
      //      access reconstructs a fresh shallow copy — performance bites in `each`/`collect`
      //      loops, and crucially `body.profile.name = "Alice"` would mutate a temporary
      //      that's discarded on the next read of `body.profile`. The `isinstance(val, cls)`
      //      guard makes the cache idempotent.
      //   2. List wrapping recurses (via `_wrap`) so `body.matrix[0][0].value` works on
      //      arbitrarily-nested lists of dicts. The phase2 emission only wrapped one level,
      //      so a handler reading from a nested list raised AttributeError instead of dotting.
      //   3. `__delattr__` now mirrors `__getattr__`'s camelCase fallback, so `del obj.some_attr`
      //      finds a `someAttr` key the same way `obj.some_attr` finds it for read.
      const dotDictCode = `class __DotDict(dict):
    def __getattr__(self, name):
        try:
            val = self[name]
            key = name
        except KeyError:
            camel = ''.join(x.capitalize() or '_' for x in name.split('_'))
            camel = camel[0].lower() + camel[1:] if camel else ''
            if camel in self:
                val = self[camel]
                key = camel
            else:
                raise AttributeError(name)
        cls = type(self)
        def _wrap(x):
            if isinstance(x, cls):
                return x
            if isinstance(x, dict):
                return cls(x)
            if isinstance(x, list):
                return [_wrap(y) for y in x]
            return x
        if isinstance(val, dict) and not isinstance(val, cls):
            val = cls(val)
            self[key] = val
        elif isinstance(val, list):
            val = [_wrap(x) for x in val]
            self[key] = val
        return val

    def __setattr__(self, name, value):
        self[name] = value

    def __delattr__(self, name):
        try:
            del self[name]
            return
        except KeyError:
            pass
        camel = ''.join(x.capitalize() or '_' for x in name.split('_'))
        camel = camel[0].lower() + camel[1:] if camel else ''
        if camel in self:
            del self[camel]
        else:
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
