/** Serialize ValueIR to a TypeScript expression string. */

import type { ValueIR } from './value-ir.js';

const PREC: Record<string, number> = {
  '??': 1,
  '||': 2,
  '&&': 3,
};

export function emitExpression(node: ValueIR): string {
  switch (node.kind) {
    case 'numLit':
      return node.raw;
    case 'strLit': {
      const q = node.quote;
      const escaped = node.value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(new RegExp(q, 'g'), `\\${q}`);
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
    case 'member': {
      const obj = emitExpression(node.object);
      const wrapped = needsReceiverParens(node.object) ? `(${obj})` : obj;
      return `${wrapped}${node.optional ? '?.' : '.'}${node.property}`;
    }
    case 'call': {
      const callee = emitExpression(node.callee);
      const wrapped = needsReceiverParens(node.callee) ? `(${callee})` : callee;
      const args = node.args.map(emitExpression).join(', ');
      return node.optional ? `${wrapped}?.(${args})` : `${wrapped}(${args})`;
    }
    case 'binary': {
      const left = emitExpression(node.left);
      const right = emitExpression(node.right);
      const lp = needsParens(node.left, node.op, 'left') ? `(${left})` : left;
      const rp = needsParens(node.right, node.op, 'right') ? `(${right})` : right;
      return `${lp} ${node.op} ${rp}`;
    }
    case 'unary':
      return `${node.op}${node.op === 'typeof' || node.op === 'void' ? ' ' : ''}${emitExpression(node.argument)}`;
    case 'spread':
      return `...${emitExpression(node.argument)}`;
  }
}

function needsParens(child: ValueIR, parentOp: string, side: 'left' | 'right'): boolean {
  if (child.kind !== 'binary') return false;
  // TS forbids ?? mixed with || or && without parens (either direction)
  if (parentOp === '??' && (child.op === '||' || child.op === '&&')) return true;
  if ((parentOp === '||' || parentOp === '&&') && child.op === '??') return true;
  const cp = PREC[child.op];
  const pp = PREC[parentOp];
  if (cp === undefined || pp === undefined) return false;
  if (cp < pp) return true;
  // Same precedence, left-associative: right child needs parens to preserve grouping
  if (cp === pp && side === 'right') return true;
  return false;
}

function needsReceiverParens(child: ValueIR): boolean {
  return child.kind === 'binary' || child.kind === 'unary' || child.kind === 'spread';
}

function escapeTemplateQuasi(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}
