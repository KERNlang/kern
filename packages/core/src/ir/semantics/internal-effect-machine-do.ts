import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { evalArrayLiteralValue, isArrayLiteralExpression, type PortableArrayElement } from './portable-array.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import { assertPortableMachineLetShape, assertPortableMachineScalarShape } from './portable-machine-shape.js';
import { resolveParsedMapSet } from './portable-map.js';
import { isPortableBindingName } from './portable-scalar-domain.js';
import {
  assignBinding,
  assignPushBuiltFreshArrayBinding,
  getBinding,
  hasBinding,
  isCapturedArrayBinding,
  isPushBuiltFreshArrayBinding,
  type SemanticEnv,
} from './semantic-env.js';
import { emptyTrace, type Trace } from './trace.js';

export type ParsedInternalMachineDo =
  | { readonly kind: 'noop' }
  | { readonly element: ValueIR; readonly kind: 'push'; readonly targetName: string }
  | {
      readonly key: ValueIR;
      readonly kind: 'map-set';
      readonly targetName: string;
      readonly value: ValueIR;
    };

function pushCallTarget(node: ValueIR): { element: ValueIR; targetName: string } | undefined {
  if (node.kind !== 'call' || node.optional || node.args.length !== 1) return undefined;
  const callee = node.callee;
  if (callee.kind !== 'member' || callee.optional || callee.property !== 'push') return undefined;
  if (callee.object.kind !== 'ident' || !isPortableBindingName(callee.object.name)) return undefined;
  return { element: node.args[0], targetName: callee.object.name };
}

function mapSetCallTarget(node: ValueIR): { key: ValueIR; targetName: string; value: ValueIR } | undefined {
  if (node.kind !== 'call' || node.optional || node.args.length !== 3) return undefined;
  const callee = node.callee;
  if (
    callee.kind !== 'member' ||
    callee.optional ||
    callee.property !== 'set' ||
    callee.object.kind !== 'ident' ||
    callee.object.name !== 'Map'
  ) {
    return undefined;
  }
  const target = node.args[0];
  if (target.kind !== 'ident' || !isPortableBindingName(target.name)) return undefined;
  return { key: node.args[1], targetName: target.name, value: node.args[2] };
}

function assertPushElementShape(node: ValueIR): void {
  if (isArrayLiteralExpression(node)) {
    assertPortableMachineLetShape(node);
    return;
  }
  assertPortableMachineScalarShape(node);
  if (node.kind === 'numLit' && isIntegerValuedFloatLiteral(node)) {
    throw new Error('portable: float literal has an integer value (float/int divergence)');
  }
}

export function parseInternalMachineDo(node: IRNode): ParsedInternalMachineDo {
  const raw = node.props?.value;
  if (raw === undefined || raw === '') return { kind: 'noop' };
  const parsed = parseExpression(String(raw));
  const push = pushCallTarget(parsed);
  if (push) {
    assertPushElementShape(push.element);
    return { element: push.element, kind: 'push', targetName: push.targetName };
  }
  const mapSet = mapSetCallTarget(parsed);
  if (mapSet) {
    assertPortableMachineScalarShape(mapSet.key);
    assertPortableMachineScalarShape(mapSet.value);
    return { ...mapSet, kind: 'map-set' };
  }
  throw new Error('do: only "<array>.push(<element>)" and "Map.set(<map>, <key>, <value>)" are supported');
}

export function internalMachineDoTargetName(node: IRNode): string | undefined {
  const parsed = parseInternalMachineDo(node);
  return parsed.kind === 'noop' ? undefined : parsed.targetName;
}

export function assertInternalMachineDoNamespaceAvailable(parsed: ParsedInternalMachineDo, env: SemanticEnv): void {
  if (parsed.kind === 'map-set' && hasBinding(env, 'Map')) {
    throw new Error('portable machine: namespace "Map" is shadowed');
  }
}

function evalPortableArrayElement(node: ValueIR, env: SemanticEnv): PortableArrayElement {
  return isArrayLiteralExpression(node)
    ? evalArrayLiteralValue(node, env, evalPortableValue)
    : evalPortableValue(node, env);
}

function isIntegerValuedFloatLiteral(node: Extract<ValueIR, { kind: 'numLit' }>): boolean {
  return (node.raw.includes('.') || /[eE]/.test(node.raw)) && Number.isInteger(node.value);
}

function isFreshnessPreservingPushElement(node: ValueIR): boolean {
  if (node.kind === 'strLit' || node.kind === 'boolLit' || node.kind === 'nullLit') return true;
  if (node.kind !== 'numLit') return false;
  if (node.bigint || !Number.isFinite(node.value)) return false;
  if (isIntegerValuedFloatLiteral(node)) {
    throw new Error('portable: float literal has an integer value (float/int divergence)');
  }
  return true;
}

export function runInternalMachineDo(node: IRNode, env: SemanticEnv): Trace {
  const parsed = parseInternalMachineDo(node);
  if (parsed.kind === 'noop') return emptyTrace();
  assertInternalMachineDoNamespaceAvailable(parsed, env);
  if (!hasBinding(env, parsed.targetName)) throw new Error(`do: binding "${parsed.targetName}" not found`);
  if (parsed.kind === 'push') {
    const current = getBinding(env, parsed.targetName);
    if (!Array.isArray(current)) {
      throw new Error(`do: "${parsed.targetName}.push(...)" requires an array binding`);
    }
    if (isCapturedArrayBinding(env, parsed.targetName)) {
      throw new Error(`fresh array binding "${parsed.targetName}" was already captured by a record field`);
    }
    const next = Object.freeze([...current, evalPortableArrayElement(parsed.element, env)]);
    if (isPushBuiltFreshArrayBinding(env, parsed.targetName) && isFreshnessPreservingPushElement(parsed.element)) {
      assignPushBuiltFreshArrayBinding(env, parsed.targetName, next);
    } else {
      assignBinding(env, parsed.targetName, next);
    }
    return emptyTrace();
  }
  const resolved = resolveParsedMapSet(parsed.targetName, parsed.key, parsed.value, env, evalPortableValue);
  assignBinding(env, resolved.targetName, resolved.newMap);
  return emptyTrace();
}
