import { parseExpression } from './parser-expression.js';
import type { IRNode } from './types.js';

export interface RunnerCapabilityClassMemberResolution<T> {
  readonly ownerClass: string;
  readonly receiverClass: string;
  readonly values: readonly T[];
}

// Portable identifiers cannot contain NUL, so this encoding is collision-free.
const CLASS_CALL_SEPARATOR = '\0';
export const RUNNER_CAPABILITY_AMBIGUOUS_CLASS = '*';

export function runnerCapabilityClassAncestry(className: string, classExtends: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (
    let current: string | undefined = className;
    current && !seen.has(current);
    current = classExtends.get(current)
  ) {
    seen.add(current);
    out.push(current);
  }
  return out;
}

export function resolveRunnerCapabilityClassMember<T>(
  className: string,
  memberName: string,
  classMembers: ReadonlyMap<string, readonly T[]>,
  classExtends: ReadonlyMap<string, string>,
  receiverClass = className,
): RunnerCapabilityClassMemberResolution<T> | undefined {
  for (const ownerClass of runnerCapabilityClassAncestry(className, classExtends)) {
    const values = classMembers.get(`${ownerClass}.${memberName}`);
    if (values && values.length > 0) return { ownerClass, receiverClass, values };
  }
  return undefined;
}

export function runnerCapabilityClassCallKey(startClass: string, receiverClass: string, memberName: string): string {
  return [startClass, receiverClass, memberName].join(CLASS_CALL_SEPARATOR);
}

export function resolveRunnerCapabilityClassCall<T>(
  key: string,
  classMembers: ReadonlyMap<string, readonly T[]>,
  classExtends: ReadonlyMap<string, string>,
): RunnerCapabilityClassMemberResolution<T> | undefined {
  const [startClass, receiverClass, memberName, ...rest] = key.split(CLASS_CALL_SEPARATOR);
  if (!startClass || !receiverClass || !memberName || rest.length > 0) {
    throw new Error('runner capability class call key is malformed');
  }
  return resolveRunnerCapabilityClassMember(startClass, memberName, classMembers, classExtends, receiverClass);
}

export function recordRunnerCapabilityClassBinding(
  node: IRNode,
  classBindings: Map<string, string>,
  helpers: ReadonlyMap<string, IRNode>,
): void {
  if (node.type !== 'let') return;
  const name = typeof node.props?.name === 'string' ? node.props.name : '';
  const rawValue = typeof node.props?.value === 'string' ? node.props.value : '';
  if (!name || !rawValue) return;
  try {
    const parsed = parseExpression(rawValue);
    if (parsed.kind === 'new' && parsed.argument.kind === 'call' && parsed.argument.callee.kind === 'ident') {
      recordClassName(classBindings, name, parsed.argument.callee.name);
    } else if (parsed.kind === 'call' && parsed.callee.kind === 'ident' && helpers.has(parsed.callee.name)) {
      recordClassName(classBindings, name, RUNNER_CAPABILITY_AMBIGUOUS_CLASS);
    }
  } catch {
    // Parser/runtime diagnostics own malformed expressions.
  }
}

function recordClassName(classBindings: Map<string, string>, name: string, className: string): void {
  const existing = classBindings.get(name);
  if (!existing) classBindings.set(name, className);
  else if (existing !== className) classBindings.set(name, RUNNER_CAPABILITY_AMBIGUOUS_CLASS);
}
