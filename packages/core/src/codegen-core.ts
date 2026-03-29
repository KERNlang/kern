/**
 * Core Language Codegen — shared TypeScript generation for KERN's type system
 *
 * Handles: type, interface, fn, machine, error, module, config, store, test, event
 * These are target-agnostic — they compile to TypeScript regardless of target.
 *
 * Machine nodes are KERN's killer feature: 12 lines of KERN → 140+ lines of TS.
 *
 * Generator implementations are split into domain modules under codegen/.
 * This file is the thin dispatcher: imports, re-exports, and generateCoreNode switch.
 * Generators that call generateCoreNode recursively remain here to avoid circular imports.
 */

import type { IRNode, ExprObject } from './types.js';
import { propsOf } from './node-props.js';
import { isTemplateNode, expandTemplateNode } from './template-engine.js';
import { KernCodegenError } from './errors.js';
import { defaultRuntime, type KernRuntime } from './runtime.js';

// ── Re-exports: emitters & helpers (backward compatibility) ─────────────
export { emitIdentifier, emitStringLiteral, emitPath, emitTemplateSafe, emitTypeAnnotation, emitImportSpecifier } from './codegen/emitters.js';
export { getProps, getChildren, getFirstChild, getStyles, getPseudoStyles, getThemeRefs, dedent, cssPropertyName, handlerCode, exportPrefix, capitalize, parseParamList, emitReasonAnnotations, emitLowConfidenceTodo } from './codegen/helpers.js';

// ── Re-exports: domain generators (backward compatibility) ──────────────
export { generateType, generateInterface, generateUnion, generateService, generateConst } from './codegen/type-system.js';
export { generateFunction, generateError } from './codegen/functions.js';
export { generateMachine, generateMachineReducer } from './codegen/machines.js';
export { generateConfig, generateStore, generateRepository, generateCache, generateDependency, generateModel } from './codegen/data-layer.js';
export { generateDerive, generateTransform, generateAction, generateGuard, generateAssume, generateInvariant, generateCollect, generateResolve, generateExpect, generateRecover, generatePattern, generateApply } from './codegen/ground-layer.js';
export { generateEvent, generateOn, generateWebSocket } from './codegen/events.js';
export { generateImport } from './codegen/modules.js';
export { generateTest } from './codegen/test-gen.js';

// ── Imports for local use within this file ──────────────────────────────
import { emitIdentifier, emitTemplateSafe, emitImportSpecifier } from './codegen/emitters.js';
import { getProps, getChildren, getFirstChild, handlerCode, exportPrefix, capitalize, emitReasonAnnotations, emitLowConfidenceTodo } from './codegen/helpers.js';

import { generateType, generateInterface, generateUnion, generateService, generateConst } from './codegen/type-system.js';
import { generateFunction, generateError } from './codegen/functions.js';
import { generateMachine } from './codegen/machines.js';
import { generateConfig, generateStore, generateRepository, generateCache, generateDependency, generateModel } from './codegen/data-layer.js';
import { generateDerive, generateTransform, generateAction, generateGuard, generateAssume, generateInvariant, generateCollect, generateResolve, generateExpect, generateRecover, generatePattern, generateApply } from './codegen/ground-layer.js';
import { generateEvent, generateOn, generateWebSocket } from './codegen/events.js';
import { generateImport } from './codegen/modules.js';
import { generateTest } from './codegen/test-gen.js';

// ── Internal aliases ────────────────────────────────────────────────────
const p = getProps;
const kids = getChildren;
const firstChild = getFirstChild;

// ── Evolved Generators (v4) ─────────────────────────────────────────────
// Populated at startup by evolved-node-loader. Checked in generateCoreNode
// before the default case, allowing graduated nodes to produce output.

// Evolved generators now live in defaultRuntime. These functions delegate for backward compatibility.

/** Register an evolved generator (called at startup). */
export function registerEvolvedGenerator(keyword: string, fn: (node: IRNode) => string[]): void {
  defaultRuntime.registerEvolvedGenerator(keyword, fn);
}

