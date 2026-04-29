/**
 * Type System Generators — type, interface, union, service, const.
 *
 * Extracted from codegen-core.ts for modular codegen architecture.
 */

import { emitExpression } from '../codegen-expression.js';
import { propsOf } from '../node-props.js';
import { parseExpression } from '../parser-expression.js';
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
  const generics = props.generics ? emitTypeAnnotation(props.generics, '', node) : '';
  const exp = exportPrefix(node);
  const docs = emitDocComment(node);

  if (values) {
    const members = values
      .split('|')
      .map((v) => `'${emitTemplateSafe(v.trim())}'`)
      .join(' | ');
    return [...docs, `${exp}type ${name}${generics} = ${members};`];
  }
  if (alias) {
    return [...docs, `${exp}type ${name}${generics} = ${emitTypeAnnotation(alias, 'unknown', node)};`];
  }
  return [...docs, `${exp}type ${name}${generics} = unknown;`];
}

// ── Interface ────────────────────────────────────────────────────────────

export function generateInterface(node: IRNode): string[] {
  const props = propsOf<'interface'>(node);
  const name = emitIdentifier(props.name, 'UnknownInterface', node);
  const generics = props.generics ? emitTypeAnnotation(props.generics, '', node) : '';
  const ext = props.extends ? ` extends ${emitTypeAnnotation(props.extends, 'unknown', node)}` : '';
  const exp = exportPrefix(node);
  const lines: string[] = [...emitDocComment(node)];

  lines.push(`${exp}interface ${name}${generics}${ext} {`);
  for (const field of kids(node, 'field')) {
    const fp = propsOf<'field'>(field);
    const fieldName = emitIdentifier(fp.name, 'field', field);
    const opt = fp.optional === 'true' || fp.optional === true ? '?' : '';
    lines.push(`  ${fieldName}${opt}: ${emitTypeAnnotation(fp.type, 'unknown', field)};`);
  }
  for (const idx of kids(node, 'indexer')) {
    const ip = propsOf<'indexer'>(idx);
    // `||` (not `??`) so an empty-string keyName also falls back to 'key'.
    const keyName = emitIdentifier(ip.keyName || 'key', 'key', idx);
    const keyType = emitTypeAnnotation(ip.keyType, 'string', idx);
    const valType = emitTypeAnnotation(ip.type, 'unknown', idx);
    const ro = ip.readonly === 'true' || ip.readonly === true ? 'readonly ' : '';
    lines.push(`  ${ro}[${keyName}: ${keyType}]: ${valType};`);
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
  const props = p(node) as {
    name?: string;
    extends?: string;
    implements?: string;
    abstract?: unknown;
    generics?: string;
  };
  const name = emitIdentifier(props.name, fallbackName, node);
  const exp = exportPrefix(node);
  const docs = emitDocComment(node);

  const generics = props.generics ? emitTypeAnnotation(props.generics, '', node) : '';
  const extendsClause = props.extends ? ` extends ${emitTypeAnnotation(props.extends, 'unknown', node)}` : '';
  const implementsClause = props.implements
    ? ` implements ${emitTypeAnnotation(props.implements, 'unknown', node)}`
    : '';
  const abstractKw = props.abstract === 'true' || props.abstract === true ? 'abstract ' : '';

  const classKw = node.type === 'service' ? 'class ' : `${abstractKw}class `;

  return {
    exp,
    name,
    docs,
    header: `${exp}${classKw}${name}${generics}${extendsClause}${implementsClause} {`,
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
    // Slice 3b: `value` (native ValueIR) takes precedence over `default`
    // (rawExpr passthrough). `value` routes through emitConstValue for
    // ValueIR canonicalisation + __quotedProps-aware string-literal handling;
    // `default` keeps the original raw passthrough so existing seeds with
    // bare-string defaults (e.g. `default=plan` for a string-typed field)
    // continue to compile unchanged.
    //
    // Codex-hold guard from slice 3a: presence is `=== undefined` only —
    // empty-string `value=""` is a legal explicit string literal when the
    // source had it quoted (__quotedProps tracks it), and emitConstValue
    // JSON.stringifies it to `""`. Slice 3b Codex hold #1: an unquoted
    // empty `value=` (no __quotedProps) must NOT be routed through
    // emitConstValue — parseExpression('') throws and returns '', producing
    // invalid TS like `x: string = ;`. Treat unquoted-empty as absent.
    const rawValue = (fp as { value?: unknown }).value;
    const rawDefault = (fp as { default?: unknown }).default;
    const valuePresent = rawValue !== undefined && (rawValue !== '' || field.__quotedProps?.includes('value') === true);
    const init = (() => {
      if (valuePresent) {
        return ` = ${emitConstValue(field, rawValue)}`;
      }
      if (rawDefault === undefined || rawDefault === '') return '';
      if (isExprObject(rawDefault)) return ` = ${rawDefault.code}`;
      return ` = ${rawDefault}`;
    })();
    lines.push(`  ${vis}${staticKw}${readonly}${fieldName}${typeAnnotation}${init};`);
  }

  // Constructor (if any constructor child exists)
  const ctorNode = firstChild(node, 'constructor');
  if (ctorNode) {
    const ctorProps = propsOf<'constructor'>(ctorNode);
    const ctorParams = emitParamList(ctorNode);
    const generics = ctorProps.generics ? emitTypeAnnotation(ctorProps.generics, '', ctorNode) : '';
    const ctorCode = handlerCode(ctorNode);
    lines.push('');
    lines.push(`  constructor${generics}(${ctorParams}) {`);
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
    const mparams = emitParamList(method);
    const generics = mp.generics ? emitTypeAnnotation(mp.generics, '', method) : '';
    const isAsync = mp.async === 'true' || mp.async === true;
    const isStream = mp.stream === 'true' || mp.stream === true;
    const isGenerator = mp.generator === 'true' || mp.generator === true;
    const isStatic = mp.static === 'true' || mp.static === true;
    const vis = mp.private === 'true' || mp.private === true ? 'private ' : '';
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
    lines.push(`  ${vis}${staticKw}${asyncKw}${star}${mname}${generics}(${mparams})${mreturns} {`);
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
    const sparams = emitParamList(setter, { fallback: 'value: unknown' });
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

// ── Enum ────────────────────────────────────────────────────────────────
// enum name=Status values="Pending|Active|Done"
// → export enum Status { Pending, Active, Done }
//
// enum name=Direction
//   member name=Up value="UP"
//   member name=Down value="DOWN"
// → export enum Direction { Up = "UP", Down = "DOWN" }
//
// enum name=Flag const=true values="On|Off"
// → export const enum Flag { On, Off }

export function generateEnum(node: IRNode): string[] {
  const props = propsOf<'enum'>(node);
  const name = emitIdentifier(props.name, 'UnknownEnum', node);
  const exp = exportPrefix(node);
  const isConst = props.const === 'true' || props.const === true;
  const constKw = isConst ? 'const ' : '';
  const docs = emitDocComment(node);

  // Member children take precedence over `values=`. If both are provided, members win
  // (and `values=` is silently ignored — the user picked the more expressive form).
  const memberChildren = kids(node, 'member');
  if (memberChildren.length > 0) {
    const lines: string[] = [...docs, `${exp}${constKw}enum ${name} {`];
    for (const m of memberChildren) {
      const mp = propsOf<'member'>(m);
      const mname = emitIdentifier(mp.name, 'unknownMember', m);
      const rawVal = mp.value;
      // Quoted strings keep their string form; bare values pass through as-is.
      // (Slice 1i/1j contract: __quotedProps tracks origin; here we honour it.)
      let valueStr: string;
      if (rawVal === undefined || rawVal === '') {
        valueStr = '';
      } else if (typeof rawVal === 'object' && (rawVal as { __expr?: unknown }).__expr === true) {
        valueStr = ` = ${(rawVal as { code: string }).code}`;
      } else if (typeof rawVal === 'string') {
        const isQuoted = m.__quotedProps?.includes('value');
        valueStr = ` = ${isQuoted ? JSON.stringify(rawVal) : rawVal}`;
      } else {
        valueStr = ` = ${String(rawVal)}`;
      }
      lines.push(`  ${mname}${valueStr},`);
    }
    lines.push('}');
    return lines;
  }

  if (props.values) {
    const members = props.values
      .split('|')
      .map((v) => emitIdentifier(v.trim(), 'unknownMember', node))
      .join(', ');
    return [...docs, `${exp}${constKw}enum ${name} { ${members} }`];
  }

  return [...docs, `${exp}${constKw}enum ${name} {}`];
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
    const value = emitConstValue(node, rawValue);
    return [...docs, `${exp}const ${name}${typeAnnotation} = ${value};`];
  }
  return [...docs, `${exp}const ${name}${typeAnnotation};`];
}

// ── Destructure (slice 3d) ──────────────────────────────────────────────

/**
 * Slice 3d — emit a TS destructuring statement from a `destructure` node.
 *
 * Two paths:
 *   (1) `expr={{...}}` escape hatch — emit the carried code verbatim. Used
 *       by the importer for complex patterns (rest `...`, defaults `=v`,
 *       nested `{a:{b}}`, computed keys) where structured children would
 *       lose information.
 *   (2) Structured children — `binding` for object patterns (with optional
 *       `key=` for renames) or `element` for array patterns (with `index=`
 *       for ordered position). Codegen detects which child kind dominates
 *       and emits `{a, b: alias} = src` or `[a, b, , c] = src` (holes from
 *       index gaps).
 *
 * `kind` defaults to `const` when omitted. `type` (optional) flows through
 * `emitTypeAnnotation` and is appended after the LHS pattern.
 */
export function generateDestructure(node: IRNode): string[] {
  const props = propsOf<'destructure'>(node);
  const docs = emitDocComment(node);
  const exp = exportPrefix(node);
  const kind = props.kind === 'let' ? 'let' : 'const';

  // Escape-hatch path for unsupported patterns (rest/defaults/nested).
  // Importer falls back to this when ts.ObjectBindingPattern / ts.ArrayBindingPattern
  // contain features the structured emitter can't represent. The raw text is
  // expected to be a full statement (including `const`/`let` and any `export`
  // prefix), so we DON'T re-prepend `exp` or `kind` here.
  if (props.expr !== undefined) {
    const raw = isExprObject(props.expr) ? props.expr.code : String(props.expr);
    return [...docs, raw];
  }

  if (props.source === undefined || props.source === '') {
    throw new Error('destructure node requires either `source=...` or `expr={{...}}`');
  }
  const sourceCode = emitConstValue(node, props.source);

  const typeAnn = props.type ? `: ${emitTypeAnnotation(props.type, 'unknown', node)}` : '';

  const pattern = formatBindingPatternFromChildren(node);
  if (pattern === null) {
    throw new Error(
      'destructure node has no `binding` or `element` children — use `expr={{...}}` instead for empty patterns',
    );
  }

  return [...docs, `${exp}${kind} ${pattern}${typeAnn} = ${sourceCode};`];
}

/**
 * Slice 3c-extension #3 / shared with slice 3d destructure: format the LHS
 * pattern (`{a, b: alias}` or `[x, , y]`) from a node's `binding` (object)
 * or `element` (array) children. Returns null when neither is present (used
 * by the destructure node validator); throws when the node mixes both.
 *
 * Used by:
 *  - `generateDestructure` (slice 3d) — full statement: `const {a,b} = src;`
 *  - `parseParamListFromChildren` (slice 3c-extension #3) — pattern-only LHS
 *    of a destructured fn parameter: `{a, b}: Point` or `[x, y]`.
 */
export function formatBindingPatternFromChildren(node: IRNode): string | null {
  const children = node.children || [];
  const bindings = children.filter((c) => c.type === 'binding');
  const elements = children.filter((c) => c.type === 'element');

  if (bindings.length === 0 && elements.length === 0) return null;
  if (bindings.length > 0 && elements.length > 0) {
    throw new Error(`${node.type} mixes \`binding\` (object) and \`element\` (array) children — use one or the other`);
  }

  if (bindings.length > 0) {
    // Object pattern: {a, b: rename, c}
    const parts = bindings.map((child) => {
      const cp = propsOf<'binding'>(child);
      const name = emitIdentifier(cp.name, 'unknownBinding', child);
      if (cp.key) {
        const key = emitIdentifier(cp.key, 'unknownKey', child);
        return `${key}: ${name}`;
      }
      return name;
    });
    return `{ ${parts.join(', ')} }`;
  }

  // Array pattern: ordered by `index=`, gaps emit holes (`, ,`).
  const indexed = elements.map((child) => {
    const cp = propsOf<'element'>(child);
    const idx = cp.index !== undefined ? Number.parseInt(cp.index, 10) : Number.NaN;
    return { idx, child, props: cp };
  });
  if (indexed.some((e) => Number.isNaN(e.idx))) {
    throw new Error(`${node.type} \`element\` children require numeric \`index=\` props`);
  }
  indexed.sort((a, b) => a.idx - b.idx);
  const max = indexed[indexed.length - 1].idx;
  const slots: string[] = [];
  for (let i = 0; i <= max; i++) {
    const match = indexed.find((e) => e.idx === i);
    if (match) {
      slots.push(emitIdentifier(match.props.name, 'unknownElement', match.child));
    } else {
      slots.push('');
    }
  }
  return `[${slots.join(', ')}]`;
}

// ── Map / Set literals (slice 3e) ───────────────────────────────────────

/**
 * Slice 3e — emit a TS Map literal from a `mapLit` node.
 *
 *   mapLit name=cache type="Map<string, number>"
 *     mapEntry key="foo" value=1
 *     mapEntry key="bar" value=2
 *
 * → `const cache: Map<string, number> = new Map([['foo', 1], ['bar', 2]]);`
 *
 * `expr={{...}}` escape hatch carries a raw TS statement verbatim — used
 * by the importer fallback when a Map literal contains shapes the
 * structured emitter can't represent (computed keys, conditional entries,
 * spread). Mirrors slice 3d destructure escape-hatch policy.
 */
export function generateMapLit(node: IRNode): string[] {
  const props = propsOf<'mapLit'>(node);
  const docs = emitDocComment(node);
  const exp = exportPrefix(node);

  if (props.expr !== undefined) {
    const raw = isExprObject(props.expr) ? props.expr.code : String(props.expr);
    return [...docs, raw];
  }

  const name = emitIdentifier(props.name, 'unknownMap', node);
  const kind = props.kind === 'let' ? 'let' : 'const';
  const typeAnn = props.type ? `: ${emitTypeAnnotation(props.type, 'Map<unknown, unknown>', node)}` : '';

  const entries = (node.children || []).filter((c) => c.type === 'mapEntry');
  const pairs = entries.map((child) => {
    const cp = propsOf<'mapEntry'>(child);
    if (cp.key === undefined) {
      throw new Error('mapEntry requires a `key=` prop');
    }
    if (cp.value === undefined) {
      throw new Error('mapEntry requires a `value=` prop');
    }
    const k = emitConstValue(child, cp.key, 'key');
    const v = emitConstValue(child, cp.value, 'value');
    return `[${k}, ${v}]`;
  });

  return [...docs, `${exp}${kind} ${name}${typeAnn} = new Map([${pairs.join(', ')}]);`];
}

/**
 * Slice 3e — emit a TS Set literal from a `setLit` node.
 *
 *   setLit name=allowed type="Set<string>"
 *     setItem value="admin"
 *     setItem value="user"
 *
 * → `const allowed: Set<string> = new Set(['admin', 'user']);`
 *
 * Same `expr={{...}}` escape-hatch policy as `mapLit`/`destructure`.
 */
export function generateSetLit(node: IRNode): string[] {
  const props = propsOf<'setLit'>(node);
  const docs = emitDocComment(node);
  const exp = exportPrefix(node);

  if (props.expr !== undefined) {
    const raw = isExprObject(props.expr) ? props.expr.code : String(props.expr);
    return [...docs, raw];
  }

  const name = emitIdentifier(props.name, 'unknownSet', node);
  const kind = props.kind === 'let' ? 'let' : 'const';
  const typeAnn = props.type ? `: ${emitTypeAnnotation(props.type, 'Set<unknown>', node)}` : '';

  const items = (node.children || []).filter((c) => c.type === 'setItem');
  const values = items.map((child) => {
    const cp = propsOf<'setItem'>(child);
    if (cp.value === undefined) {
      throw new Error('setItem requires a `value=` prop');
    }
    return emitConstValue(child, cp.value, 'value');
  });

  return [...docs, `${exp}${kind} ${name}${typeAnn} = new Set([${values.join(', ')}]);`];
}

/** Emit the right-hand side of an expression-typed prop (e.g. `const.value`,
 *  `let.value`) from its raw IR form.
 *
 *  - `<prop>={{ expr }}` (ExprObject) — emit `.code` raw (escape hatch for arbitrary TS).
 *  - `<prop>="literal"` (quoted, tracked in __quotedProps) — emit as JSON-quoted string
 *    so output is valid TS even when the literal contains expression-illegal characters.
 *  - bare `<prop>=...` — try ValueIR parse + emit for canonicalization. Fall back to raw
 *    string on parse failure (validator emits INVALID_EXPRESSION but codegen still ships).
 *
 *  Slice 3e — `propName` parameter (default 'value') lets non-`value` props
 *  participate in the same quoted-vs-bare distinction. `mapEntry.key` and
 *  `mapEntry.value` both flow through this with their own __quotedProps key. */
export function emitConstValue(node: IRNode, rawValue: unknown, propName = 'value'): string {
  if (isExprObject(rawValue)) return rawValue.code;
  if (typeof rawValue !== 'string') return String(rawValue);
  if (node.__quotedProps?.includes(propName)) return JSON.stringify(rawValue);
  try {
    return emitExpression(parseExpression(rawValue));
  } catch {
    return rawValue;
  }
}

/**
 * Slice 3c — produce a TS parameter-list string from `param` child IR nodes.
 *
 * Mirrors `parseParamList` (which parses the legacy `params="..."` string)
 * but reads structured child nodes so each parameter's `value=` flows through
 * `emitConstValue` for ValueIR canonicalisation. Identifier/type annotations
 * are routed through the schema emitters so authored bad input raises
 * KernCodegenError instead of producing broken TS.
 *
 * Per child:
 *   - `value=` (slice 3c, ValueIR-canonicalised) — JSON-quoted for quoted
 *     string literals, parsed+re-emitted for bare expressions, raw for
 *     `{{...}}` ExprObject. Same routing as slice 3b field.value.
 *   - `default=` (rawExpr passthrough) — kept for back-compat / MCP usage.
 *   - When both set, `value` wins. The slice 3a/3b gate treats unquoted
 *     empty `value=` as absent so it doesn't trigger the
 *     `parseExpression('')` throw → empty fallback → `name: T = ;` bug.
 *
 * `options.stripDefaults`: TS forbids parameter initializers in overload
 * signatures — the implementation alone may carry defaults. Same flag as
 * the sibling `parseParamList`.
 */
export function parseParamListFromChildren(paramNodes: IRNode[], options?: { stripDefaults?: boolean }): string {
  if (paramNodes.length === 0) return '';
  return paramNodes
    .map((paramNode) => {
      const pp = propsOf<'param'>(paramNode);
      // Slice 3c-extension #3: destructured params via `binding`/`element`
      // children — the pattern (`{a, b}` / `[x, y]`) replaces the name in
      // the LHS. Slice 3d shares the same children, so the same formatter
      // serves both contexts. When a destructure pattern is present, `name=`
      // is ignored (and the importer omits it).
      const destructurePattern = formatBindingPatternFromChildren(paramNode);
      const rawName = destructurePattern ?? emitIdentifier(pp.name, 'parameter', paramNode);
      // Slice 3c-extension: TS-style variadic `...` prepended to name.
      const variadic = pp.variadic === true || pp.variadic === 'true' ? '...' : '';
      const pname = `${variadic}${rawName}`;
      // Slice 3c-extension: TS-style optional `?` between name and type.
      const optional = pp.optional === true || pp.optional === 'true' ? '?' : '';
      const typeAnn = pp.type ? `: ${emitTypeAnnotation(pp.type, 'unknown', paramNode)}` : '';

      if (options?.stripDefaults) return `${pname}${optional}${typeAnn}`;

      const rawValue = pp.value;
      const rawDefault = pp.default;
      const valuePresent =
        rawValue !== undefined && (rawValue !== '' || paramNode.__quotedProps?.includes('value') === true);

      if (valuePresent) {
        return `${pname}${optional}${typeAnn} = ${emitConstValue(paramNode, rawValue)}`;
      }
      if (rawDefault === undefined || rawDefault === '') return `${pname}${optional}${typeAnn}`;
      if (isExprObject(rawDefault)) return `${pname}${optional}${typeAnn} = ${rawDefault.code}`;
      return `${pname}${optional}${typeAnn} = ${rawDefault}`;
    })
    .join(', ');
}

/**
 * Slice 3c — unified TS parameter-list emitter for any callable IR node.
 *
 * Reads the node's `param` children first (canonical, ValueIR-routed). If
 * none, falls back to the legacy `params="..."` string. If neither, returns
 * the fallback (default empty).
 *
 * Children win when present. Mixed mode is intentionally unsupported — a
 * signature is either fully-structured-children or fully-legacy-string.
 * Producers (importer, migrate-class-body) emit children all-or-nothing
 * per signature; consumers don't need to reconcile partial states.
 */
export function emitParamList(node: IRNode, options?: { stripDefaults?: boolean; fallback?: string }): string {
  const paramChildren = kids(node, 'param');
  if (paramChildren.length > 0) {
    return parseParamListFromChildren(paramChildren, options);
  }
  const params = (p(node).params as string | undefined) ?? '';
  if (params) return parseParamList(params, options);
  return options?.fallback ?? '';
}
