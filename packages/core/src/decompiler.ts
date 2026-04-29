import { STYLE_SHORTHANDS, VALUE_SHORTHANDS } from './spec.js';
import type { DecompileResult, ExprObject, IRNode } from './types.js';

function expandKey(key: string): string {
  return STYLE_SHORTHANDS[key] || key;
}

function expandVal(val: string): string {
  return VALUE_SHORTHANDS[val] || val;
}

/**
 * Decompile an IR tree back to a human-readable text representation.
 *
 * Useful for debugging, diffing, and displaying IR to users. Expands style
 * shorthands and value aliases for readability.
 *
 * @param root - The root IRNode to decompile
 * @returns `{ code: string }` — the human-readable representation
 */
export function decompile(root: IRNode): DecompileResult {
  const lines: string[] = [];

  function render(node: IRNode, indent: string): void {
    if (!node.type) {
      lines.push(`${indent}[unknown node]`);
      return;
    }
    const props = node.props || {};

    // Canonical-grammar cases — emit re-parseable KERN. Other node types
    // still fall through to the debug-shape serializer below; make them
    // canonical in a follow-up PR.
    if (node.type === 'each') {
      renderEach(node, indent);
      return;
    }
    if (node.type === 'let') {
      renderLet(node, indent);
      return;
    }
    if (node.type === 'field') {
      renderField(node, indent);
      return;
    }
    if (node.type === 'param') {
      renderParam(node, indent);
      return;
    }
    if (node.type === 'destructure') {
      renderDestructure(node, indent);
      return;
    }
    if (node.type === 'binding' || node.type === 'element') {
      // Standalone render path — only hit when these appear outside a
      // `destructure` parent. Inside a parent, `renderDestructure` handles
      // them inline.
      renderDestructureChild(node, indent);
      return;
    }
    if (node.type === 'mapLit') {
      renderMapLit(node, indent);
      return;
    }
    if (node.type === 'setLit') {
      renderSetLit(node, indent);
      return;
    }
    if (node.type === 'mapEntry' || node.type === 'setItem') {
      // Children of mapLit/setLit — handled inline by their parent renderer.
      // Standalone render path covers the orphan case for completeness.
      renderMapSetChild(node, indent);
      return;
    }

    const name = (props.name as string) || '';
    const type = node.type.charAt(0).toUpperCase() + node.type.slice(1);

    // Style description
    const styles =
      props.styles && typeof props.styles === 'object' && !Array.isArray(props.styles)
        ? (props.styles as Record<string, string>)
        : undefined;
    const styleDesc = styles
      ? Object.entries(styles)
          .map(([k, v]) => `${expandKey(k)}: ${expandVal(String(v))}`)
          .join(', ')
      : '';

    // Props (excluding internal keys)
    const propEntries = Object.entries(props)
      .filter(([k]) => k !== 'styles' && k !== 'pseudoStyles' && k !== 'themeRefs')
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(', ');

    let desc = `${indent}${type}`;
    if (name) desc += ` "${name}"`;
    if (propEntries) desc += ` (${propEntries})`;
    if (styleDesc) desc += ` [${styleDesc}]`;

    const themeRefs = props.themeRefs as string[] | undefined;
    if (themeRefs?.length) desc += ` inherits ${themeRefs.map((r) => `$${r}`).join(', ')}`;

    lines.push(desc);

    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderLet(node: IRNode, indent: string): void {
    const props = node.props || {};
    const name = (props.name as string) || 'binding';
    // Codex hold #3: prefer `value=` if the let node carries one (slice 3a).
    // Without this, a let authored with `value=42` would round-trip to
    // `expr=""` and lose its assignment entirely.
    const rawValue = props.value;
    const rawExpr = props.expr;
    const t = props.type as string | undefined;
    const parts: string[] = [`let name=${name}`];
    if (rawValue !== undefined) {
      const valueText =
        typeof rawValue === 'object' && (rawValue as ExprObject).__expr
          ? `{{${(rawValue as ExprObject).code}}}`
          : JSON.stringify(rawValue as string);
      parts.push(`value=${valueText}`);
    } else {
      const expr =
        rawExpr && typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
          ? (rawExpr as ExprObject).code
          : (rawExpr as string) || '';
      parts.push(`expr=${JSON.stringify(expr)}`);
    }
    if (t) parts.push(`type=${t}`);
    lines.push(`${indent}${parts.join(' ')}`);
    // `let` has no children in normal use, but preserve generic recursion.
    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderField(node: IRNode, indent: string): void {
    // Slice 3b: emit `field` re-parseably so canonical `value={{...}}` forms
    // survive the IR → text round-trip. Without this, the generic JSON.stringify
    // path would emit `value={"__expr":true,"code":"foo()"}` for any class field
    // imported from TS — un-re-parseable.
    //
    // String prop emission honours __quotedProps so a bare `value=42` (numeric
    // literal) round-trips as bare and codegens to `42`, whereas a quoted
    // `value="42"` round-trips quoted and codegens to `"42"` (string literal).
    // Without this distinction, all bare values would gain spurious quotes on
    // every decompile + re-parse cycle.
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'field';
    const parts: string[] = [`field name=${name}`];

    function renderStringProp(propName: string, raw: string | ExprObject): string {
      if (typeof raw === 'object' && (raw as ExprObject).__expr) {
        return `${propName}={{${(raw as ExprObject).code}}}`;
      }
      const s = raw as string;
      // Bare-emit only when the source was unquoted AND the value matches a
      // strict whitelist of identifier-shape characters (alphanumeric, `_`,
      // `.`, `-`). Codex hold #2: a permissive blacklist (e.g. `/[\s=]/`)
      // would emit values like `'draft'|'done'` or `{id:string}` bare, which
      // the parser then truncates at the embedded quote or treats as a
      // style block. The whitelist covers numeric literals, identifiers, and
      // dotted member chains — the cases ValueIR canonicalises — and forces
      // JSON.stringify on anything else (type unions, object shorthands,
      // strings with punctuation, etc.).
      const wasQuoted = quoted.includes(propName);
      const safeBare = !wasQuoted && s !== '' && /^[\w.-]+$/.test(s);
      return `${propName}=${safeBare ? s : JSON.stringify(s)}`;
    }

    const t = props.type as string | undefined;
    if (t !== undefined) parts.push(renderStringProp('type', t));
    const opt = props.optional;
    if (opt === true || opt === 'true') parts.push('optional=true');
    const priv = props.private;
    if (priv === true || priv === 'true') parts.push('private=true');
    const ro = props.readonly;
    if (ro === true || ro === 'true') parts.push('readonly=true');
    const stat = props.static;
    if (stat === true || stat === 'true') parts.push('static=true');

    const rawValue = props.value as string | ExprObject | undefined;
    const rawDefault = props.default as string | ExprObject | undefined;
    if (rawValue !== undefined) {
      parts.push(renderStringProp('value', rawValue));
    } else if (rawDefault !== undefined) {
      parts.push(renderStringProp('default', rawDefault));
    }

    lines.push(`${indent}${parts.join(' ')}`);
    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderParam(node: IRNode, indent: string): void {
    // Slice 3c: emit `param` re-parseably so canonical `value={{...}}` forms
    // (and ValueIR-canonicalised bare values) survive IR → text round-trip.
    // Mirrors renderField — same __quotedProps-aware bare/quoted policy.
    //
    // `param` is used in two contexts: (a) MCP tool/resource/prompt params
    // (description/required/min/max apply); (b) fn/method/constructor
    // parameter defaults via slice 3c (value/default apply). Both share this
    // emitter so a node round-trips correctly regardless of parent context.
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    // Slice 3c-extension #3: destructured params omit `name=`; the LHS pattern
    // is encoded in `binding`/`element` children. Detect by child presence so
    // round-trips of importer-emitted destructured params don't gain a bogus
    // `name=param` attribute that would re-parse to a `param name="param"`.
    const hasDestructure = (node.children ?? []).some((c) => c.type === 'binding' || c.type === 'element');
    const name = props.name as string | undefined;
    const parts: string[] = ['param'];
    if (!hasDestructure && name) parts[0] = `param name=${name}`;
    else if (!hasDestructure) parts[0] = 'param name=param';

    function renderStringProp(propName: string, raw: string | ExprObject): string {
      if (typeof raw === 'object' && (raw as ExprObject).__expr) {
        return `${propName}={{${(raw as ExprObject).code}}}`;
      }
      const s = raw as string;
      // Bare-emit only when source was unquoted AND value matches the
      // identifier-shape whitelist (mirrors renderField — see Codex hold #2).
      const wasQuoted = quoted.includes(propName);
      const safeBare = !wasQuoted && s !== '' && /^[\w.-]+$/.test(s);
      return `${propName}=${safeBare ? s : JSON.stringify(s)}`;
    }

    const t = props.type as string | undefined;
    if (t !== undefined) parts.push(renderStringProp('type', t));
    const required = props.required;
    if (required === true || required === 'true') parts.push('required=true');
    // Slice 3c-extension: TS-style optional `?` round-trips via `optional=true`.
    const optional = props.optional;
    if (optional === true || optional === 'true') parts.push('optional=true');
    // Slice 3c-extension: TS-style variadic `...` round-trips via `variadic=true`.
    const variadic = props.variadic;
    if (variadic === true || variadic === 'true') parts.push('variadic=true');

    const rawValue = props.value as string | ExprObject | undefined;
    const rawDefault = props.default as string | ExprObject | undefined;
    if (rawValue !== undefined) {
      parts.push(renderStringProp('value', rawValue));
    } else if (rawDefault !== undefined) {
      parts.push(renderStringProp('default', rawDefault));
    }

    const description = props.description;
    if (typeof description === 'string') parts.push(`description=${JSON.stringify(description)}`);
    const min = props.min;
    if (min !== undefined) parts.push(`min=${min}`);
    const max = props.max;
    if (max !== undefined) parts.push(`max=${max}`);

    lines.push(`${indent}${parts.join(' ')}`);
    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  function renderDestructure(node: IRNode, indent: string): void {
    // Slice 3d: emit `destructure` re-parseably so structured `binding`/
    // `element` children plus the `expr={{...}}` escape hatch survive
    // IR → text round-trip. Mirrors renderParam's __quotedProps-aware
    // bare-vs-quoted policy on `source`.
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const parts: string[] = ['destructure'];

    // Escape-hatch path: raw statement carried verbatim. When present, all
    // other props are ignored (codegen also ignores them — see generateDestructure).
    const rawExpr = props.expr as string | ExprObject | undefined;
    if (rawExpr !== undefined) {
      if (typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr) {
        parts.push(`expr={{${(rawExpr as ExprObject).code}}}`);
      } else {
        parts.push(`expr=${JSON.stringify(rawExpr)}`);
      }
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }

    const kind = props.kind as string | undefined;
    if (kind && kind !== 'const') parts.push(`kind=${kind}`);

    const t = props.type as string | undefined;
    if (t !== undefined) {
      const wasQuoted = quoted.includes('type');
      const safeBare = !wasQuoted && /^[\w.<>[\]|&,\s-]+$/.test(t) && !/\s/.test(t.trim());
      parts.push(`type=${safeBare ? t : JSON.stringify(t)}`);
    }

    const rawSource = props.source as string | ExprObject | undefined;
    if (rawSource !== undefined) {
      if (typeof rawSource === 'object' && (rawSource as ExprObject).__expr) {
        parts.push(`source={{${(rawSource as ExprObject).code}}}`);
      } else {
        const s = rawSource as string;
        const wasQuoted = quoted.includes('source');
        const safeBare = !wasQuoted && /^[\w.-]+$/.test(s);
        parts.push(`source=${safeBare ? s : JSON.stringify(s)}`);
      }
    }

    const exported = props.export;
    if (exported === true || exported === 'true') parts.push('export=true');

    lines.push(`${indent}${parts.join(' ')}`);

    if (node.children) {
      for (const child of node.children) {
        renderDestructureChild(child, `${indent}  `);
      }
    }
  }

  function renderDestructureChild(node: IRNode, indent: string): void {
    const props = node.props || {};
    const name = (props.name as string) || '?';
    if (node.type === 'binding') {
      const parts: string[] = [`binding name=${name}`];
      const key = props.key as string | undefined;
      if (key) parts.push(`key=${key}`);
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }
    if (node.type === 'element') {
      const parts: string[] = [`element name=${name}`];
      const idx = props.index;
      if (idx !== undefined) parts.push(`index=${idx}`);
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }
    // Unknown — should never hit; fall through to generic render.
    render(node, indent);
  }

  function renderMapLit(node: IRNode, indent: string): void {
    // Slice 3e: emit `mapLit` re-parseably with `mapEntry` children inline.
    // Mirrors renderDestructure escape-hatch + __quotedProps policy.
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'unknownMap';
    const parts: string[] = [`mapLit name=${name}`];

    // Escape-hatch path — raw statement carried verbatim. Other props ignored.
    const rawExpr = props.expr as string | ExprObject | undefined;
    if (rawExpr !== undefined) {
      const exprText =
        typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
          ? `{{${(rawExpr as ExprObject).code}}}`
          : JSON.stringify(rawExpr);
      lines.push(`${indent}mapLit name=${name} expr=${exprText}`);
      return;
    }

    const t = props.type as string | undefined;
    if (t !== undefined) {
      const wasQuoted = quoted.includes('type');
      const safeBare = !wasQuoted && /^[\w.<>[\]|&,\s-]+$/.test(t) && !/\s/.test(t.trim());
      parts.push(`type=${safeBare ? t : JSON.stringify(t)}`);
    }
    const kind = props.kind as string | undefined;
    if (kind && kind !== 'const') parts.push(`kind=${kind}`);
    if (props.export === true || props.export === 'true') parts.push('export=true');

    lines.push(`${indent}${parts.join(' ')}`);
    if (node.children) {
      for (const child of node.children) {
        renderMapSetChild(child, `${indent}  `);
      }
    }
  }

  function renderSetLit(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];
    const name = (props.name as string) || 'unknownSet';
    const parts: string[] = [`setLit name=${name}`];

    const rawExpr = props.expr as string | ExprObject | undefined;
    if (rawExpr !== undefined) {
      const exprText =
        typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
          ? `{{${(rawExpr as ExprObject).code}}}`
          : JSON.stringify(rawExpr);
      lines.push(`${indent}setLit name=${name} expr=${exprText}`);
      return;
    }

    const t = props.type as string | undefined;
    if (t !== undefined) {
      const wasQuoted = quoted.includes('type');
      const safeBare = !wasQuoted && /^[\w.<>[\]|&,\s-]+$/.test(t) && !/\s/.test(t.trim());
      parts.push(`type=${safeBare ? t : JSON.stringify(t)}`);
    }
    const kind = props.kind as string | undefined;
    if (kind && kind !== 'const') parts.push(`kind=${kind}`);
    if (props.export === true || props.export === 'true') parts.push('export=true');

    lines.push(`${indent}${parts.join(' ')}`);
    if (node.children) {
      for (const child of node.children) {
        renderMapSetChild(child, `${indent}  `);
      }
    }
  }

  function renderMapSetChild(node: IRNode, indent: string): void {
    const props = node.props || {};
    const quoted = node.__quotedProps ?? [];

    function renderExprProp(propName: string, raw: unknown): string {
      if (typeof raw === 'object' && raw !== null && (raw as ExprObject).__expr) {
        return `${propName}={{${(raw as ExprObject).code}}}`;
      }
      const s = raw as string;
      const wasQuoted = quoted.includes(propName);
      const safeBare = !wasQuoted && typeof s === 'string' && s !== '' && /^[\w.-]+$/.test(s);
      return `${propName}=${safeBare ? s : JSON.stringify(s)}`;
    }

    if (node.type === 'mapEntry') {
      const key = props.key;
      const val = props.value;
      const parts: string[] = ['mapEntry'];
      if (key !== undefined) parts.push(renderExprProp('key', key));
      if (val !== undefined) parts.push(renderExprProp('value', val));
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }
    if (node.type === 'setItem') {
      const val = props.value;
      const parts: string[] = ['setItem'];
      if (val !== undefined) parts.push(renderExprProp('value', val));
      lines.push(`${indent}${parts.join(' ')}`);
      return;
    }
    render(node, indent);
  }

  function renderEach(node: IRNode, indent: string): void {
    const props = node.props || {};
    const name = (props.name as string) || 'item';
    const rawIn = props.in;
    const inExpr =
      rawIn && typeof rawIn === 'object' && (rawIn as ExprObject).__expr
        ? (rawIn as ExprObject).code
        : (rawIn as string) || '';
    const index = (props.index as string) || '';
    const rawKey = props.key;
    const keyExpr =
      rawKey && typeof rawKey === 'object' && (rawKey as ExprObject).__expr
        ? (rawKey as ExprObject).code
        : typeof rawKey === 'string'
          ? rawKey
          : '';

    const parts: string[] = [`each name=${name}`, `in=${JSON.stringify(inExpr)}`];
    if (index) parts.push(`index=${index}`);
    if (keyExpr) parts.push(`key=${JSON.stringify(keyExpr)}`);
    lines.push(`${indent}${parts.join(' ')}`);

    if (node.children) {
      for (const child of node.children) {
        render(child, `${indent}  `);
      }
    }
  }

  render(root, '');
  return { code: lines.join('\n') };
}