/** Register a target-specific evolved generator (called at startup). */
export function registerEvolvedTargetGenerator(keyword: string, target: string, fn: (node: IRNode) => string[]): void {
  defaultRuntime.registerEvolvedTargetGenerator(keyword, target, fn);
}

/** Unregister an evolved generator (for rollback/testing). */
export function unregisterEvolvedGenerator(keyword: string): void {
  defaultRuntime.unregisterEvolvedGenerator(keyword);
}

/** Clear all evolved generators (for test isolation). */
export function clearEvolvedGenerators(): void {
  defaultRuntime.clearEvolvedGenerators();
}

/** Check if an evolved generator exists for a type. */
export function hasEvolvedGenerator(type: string): boolean {
  return defaultRuntime.hasEvolvedGenerator(type);
}

// ── Generators that call generateCoreNode (kept here to avoid circular imports) ──

// ── Module ───────────────────────────────────────────────────────────────
// module name=@agon/core
//   export from="./plan.js" names="createPlan,advanceStep"

export function generateModule(node: IRNode): string[] {
  const props = propsOf<'module'>(node);
  const name = emitTemplateSafe(props.name || 'unknown');
  const lines: string[] = [];

  lines.push(`// ── Module: ${name} ──`);
  lines.push('');

  // 'export' children don't have a typed interface in NodePropsMap
  for (const exp of kids(node, 'export')) {
    const ep = p(exp);
    const rawFrom = ep.from as string;
    const safeFrom = rawFrom ? emitImportSpecifier(rawFrom, exp) : '';
    const rawNames = ep.names as string;
    const safeNames = rawNames ? rawNames.split(',').map(s => emitIdentifier(s.trim(), 'export', exp)).join(', ') : '';
    const rawTypeNames = ep.types as string;
    const safeTypeNames = rawTypeNames ? rawTypeNames.split(',').map(s => emitIdentifier(s.trim(), 'export', exp)).join(', ') : '';
    const star = ep.star === 'true' || ep.star === true;
    const safeDefault = ep.default ? emitIdentifier(ep.default as string, 'default', exp) : '';

    // export * from './foo.js'
    if (safeFrom && !safeNames && !safeTypeNames && star) {
      lines.push(`export * from '${safeFrom}';`);
    }
    // export { a, b } from './foo.js'
    if (safeFrom && safeNames) {
      lines.push(`export { ${safeNames} } from '${safeFrom}';`);
    }
    // export type { A, B } from './types.js'
    if (safeFrom && safeTypeNames) {
      lines.push(`export type { ${safeTypeNames} } from '${safeFrom}';`);
    }
    // export default foo
    if (safeDefault && !safeFrom) {
      lines.push(`export default ${safeDefault};`);
    }
    // export default from './foo.js' (re-export default)
    if (safeDefault && safeFrom) {
      lines.push(`export { default as ${safeDefault} } from '${safeFrom}';`);
    }
    // export { a, b } (no from — local re-export)
    if (!safeFrom && safeNames && !safeDefault) {
      lines.push(`export { ${safeNames} };`);
    }
    // export type { A, B } (no from — local type re-export)
    if (!safeFrom && safeTypeNames && !safeDefault) {
      lines.push(`export type { ${safeTypeNames} };`);
    }
  }

  // Inline child definitions
  for (const child of kids(node)) {
    if (child.type === 'export') continue;
    lines.push(...generateCoreNode(child));
    lines.push('');
  }

  return lines;
}


// ── Each (ground-layer, calls generateCoreNode) ─────────────────────────
// each name=stem in="track.stems"
//   derive name=normalized expr={{normalize(stem.amplitude)}}

export function generateEach(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'each'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = props.name || 'item';
  const collection = props.in;
  const index = props.index;

  const lines: string[] = [...todo, ...annotations];
  if (index) {
    lines.push(`for (const [${index}, ${name}] of (${collection}).entries()) {`);
  } else {
    lines.push(`for (const ${name} of ${collection}) {`);
  }

  for (const child of kids(node)) {
    const childLines = generateCoreNode(child);
    for (const line of childLines) {
      lines.push(`  ${line}`);
    }
  }

  lines.push('}');
  return lines;
}

