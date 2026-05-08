import type { ConceptEdge } from '@kernlang/core';
import { type LineInfo, lineSpan, nodeText } from '../helpers/lines.js';
import { STDLIB_MODULES } from '../signatures.js';

export function classifyDependency(specifier: string): 'stdlib' | 'external' | 'internal' {
  if (specifier.startsWith('.')) return 'internal';
  const root = specifier.split('.')[0];
  return STDLIB_MODULES.has(root) ? 'stdlib' : 'external';
}

export function addDependency(edges: ConceptEdge[], filePath: string, info: LineInfo, specifier: string): void {
  edges.push({
    id: `${filePath}#dep@${info.offset}:${specifier}`,
    kind: 'dependency',
    sourceId: filePath,
    targetId: specifier,
    primarySpan: lineSpan(filePath, info),
    evidence: nodeText(info),
    confidence: 0.85,
    language: 'py',
    payload: { kind: 'dependency', subtype: classifyDependency(specifier), specifier },
  });
}
