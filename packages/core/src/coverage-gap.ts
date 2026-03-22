/**
 * Coverage Gap Emitter — compiler self-awareness for KERN's IR.
 *
 * When the compiler encounters patterns it can't fully express (handler escapes,
 * non-standard attrs), it emits coverage gap signals. Evolve v3 collects these
 * to propose new IR nodes.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import type { IRNode } from './types.js';

export interface CoverageGap {
  file: string;
  line: number;
  nodeType: string;
  handlerLength: number;
  timestamp: string;
}

/**
 * Walk the AST and collect coverage gaps — handler nodes signal IR limitations.
 */
export function collectCoverageGaps(root: IRNode, filePath: string): CoverageGap[] {
  const gaps: CoverageGap[] = [];
  const timestamp = new Date().toISOString();

  function walk(node: IRNode): void {
    if (node.type === 'handler') {
      const code = (node.props?.code as string) || '';
      if (code.trim().length > 0) {
        gaps.push({
          file: filePath,
          line: node.loc?.line ?? 0,
          nodeType: 'handler',
          handlerLength: code.length,
          timestamp,
        });
      }
    }

    if (node.children) {
      for (const child of node.children) {
        walk(child);
      }
    }
  }

  walk(root);
  return gaps;
}

/**
 * Write coverage gaps to the gap directory (accumulative).
 */
export function writeCoverageGaps(gaps: CoverageGap[], gapDir: string): void {
  if (gaps.length === 0) return;

  const dir = resolve(gapDir);
  mkdirSync(dir, { recursive: true });

  // Write as a single file per source file (overwrite on recompile)
  const sourceFile = gaps[0].file;
  const safeFileName = sourceFile.replace(/[/\\:]/g, '_').replace(/^_+/, '') + '.json';
  const filePath = resolve(dir, safeFileName);

  writeFileSync(filePath, JSON.stringify(gaps, null, 2));
}

/**
 * Read all accumulated coverage gaps from the gap directory.
 */
export function readCoverageGaps(gapDir: string): CoverageGap[] {
  const dir = resolve(gapDir);
  if (!existsSync(dir)) return [];

  const allGaps: CoverageGap[] = [];
  const files = readdirSync(dir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), 'utf-8');
      const gaps: CoverageGap[] = JSON.parse(content);
      allGaps.push(...gaps);
    } catch (_e) {
      // Intentional: skip invalid/corrupt gap files — non-fatal during aggregation
    }
  }

  return allGaps;
}
