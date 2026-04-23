/**
 * Screen codegen — generates React/Ink components from KERN `screen` nodes.
 *
 * KERN syntax:
 *   screen name=MyComponent target=ink
 *     prop name=title type=string
 *     prop name=count type=number optional=true
 *     state name=value type=string initial="''"
 *     state name=open type=boolean initial="false"
 *     effect <<<
 *       // useEffect body
 *     >>>
 *     render <<<
 *       <Box><Text>{title}</Text></Box>
 *     >>>
 *
 * Generates:
 *   import React, { useState, useEffect, useCallback, useRef } from 'react';
 *   import { Box, Text, useInput, useApp } from 'ink';
 *
 *   export function MyComponent({ title, count }: { title: string; count?: number }) {
 *     const [value, setValue] = useState('');
 *     const [open, setOpen] = useState(false);
 *     useEffect(() => { ... }, []);
 *     return (<Box><Text>{title}</Text></Box>);
 *   }
 */

import { KernCodegenError } from '../errors.js';
import type { ExprObject, IRNode } from '../types.js';
import { emitIdentifier, emitTypeAnnotation } from './emitters.js';
import { exportPrefix, getChildren, getFirstChild, getProps } from './helpers.js';

type ScreenProps = {
  name?: string;
  target?: string;
  export?: string | boolean;
};

type PropChild = {
  name: string;
  type: string;
  optional?: boolean;
  default?: string;
};

