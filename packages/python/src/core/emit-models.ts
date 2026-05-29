import type { IRNode } from '@kernlang/core';
import { generatePythonCoreNode } from '../codegen-python.js';

function findServerNode(root: IRNode): IRNode | undefined {
  if (root.type === 'server') return root;
  for (const child of root.children || []) {
    const found = findServerNode(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * Filter the AST for core nodes / declarations and render their bodies using `generatePythonCoreNode`.
 * In types-only projection (e.g. `--emit=models` or target `python`), functions are suppressed.
 */
export function emitModels(
  root: IRNode,
  options?: {
    pythonModelBackend?: 'pydantic' | 'sqlmodel' | 'auto';
    emit?: string;
    target?: string;
    resolveKernModuleSpec?: (rawPath: string, node: IRNode) => string | undefined;
  },
): { code: string; bodies: string[][] } {
  const isModelsOnly = options?.emit === 'models' || options?.target === 'python';

  // Allowed core node types
  const TOP_LEVEL_CORE = new Set([
    'type',
    'interface',
    'fn',
    'machine',
    'error',
    'module',
    'config',
    'store',
    'test',
    'event',
    'import',
    'extern',
    'use',
    'const',
    'model',
    'repository',
    'cache',
    'dependency',
    'service',
    'union',
    'job',
    'storage',
    'email',
    'derive',
    'transform',
    'action',
    'guard',
    'assume',
    'invariant',
    'each',
    'collect',
    'branch',
    'resolve',
    'expect',
    'recover',
  ]);

  const MODEL_ONLY_CORE = new Set(['type', 'interface', 'event', 'model', 'union']);

  const allowedTypes = isModelsOnly ? MODEL_ONLY_CORE : TOP_LEVEL_CORE;

  // Replicate original transpiler-fastapi core node selection
  const serverNode = findServerNode(root) || root;
  const rootChildren = root.children || [];
  const serverChildren = serverNode !== root ? serverNode.children || [] : [];

  const coreNodes: IRNode[] = [
    ...rootChildren.filter((c) => allowedTypes.has(c.type)),
    ...serverChildren.filter((c) => allowedTypes.has(c.type)),
  ];

  if (allowedTypes.has(root.type) && !coreNodes.includes(root)) {
    coreNodes.unshift(root);
  }

  const codegenOpts = {
    resolveKernModuleSpec: options?.resolveKernModuleSpec,
    pythonModelBackend: options?.pythonModelBackend,
  };

  const bodies = coreNodes.map((node) => generatePythonCoreNode(node, codegenOpts));

  const lines: string[] = [];
  for (const coreLines of bodies) {
    if (coreLines.length > 0) {
      lines.push(...coreLines);
      lines.push('');
    }
  }

  return {
    code: lines.join('\n'),
    bodies,
  };
}