// ── Branch / path (ground-layer, calls generateCoreNode) ────────────────
// branch name=tierRoute on="user.tier"
//   path value="free"
//     derive name=maxStems expr={{4}} type=number

export function generateBranch(node: IRNode): string[] {
  const annotations = emitReasonAnnotations(node);
  const props = propsOf<'branch'>(node);
  const conf = props.confidence;
  const todo = emitLowConfidenceTodo(node, conf);
  const name = props.name || 'branch';
  const on = props.on;
  const paths = kids(node, 'path');

  const lines: string[] = [...todo, ...annotations];
  lines.push(`/** branch: ${name} */`);
  lines.push(`switch (${on}) {`);

  // 'path' children don't have a typed interface in NodePropsMap
  for (const pathNode of paths) {
    const pp = p(pathNode);
    const value = pp.value as string;
    lines.push(`  case '${value}': {`);
    for (const child of kids(pathNode)) {
      const childLines = generateCoreNode(child);
      for (const line of childLines) {
        lines.push(`    ${line}`);
      }
    }
    lines.push(`    break;`);
    lines.push(`  }`);
  }

  lines.push('}');
  return lines;
}

// ── Conditional (calls generateCoreNode) ─────────────────────────────────
// conditional if=isPro
//   text value="Pro features unlocked"
// → {isPro && (<>..children..</>)}

export function generateConditional(node: IRNode): string[] {
  const props = propsOf<'conditional'>(node);
  const rawCondition = props.if;
  // Handle expression objects: { __expr: true, code: 'loading' }
  const condition = rawCondition && typeof rawCondition === 'object' && (rawCondition as ExprObject).__expr
    ? (rawCondition as ExprObject).code
    : rawCondition as string;
  if (!condition) throw new KernCodegenError("conditional node requires an 'if' prop", node);

  const childLines: string[] = [];
  for (const child of kids(node)) {
    childLines.push(...generateCoreNode(child));
  }

  if (childLines.length === 0) {
    return [`{${condition} && null}`];
  }
  if (childLines.length === 1) {
    return [`{${condition} && (${childLines[0].trim()})}`];
  }
  return [
    `{${condition} && (`,
    `  <>`,
    ...childLines.map(l => `    ${l}`),
    `  </>`,
    `)}`,
  ];
}

// ── Select ───────────────────────────────────────────────────────────────
// select name=status value=current placeholder="Choose"
//   option value=active label="Active"
//   option value=pending label="Pending"

