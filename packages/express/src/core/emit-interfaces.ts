import type { IRNode } from '@kernlang/core';
import { generateCoreNode } from '@kernlang/core';

function findServerNode(root: IRNode): IRNode | undefined {
  if (root.type === 'server') return root;
  for (const child of root.children || []) {
    const found = findServerNode(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * Filter the AST for core nodes / declarations and render their bodies using `generateCoreNode`.
 * In types-only projection (e.g. `--emit=types` or target `lib`), functions are suppressed.
 */
export function emitInterfaces(
  root: IRNode,
  options?: {
    emit?: string;
    target?: string;
  },
): { code: string; bodies: string[][] } {
  const isTypesOnly = options?.emit === 'types' || (options?.target === 'lib' && options?.emit === 'types');

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

  const INTERFACE_ONLY_CORE = new Set(['type', 'interface', 'event', 'model', 'union']);

  const allowedTypes = isTypesOnly ? INTERFACE_ONLY_CORE : TOP_LEVEL_CORE;

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

  const bodies = coreNodes.map((node) => generateCoreNode(node));

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
