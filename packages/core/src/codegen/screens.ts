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

import type { IRNode } from '../types.js';
import { getProps, getChildren, getFirstChild, exportPrefix } from './helpers.js';
import { emitIdentifier } from './emitters.js';

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

type StateChild = {
  name: string;
  type: string;
  initial?: string;
};

function propsOf(node: IRNode): Record<string, unknown> {
  return node.props || {};
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
  const target = props.target || 'ink';
  const exp = exportPrefix(node);
  const lines: string[] = [];

  // Collect children
  const propNodes = getChildren(node, 'prop');
  const stateNodes = getChildren(node, 'state');
  const effectNodes = getChildren(node, 'effect');
  const renderNode = getFirstChild(node, 'render');
  const callbackNodes = getChildren(node, 'callback');
  const refNodes = getChildren(node, 'ref');

  // Determine which React hooks are needed
  const needsState = stateNodes.length > 0;
  const needsEffect = effectNodes.length > 0;
  const needsCallback = callbackNodes.length > 0;
  const needsRef = refNodes.length > 0;

  // Imports
  const reactImports = ['React'];
  if (needsState) reactImports.push('useState');
  if (needsEffect) reactImports.push('useEffect');
  if (needsCallback) reactImports.push('useCallback');
  if (needsRef) reactImports.push('useRef');

  // Only add React import if this is likely a standalone screen
  // (multi-screen files should use KERN import nodes instead)
  const hookList = reactImports.slice(1);
  if (hookList.length > 0) {
    lines.push(`import React, { ${hookList.join(', ')} } from 'react';`);
  } else {
    lines.push(`import React from 'react';`);
  }
  if (target === 'ink') {
    lines.push(`import { Box, Text } from 'ink';`);
  }
  lines.push('');

  // Parse props
  const componentProps: PropChild[] = propNodes.map(n => {
    const p = propsOf(n);
    return {
      name: emitIdentifier(p.name as string, 'unknown', n),
      type: (p.type as string) || 'any',
      optional: p.optional === true || p.optional === 'true',
      default: p.default as string | undefined,
    };
  });

  // Props type
  const propsTypeEntries = componentProps.map(p =>
    `${p.name}${p.optional ? '?' : ''}: ${p.type}`
  ).join('; ');

  // Destructure with defaults
  const destructure = componentProps.map(p =>
    p.default ? `${p.name} = ${p.default}` : p.name
  ).join(', ');

  // Function signature
  lines.push(`${exp}function ${name}({ ${destructure} }: { ${propsTypeEntries} }) {`);

  // State declarations
  for (const sn of stateNodes) {
    const sp = propsOf(sn);
    const sName = emitIdentifier(sp.name as string, 'state', sn);
    const sType = (sp.type as string) || 'any';
    const sInitial = (sp.initial as string) || 'undefined';
    const setter = `set${sName.charAt(0).toUpperCase()}${sName.slice(1)}`;
    lines.push(`  const [${sName}, ${setter}] = useState<${sType}>(${sInitial});`);
  }

  // Ref declarations
  for (const rn of refNodes) {
    const rp = propsOf(rn);
    const rName = emitIdentifier(rp.name as string, 'ref', rn);
    const rType = (rp.type as string) || 'any';
    const rInitial = (rp.initial as string) || 'null';
    lines.push(`  const ${rName} = useRef<${rType}>(${rInitial});`);
  }

  if (stateNodes.length > 0 || refNodes.length > 0) lines.push('');

  // Callbacks
  for (const cn of callbackNodes) {
    const cp = propsOf(cn);
    const cName = emitIdentifier(cp.name as string, 'handler', cn);
    const cParams = cp.params as string || '';
    const cDeps = cp.deps as string || '[]';
    const body = handlerContent(cn);
    lines.push(`  const ${cName} = useCallback(${cParams ? `(${cParams})` : '()'} => {`);
    for (const line of body.split('\n')) {
      lines.push(`    ${line}`);
    }
    lines.push(`  }, ${cDeps});`);
    lines.push('');
  }

  // Effects
  for (const en of effectNodes) {
    const ep = propsOf(en);
    const eDeps = ep.deps as string || '[]';
    const body = handlerContent(en);
    lines.push(`  useEffect(() => {`);
    for (const line of body.split('\n')) {
      lines.push(`    ${line}`);
    }
    lines.push(`  }, ${eDeps});`);
    lines.push('');
  }

  // Render
  if (renderNode) {
    const body = handlerContent(renderNode);
    const trimmed = body.trim();
    // If handler body contains `return`, emit as-is (it manages its own return)
    // Otherwise, wrap in return(...)
    if (trimmed.includes('return ') || trimmed.includes('return(')) {
      for (const line of body.split('\n')) {
        lines.push(`  ${line}`);
      }
    } else {
      lines.push(`  return (`);
      for (const line of body.split('\n')) {
        lines.push(`    ${line}`);
      }
      lines.push(`  );`);
    }
  } else {
    lines.push(`  return null;`);
  }

  lines.push('}');
  lines.push('');

  return lines;
}
