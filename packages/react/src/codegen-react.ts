/**
 * React-specific codegen — generates JSX/TSX code for provider and effect nodes.
 *
 * These nodes live in @kernlang/react because they produce JSX output,
 * unlike hook which generates pure TypeScript and lives in @kernlang/core.
 */

import type { IRNode } from '@kernlang/core';
import { parseParamList, capitalize, generateCoreNode } from '@kernlang/core';

// ── Helpers ──────────────────────────────────────────────────────────────

function p(node: IRNode): Record<string, unknown> {
  return node.props || {};
}

function kids(node: IRNode, type?: string): IRNode[] {
  const c = node.children || [];
  return type ? c.filter(n => n.type === type) : c;
}

function firstChild(node: IRNode, type: string): IRNode | undefined {
  return kids(node, type)[0];
}

function dedent(code: string): string {
  const lines = code.split('\n');
  const nonEmpty = lines.filter(l => l.trim().length > 0);
  if (nonEmpty.length === 0) return code;
  const min = Math.min(...nonEmpty.map(l => l.match(/^(\s*)/)?.[1].length ?? 0));
  return lines.map(l => l.slice(min)).join('\n');
}

function handlerCode(node: IRNode): string {
  const handler = firstChild(node, 'handler');
  if (!handler) return '';
  const raw = p(handler).code as string || '';
  return dedent(raw);
}

// ── Provider ─────────────────────────────────────────────────────────────
// provider name=Search type=UseSearchResult
//   prop name=initialQuery type=string
//   prop name=category type=string optional=true
//   handler <<<
//     const value = useSearch({ query: initialQuery, category });
//   >>>
//
// Generates 3 pieces:
//   1. SearchContext = createContext<UseSearchResult | null>(null)
//   2. SearchProvider component with props + <SearchContext.Provider>
//   3. useSearchContext() consumer hook with null-check

export function generateProvider(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const valueType = props.type as string;
  const lines: string[] = [];

  lines.push("'use client';");
  lines.push('');
  lines.push("import { createContext, useContext } from 'react';");
  lines.push(`import type { ReactNode } from 'react';`);
  lines.push('');

  // 1. Context
  lines.push(`const ${name}Context = createContext<${valueType} | null>(null);`);
  lines.push('');

  // 2. Props interface
  const propNodes = kids(node, 'prop');
  lines.push(`export interface ${name}ProviderProps {`);
  lines.push(`  children: ReactNode;`);
  for (const prop of propNodes) {
    const pp = p(prop);
    const opt = pp.optional === 'true' || pp.optional === true ? '?' : '';
    lines.push(`  ${pp.name}${opt}: ${pp.type};`);
  }
  lines.push('}');
  lines.push('');

  // 3. Provider component
  const propNames = propNodes.map(pn => p(pn).name as string);
  const destructured = ['children', ...propNames].join(', ');
  lines.push(`export function ${name}Provider({ ${destructured} }: ${name}ProviderProps) {`);
  const code = handlerCode(node);
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`  ${line}`);
    }
  }
  lines.push('');
  lines.push(`  return (`);
  lines.push(`    <${name}Context.Provider value={value}>`);
  lines.push(`      {children}`);
  lines.push(`    </${name}Context.Provider>`);
  lines.push(`  );`);
  lines.push('}');
  lines.push('');

  // 4. Consumer hook
  lines.push(`export function use${name}Context(): ${valueType} {`);
  lines.push(`  const ctx = useContext(${name}Context);`);
  lines.push(`  if (ctx === null) {`);
  lines.push(`    throw new Error('use${name}Context must be used within a ${name}Provider');`);
  lines.push(`  }`);
  lines.push(`  return ctx;`);
  lines.push('}');

  return lines;
}

// ── Effect (Component) ──────────────────────────────────────────────────
// effect name=TrackingContainer generic=T once=true
//   prop name=entities type="T[]"
//   prop name=generator type="(items: T[]) => Promise<TrackingEvent>"
//   deps="entities,generator"
//   handler <<<
//     generator(entities).then(event => trackPageLoadEvent(event));
//   >>>
//   cleanup <<<
//     abortCtrl.abort();
//   >>>
//
// Generates: props interface + component with useRef guard (once=true) +
// useEffect with deps + optional cleanup + return null

