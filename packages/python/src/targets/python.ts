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
      // by routing recursion through `type(self)` — the original class object — and by
      // using `_DotList` (single underscore, NOT mangled) as the list marker class. Surfaced
      // by the Wave 3 parity suite when a route's `path_params`/`query` (always dicts)
      // triggered the dict-branch recursion; phase2 smokes only exercised scalar `body.value`
      // so the bug stayed latent.
      //
      // Wave 3 agon-review follow-ups (rounds 1+2, 2026-05-31):
      //   1. Cache wrapped values back into the parent (`self[key] = val`). Otherwise every
      //      access reconstructs a fresh shallow copy — performance bites in `each`/`collect`
      //      loops, and `body.profile.name = "Alice"` would mutate a temporary that the next
      //      read of `body.profile` discards. The `isinstance(val, cls)` guard makes the
      //      dict path idempotent.
      //   2. Wrapping recurses through `_wrap`, so `body.matrix[0][0].value` works on
      //      arbitrarily-nested lists of dicts. The phase2 emission only wrapped one level.
      //   3. `_DotList(list)` is the list-side idempotency marker — without it, plain
      //      `isinstance(val, list)` is true even for already-wrapped lists, so every access
      //      re-builds a new list (caching gap agy/claude both flagged in round 2: a
      //      stale-reference / lost-mutation edge — `ref = body.items; body.items; ref.append(x)`
      //      mutates the orphan). The `_DotList` test gates re-wrap to genuinely-plain lists.
      //   4. `__delattr__` mirrors `__getattr__`'s camelCase fallback (round 1, agy nit).
      //
      // SIDE EFFECT (intentional): write-back means a dotted read mutates the parent dict —
      // `body.profile` rewrites self["profile"] to the wrapped form. This is what makes
      // assignment persistence work; the downside is that anything which later iterates the
      // raw dict (`body.items()`, re-serialization) sees wrapped values. Harmless for the
      // conformance comparison and for in-handler use; flagging it here so future readers
      // don't mistake it for a bug. (round 2 claude observation, severity nit.)
      const dotDictCode = `class _DotList(list):
    pass


class __DotDict(dict):
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
            if isinstance(x, _DotList):
                return x
            if isinstance(x, dict):
                return cls(x)
            if isinstance(x, list):
                return _DotList(_wrap(y) for y in x)
            return x
        if isinstance(val, dict) and not isinstance(val, cls):
            val = cls(val)
            self[key] = val
        elif isinstance(val, list) and not isinstance(val, _DotList):
            val = _DotList(_wrap(x) for x in val)
            self[key] = val
        return val

    def __setattr__(self, name, value):
        self[name] = value

    def __delattr__(self, name):
        try:
            del self[name]
        except KeyError:
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
