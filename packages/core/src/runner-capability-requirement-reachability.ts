import type { CapabilityRequirement, UnsupportedAsyncCapabilityRequirement } from './runner-capability-plan.js';
import type { IRNode } from './types.js';

function requirementsByLine(requirements: readonly CapabilityRequirement[]): Map<string, CapabilityRequirement[]> {
  const indexed = new Map<string, CapabilityRequirement[]>();
  for (const requirement of requirements) {
    const key = `${requirement.sourceLine}:${requirement.id}`;
    const existing = indexed.get(key);
    if (existing) existing.push(requirement);
    else indexed.set(key, [requirement]);
  }
  return indexed;
}

function requirementForNode(
  node: IRNode,
  indexed: Map<string, CapabilityRequirement[]>,
): CapabilityRequirement | undefined {
  const namespace = node.props?.namespace;
  const operation = node.props?.operation;
  if (typeof namespace !== 'string' || namespace === '' || typeof operation !== 'string' || operation === '') {
    return undefined;
  }
  return indexed.get(`${node.loc?.line ?? -1}:${namespace}.${operation}`)?.shift();
}

function collectExecutable(
  node: IRNode,
  handlers: ReadonlySet<IRNode>,
  inside: boolean,
  indexed: Map<string, CapabilityRequirement[]>,
  out: CapabilityRequirement[],
): void {
  const nextInside = inside || handlers.has(node);
  if (node.type === 'capability' && nextInside) {
    const requirement = requirementForNode(node, indexed);
    if (requirement) out.push(requirement);
  }
  for (const child of node.children ?? []) collectExecutable(child, handlers, nextInside, indexed, out);
}

export function collectExecutableRequirements(
  roots: readonly IRNode[],
  handlers: ReadonlySet<IRNode>,
  requirements: readonly CapabilityRequirement[],
): CapabilityRequirement[] {
  if (requirements.length === 0) return [];
  const indexed = requirementsByLine(requirements);
  const out: CapabilityRequirement[] = [];
  for (const root of roots) collectExecutable(root, handlers, false, indexed, out);
  return out;
}

function collectUnsupported(
  node: IRNode,
  handlers: ReadonlySet<IRNode>,
  unsupportedHandlers: ReadonlySet<IRNode>,
  inside: boolean,
  unsupportedContainer: IRNode | undefined,
  indexed: Map<string, CapabilityRequirement[]>,
  out: UnsupportedAsyncCapabilityRequirement[],
): void {
  const nextInside = inside || handlers.has(node);
  const nextUnsupported = handlers.has(node) && unsupportedHandlers.has(node) ? node : unsupportedContainer;
  if (node.type === 'capability') {
    const requirement = requirementForNode(node, indexed);
    if (requirement && !nextInside) out.push({ ...requirement, reason: 'outside-main' });
    else if (requirement && nextUnsupported) out.push({ ...requirement, reason: 'unsupported' });
  }
  for (const child of node.children ?? []) {
    collectUnsupported(child, handlers, unsupportedHandlers, nextInside, nextUnsupported, indexed, out);
  }
}

export function collectUnsupportedAsyncExecutionsAcrossModules(
  roots: readonly IRNode[],
  handlers: ReadonlySet<IRNode>,
  unsupportedHandlers: ReadonlySet<IRNode>,
  requirements: readonly CapabilityRequirement[],
): UnsupportedAsyncCapabilityRequirement[] {
  if (requirements.length === 0) return [];
  const indexed = requirementsByLine(requirements);
  const out: UnsupportedAsyncCapabilityRequirement[] = [];
  for (const root of roots) {
    collectUnsupported(root, handlers, unsupportedHandlers, false, undefined, indexed, out);
  }
  return out;
}
