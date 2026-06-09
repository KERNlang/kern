import type { IRNode, ResolvedKernConfig, TranspileResult } from '@kernlang/core';
import { countTokens, serializeIR } from '@kernlang/core';
import { emitImports } from '../core/emit-imports.js';
import { emitModels } from '../core/emit-models.js';
import { collectFenceDiagnostics } from '../core/fence-diagnostics.js';
import { emitPureHandlers } from '../core/handlers/index.js';
import { findServerNode } from '../fastapi-utils.js';
import { generatePythonClass } from '../generators/data.js';

/**
 * The PyDotDict / _DotList shim, emitted at the top of every `--emit=backend`
 * Python module that contains pure handlers. Re-exported so the conformance
 * harness can import the SAME bytes instead of maintaining a near-duplicate
 * string (Wave 3 round-3 agon-review finding D — kimi 0.90 / claude 0.50 /
 * zai 0.65 convergence on the drift hazard).
 *
 * Design notes (cumulative across Wave 3 review rounds):
 *   • Python name-mangling: an identifier with two leading underscores
 *     INSIDE a class body becomes `_ClassName__name`. So `__DotDict(val)`
 *     inside `__DotDict`'s own methods would resolve to `_DotDict__DotDict`
 *     (NameError). Route dict recursion through `cls = type(self); cls(val)`,
 *     and use `_DotList` (single underscore — NOT mangled) as the list
 *     idempotency marker.
 *   • Cached write-back (`self[key] = val`) makes both branches O(1) on
 *     re-access and persists in-handler writes — `body.profile.name = "x"`
 *     now sticks. SIDE EFFECT: a dotted read mutates the parent dict; raw
 *     `body.items()` iteration sees wrapped values. Intentional.
 *   • `_DotList.__getitem__` auto-wraps elements so post-access append/insert
 *     of plain dicts still reads back as `__DotDict` — `body.rows.append({a:1});
 *     body.rows[0].a` works (round-3 codex 0.86 + agy 0.95 regression close).
 *     Bound at module level so the `__DotDict` reference inside it isn't
 *     subject to class-body name-mangling.
 *   • `__delattr__` mirrors `__getattr__`'s camelCase fallback; the
 *     `from None` suppresses chained KeyError tracebacks (round-3 claude 0.70).
 */
export const DOT_DICT_SHIM_PY = `class _DotList(list):
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
                raise AttributeError(name) from None
        cls = type(self)
        def _wrap(x):
            if isinstance(x, cls):
                return x
            if isinstance(x, _DotList):
                return x
            if isinstance(x, dict):
                return cls(x)
            if isinstance(x, list):
                return _DotList([_wrap(y) for y in x])
            return x
        if isinstance(val, dict) and not isinstance(val, cls):
            val = cls(val)
            self[key] = val
        elif isinstance(val, list) and not isinstance(val, _DotList):
            val = _DotList([_wrap(x) for x in val])
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
                raise AttributeError(name) from None


def _dotlist_getitem(self, index):
    val = list.__getitem__(self, index)
    if isinstance(val, (__DotDict, _DotList)):
        return val
    if isinstance(val, dict):
        wrapped = __DotDict(val)
        list.__setitem__(self, index, wrapped)
        return wrapped
    if isinstance(val, list):
        wrapped = _DotList(val)
        list.__setitem__(self, index, wrapped)
        return wrapped
    return val


_DotList.__getitem__ = _dotlist_getitem
`;

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
      const handlerBlocks = handlers.map((h) => `${h.signature}\n${h.bodyLines.join('\n')}`).join('\n\n');
      handlersCode = `\n${DOT_DICT_SHIM_PY}\n\n${handlerBlocks}\n`;
    }
  }

  // 3. Core node render
  const { code: modelsCode } = emitModels(root, {
    pythonModelBackend,
    emit,
    target: 'python',
  });

  // 3b. Class declarations -> pure Python classes. Additive: files without
  // `class` nodes (e.g. the models-only byte-invariance corpus) are untouched.
  const classNodes = root.type === 'class' ? [root] : (root.children ?? []).filter((child) => child.type === 'class');
  const classesCode = classNodes.map((node) => generatePythonClass(node).join('\n')).join('\n\n');

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

  // Class definitions (pure Python — not FastAPI/Pydantic).
  if (classesCode.trim().length > 0) {
    lines.push('');
    lines.push(classesCode);
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