export function generateSelect(node: IRNode): string[] {
  const props = propsOf<'select'>(node);
  const name = props.name || 'select';
  const value = props.value;
  const placeholder = props.placeholder;
  const onChange = props.onChange;

  const attrs: string[] = [`name="${name}"`];
  if (value) attrs.push(`value={${value}}`);
  if (onChange) attrs.push(`onChange={${onChange}}`);

  // Event handlers like onChange require 'use client' in React/Next.js
  const lines: string[] = onChange ? [`{/* kern:use-client */}`] : [];
  lines.push(`<select ${attrs.join(' ')}>`);
  if (placeholder) {
    lines.push(`  <option value="" disabled>${emitTemplateSafe(placeholder)}</option>`);
  }
  for (const opt of kids(node, 'option')) {
    const op = propsOf<'option'>(opt);
    const optValue = emitTemplateSafe(op.value || '');
    const optLabel = emitTemplateSafe(op.label || op.value || '');
    lines.push(`  <option value="${optValue}">${optLabel}</option>`);
  }
  lines.push(`</select>`);
  return lines;
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export const CORE_NODE_TYPES = new Set([
  'type', 'interface', 'field', 'fn',
  'union', 'variant',
  'service', 'method', 'singleton', 'constructor',
  'machine', 'transition',
  'error', 'module', 'export',
  'config', 'store',
  'test', 'describe', 'it',
  'event', 'import', 'const',
  'hook',
  'on', 'websocket',
  'template', 'slot', 'body',
  // Async extensions
  'signal', 'cleanup',
  // Ground layer
  'derive', 'transform', 'action', 'guard', 'assume', 'invariant',
  'each', 'collect', 'branch', 'path',
  'resolve', 'candidate', 'discriminator',
  'expect', 'recover', 'strategy',
  'pattern', 'apply',
  // Reason layer
  'reason', 'evidence',
  // Confidence layer
  'needs',
  // Backend data layer (graduated nodes)
  'model', 'column', 'relation',
  'repository',
  'dependency', 'inject',
  'cache', 'entry', 'invalidate',
  // UI controls (graduated nodes)
  'conditional',
  'select', 'option',
]);

/** Check if a node type is a core language construct. */
export function isCoreNode(type: string): boolean {
  return CORE_NODE_TYPES.has(type);
}

/**
 * Generate TypeScript lines for a core IR node (type system, functions, machines, etc.).
 *
 * Returns an empty array if the node type is unknown and no evolved generator is registered.
 * Template nodes are expanded automatically via the template engine.
 *
 * @param node - The IR node to generate code for
 * @param target - Optional target hint (e.g., `'ink'` for machine → useReducer)
 * @param runtime - Optional KernRuntime instance
 * @returns Array of TypeScript source lines
 * @throws {KernCodegenError} For nodes with invalid/missing required props
 */
export function generateCoreNode(node: IRNode, target?: string, runtime?: KernRuntime): string[] {
  const rt = runtime ?? defaultRuntime;
  switch (node.type) {
    case 'type': return generateType(node);
    case 'interface': return generateInterface(node);
    case 'union': return generateUnion(node);
    case 'service': return generateService(node);
    case 'fn': return generateFunction(node);
    case 'machine': return generateMachine(node);
    case 'error': return generateError(node);
    case 'module': return generateModule(node);
    case 'config': return generateConfig(node);
    case 'store': return generateStore(node);
    case 'test': return generateTest(node);
    case 'event': return generateEvent(node);
    case 'import': return generateImport(node);
    case 'const': return generateConst(node);
    case 'hook': return []; // Handled by @kernlang/react
    case 'on': return generateOn(node);
    case 'websocket': return generateWebSocket(node);
    // Ground layer
    case 'derive': return generateDerive(node);
    case 'transform': return generateTransform(node);
    case 'action': return generateAction(node);
    case 'guard': return generateGuard(node);
    case 'assume': return generateAssume(node);
    case 'invariant': return generateInvariant(node);
    case 'each': return generateEach(node);
    case 'collect': return generateCollect(node);
    case 'branch': return generateBranch(node);
    case 'resolve': return generateResolve(node);
    case 'expect': return generateExpect(node);
    case 'recover': return generateRecover(node);
    case 'pattern': return generatePattern(node);
    case 'apply': return generateApply(node);
    // Template / structural definitions produce no output
    case 'template': return [];
    case 'slot': return [];
    case 'body': return [];
    case 'path': return [];
    case 'candidate': return [];
    case 'discriminator': return [];
    case 'strategy': return [];
    case 'reason': return [];
    case 'evidence': return [];
    case 'needs': return [];
    // Graduated nodes — backend data layer
    case 'model': return generateModel(node);
    case 'repository': return generateRepository(node);
    case 'dependency': return generateDependency(node);
    case 'cache': return generateCache(node);
    // Graduated nodes — UI controls
    case 'conditional': return generateConditional(node);
    case 'select': return generateSelect(node);
    // Structural children consumed by parents
    case 'variant': return [];
    case 'method': return [];
    case 'singleton': return [];
    case 'constructor': return [];
    case 'signal': return [];
    case 'cleanup': return [];
    case 'column': return [];
    case 'relation': return [];
    case 'inject': return [];
    case 'entry': return [];
    case 'invalidate': return [];
    case 'option': return [];
    default: {
      // Check evolved generators (v4) — target-specific first, then default
      const targetMap = target ? rt.evolvedTargetGenerators.get(node.type) : undefined;
      const targetGen = targetMap && target ? targetMap.get(target) : undefined;
      const evolvedGen = targetGen || rt.evolvedGenerators.get(node.type);
      if (evolvedGen) return evolvedGen(node);
      // Check if this is a template instance
      if (isTemplateNode(node.type, rt)) return expandTemplateNode(node, 0, rt);
      return [];
    }
  }
}
