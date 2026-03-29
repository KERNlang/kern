/**
 * Type System Generators — type, interface, union, service, const.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import type { IRNode } from '../types.js';
import { propsOf } from '../node-props.js';
import { emitIdentifier, emitStringLiteral, emitTemplateSafe, emitTypeAnnotation } from './emitters.js';
import { getProps, getChildren, getFirstChild, handlerCode, exportPrefix, capitalize, parseParamList } from './helpers.js';

const p = getProps;
const kids = getChildren;
const firstChild = getFirstChild;

// ── Type Alias ───────────────────────────────────────────────────────────
// type name=PlanState values="draft|approved|running|paused|completed|failed|cancelled"
// → export type PlanState = 'draft' | 'approved' | 'running' | ...;

export function generateType(node: IRNode): string[] {
  const props = propsOf<'type'>(node);
  const name = emitIdentifier(props.name, 'UnknownType', node);
  const { values, alias } = props;
  const exp = exportPrefix(node);

  if (values) {
    const members = values.split('|').map(v => `'${emitTemplateSafe(v.trim())}'`).join(' | ');
    return [`${exp}type ${name} = ${members};`];
  }
  if (alias) {
    return [`${exp}type ${name} = ${emitTypeAnnotation(alias, 'unknown', node)};`];
  }
  return [`${exp}type ${name} = unknown;`];
}

// ── Interface ────────────────────────────────────────────────────────────

export function generateInterface(node: IRNode): string[] {
  const props = propsOf<'interface'>(node);
  const name = emitIdentifier(props.name, 'UnknownInterface', node);
  const ext = props.extends ? ` extends ${emitTypeAnnotation(props.extends, 'unknown', node)}` : '';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`${exp}interface ${name}${ext} {`);
  for (const field of kids(node, 'field')) {
    const fp = propsOf<'field'>(field);
    const fieldName = emitIdentifier(fp.name, 'field', field);
    const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
    lines.push(`  ${fieldName}${opt}: ${emitTypeAnnotation(fp.type, 'unknown', field)};`);
  }
  lines.push('}');
  return lines;
}

// ── Discriminated Union ──────────────────────────────────────────────────

export function generateUnion(node: IRNode): string[] {
  const props = propsOf<'union'>(node);
  const name = emitIdentifier(props.name, 'UnknownUnion', node);
  const discriminant = emitIdentifier(props.discriminant, 'type', node);
  const exp = exportPrefix(node);
  const variants = kids(node, 'variant');

  if (variants.length === 0) {
    return [`${exp}type ${name} = never;`];
  }

  const lines: string[] = [`${exp}type ${name} =`];
  for (let i = 0; i < variants.length; i++) {
    const vp = propsOf<'variant'>(variants[i]);
    const vname = emitIdentifier(vp.name, 'variant', variants[i]);
    const fields = kids(variants[i], 'field');
    const fieldParts = [`${discriminant}: '${emitTemplateSafe(vname)}'`];
    for (const field of fields) {
      const fp = propsOf<'field'>(field);
      const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
      fieldParts.push(`${emitIdentifier(fp.name, 'field', field)}${opt}: ${emitTypeAnnotation(fp.type, 'unknown', field)}`);
    }
    const semi = i === variants.length - 1 ? ';' : '';
    lines.push(`  | { ${fieldParts.join('; ')} }${semi}`);
  }
  return lines;
}

// ── Service (Class) ─────────────────────────────────────────────────────

export function generateService(node: IRNode): string[] {
  const props = propsOf<'service'>(node);
  const name = emitIdentifier(props.name, 'UnknownService', node);
  const impl = props.implements;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  const implClause = impl ? ` implements ${emitTypeAnnotation(impl, 'unknown', node)}` : '';
  lines.push(`${exp}class ${name}${implClause} {`);

  // Fields
  for (const field of kids(node, 'field')) {
    const fp = propsOf<'field'>(field);
    const fieldName = emitIdentifier(fp.name, 'field', field);
    const vis = fp.private === 'true' || fp.private === true ? 'private ' : '';
    const readonly = (fp as Record<string, unknown>).readonly === 'true' || (fp as Record<string, unknown>).readonly === true ? 'readonly ' : '';
    const typeAnnotation = fp.type ? `: ${emitTypeAnnotation(fp.type, 'unknown', field)}` : '';
    const defaultVal = fp.default;
    // default values are by-design raw code (escape hatch) — documented, not sanitized
    const init = defaultVal !== undefined ? ` = ${defaultVal}` : '';
    lines.push(`  ${vis}${readonly}${fieldName}${typeAnnotation}${init};`);
  }

  // Constructor (if any constructor child exists)
  const ctorNode = firstChild(node, 'constructor');
  if (ctorNode) {
    const ctorProps = p(ctorNode);
    const ctorParams = ctorProps.params ? parseParamList(ctorProps.params as string) : '';
    const ctorCode = handlerCode(ctorNode);
    lines.push('');
    lines.push(`  constructor(${ctorParams}) {`);
    if (ctorCode) {
      for (const line of ctorCode.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
  }

  // Methods
  for (const method of kids(node, 'method')) {
    const mp = propsOf<'method'>(method);
    const mname = emitIdentifier(mp.name, 'method', method);
    const mparams = mp.params ? parseParamList(mp.params) : '';
    const isAsync = (mp as Record<string, unknown>).async === 'true' || (mp as Record<string, unknown>).async === true;
    const isStream = (mp as Record<string, unknown>).stream === 'true' || (mp as Record<string, unknown>).stream === true;
    const isStatic = (mp as Record<string, unknown>).static === 'true' || (mp as Record<string, unknown>).static === true;
    const vis = (mp as Record<string, unknown>).private === 'true' || (mp as Record<string, unknown>).private === true ? 'private ' : '';
    const staticKw = isStatic ? 'static ' : '';
    const star = isStream ? '*' : '';
    const asyncKw = (isAsync || isStream) ? 'async ' : '';
    const mcode = handlerCode(method);

    // stream=true → AsyncGenerator return type
    const mreturns = isStream
      ? `: AsyncGenerator<${emitTypeAnnotation(mp.returns, 'unknown', method)}>`
      : mp.returns ? `: ${emitTypeAnnotation(mp.returns, 'unknown', method)}` : '';

    lines.push('');
    lines.push(`  ${vis}${staticKw}${asyncKw}${star}${mname}(${mparams})${mreturns} {`);
    if (mcode) {
      for (const line of mcode.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
  }

  lines.push('}');

  // Singleton instances
  for (const singleton of kids(node, 'singleton')) {
    const sp = p(singleton);
    const sname = emitIdentifier(sp.name as string, 'instance', singleton);
    const stype = emitIdentifier(sp.type as string, name, singleton);
    lines.push('');
    lines.push(`${exp}const ${sname} = new ${stype}();`);
  }

  return lines;
}

// ── Const ───────────────────────────────────────────────────────────────

export function generateConst(node: IRNode): string[] {
  const props = propsOf<'const'>(node);
  const name = emitIdentifier(props.name, 'unknownConst', node);
  const constType = props.type;
  const value = props.value;
  const exp = exportPrefix(node);
  const code = handlerCode(node);

  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';

  if (code) {
    return [`${exp}const ${name}${typeAnnotation} = ${code.trim()};`];
  }
  if (value) {
    return [`${exp}const ${name}${typeAnnotation} = ${value};`];
  }
  return [`${exp}const ${name}${typeAnnotation};`];
}
