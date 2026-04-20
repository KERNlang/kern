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
import { emitIdentifier } from './emitters.js';
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
const RENDER_JSX_CHILD_TYPES = new Set<string>(['each']);

function emitRender(renderNode: IRNode | undefined, lines: string[]): void {
  if (!renderNode) {
    lines.push(`  return null;`);
    return;
  }

  const hasJsxChild = getChildren(renderNode).some((c) => RENDER_JSX_CHILD_TYPES.has(c.type));
  if (hasJsxChild) {
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
 * Compose a render block from declarative KERN children (each, and later conditional).
 * Handler blocks inside render are treated as literal JSX fragments.
 * Emits `return (<>...</>);` containing each child's JSX.
 */
function emitRenderComposed(renderNode: IRNode, lines: string[]): void {
  const pieces: string[][] = [];
  for (const child of getChildren(renderNode)) {
    if (child.type === 'each') {
      pieces.push(generateEachJSX(child));
    } else if (child.type === 'handler') {
      // In composed mode the handler contributes a JSX fragment, not a
      // `return`-wrapped expression. Strip a leading `return (...);` so authors
      // can reuse the same handler shape as non-composed renders.
      const raw = (propsOf(child).code as string) || '';
      pieces.push(stripReturnWrapper(raw).split('\n'));
    }
    // Other declarative/metadata children (doc, reason, needs, ...) are skipped.
  }

  lines.push(`  return (`);
  lines.push(`    <>`);
  for (const piece of pieces) {
    for (const line of piece) lines.push(`      ${line}`);
  }
  lines.push(`    </>`);
  lines.push(`  );`);
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
 * Auto-key: `<name>.id ?? <name>.key ?? <index>` when `key=` is not supplied.
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
  const effectiveKey = keyExpr || `${name}.id ?? ${name}.key ?? ${index}`;

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
 * Render a single `let` node as a `const name[: type] = expr;` line, stripping
 * nothing — the expression is raw code by design (rawExpr).
 */
function renderLetBinding(node: IRNode): string {
  const lp = propsOf(node);
  const lname = (lp.name as string) || 'binding';
  const rawExpr = lp.expr;
  const expr =
    rawExpr && typeof rawExpr === 'object' && (rawExpr as ExprObject).__expr
      ? (rawExpr as ExprObject).code
      : (rawExpr as string) || '';
  if (!expr) {
    throw new KernCodegenError("let node requires an 'expr' prop", node);
  }
  const t = lp.type as string | undefined;
  const typeAnn = t ? `: ${t}` : '';
  return `const ${lname}${typeAnn} = ${expr};`;
}
