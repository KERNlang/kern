import type { ConceptNode, ConceptSpan } from '@kernlang/core';
import { conceptSpan } from '@kernlang/core';

export interface LineInfo {
  text: string;
  line: number;
  offset: number;
}

export interface FunctionBlock {
  name: string;
  async: boolean;
  startLine: number;
  endLine: number;
  indent: number;
  id: string;
}

export function splitLines(source: string): LineInfo[] {
  const lines = source.split('\n');
  let offset = 0;
  return lines.map((text, index) => {
    const info = { text, line: index + 1, offset };
    offset += text.length + 1;
    return info;
  });
}

export function indentation(text: string): number {
  return text.match(/^\s*/)?.[0].length ?? 0;
}

export function lineSpan(filePath: string, info: LineInfo): ConceptSpan {
  const startCol = indentation(info.text) + 1;
  return conceptSpan(filePath, info.line, startCol, info.line, Math.max(startCol, info.text.length + 1));
}

export function nodeText(info: LineInfo): string {
  return info.text.trim();
}

export function addNode(nodes: ConceptNode[], node: ConceptNode): void {
  nodes.push(node);
}

export function findFunctionBlocks(lines: LineInfo[], filePath: string): FunctionBlock[] {
  const blocks: FunctionBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const info = lines[i];
    const match = info.text.match(/^(\s*)(async\s+def|def)\s+([A-Za-z_]\w*)\s*\(/);
    if (!match) continue;

    const indent = match[1].length;
    let endLine = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j];
      const trimmed = candidate.text.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('@')) continue;
      if (indentation(candidate.text) <= indent) {
        endLine = candidate.line - 1;
        break;
      }
    }

    blocks.push({
      name: match[3],
      async: match[2].startsWith('async'),
      startLine: info.line,
      endLine,
      indent,
      id: `${filePath}#fn:${match[3]}@${info.offset}`,
    });
  }
  return blocks;
}

export function containerForLine(blocks: FunctionBlock[], line: number): FunctionBlock | undefined {
  return blocks.find((block) => line >= block.startLine && line <= block.endLine);
}

export function nextFunctionAfter(blocks: readonly FunctionBlock[], line: number): FunctionBlock | undefined {
  return blocks.find((block) => block.startLine > line);
}
