/**
 * Function & Error Generators — fn, error.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import { propsOf } from '../node-props.js';
import type { ExprObject, IRNode } from '../types.js';
import { emitIdentifier, emitTypeAnnotation } from './emitters.js';
import {
  dedent,
  emitDocComment,
  exportPrefix,
  getChildren,
  getFirstChild,
  getProps,
  handlerCode,
  parseParamList,
} from './helpers.js';

const p = getProps;
const kids = getChildren;
const firstChild = getFirstChild;

// ── Function ─────────────────────────────────────────────────────────────

export function generateFunction(node: IRNode): string[] {
  const props = propsOf<'fn'>(node);
  const name = emitIdentifier(props.name, 'unknownFn', node);
  const params = props.params || '';
  const returns = props.returns;
  const isAsync = props.async === 'true' || props.async === true;
  const isStream = props.stream === 'true' || props.stream === true;
  const isGenerator = props.generator === 'true' || props.generator === true;
  const exp = exportPrefix(node);
  // Slice 2f — generics: `fn name=identity generics="<T>" params="x:T" returns=T`
  // emits `function identity<T>(x: T): T { ... }`. emitTypeAnnotation handles
  // brackets/whitespace; same prop also goes on overload signatures (TS overloads
  // can declare their own type parameters when the impl is generic).
  const generics = props.generics ? emitTypeAnnotation(props.generics, '', node) : '';
  const lines: string[] = [...emitDocComment(node)];

  // Slice 2e — overload signatures emitted before the implementation. Each
  // produces a `function name(...): R;` line; the implementation that follows
  // is the actual body. TS dispatch matches against overload signatures and
  // ignores the implementation signature for callers.
  // TS rules: overload signatures must NOT carry the `async` keyword, the `*`
  // generator marker, or parameter default values — those belong to the
  // implementation only. We only emit `${exp}function name(...): R;` here.
  const overloadChildren = kids(node, 'overload');
  for (const ov of overloadChildren) {
    const op = propsOf<'overload'>(ov);
    const oParams = op.params ? parseParamList(op.params, { stripDefaults: true }) : '';
    const oRet = op.returns ? `: ${emitTypeAnnotation(op.returns, 'unknown', ov)}` : '';
    lines.push(`${exp}function ${name}${generics}(${oParams})${oRet};`);
  }

  // Parse params: "action:PlanAction,ws:WorkspaceSnapshot,spread:number=8"
  // → "action: PlanAction, ws: WorkspaceSnapshot, spread: number = 8"
  const paramList = params ? parseParamList(params) : '';

  // stream=true → async generator function
  if (isStream) {
    const yieldType = emitTypeAnnotation(returns, 'unknown', node);
    // If user already declared AsyncGenerator<...>, use as-is to avoid double-wrapping
    const retClause = yieldType.startsWith('AsyncGenerator<') ? `: ${yieldType}` : `: AsyncGenerator<${yieldType}>`;
    const code = handlerCode(node);
    lines.push(`${exp}async function* ${name}${generics}(${paramList})${retClause} {`);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
    lines.push('}');
    return lines;
  }

  // generator=true → Generator<T> return type
  const genPrefix = isAsync ? 'AsyncGenerator<' : 'Generator<';
  const retClause =
    isGenerator && returns
      ? (() => {
          const rt = emitTypeAnnotation(returns, 'unknown', node);
          // If user already declared Generator<...>/AsyncGenerator<...>, use as-is
          return rt.startsWith('Generator<') || rt.startsWith('AsyncGenerator<') ? `: ${rt}` : `: ${genPrefix}${rt}>`;
        })()
      : returns
        ? `: ${emitTypeAnnotation(returns, 'unknown', node)}`
        : '';
  const asyncKw = isAsync ? 'async ' : '';
  const code = handlerCode(node);

  const signalNode = firstChild(node, 'signal');
  const cleanupNode = firstChild(node, 'cleanup');
  const hasSignal = !!signalNode;
  const hasCleanup = !!cleanupNode;

  const star = isGenerator ? '* ' : '';
  lines.push(`${exp}${asyncKw}function${star ? '* ' : ' '}${name}${generics}(${paramList})${retClause} {`);

  // Signal → AbortController setup
  if (hasSignal) {
    const signalName = emitIdentifier(p(signalNode!).name as string, 'abort', signalNode);
    lines.push(`  const ${signalName} = new AbortController();`);
  }

  // `expr={{ ... }}` — single-expression function body. The expr is emitted
  // verbatim so that migrations from `handler <<< <body> >>>` produce
  // byte-identical TypeScript. Schema permits `expr` to coexist with
  // `handler` so that either (but not both) supplies the body; here `code`
  // wins because an explicit handler child is a stronger signal.
  const exprBody = !code ? fnExprBody(props.expr) : undefined;

  // Wrap body in try/finally if cleanup exists
  if (hasCleanup) {
    lines.push('  try {');
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    } else if (exprBody !== undefined) {
      lines.push(`    ${exprBody}`);
    }
    lines.push('  } finally {');
    const cleanupCode = (p(cleanupNode!).code as string) || '';
    if (cleanupCode) {
      const dedented = dedent(cleanupCode);
      for (const line of dedented.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
  } else if (code) {
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
  } else if (exprBody !== undefined) {
    lines.push(`  ${exprBody}`);
  }

  lines.push('}');
  return lines;
}

function fnExprBody(raw: string | ExprObject | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (typeof raw === 'object' && raw !== null && '__expr' in raw) return raw.code;
  return raw;
}

// ── Error Class ──────────────────────────────────────────────────────────

export function generateError(node: IRNode): string[] {
  const props = propsOf<'error'>(node);
  const name = emitIdentifier(props.name, 'UnknownError', node);
  const ext = emitIdentifier(props.extends, 'Error', node);
  const message = props.message;
  const exp = exportPrefix(node);
  const fields = kids(node, 'field');
  const lines: string[] = [...emitDocComment(node)];

  lines.push(`${exp}class ${name} extends ${ext} {`);

  const code = handlerCode(node);

  if (fields.length > 0) {
    lines.push(`  constructor(`);
    // Check if first field is 'message' — special case: pass to super
    const hasMessageParam = propsOf<'field'>(fields[0]).name === 'message';
    for (const field of fields) {
      const fp = propsOf<'field'>(field);
      const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
      const isMessage = fp.name === 'message';
      // 'message' param is not readonly — it's passed to super
      const fName = emitIdentifier(fp.name, 'field', field);
      const fType = emitTypeAnnotation(fp.type, 'unknown', field);
      if (isMessage) {
        lines.push(`    ${fName}${opt}: ${fType},`);
      } else {
        lines.push(`    public readonly ${fName}${opt}: ${fType},`);
      }
    }
    lines.push(`  ) {`);
    if (code) {
      // Custom handler body — replaces auto-generated constructor logic
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    } else if (message) {
      // Check if message references array fields that need formatting
      const arrayFields = fields.filter((f) => {
        const ft = propsOf<'field'>(f).type || '';
        return ft.includes('[]') || ft.includes('string |') || ft.includes('| string');
      });
      for (const f of arrayFields) {
        const fn = propsOf<'field'>(f).name || 'field';
        lines.push(`    const ${fn}Str = Array.isArray(${fn}) ? ${fn}.join(' | ') : ${fn};`);
      }
      lines.push(`    super(\`${message}\`);`);
      lines.push(`    this.name = '${name}';`);
    } else if (hasMessageParam) {
      lines.push(`    super(message);`);
      lines.push(`    this.name = '${name}';`);
    } else {
      lines.push(`    super();`);
      lines.push(`    this.name = '${name}';`);
    }
    lines.push(`  }`);
  } else {
    lines.push(`  constructor(message: string) {`);
    lines.push(`    super(message);`);
    lines.push(`    this.name = '${name}';`);
    lines.push(`  }`);
  }

  lines.push('}');
  return lines;
}
