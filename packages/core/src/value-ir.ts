/** Expression value AST. Mirrors TS/JS precedence semantics for round-trip safety. */

import type { IRSourceLocation } from './types.js';

export type BinaryOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '**'
  | '=='
  | '!='
  | '==='
  | '!=='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'instanceof'
  | '&&'
  | '||'
  | '??'
  | '&'
  | '|'
  | '^'
  | '<<'
  | '>>'
  | '>>>';

export type UnaryOp = '!' | '-' | '+' | '~' | 'typeof' | 'void';

export type ValueIR =
  | { kind: 'numLit'; value: number; bigint?: boolean; raw: string; loc?: IRSourceLocation }
  | { kind: 'strLit'; value: string; quote: '"' | "'"; loc?: IRSourceLocation }
  | { kind: 'tmplLit'; quasis: string[]; expressions: ValueIR[]; loc?: IRSourceLocation }
  | { kind: 'boolLit'; value: boolean; loc?: IRSourceLocation }
  | { kind: 'nullLit'; loc?: IRSourceLocation }
  | { kind: 'undefLit'; loc?: IRSourceLocation }
  | { kind: 'regexLit'; pattern: string; flags: string; loc?: IRSourceLocation }
  | { kind: 'ident'; name: string; loc?: IRSourceLocation }
  | { kind: 'member'; object: ValueIR; property: string; optional: boolean; loc?: IRSourceLocation }
  | { kind: 'index'; object: ValueIR; index: ValueIR; optional: boolean; loc?: IRSourceLocation }
  | { kind: 'call'; callee: ValueIR; args: ValueIR[]; optional: boolean; typeArgs?: string; loc?: IRSourceLocation }
  | {
      kind: 'lambda';
      params: { name: string; type?: string }[];
      returnType?: string;
      /** Expression-bodied arrow (`x => x.id`). Mutually exclusive with
       *  `bodyBlock` — exactly one is present. */
      body?: ValueIR;
      /** Block-bodied arrow (`x => { … }`). Raw TS text INCLUDING the outer
       *  braces, for verbatim TS re-emit only. Every analyzer reads the TS AST
       *  via `parseClosureBlockAst`, never this string. Its EXISTENCE in the IR
       *  implies it passed the v1 closure gate (the parser validates at parse
       *  time, fail-closed). Mutually exclusive with `body`. */
      bodyBlock?: { raw: string };
      parenthesized: boolean;
      loc?: IRSourceLocation;
    }
  | { kind: 'binary'; op: BinaryOp; left: ValueIR; right: ValueIR; loc?: IRSourceLocation }
  | { kind: 'unary'; op: UnaryOp; argument: ValueIR; loc?: IRSourceLocation }
  | { kind: 'spread'; argument: ValueIR; loc?: IRSourceLocation }
  | { kind: 'await'; argument: ValueIR; loc?: IRSourceLocation }
  | { kind: 'new'; argument: ValueIR; loc?: IRSourceLocation }
  | { kind: 'typeAssert'; expression: ValueIR; type: string; loc?: IRSourceLocation }
  | { kind: 'nonNull'; expression: ValueIR; loc?: IRSourceLocation }
  | { kind: 'propagate'; argument: ValueIR; op: '?' | '!'; loc?: IRSourceLocation }
  | {
      kind: 'objectLit';
      entries: ({ key: string; rawKey?: string; value: ValueIR } | { kind: 'spread'; argument: ValueIR })[];
      loc?: IRSourceLocation;
    }
  | { kind: 'arrayLit'; items: ValueIR[]; loc?: IRSourceLocation }
  // Slice α-2: ternary `test ? consequent : alternate`. Three-operand —
  // distinct from `binary`. Right-associative in the parser.
  | { kind: 'conditional'; test: ValueIR; consequent: ValueIR; alternate: ValueIR; loc?: IRSourceLocation };

export type ValueIRKind = ValueIR['kind'];

export function isValueIR(x: unknown): x is ValueIR {
  if (typeof x !== 'object' || x === null) return false;
  const k = (x as { kind?: unknown }).kind;
  return (
    k === 'numLit' ||
    k === 'strLit' ||
    k === 'tmplLit' ||
    k === 'boolLit' ||
    k === 'nullLit' ||
    k === 'undefLit' ||
    k === 'regexLit' ||
    k === 'ident' ||
    k === 'member' ||
    k === 'index' ||
    k === 'call' ||
    k === 'lambda' ||
    k === 'binary' ||
    k === 'unary' ||
    k === 'spread' ||
    k === 'await' ||
    k === 'new' ||
    k === 'typeAssert' ||
    k === 'nonNull' ||
    k === 'propagate' ||
    k === 'objectLit' ||
    k === 'arrayLit' ||
    k === 'conditional'
  );
}
