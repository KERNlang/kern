/**
 * Function & Error Generators — fn, error.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import type { IRNode } from '../types.js';
import { emitIdentifier, emitTypeAnnotation } from './emitters.js';
import { getProps, getChildren, getFirstChild, dedent, handlerCode, exportPrefix, parseParamList } from './helpers.js';

const p = getProps;
const kids = getChildren;
const firstChild = getFirstChild;

// ── Function ─────────────────────────────────────────────────────────────

export function generateFunction(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'unknownFn', node);
  const params = props.params as string || '';
  const returns = props.returns as string;
  const isAsync = props.async === 'true' || props.async === true;
  const isStream = props.stream === 'true' || props.stream === true;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Parse params: "action:PlanAction,ws:WorkspaceSnapshot,spread:number=8"
  // → "action: PlanAction, ws: WorkspaceSnapshot, spread: number = 8"
  const paramList = params ? parseParamList(params) : '';

  // stream=true → async generator function
  if (isStream) {
    const yieldType = emitTypeAnnotation(returns as string, 'unknown', node);
    const retClause = `: AsyncGenerator<${yieldType}>`;
    const code = handlerCode(node);
    lines.push(`${exp}async function* ${name}(${paramList})${retClause} {`);
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`  ${line}`);
      }
    }
    lines.push('}');
    return lines;
  }

  const retClause = returns ? `: ${emitTypeAnnotation(returns as string, 'unknown', node)}` : '';
  const asyncKw = isAsync ? 'async ' : '';
  const code = handlerCode(node);

  // Gap 3: signal + cleanup support for async functions
  const signalNode = firstChild(node, 'signal');
  const cleanupNode = firstChild(node, 'cleanup');
  const hasSignal = !!signalNode;
  const hasCleanup = !!cleanupNode;

  lines.push(`${exp}${asyncKw}function ${name}(${paramList})${retClause} {`);

  // Signal → AbortController setup
  if (hasSignal) {
    const signalName = emitIdentifier((p(signalNode!).name as string), 'abort', signalNode);
    lines.push(`  const ${signalName} = new AbortController();`);
  }

  // Wrap body in try/finally if cleanup exists
  if (hasCleanup) {
    lines.push('  try {');
    if (code) {
      for (const line of code.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  } finally {');
    const cleanupCode = p(cleanupNode!).code as string || '';
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
  }

  lines.push('}');
  return lines;
}

// ── Error Class ──────────────────────────────────────────────────────────

export function generateError(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownError', node);
  const ext = emitIdentifier(props.extends as string, 'Error', node);
  const message = props.message as string;
  const exp = exportPrefix(node);
  const fields = kids(node, 'field');
  const lines: string[] = [];

  lines.push(`${exp}class ${name} extends ${ext} {`);

  const code = handlerCode(node);

  if (fields.length > 0) {
    lines.push(`  constructor(`);
    // Check if first field is 'message' — special case: pass to super
    const hasMessageParam = (p(fields[0]).name as string) === 'message';
    for (const field of fields) {
      const fp = p(field);
      const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
      const isMessage = (fp.name as string) === 'message';
      // 'message' param is not readonly — it's passed to super
      const fName = emitIdentifier(fp.name as string, 'field', field);
      const fType = emitTypeAnnotation(fp.type as string, 'unknown', field);
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
      const arrayFields = fields.filter(f => {
        const ft = p(f).type as string;
        return ft.includes('[]') || ft.includes('string |') || ft.includes('| string');
      });
      for (const f of arrayFields) {
        const fn = p(f).name as string;
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