export function generateEffect(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const generic = props.generic as string | undefined;
  const once = props.once === 'true' || props.once === true;
  const deps = props.deps as string || '';
  const lines: string[] = [];

  const reactImports = ['useEffect'];
  if (once) reactImports.push('useRef');

  lines.push("'use client';");
  lines.push('');
  lines.push(`import { ${reactImports.sort().join(', ')} } from 'react';`);
  lines.push('');

  // Generic type parameter
  const genericParam = generic ? `<${generic}>` : '';
  const genericConstraint = generic ? `<${generic}>` : '';

  // Props interface
  const propNodes = kids(node, 'prop');
  lines.push(`export interface ${name}Props${genericParam} {`);
  for (const prop of propNodes) {
    const pp = p(prop);
    const opt = pp.optional === 'true' || pp.optional === true ? '?' : '';
    lines.push(`  ${pp.name}${opt}: ${pp.type};`);
  }
  lines.push('}');
  lines.push('');

  // Component
  const propNames = propNodes.map(pn => p(pn).name as string);
  const destructured = propNames.join(', ');
  lines.push(`export function ${name}${genericConstraint}({ ${destructured} }: ${name}Props${genericConstraint}) {`);

  // Once guard — useRef for React 18 Strict Mode double-mount safety
  if (once) {
    lines.push(`  const hasRun = useRef(false);`);
  }

  // useEffect
  const depsArr = deps ? `[${deps}]` : '[]';
  lines.push(`  useEffect(() => {`);

  if (once) {
    lines.push(`    if (hasRun.current) return;`);
    lines.push(`    hasRun.current = true;`);
  }

  const code = handlerCode(node);
  if (code) {
    for (const line of code.split('\n')) {
      lines.push(`    ${line}`);
    }
  }

  // Cleanup
  const cleanupNode = firstChild(node, 'cleanup');
  if (cleanupNode) {
    const cleanupCode = p(cleanupNode).code as string || '';
    const cleanupDedented = dedent(cleanupCode);
    lines.push(`    return () => {`);
    for (const line of cleanupDedented.split('\n')) {
      lines.push(`      ${line}`);
    }
    lines.push(`    };`);
  }

  lines.push(`  }, ${depsArr});`);
  lines.push('');
  lines.push(`  return null;`);
  lines.push('}');

  return lines;
}

/** Check if a node is a React codegen node (provider or top-level effect). */
export function isReactNode(type: string): boolean {
  return type === 'provider' || type === 'effect';
}

// ── Ground Layer — React Overrides (Tier 2) ──────────────────────────────

const GROUND_NODE_TYPES = new Set([
  'derive', 'transform', 'action', 'guard', 'assume', 'invariant',
  'each', 'collect', 'branch', 'resolve', 'expect', 'recover',
  'pattern', 'apply',
]);

/** Check if a node is a ground-layer node that may have React-specific overrides. */
export function isGroundNode(type: string): boolean {
  return GROUND_NODE_TYPES.has(type);
}

/** React Tier 2 override for derive → useMemo. */
function generateReactDerive(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string;
  const expr = props.expr as string;
  const deps = props.deps as string || '';
  const depsArr = deps ? `[${deps}]` : '[]';

  return [`const ${name} = useMemo(() => ${expr}, ${depsArr});`];
}

/** React Tier 2 override for each → .map() for JSX rendering. */
function generateReactEach(node: IRNode): string[] {
  const props = p(node);
  const name = props.name as string || 'item';
  const collection = props.in as string;
  const index = props.index as string | undefined;

  const lines: string[] = [];
  const paramStr = index ? `(${name}, ${index})` : `(${name})`;
  lines.push(`{(${collection}).map(${paramStr} => (`);
  for (const child of kids(node)) {
    const childLines = generateCoreNode(child);
    for (const line of childLines) {
      lines.push(`  ${line}`);
    }
  }
  lines.push(`))}`);
  return lines;
}

/** Generate React-overridden ground-layer node. Falls through to core for non-overridden nodes. */
export function generateGroundNode(node: IRNode): string[] | null {
  switch (node.type) {
    case 'derive': return generateReactDerive(node);
    case 'each': return generateReactEach(node);
    default: return null; // No React override — fall through to core
  }
}

/** Generate TSX for a React codegen node. */
export function generateReactNode(node: IRNode): string[] {
  switch (node.type) {
    case 'provider': return generateProvider(node);
    case 'effect': return generateEffect(node);
    default: return [];
  }
}