function propsOf(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

/**
 * Detect whether a useState initial value needs lazy initialization.
 * IIFEs and function expressions re-evaluate on every render when passed
 * directly to useState(). Wrapping as useState(() => expr) fixes this.
 */
function needsLazyInit(initial: string, type?: string): boolean {
  const trimmed = initial.trim();
  // IIFE: ((...) => ...)() or (function() { ... })()
  if (/^\(.*\)\s*\(/.test(trimmed)) return true;
  // function expression: function( — executes when called, needs lazy wrap
  if (trimmed.startsWith('function(') || trimmed.startsWith('function (')) return true;
  // new constructor: new Map(), new Set(), etc. — creates a new instance per render
  if (trimmed.startsWith('new ')) return true;
  // Arrow functions: only wrap if the state TYPE is a function (state holds a function value).
  // Without this, React treats () => x as a lazy initializer and stores x instead of the function.
  // With a non-function type, the arrow IS the lazy initializer — don't double-wrap.
  if (/^\(?[^)]*\)?\s*=>/.test(trimmed) && type && /=>/.test(type)) return true;
  return false;
}

function handlerContent(node: IRNode): string {
  const handler = getChildren(node, 'handler')[0];
  if (handler) {
    const hp = propsOf(handler);
    return (hp.code as string) || (hp.body as string) || '';
  }
  // Check for inline body/code prop
  const p = propsOf(node);
  return (p.code as string) || (p.body as string) || '';
}

export function generateScreen(node: IRNode): string[] {
  const props = getProps(node) as unknown as ScreenProps;
  const name = emitIdentifier(props.name, 'UnnamedScreen', node);
  const _target = props.target || 'ink';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Collect children
  const propNodes = getChildren(node, 'prop');
  const stateNodes = getChildren(node, 'state');
  const effectNodes = getChildren(node, 'effect');
  const renderNode = getFirstChild(node, 'render');
  const callbackNodes = getChildren(node, 'callback');
  const memoNodes = getChildren(node, 'memo');
  const refNodes = getChildren(node, 'ref');
  const onInputNodes = getChildren(node, 'on').filter((n) => {
    const p = propsOf(n);
    return p.event === 'input';
  });

  // Don't emit imports here — KERN import nodes at file level handle React/Ink imports.
  // Screen codegen only emits the component function. This avoids duplicate imports
  // when multiple screens are in one file.
  //
  // Files MUST have: import from="ink" names="Box,Text"
  // If hooks are used, the file needs: import from="react" names="React,useState,useEffect,..."
  lines.push('');

  // Parse props
  const componentProps: PropChild[] = propNodes.map((n) => {
    const p = propsOf(n);
    return {
      name: emitIdentifier(p.name as string, 'unknown', n),
      type: (p.type as string) || 'any',
      optional: p.optional === true || p.optional === 'true',
      default: p.default as string | undefined,
    };
  });

  // Props type
  const propsTypeEntries = componentProps.map((p) => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join('; ');

  // Destructure with defaults
  const destructure = componentProps.map((p) => (p.default ? `${p.name} = ${p.default}` : p.name)).join(', ');

  // Function signature
  lines.push(`${exp}function ${name}({ ${destructure} }: { ${propsTypeEntries} }) {`);

  emitStateDecls(stateNodes, lines);
  emitRefDecls(refNodes, lines);
  if (stateNodes.length > 0 || refNodes.length > 0) lines.push('');
  emitMemos(memoNodes, lines);
  emitCallbacks(callbackNodes, lines);
  emitEffects(effectNodes, lines);
  emitInputHandlers(onInputNodes, lines);
  emitRender(renderNode, lines);

  lines.push('}');
  lines.push('');

  return lines;
}

// ── Hook generation helpers (extracted from generateScreen) ─────────────

function emitStateDecls(nodes: IRNode[], lines: string[]): void {
  for (const sn of nodes) {
    const sp = propsOf(sn);
    const sName = emitIdentifier(sp.name as string, 'state', sn);
    const sType = (sp.type as string) || 'any';
    const sInitial = (sp.initial as string) || 'undefined';
    const setter = `set${sName.charAt(0).toUpperCase()}${sName.slice(1)}`;
    const useLazy = needsLazyInit(sInitial, sType);
    const initExpr = useLazy ? `() => ${sInitial}` : sInitial;
    lines.push(`  const [${sName}, ${setter}] = useState<${sType}>(${initExpr});`);
  }
}

function emitRefDecls(nodes: IRNode[], lines: string[]): void {
  for (const rn of nodes) {
    const rp = propsOf(rn);
    const rName = emitIdentifier(rp.name as string, 'ref', rn);
    const rType = (rp.type as string) || 'any';
    const rInitial = (rp.initial as string) || 'null';
    lines.push(`  const ${rName} = useRef<${rType}>(${rInitial});`);
  }
}

function emitMemos(nodes: IRNode[], lines: string[]): void {
  for (const mn of nodes) {
    const mp = propsOf(mn);
    const mName = emitIdentifier(mp.name as string, 'memo', mn);
    const mDeps = (mp.deps as string) || '';
    const mDepsArr = mDeps && mDeps !== '[]' ? `[${mDeps}]` : '[]';
    const body = handlerContent(mn);
    lines.push(`  const ${mName} = useMemo(() => {`);
    for (const line of body.split('\n')) lines.push(`    ${line}`);
    lines.push(`  }, ${mDepsArr});`);
    lines.push('');
  }
}

function emitCallbacks(nodes: IRNode[], lines: string[]): void {
  for (const cn of nodes) {
    const cp = propsOf(cn);
    const cName = emitIdentifier(cp.name as string, 'handler', cn);
    const cParams = (cp.params as string) || '';
    const cDeps = (cp.deps as string) || '';
    const cDepsArr = cDeps && cDeps !== '[]' ? `[${cDeps}]` : '[]';
    const isAsync = cp.async === true || cp.async === 'true';
    const body = handlerContent(cn);
    lines.push(`  const ${cName} = useCallback(${isAsync ? 'async ' : ''}${cParams ? `(${cParams})` : '()'} => {`);
    for (const line of body.split('\n')) lines.push(`    ${line}`);
    lines.push(`  }, ${cDepsArr});`);
    lines.push('');
  }
}

function emitEffects(nodes: IRNode[], lines: string[]): void {
  for (const en of nodes) {
    const ep = propsOf(en);
    const eDeps = (ep.deps as string) || '';
    const eDepsArr = eDeps && eDeps !== '[]' ? `[${eDeps}]` : '[]';
    const body = handlerContent(en);
    lines.push(`  useEffect(() => {`);
    for (const line of body.split('\n')) lines.push(`    ${line}`);
    lines.push(`  }, ${eDepsArr});`);
    lines.push('');
  }
}

function emitInputHandlers(nodes: IRNode[], lines: string[]): void {
  for (const onNode of nodes) {
    const body = handlerContent(onNode);
    lines.push(`  const _inputHandlerRef = useRef<(input: string, key: any) => void>(() => {});`);
    lines.push(`  _inputHandlerRef.current = (input: string, key: any) => {`);
    for (const line of body.split('\n')) lines.push(`    ${line}`);
    lines.push(`  };`);
    lines.push(`  useInput((input: string, key: any) => _inputHandlerRef.current(input, key));`);
    lines.push('');
  }
}

// JSX-composable child types inside a `render` block. Only these trigger the
// declarative-composition path. Metadata-only children (doc, reason, needs, ...)
// must NOT force composition — their sibling handler owns the render body and
// should continue through the raw-handler passthrough below.
const RENDER_JSX_CHILD_TYPES = new Set<string>(['each', 'conditional', 'group']);

/**
 * Emit the render body — return-statement + JSX — into `lines`. Exported so
 * target-specific transpilers (Ink, Vue, etc.) can delegate the composed-mode
 * walk (wrapper / each / conditional / local) to a single source of truth
 * rather than re-implementing it per target.
 *
 * Terminal target uses this for screens where the author supplied either
 * `render wrapper="..."` or a JSX-composable child (each, conditional) or
 * a `local` binding — all three trigger composed mode.
 */
export function emitRender(renderNode: IRNode | undefined, lines: string[]): void {
  if (!renderNode) {
    lines.push(`  return null;`);
    return;
  }

  const hasJsxChild = getChildren(renderNode).some(
    (c) => RENDER_JSX_CHILD_TYPES.has(c.type) || (c.type === 'fmt' && isFmtInlineForm(c)),
  );
  const hasWrapper = !!propsOf(renderNode).wrapper;
  // A `local` child alone implies the author wants composed mode even if no
  // each/conditional is present — the locals need to hoist as statements and
  // the JSX return needs to be constructed, not passed through as raw handler.
  const hasLocal = getChildren(renderNode, 'local').length > 0;
  if (hasJsxChild || hasWrapper || hasLocal) {
    emitRenderComposed(renderNode, lines);
    return;
  }

  const body = handlerContent(renderNode);
  const trimmed = body.trim();
  if (trimmed.includes('return ') || trimmed.includes('return(')) {
    for (const line of body.split('\n')) lines.push(`  ${line}`);
  } else {
    lines.push(`  return (`);
    for (const line of body.split('\n')) lines.push(`    ${line}`);
    lines.push(`  );`);
  }
}

/**
 * Extract the tag name from a wrapper string like `<Box paddingX={1}>` → `Box`.
 * Returns undefined if the input isn't a recognizable opening tag.
 */
function extractWrapperTag(wrapper: string): string | undefined {
  const match = wrapper.trim().match(/^<([A-Za-z_][A-Za-z0-9_.]*)/);
  return match?.[1];
}

/**
 * Compose a render block from declarative KERN children (each, conditional,
 * local, handler). Emits:
 *
 *   [local bindings at screen-function scope]
 *   return (
 *     [wrapper open OR <>]
 *       [each / conditional / handler pieces]
 *     [wrapper close OR </>]
 *   );
 *
 * When a `wrapper="<Tag attrs>"` prop is present the wrapper tag replaces the
 * default Fragment; the tag name is extracted from the string so `</Tag>` can
 * be emitted correctly. When `local` children are present their `const name =
 * expr;` bindings hoist ABOVE the return so sibling JSX can close over them.
 */
function emitRenderComposed(renderNode: IRNode, lines: string[]): void {
  // Step 1: emit local bindings at screen-function scope, before the return.
  // Locals are expression-only; a handler-bodied "local" would be ambiguous
  // (too close to derive/memo) and is rejected by the validator.
  const localNodes = getChildren(renderNode, 'local');
  for (const localNode of localNodes) {
    lines.push(`  ${renderLocalBinding(localNode)}`);
  }

  // Step 2: collect JSX pieces from non-local children in source order.
  const pieces = collectComposedPieces(renderNode);

  // Step 3: decide between wrapper tag and Fragment.
  const wrapper = propsOf(renderNode).wrapper as string | undefined;
  const openTag = wrapper?.trim();
  const tagName = openTag ? extractWrapperTag(openTag) : undefined;
  const closeTag = tagName ? `</${tagName}>` : '</>';
  const openEmit = openTag ?? '<>';

  lines.push(`  return (`);
  lines.push(`    ${openEmit}`);
  for (const piece of pieces) {
    for (const line of piece) lines.push(`      ${line}`);
  }
  lines.push(`    ${closeTag}`);
  lines.push(`  );`);
}

/**
 * Walk the JSX-composable children of a `render` or `group` node in source
 * order and return each child's rendered JSX lines. Shared by the render-root
 * composer and the recursive `group` composer so nesting works uniformly.
 *
 * Skips `local` and metadata children — locals hoist at render scope (handled
 * before the return by `emitRenderComposed`), and metadata doesn't produce
 * JSX. `group` children recurse through `generateGroupJSX`. A `fmt` child
 * with no `name` and no `return=true` is the inline-JSX form: it emits as
 * `{\`${template}\`}` and stands in for a handler-wrapped interpolated
 * text node.
 */
function collectComposedPieces(parent: IRNode): string[][] {
  const pieces: string[][] = [];
  for (const child of getChildren(parent)) {
    if (child.type === 'each') {
      pieces.push(generateEachJSX(child));
    } else if (child.type === 'conditional') {
      pieces.push(generateConditionalJSX(child));
    } else if (child.type === 'group') {
      pieces.push(generateGroupJSX(child));
    } else if (child.type === 'fmt' && isFmtInlineForm(child)) {
      pieces.push([generateFmtInline(child)]);
    } else if (child.type === 'handler') {
      // In composed mode the handler contributes a JSX fragment, not a
      // `return`-wrapped expression. Strip a leading `return (...);` so authors
      // can reuse the same handler shape as non-composed renders.
      const raw = (propsOf(child).code as string) || '';
      pieces.push(stripReturnWrapper(raw).split('\n'));
    }
    // local + metadata children skipped here. A `fmt` child with `name=` or
    // `return=true` also falls through here — those are statement-form and
    // get dispatched by the core codegen when they appear at the right scope,
    // not inside a composed-JSX walk.
  }
  return pieces;
}

/**
 * True when a `fmt` node is in its inline-JSX form — no `name`, no
 * `return=true`. That form only makes sense as a direct child of
 * `render`/`group` where it emits `{\`${template}\`}` as a JSX expression.
 */
function isFmtInlineForm(node: IRNode): boolean {
  const p = propsOf(node);
  const returnMode = p.return === true || p.return === 'true';
  return !returnMode && p.name === undefined;
}

/**
 * Emit an inline-JSX `fmt` as a single line: `{\`${template}\`}`. Reuses the
 * same backtick-escape rule as the statement-form `generateFmt` so a raw
 * backtick in the template can't close the literal.
 */
function generateFmtInline(node: IRNode): string {
  const template = propsOf(node).template;
  if (template === undefined || template === null) {
    throw new KernCodegenError("fmt node requires a 'template' prop", node);
  }
  const escaped = String(template).replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return `{\`${escaped}\`}`;
}

/**
 * Emit a `group wrapper="<Tag attrs>"` node as nested JSX inside a composed
 * render. Unlike `render`, `group` has no locals to hoist — its only job is
 * to wrap a subset of sibling JSX pieces in an inner tag. Recurses through
 * `collectComposedPieces` so `group` inside `group` composes arbitrarily
 * deep.
 *
 *   group wrapper="<Box paddingLeft={2}>"
 *     handler <<< <Header /> >>>
 *     each name=item in=items
 *       handler <<< <Row item={item} /> >>>
 *
 *   →
 *
 *   <Box paddingLeft={2}>
 *     <Header />
 *     {(items).map((item, __i) => (
 *       <React.Fragment key={...}>
 *         <Row item={item} />
 *       </React.Fragment>
 *     ))}
 *   </Box>
 */
function generateGroupJSX(node: IRNode): string[] {
  const wrapper = propsOf(node).wrapper as string | undefined;
  const openTag = wrapper?.trim();
  if (!openTag) {
    throw new KernCodegenError("group node requires a 'wrapper' prop", node);
  }
  const tagName = extractWrapperTag(openTag);
  if (!tagName) {
    throw new KernCodegenError(
      `group wrapper="${openTag}" is not a recognizable opening tag (expected "<Tag …>")`,
      node,
    );
  }
  const closeTag = `</${tagName}>`;

  const pieces = collectComposedPieces(node);
  const lines: string[] = [openTag];
  for (const piece of pieces) {
    for (const line of piece) lines.push(`  ${line}`);
  }
  lines.push(closeTag);
  return lines;
}

/**
 * Emit a `local` node as a `const name[: type] = expr;` line at screen scope.
 * Mirrors the `let` iteration binding but at render scope rather than inside
 * the `each` callback. Expression-only by design — for hook-driven values use
 * `memo` / `callback` above the render.
 */
function renderLocalBinding(node: IRNode): string {
  const lp = propsOf(node);
  const lname = emitIdentifier(lp.name as string, 'binding', node);
  const rawExpr = lp.expr;
  const expr =
    rawExpr && typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
      ? (rawExpr as ExprObject).code
      : (rawExpr as string) || '';
  if (!expr) {
    throw new KernCodegenError("local node requires an 'expr' prop", node);
  }
  const t = lp.type as string | undefined;
  const typeAnn = t ? `: ${emitTypeAnnotation(t, 'unknown', node)}` : '';
  return `const ${lname}${typeAnn} = ${expr};`;
}

/**
 * If a handler body is shaped like `return (<...>);` or `return <...>;`, return
 * just the inner JSX so it can be embedded inside a fragment. Otherwise return
 * the body unchanged.
 */
function stripReturnWrapper(code: string): string {
  const trimmed = code.trim();
  const parenReturn = trimmed.match(/^return\s*\(([\s\S]*)\)\s*;?\s*$/m);
  if (parenReturn) return parenReturn[1].trim();
  const bareReturn = trimmed.match(/^return\s+([\s\S]*?)\s*;?\s*$/m);
  if (bareReturn && !trimmed.includes('\n')) return bareReturn[1].trim();
  return code;
}

/**
 * JSX-expression form of `each`.
 *
 * - With no `let` children: emits the expression-arrow form
 *     `(coll).map((name, i) => <React.Fragment key={...}>...</React.Fragment>)`.
 * - With `let` children: emits a block-arrow form that threads each `let` as a
 *   plain `const` inside the callback, then returns the fragment:
 *     `(coll).map((name, i) => { const x = ...; const y = ...; return (<React.Fragment key={...}>...</React.Fragment>); })`.
 *
 * Authors choose: put iteration-scoped bindings as `let` children (declarative,
 * toolable), or inline them inside the handler (still works for simple shapes
 * but not recommended for multi-statement callbacks).
 *
 * Auto-key: when `key=` is not supplied, emits a fallback chain
 * `((<name> as { id?: React.Key; key?: React.Key }).id ?? (<name> as { id?:
 * React.Key; key?: React.Key }).key ?? <index>)`. The inline cast makes the
 * auto-key tolerant of typed element arrays whose declared type omits one or
 * both of `id` / `key` — without the cast, TypeScript would raise TS2339 on
 * the missing field. Authors who want a cleaner emit can always pass an
 * explicit `key=` prop, which bypasses the fallback entirely.
 */
function generateEachJSX(node: IRNode): string[] {
  const props = propsOf(node);
  const name = (props.name as string) || 'item';
  const rawCollection = props.in;
  const collection =
    rawCollection && typeof rawCollection === 'object' && (rawCollection as ExprObject).__expr
      ? (rawCollection as ExprObject).code
      : (rawCollection as string);
  if (!collection) throw new KernCodegenError("each node requires an 'in' prop", node);

  const index = (props.index as string) || '__i';
  const rawKey = props.key;
  const keyExpr =
    rawKey && typeof rawKey === 'object' && (rawKey as ExprObject).__expr
      ? (rawKey as ExprObject).code
      : typeof rawKey === 'string'
        ? rawKey
        : '';
  const autoKeyCast = `(${name} as { id?: React.Key; key?: React.Key })`;
  const effectiveKey = keyExpr || `${autoKeyCast}.id ?? ${autoKeyCast}.key ?? ${index}`;

  const handler = getFirstChild(node, 'handler');
  if (!handler) {
    throw new KernCodegenError(
      'each inside a render block requires a `handler <<<>>>` child with the per-item JSX',
      node,
    );
  }
  const body = (propsOf(handler).code as string) || '';
  // Handler body is embedded inside the React.Fragment. If the author wrote a
  // full `return (...);` wrapper, strip it so it composes cleanly.
  const bodyLines = stripReturnWrapper(body).split('\n');

  const letChildren = getChildren(node, 'let');

  const lines: string[] = [];
  if (letChildren.length === 0) {
    // Expression-arrow form.
    lines.push(`{(${collection}).map((${name}, ${index}) => (`);
    lines.push(`  <React.Fragment key={${effectiveKey}}>`);
    for (const line of bodyLines) lines.push(`    ${line}`);
    lines.push(`  </React.Fragment>`);
    lines.push(`))}`);
    return lines;
  }

  // Block-arrow form — emit let bindings as consts, then return the fragment.
  lines.push(`{(${collection}).map((${name}, ${index}) => {`);
  for (const letNode of letChildren) {
    lines.push(`  ${renderLetBinding(letNode)}`);
  }
  lines.push(`  return (`);
  lines.push(`    <React.Fragment key={${effectiveKey}}>`);
  for (const line of bodyLines) lines.push(`      ${line}`);
  lines.push(`    </React.Fragment>`);
  lines.push(`  );`);
  lines.push(`})}`);
  return lines;
}

/**
 * JSX-expression form of `conditional` inside a render block.
 *
 *   conditional if="loading"          → `{loading && (<Spinner />)}`
 *     handler <<< <Spinner /> >>>
 *
 *   conditional if="loading"          → `{loading ? (<Spinner />) : (<Content />)}`
 *     handler <<< <Spinner /> >>>
 *     else
 *       handler <<< <Content /> >>>
 *
 *   conditional if="loading"          → `{loading ? (<Spinner />) : error ? (<Err />) : (<Content />)}`
 *     handler <<< <Spinner /> >>>
 *     elseif expr="error"
 *       handler <<< <Err /> >>>
 *     else
 *       handler <<< <Content /> >>>
 *
 * Each branch must carry its JSX in a `handler <<<>>>` child. `elseif` / `else`
 * children appear in source order and chain into nested ternaries.
 */
function generateConditionalJSX(node: IRNode): string[] {
  const props = propsOf(node);
  const rawCondition = props.if;
  const condition =
    rawCondition && typeof rawCondition === 'object' && (rawCondition as ExprObject).__expr
      ? (rawCondition as ExprObject).code
      : (rawCondition as string);
  if (!condition) throw new KernCodegenError("conditional node requires an 'if' prop", node);

  const thenHandler = getFirstChild(node, 'handler');
  if (!thenHandler) {
    throw new KernCodegenError(
      'conditional inside a render block requires a `handler <<<>>>` child with the `then` JSX',
      node,
    );
  }
  const thenLines = stripReturnWrapper((propsOf(thenHandler).code as string) || '').split('\n');

  const elseIfNodes = getChildren(node, 'elseif');
  const elseNode = getFirstChild(node, 'else');

  // Simple `{cond && (...)}` — no alternatives.
  if (elseIfNodes.length === 0 && !elseNode) {
    const lines: string[] = [`{${condition} && (`];
    for (const line of thenLines) lines.push(`  ${line}`);
    lines.push(`)}`);
    return lines;
  }

  // Ternary chain: then → [elseif → ...] → (else | null).
  const lines: string[] = [`{${condition} ? (`];
  for (const line of thenLines) lines.push(`  ${line}`);

  for (const elseIf of elseIfNodes) {
    const ep = propsOf(elseIf);
    const rawExpr = ep.expr;
    const elseIfExpr =
      rawExpr && typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
        ? (rawExpr as ExprObject).code
        : (rawExpr as string);
    if (!elseIfExpr) {
      throw new KernCodegenError("elseif node requires an 'expr' prop", elseIf);
    }
    const elseIfHandler = getFirstChild(elseIf, 'handler');
    if (!elseIfHandler) {
      throw new KernCodegenError(
        'elseif inside a render block requires a `handler <<<>>>` child with the branch JSX',
        elseIf,
      );
    }
    const body = stripReturnWrapper((propsOf(elseIfHandler).code as string) || '').split('\n');
    lines.push(`) : ${elseIfExpr} ? (`);
    for (const line of body) lines.push(`  ${line}`);
  }

  if (elseNode) {
    const elseHandler = getFirstChild(elseNode, 'handler');
    if (!elseHandler) {
      throw new KernCodegenError(
        'else inside a render block requires a `handler <<<>>>` child with the fallback JSX',
        elseNode,
      );
    }
    const body = stripReturnWrapper((propsOf(elseHandler).code as string) || '').split('\n');
    lines.push(`) : (`);
    for (const line of body) lines.push(`  ${line}`);
    lines.push(`)}`);
  } else {
    lines.push(`) : null}`);
  }
  return lines;
}

/**
 * Render a single `let` node as a `const name[: type] = expr;` line. Name and
 * type are routed through the schema emitters so invalid identifiers or type
 * annotations raise KernCodegenError instead of producing broken TSX like
 * `const is-selected = …;`. The expression is raw by design (rawExpr).
 */
function renderLetBinding(node: IRNode): string {
  const lp = propsOf(node);
  const lname = emitIdentifier(lp.name as string, 'binding', node);
  const rawExpr = lp.expr;
  const expr =
    rawExpr && typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
      ? (rawExpr as ExprObject).code
      : (rawExpr as string) || '';
  if (!expr) {
    throw new KernCodegenError("let node requires an 'expr' prop", node);
  }
  const t = lp.type as string | undefined;
  const typeAnn = t ? `: ${emitTypeAnnotation(t, 'unknown', node)}` : '';
  return `const ${lname}${typeAnn} = ${expr};`;
}
