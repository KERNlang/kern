import type { IRNode } from '@kernlang/core';
import { getChildren } from '@kernlang/core';
import { buildPythonStdlibPreamble } from '../python-stdlib-preamble.js';
import { mapTsTypeToPython } from '../type-map.js';

function findServerNode(root: IRNode): IRNode | undefined {
  if (root.type === 'server') return root;
  for (const child of root.children || []) {
    const found = findServerNode(child);
    if (found) return found;
  }
  return undefined;
}

/**
 * Perform a demand-driven AST traversal to collect necessary Python imports
 * for the generated models and types, plus any Result/Option preamble imports.
 */
export function emitImports(
  root: IRNode,
  options?: { pythonModelBackend?: 'pydantic' | 'sqlmodel' | 'auto' },
): { lines: string[]; imports: Set<string> } {
  const imports = new Set<string>();

  // 1. Collect KERN standard library preamble imports and definition lines
  const stdlib = buildPythonStdlibPreamble(root);
  for (const imp of stdlib.imports) {
    imports.add(imp);
  }

  // 2. Selection of the exact same core nodes as the original transpiler
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

  const serverNode = findServerNode(root) || root;
  const rootChildren = root.children || [];
  const serverChildren = serverNode !== root ? serverNode.children || [] : [];

  const coreNodes: IRNode[] = [
    ...rootChildren.filter((c) => TOP_LEVEL_CORE.has(c.type)),
    ...serverChildren.filter((c) => TOP_LEVEL_CORE.has(c.type)),
  ];

  if (TOP_LEVEL_CORE.has(root.type) && !coreNodes.includes(root)) {
    coreNodes.unshift(root);
  }

  const coreTypes = new Set(coreNodes.map((n) => n.type));
  const backend = options?.pythonModelBackend || 'auto';

  // 3. BaseModel / SQLModel imports
  if (coreTypes.has('interface') || coreTypes.has('union')) {
    imports.add('from pydantic import BaseModel');
  }

  if (coreTypes.has('model')) {
    if (backend === 'pydantic') {
      imports.add('from pydantic import BaseModel');
    } else {
      imports.add('from sqlmodel import SQLModel, Field, Relationship');
    }
  }

  if (coreTypes.has('repository')) {
    imports.add('from sqlalchemy.ext.asyncio import AsyncSession');
  }

  if (coreTypes.has('event')) {
    imports.add('from typing import TypedDict');
    imports.add('from typing import Literal');
    imports.add('from typing import Any');
  }

  // 4. Examine all type strings in the AST to pull in typing / built-in imports
  const typeProps = ['type', 'returns', 'constType', 'alias', 'values'];

  function checkTypeString(tsType: string) {
    const pyType = mapTsTypeToPython(tsType);
    if (pyType.includes('Literal[')) {
      imports.add('from typing import Literal');
    }
    if (pyType.includes('Union[')) {
      imports.add('from typing import Union');
    }
    if (pyType.includes('Any')) {
      imports.add('from typing import Any');
    }
    if (pyType.includes('Callable[')) {
      imports.add('from typing import Callable');
    }
    if (tsType.includes('=>')) {
      imports.add('from typing import Callable');
    }
    if (pyType.includes('UUID')) {
      imports.add('from uuid import UUID');
    }
    if (pyType.includes('date') || pyType.includes('datetime')) {
      imports.add('from datetime import date, datetime');
    }
    if (pyType.includes('Decimal')) {
      imports.add('from decimal import Decimal');
    }
  }

  function walkProps(node: IRNode) {
    if (node.type === 'type' && node.props?.values) {
      imports.add('from typing import Literal');
    }

    if (node.props) {
      for (const prop of typeProps) {
        if (typeof node.props[prop] === 'string') {
          checkTypeString(node.props[prop] as string);
        }
      }
    }

    if (node.type === 'model') {
      for (const col of getChildren(node, 'column')) {
        const colType = (col.props?.type as string) || '';
        if (colType === 'uuid') imports.add('from uuid import UUID');
        if (['date', 'datetime', 'timestamp', 'Timestamp'].includes(colType)) {
          imports.add('from datetime import date, datetime');
        }
        if (['decimal', 'Money'].includes(colType)) {
          imports.add('from decimal import Decimal');
        }
        if (colType === 'json') imports.add('from typing import Any');
      }
    }

    for (const child of node.children || []) {
      walkProps(child);
    }
  }

  // Only walk type properties of the selected coreNodes and the root itself to remain strictly demand-driven for compiled components
  for (const node of coreNodes) {
    walkProps(node);
  }
  if (root !== serverNode) {
    walkProps(root);
  }

  return {
    lines: stdlib.lines,
    imports,
  };
}
