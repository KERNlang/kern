/**
 * Type System Generators — type, interface, union, service, const.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import { propsOf } from '../node-props.js';
import type { ExprObject, IRNode } from '../types.js';
import { emitIdentifier, emitTemplateSafe, emitTypeAnnotation } from './emitters.js';
import {
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

function isExprObject(value: unknown): value is ExprObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __expr?: unknown }).__expr === true &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

// ── Type Alias ───────────────────────────────────────────────────────────
// type name=PlanState values="draft|approved|running|paused|completed|failed|cancelled"
// → export type PlanState = 'draft' | 'approved' | 'running' | ...;

export function generateType(node: IRNode): string[] {
  const props = propsOf<'type'>(node);
  const name = emitIdentifier(props.name, 'UnknownType', node);
  const { values, alias } = props;
  const exp = exportPrefix(node);
  const docs = emitDocComment(node);

  if (values) {
    const members = values
      .split('|')
      .map((v) => `'${emitTemplateSafe(v.trim())}'`)
      .join(' | ');
    return [...docs, `${exp}type ${name} = ${members};`];
  }
  if (alias) {
    return [...docs, `${exp}type ${name} = ${emitTypeAnnotation(alias, 'unknown', node)};`];
  }
  return [...docs, `${exp}type ${name} = unknown;`];
}

// ── Interface ────────────────────────────────────────────────────────────

export function generateInterface(node: IRNode): string[] {
  const props = propsOf<'interface'>(node);
  const name = emitIdentifier(props.name, 'UnknownInterface', node);
  const ext = props.extends ? ` extends ${emitTypeAnnotation(props.extends, 'unknown', node)}` : '';
  const exp = exportPrefix(node);
  const lines: string[] = [...emitDocComment(node)];

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
  const docs = emitDocComment(node);

  if (variants.length === 0) {
    return [...docs, `${exp}type ${name} = never;`];
  }

  const lines: string[] = [...docs, `${exp}type ${name} =`];
  for (let i = 0; i < variants.length; i++) {
    const vp = propsOf<'variant'>(variants[i]);
    const fields = kids(variants[i], 'field');
    const semi = i === variants.length - 1 ? ';' : '';

    // Type-reference variant: `variant type=TextPart` — emit as union member directly
    if (vp.type && fields.length === 0) {
      lines.push(`  | ${emitTypeAnnotation(vp.type, 'unknown', variants[i])}${semi}`);
      continue;
    }

    // Inline variant: `variant name=circle` with child fields — emit as discriminated object
    const vname = emitTemplateSafe(vp.name ?? vp.type ?? 'variant');
    const fieldParts = [`${discriminant}: '${emitTemplateSafe(vname)}'`];
    for (const field of fields) {
      const fp = propsOf<'field'>(field);
      const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
      fieldParts.push(
        `${emitIdentifier(fp.name, 'field', field)}${opt}: ${emitTypeAnnotation(fp.type, 'unknown', field)}`,
      );
    }
    lines.push(`  | { ${fieldParts.join('; ')} }${semi}`);
  }
  return lines;
}

// ── Class-like (Service + Class) ────────────────────────────────────────
//
// Both `service` and `class` emit a TypeScript class declaration with the
// same field/method/constructor body. They differ only in the header clause:
//   service name=X implements=Y   → `class X implements Y { ... }`
//   class name=X extends=Y        → `class X extends Y { ... }`
//   class name=X abstract=true    → `abstract class X { ... }`
// Sharing emitClassBody keeps codegen parity as new schema fields are added.

function emitClassHeader(
  node: IRNode,
  fallbackName: string,
): { exp: string; name: string; header: string; docs: string[] } {
  const props = p(node) as { name?: string; extends?: string; implements?: string; abstract?: unknown };
  const name = emitIdentifier(props.name, fallbackName, node);
  const exp = exportPrefix(node);
  const docs = emitDocComment(node);

  const extendsClause = props.extends ? ` extends ${emitTypeAnnotation(props.extends, 'unknown', node)}` : '';
  const implementsClause = props.implements
    ? ` implements ${emitTypeAnnotation(props.implements, 'unknown', node)}`
    : '';
  const abstractKw = props.abstract === 'true' || props.abstract === true ? 'abstract ' : '';

  return {
    exp,
    name,
    docs,
    header: `${exp}${abstractKw}class ${name}${extendsClause}${implementsClause} {`,
  };
}

export function generateClass(node: IRNode): string[] {
  const { exp, name, header, docs } = emitClassHeader(node, 'UnknownClass');
  const lines: string[] = [...docs];
  lines.push(header);
  emitClassBody(node, lines);
  lines.push('}');
  emitSingletons(node, lines, name, exp);
  return lines;
}

export function generateService(node: IRNode): string[] {
  const { exp, name, header, docs } = emitClassHeader(node, 'UnknownService');
  const lines: string[] = [...docs];
  lines.push(header);
  emitClassBody(node, lines);
  lines.push('}');
  emitSingletons(node, lines, name, exp);
  return lines;
}

function emitSingletons(node: IRNode, lines: string[], className: string, exp: string): void {
  for (const singleton of kids(node, 'singleton')) {
    const sp = p(singleton);
    const sname = emitIdentifier(sp.name as string, 'instance', singleton);
    const stype = emitIdentifier(sp.type as string, className, singleton);
    lines.push('');
    lines.push(`${exp}const ${sname} = new ${stype}();`);
  }
}

function emitClassBody(node: IRNode, lines: string[]): void {
  // Fields
  for (const field of kids(node, 'field')) {
    const fp = propsOf<'field'>(field);
    const fieldName = emitIdentifier(fp.name, 'field', field);
    const vis = fp.private === 'true' || fp.private === true ? 'private ' : '';
    const staticKw = fp.static === 'true' || fp.static === true ? 'static ' : '';
    const readonly = fp.readonly === 'true' || fp.readonly === true ? 'readonly ' : '';
    const typeAnnotation = fp.type ? `: ${emitTypeAnnotation(fp.type, 'unknown', field)}` : '';
    const defaultVal = (fp as { default?: unknown }).default;
    // `default={{ expr }}` parses as an ExprObject; emit its raw code.
    // Bare `default=0` arrives as a string. Either way it's by-design raw TS.
    const init = (() => {
      if (defaultVal === undefined || defaultVal === '') return '';
      if (isExprObject(defaultVal)) return ` = ${defaultVal.code}`;
      return ` = ${defaultVal}`;
    })();
    lines.push(`  ${vis}${staticKw}${readonly}${fieldName}${typeAnnotation}${init};`);
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
    const isStream =
      (mp as Record<string, unknown>).stream === 'true' || (mp as Record<string, unknown>).stream === true;
    const isGenerator =
      (mp as Record<string, unknown>).generator === 'true' || (mp as Record<string, unknown>).generator === true;
    const isStatic =
      (mp as Record<string, unknown>).static === 'true' || (mp as Record<string, unknown>).static === true;
    const vis =
      (mp as Record<string, unknown>).private === 'true' || (mp as Record<string, unknown>).private === true
        ? 'private '
        : '';
    const staticKw = isStatic ? 'static ' : '';
    const star = isStream || isGenerator ? '*' : '';
    const asyncKw = isAsync || isStream ? 'async ' : '';
    const mcode = handlerCode(method);

    // stream=true → AsyncGenerator, generator=true → Generator/AsyncGenerator
    // If user already declared full Generator<...>/AsyncGenerator<...>, use as-is
    const mrt = mp.returns ? emitTypeAnnotation(mp.returns, 'unknown', method) : '';
    const mGenPrefix = isAsync ? 'AsyncGenerator<' : 'Generator<';
    const mreturns = isStream
      ? mrt.startsWith('AsyncGenerator<')
        ? `: ${mrt}`
        : `: AsyncGenerator<${mrt || 'unknown'}>`
      : isGenerator && mp.returns
        ? mrt.startsWith('Generator<') || mrt.startsWith('AsyncGenerator<')
          ? `: ${mrt}`
          : `: ${mGenPrefix}${mrt}>`
        : mp.returns
          ? `: ${mrt}`
          : '';

    lines.push('');
    lines.push(`  ${vis}${staticKw}${asyncKw}${star}${mname}(${mparams})${mreturns} {`);
    if (mcode) {
      for (const line of mcode.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
  }

  // Getters — `get name(): T { body }`
  for (const getter of kids(node, 'getter')) {
    const gp = propsOf<'getter'>(getter);
    const gname = emitIdentifier(gp.name, 'getter', getter);
    const gvis = gp.private === 'true' || gp.private === true ? 'private ' : '';
    const gstatic = gp.static === 'true' || gp.static === true ? 'static ' : '';
    const greturns = gp.returns ? `: ${emitTypeAnnotation(gp.returns, 'unknown', getter)}` : '';
    const gcode = handlerCode(getter);
    lines.push('');
    lines.push(`  ${gvis}${gstatic}get ${gname}()${greturns} {`);
    if (gcode) {
      for (const line of gcode.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
  }

  // Setters — `set name(v: T) { body }`
  for (const setter of kids(node, 'setter')) {
    const sp = propsOf<'setter'>(setter);
    const sname = emitIdentifier(sp.name, 'setter', setter);
    const svis = sp.private === 'true' || sp.private === true ? 'private ' : '';
    const sstatic = sp.static === 'true' || sp.static === true ? 'static ' : '';
    const sparams = sp.params ? parseParamList(sp.params) : 'value: unknown';
    const scode = handlerCode(setter);
    lines.push('');
    lines.push(`  ${svis}${sstatic}set ${sname}(${sparams}) {`);
    if (scode) {
      for (const line of scode.split('\n')) {
        lines.push(`    ${line}`);
      }
    }
    lines.push('  }');
  }
}

// ── Const ───────────────────────────────────────────────────────────────

export function generateConst(node: IRNode): string[] {
  const props = propsOf<'const'>(node);
  const name = emitIdentifier(props.name, 'unknownConst', node);
  const constType = props.type;
  const rawValue = props.value;
  const exp = exportPrefix(node);
  const code = handlerCode(node);
  const docs = emitDocComment(node);

  const typeAnnotation = constType ? `: ${emitTypeAnnotation(constType, 'unknown', node)}` : '';

  if (code) {
    return [...docs, `${exp}const ${name}${typeAnnotation} = ${code.trim()};`];
  }
  if (rawValue !== undefined && rawValue !== '') {
    // `value={{ expr }}` is parsed as ExprObject; emit the raw code. Bare
    // literal values (`value=42`) come through as strings.
    const value = isExprObject(rawValue) ? rawValue.code : rawValue;
    return [...docs, `${exp}const ${name}${typeAnnotation} = ${value};`];
  }
  return [...docs, `${exp}const ${name}${typeAnnotation};`];
}
