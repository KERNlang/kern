/** Serialize ValueIR to a TypeScript expression string. */

import type { ValueIR } from './value-ir.js';

const LOGICAL_OPS = new Set(['&&', '||', '??']);

export function emitExpression(node: ValueIR): string {
  switch (node.kind) {
    case 'numLit':
      return node.raw;
    case 'strLit': {
      const q = node.quote;
      const escaped = node.value.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`);
      return `${q}${escaped}${q}`;
    }
    case 'boolLit':
      return node.value ? 'true' : 'false';
    case 'nullLit':
      return 'null';
    case 'undefLit':
      return 'undefined';
    case 'regexLit':
      return `/${node.pattern}/${node.flags}`;
    case 'tmplLit': {
      let out = '`';
      for (let i = 0; i < node.quasis.length; i++) {
        out += escapeTemplateQuasi(node.quasis[i]);
        if (i < node.expressions.length) out += `\${${emitExpression(node.expressions[i])}}`;
      }
      out += '`';
      return out;
    }
    case 'ident':
      return node.name;
    case 'member':
      return `${emitExpression(node.object)}${node.optional ? '?.' : '.'}${node.property}`;
    case 'call': {
      const args = node.args.map(emitExpression).join(', ');
      const callee = emitExpression(node.callee);
      return node.optional ? `${callee}?.(${args})` : `${callee}(${args})`;
    }
    case 'binary': {
      const left = emitExpression(node.left);
      const right = emitExpression(node.right);
      // Parenthesize mixed && / || / ?? to keep TS-required disambiguation
      const lp = needsParens(node.left, node.op) ? `(${left})` : left;
      const rp = needsParens(node.right, node.op) ? `(${right})` : right;
      return `${lp} ${node.op} ${rp}`;
    }
    case 'unary':
      return `${node.op}${node.op === 'typeof' || node.op === 'void' ? ' ' : ''}${emitExpression(node.argument)}`;
    case 'spread':
      return `...${emitExpression(node.argument)}`;
  }
}

function needsParens(child: ValueIR, parentOp: string): boolean {
  if (child.kind !== 'binary') return false;
  if (!LOGICAL_OPS.has(parentOp) || !LOGICAL_OPS.has(child.op)) return false;
  // TS forbids ?? mixed with || or && without parens in either direction.
  if (parentOp !== child.op && (parentOp === '??' || child.op === '??')) return true;
  return false;
}

function escapeTemplateQuasi(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
