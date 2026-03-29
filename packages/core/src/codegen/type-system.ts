/**
 * Type System Generators — type, interface, union, service, const.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import type { IRNode } from '../types.js';
import { emitIdentifier, emitStringLiteral, emitTemplateSafe, emitTypeAnnotation } from './emitters.js';
import { getProps, getChildren, getFirstChild, handlerCode, exportPrefix, capitalize, parseParamList } from './helpers.js';

const p = getProps;
const kids = getChildren;
const firstChild = getFirstChild;

// ── Type Alias ───────────────────────────────────────────────────────────
// type name=PlanState values="draft|approved|running|paused|completed|failed|cancelled"
// → export type PlanState = 'draft' | 'approved' | 'running' | ...;

export function generateType(node: IRNode): string[] {
  const { name: rawName, values, alias } = p(node) as Record<string, string>;
  const name = emitIdentifier(rawName, 'UnknownType', node);
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
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownInterface', node);
  const ext = props.extends ? ` extends ${emitTypeAnnotation(props.extends as string, 'unknown', node)}` : '';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  lines.push(`${exp}interface ${name}${ext} {`);
  for (const field of kids(node, 'field')) {
    const fp = p(field);
    const fieldName = emitIdentifier(fp.name as string, 'field', field);
    const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
    lines.push(`  ${fieldName}${opt}: ${emitTypeAnnotation(fp.type as string, 'unknown', field)};`);
  }
  lines.push('}');
  return lines;
}

// ── Discriminated Union ──────────────────────────────────────────────────

export function generateUnion(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownUnion', node);
  const discriminant = emitIdentifier(props.discriminant as string, 'type', node);
  const exp = exportPrefix(node);
  const variants = kids(node, 'variant');

  if (variants.length === 0) {
    return [`${exp}type ${name} = never;`];
  }

  const lines: string[] = [`${exp}type ${name} =`];
  for (let i = 0; i < variants.length; i++) {
    const vp = p(variants[i]);
    const vname = emitIdentifier(vp.name as string, 'variant', variants[i]);
    const fields = kids(variants[i], 'field');
    const fieldParts = [`${discriminant}: '${emitTemplateSafe(vname)}'`];
    for (const field of fields) {
      const fp = p(field);
      const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
      fieldParts.push(`${emitIdentifier(fp.name as string, 'field', field)}${opt}: ${emitTypeAnnotation(fp.type as string, 'unknown', field)}`);
    }
    const semi = i === variants.length - 1 ? ';' : '';
    lines.push(`  | { ${fieldParts.join('; ')} }${semi}`);
  }
  return lines;
}

// ── Service (Class) ─────────────────────────────────────────────────────

export function generateService(node: IRNode): string[] {
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'UnknownService', node);
  const impl = props.implements as string;
  const exp = exportPrefix(node);
  const lines: string[] = [];

  const implClause = impl ? ` implements ${emitTypeAnnotation(impl, 'unknown', node)}` : '';
  lines.push(`${exp}class ${name}${implClause} {`);

  // Fields
  for (const field of kids(node, 'field')) {
    const fp = p(field);
    const fieldName = emitIdentifier(fp.name as string, 'field', field);
    const vis = fp.private === 'true' || fp.private === true ? 'private ' : '';
    const readonly = fp.readonly === 'true' || fp.readonly === true ? 'readonly ' : '';
    const typeAnnotation = fp.type ? `: ${emitTypeAnnotation(fp.type as string, 'unknown', field)}` : '';
    const defaultVal = fp.default as string;
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
    const mp = p(method);
    const mname = emitIdentifier(mp.name as string, 'method', method);
    const mparams = mp.params ? parseParamList(mp.params as string) : '';
    const isAsync = mp.async === 'true' || mp.async === true;
    const isStream = mp.stream === 'true' || mp.stream === true;
    const isStatic = mp.static === 'true' || mp.static === true;
    const vis = mp.private === 'true' || mp.private === true ? 'private ' : '';
    const staticKw = isStatic ? 'static ' : '';
    const star = isStream ? '*' : '';
    const asyncKw = (isAsync || isStream) ? 'async ' : '';
    const mcode = handlerCode(method);

    // stream=true → AsyncGenerator return type
    const mreturns = isStream
      ? `: AsyncGenerator<${emitTypeAnnotation(mp.returns as string, 'unknown', method)}>`
      : mp.returns ? `: ${emitTypeAnnotation(mp.returns as string, 'unknown', method)}` : '';

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
  const props = p(node);
  const name = emitIdentifier(props.name as string, 'unknownConst', node);
  const constType = props.type as string | undefined;
  const value = props.value as string | undefined;
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
