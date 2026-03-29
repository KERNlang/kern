/**
 * Test Generator — test.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import type { IRNode } from '../types.js';
import { emitTemplateSafe } from './emitters.js';
import { getProps, getChildren, handlerCode } from './helpers.js';

const p = getProps;
const kids = getChildren;

// ── Test ─────────────────────────────────────────────────────────────────

export function generateTest(node: IRNode): string[] {
  const props = p(node);
  const name = emitTemplateSafe(props.name as string || 'UnknownTest');
  const lines: string[] = [];

  lines.push(`import { describe, it, expect } from 'vitest';`);
  lines.push('');

  // Top-level setup handler
  const setup = handlerCode(node);
  if (setup) {
    for (const line of setup.split('\n')) lines.push(line);
    lines.push('');
  }

  lines.push(`describe('${name}', () => {`);

  for (const desc of kids(node, 'describe')) {
    const dname = emitTemplateSafe(p(desc).name as string || 'describe');
    lines.push(`  describe('${dname}', () => {`);

    for (const test of kids(desc, 'it')) {
      const tname = emitTemplateSafe(p(test).name as string || 'test');
      const code = handlerCode(test);
      lines.push(`    it('${tname}', () => {`);
      if (code) {
        for (const line of code.split('\n')) lines.push(`      ${line}`);
      }
      lines.push(`    });`);
    }

    lines.push(`  });`);
  }

  // Top-level it blocks
  for (const test of kids(node, 'it')) {
    const tname = emitTemplateSafe(p(test).name as string || 'test');
    const code = handlerCode(test);
    lines.push(`  it('${tname}', () => {`);
    if (code) {
      for (const line of code.split('\n')) lines.push(`    ${line}`);
    }
    lines.push(`  });`);
  }

  lines.push('});');
  return lines;
}
