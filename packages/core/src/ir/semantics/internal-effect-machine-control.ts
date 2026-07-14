import type { IRNode } from '../../types.js';
import { internalMachineExpressionBindings } from './internal-effect-machine-expression-bindings.js';
import { defineBinding, hasBinding, type SemanticEnv } from './semantic-env.js';

export function clonePreflightEnvironment(env: SemanticEnv): SemanticEnv {
  return {
    ...env,
    bindings: new Map(env.bindings),
    capturedArrayBindings: env.capturedArrayBindings ? new Set(env.capturedArrayBindings) : undefined,
    freshArrayBindings: env.freshArrayBindings ? new Set(env.freshArrayBindings) : undefined,
    intProvenance: env.intProvenance ? new Set(env.intProvenance) : undefined,
    parent: env.parent ? clonePreflightEnvironment(env.parent) : undefined,
    pushBuiltFreshArrayBindings: env.pushBuiltFreshArrayBindings ? new Set(env.pushBuiltFreshArrayBindings) : undefined,
    recordArrayFields: env.recordArrayFields
      ? new Map([...env.recordArrayFields].map(([name, fields]) => [name, fields === null ? null : new Set(fields)]))
      : undefined,
  };
}

export function controlExpressionIsDeferred(raw: unknown, deferredBindings: ReadonlySet<string>): boolean {
  if (typeof raw !== 'string') return false;
  try {
    for (const name of internalMachineExpressionBindings(raw)) {
      if (deferredBindings.has(name)) return true;
    }
  } catch {
    // The canonical control validator owns malformed-expression diagnostics.
    // Returning false routes the input through that machine-error wrapper.
  }
  return false;
}

export function branchControlIsDeferred(node: IRNode, deferredBindings: ReadonlySet<string>): boolean {
  if (controlExpressionIsDeferred(node.props?.on, deferredBindings)) return true;
  for (const path of node.children ?? []) {
    if (
      path.props?.default !== true &&
      path.props?.default !== 'true' &&
      path.__quotedProps?.includes('value') !== true &&
      controlExpressionIsDeferred(path.props?.value, deferredBindings)
    ) {
      return true;
    }
  }
  return false;
}

export function forControlIsDeferred(node: IRNode, deferredBindings: ReadonlySet<string>): boolean {
  return (['from', 'to', 'step'] as const).some((prop) =>
    controlExpressionIsDeferred(node.props?.[prop], deferredBindings),
  );
}

function nodeMayReturnOrThrow(node: IRNode): boolean {
  if (node.type === 'return' || node.type === 'throw') return true;
  return (node.children ?? []).some(nodeMayReturnOrThrow);
}

function nodeMayExitCurrentFrame(node: IRNode): boolean {
  if (node.type === 'return' || node.type === 'throw' || node.type === 'break' || node.type === 'continue') {
    return true;
  }
  if (node.type === 'for' || node.type === 'each' || node.type === 'while') {
    return (node.children ?? []).some(nodeMayReturnOrThrow);
  }
  return (node.children ?? []).some(nodeMayExitCurrentFrame);
}

/** Nodes guaranteed to run before every canonical completion that enters a sibling finally clause. */
export function guaranteedFinallyEntryPrefix(nodes: readonly IRNode[]): readonly IRNode[] {
  const prefix: IRNode[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const elseNode = node.type === 'if' && nodes[index + 1]?.type === 'else' ? nodes[index + 1] : undefined;
    if (nodeMayExitCurrentFrame(node) || (elseNode !== undefined && nodeMayExitCurrentFrame(elseNode))) break;
    prefix.push(node);
    if (elseNode) {
      prefix.push(elseNode);
      index += 1;
    }
  }
  return prefix;
}

function addFrameBindingNames(node: IRNode, bindings: Set<string>): void {
  for (const prop of ['entryKey', 'entryValue', 'index', 'name', 'pairKey', 'pairValue'] as const) {
    const name = node.props?.[prop];
    if (typeof name === 'string' && name !== '') bindings.add(name);
  }
}

function addDeclaredBinding(node: IRNode, bindings: Set<string>): void {
  if (node.type !== 'let' && node.type !== 'fmt' && node.type !== 'expression-v1' && node.type !== 'capability') {
    return;
  }
  const name = node.props?.name;
  if (typeof name === 'string' && name !== '') bindings.add(name);
}

function retainBindingsPresentInBoth(target: Set<string>, left: ReadonlySet<string>, right: ReadonlySet<string>): void {
  for (const name of left) {
    if (right.has(name)) target.add(name);
  }
}

function recordFrameEscapes(
  nodes: readonly IRNode[],
  out: Set<string>,
  initialBindings: ReadonlySet<string>,
): Set<string> {
  const bindings = new Set(initialBindings);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type === 'if') {
      const elseNode = nodes[index + 1]?.type === 'else' ? nodes[index + 1] : undefined;
      if (elseNode) index += 1;
      const thenBindings = recordFrameEscapes(node.children ?? [], out, bindings);
      const elseBindings = elseNode ? recordFrameEscapes(elseNode.children ?? [], out, bindings) : bindings;
      retainBindingsPresentInBoth(bindings, thenBindings, elseBindings);
      continue;
    }
    if (node.type === 'branch') {
      for (const path of node.children ?? []) recordFrameEscapes(path.children ?? [], out, bindings);
      continue;
    }
    if (node.type === 'for' || node.type === 'each' || node.type === 'while') {
      const nestedBindings = new Set(bindings);
      addFrameBindingNames(node, nestedBindings);
      recordFrameEscapes(node.children ?? [], out, nestedBindings);
      continue;
    }
    if (node.type === 'assign') {
      const target = node.props?.target;
      if (typeof target === 'string' && target !== '' && !bindings.has(target)) out.add(target);
    }
    addDeclaredBinding(node, bindings);
    if (node.children) recordFrameEscapes(node.children, out, bindings);
  }
  return bindings;
}

export function recordEscapingBindingWrites(
  nodes: readonly IRNode[],
  out: Set<string>,
  initialBindings: ReadonlySet<string> = new Set(),
): void {
  recordFrameEscapes(nodes, out, initialBindings);
}

export interface ConditionalBindingPath {
  readonly initialBindings?: readonly string[];
  readonly nodes: readonly IRNode[];
}

export function conditionalBindingEffects(paths: readonly ConditionalBindingPath[]): {
  readonly assigned: ReadonlySet<string>;
  readonly declared: ReadonlySet<string>;
} {
  const assigned = new Set<string>();
  let declared: Set<string> | undefined;
  for (const path of paths) {
    const pathDeclared = recordFrameEscapes(path.nodes, assigned, new Set(path.initialBindings ?? []));
    declared = declared ? new Set([...declared].filter((name) => pathDeclared.has(name))) : new Set(pathDeclared);
  }
  return { assigned, declared: declared ?? new Set() };
}

export function applyConditionalBindingEffects(
  paths: readonly ConditionalBindingPath[],
  env: SemanticEnv,
  deferredBindings: Set<string>,
): void {
  const effects = conditionalBindingEffects(paths);
  for (const name of effects.assigned) {
    if (hasBinding(env, name)) deferredBindings.add(name);
  }
  for (const name of effects.declared) {
    if (hasBinding(env, name)) continue;
    defineBinding(env, name, null);
    deferredBindings.add(name);
  }
}
