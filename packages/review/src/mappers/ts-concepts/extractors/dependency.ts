import type { ConceptEdge } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import type { SourceFile } from 'ts-morph';
import { span } from '../helpers/ast.js';
import { NODE_STDLIB } from '../signatures.js';

export function extractDependencyEdges(sf: SourceFile, filePath: string, edges: ConceptEdge[]): void {
  for (const imp of sf.getImportDeclarations()) {
    const specifier = imp.getModuleSpecifierValue();
    const start = imp.getStart();

    let subtype: 'internal' | 'external' | 'stdlib' = 'external';
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      subtype = 'internal';
    } else if (NODE_STDLIB.has(specifier.split('/')[0]) || specifier.startsWith('node:')) {
      subtype = 'stdlib';
    }

    edges.push({
      id: conceptId(filePath, 'dependency', start),
      kind: 'dependency',
      sourceId: filePath,
      targetId: specifier,
      primarySpan: span(filePath, imp),
      evidence: imp.getText().substring(0, 120),
      confidence: 1.0,
      language: 'ts',
      payload: { kind: 'dependency', subtype, specifier },
    });
  }
}
