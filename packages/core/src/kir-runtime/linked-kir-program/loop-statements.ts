import type { CanonicalValue } from '../../canonical-value/types.js';
import type { StructuralKirNode } from '../../kir-structural/types.js';
import type { RuntimeMeter } from '../inspect.js';
import { canonicalRecord, nodeProperties } from '../inspect.js';
import type { LinkedKernKirExpression, LinkedKernKirStatement } from './contracts.js';
import { compileLinkedExpression, staticExpressionType } from './expression.js';
import {
  assertAsyncCallPosition,
  bindName,
  branchScope,
  fault,
  type LinkScope,
  propertySet,
  propertyText,
} from './link-support.js';

// A loop body is compiled by the block compiler that dispatched the loop. It arrives as an argument
// so this module never imports the dispatcher back, keeping the directory's import graph a DAG.
export type BranchCompiler = (
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
) => readonly LinkedKernKirStatement[];

// An omitted step is materialized as a literal one here, so no leg branches on its absence.
const LOOP_STEP_ONE: LinkedKernKirExpression = Object.freeze({
  kind: 'literal' as const,
  value: Object.freeze({ tag: 'integer' as const, value: '1' }),
});

// `propertySet` in `compileFor` already requires `from` and `to` before this runs; `step` is its
// only optional key, so a missing `from`/`to` here would mean that caller gate broke, not that a
// bound was omitted.
function loopBound(
  properties: ReadonlyMap<string, CanonicalValue>,
  key: string,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): LinkedKernKirExpression {
  const raw = properties.get(key);
  if (raw === undefined) {
    if (key !== 'step') fault('handler-entry-unsupported', `${label}.${key}: missing property`);
    return LOOP_STEP_ONE;
  }
  const boundLabel = `${label}.${key}`;
  const compiled = compileLinkedExpression(raw, scope, meter, boundLabel);
  assertAsyncCallPosition(compiled, scope, boundLabel, false);
  if (staticExpressionType(compiled, scope) !== 'integer') {
    fault('handler-entry-unsupported', `${boundLabel}: KIR_FOR_BOUND_NOT_INTEGER`);
  }
  return compiled;
}

export function compileFor(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
  compileBranch: BranchCompiler,
): LinkedKernKirStatement {
  meter.step();
  const properties = nodeProperties(node, label);
  propertySet(properties, ['from', 'name', 'to'], ['step'], label);
  const counter = propertyText(properties, 'name', label, meter);
  if (scope.bindings.has(counter)) fault('handler-entry-unsupported', `${label}: duplicate binding ${counter}`);
  const from = loopBound(properties, 'from', scope, meter, label);
  const to = loopBound(properties, 'to', scope, meter, label);
  const step = loopBound(properties, 'step', scope, meter, label);
  if (step.kind === 'literal' && step.value.tag === 'integer' && BigInt(step.value.value) === 0n) {
    fault('handler-entry-unsupported', `${label}.step: KIR_FOR_ZERO_STEP`);
  }
  // The counter binds into the body scope and never into `assignable`, so RT-9's one gate refuses an
  // assignment to it and `counters` only selects which label that refusal carries.
  const bodyScope = {
    ...branchScope(scope),
    loopDepth: scope.loopDepth + 1,
    loopFinallyDepth: scope.finallyDepth,
  };
  bindName(bodyScope, counter, 'integer', 'integer');
  bodyScope.counters.add(counter);
  return Object.freeze({
    body: compileBranch(node, bodyScope, meter, `${label}.body`),
    counter,
    from,
    kind: 'for' as const,
    step,
    to,
  });
}

export function compileEach(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
  compileBranch: BranchCompiler,
): LinkedKernKirStatement {
  meter.step();
  const properties = nodeProperties(node, label);
  propertySet(
    properties,
    ['in', 'name'],
    ['await', 'entries', 'entryKey', 'entryValue', 'index', 'pairKey', 'pairValue', 'trailingComment'],
    label,
  );
  if (properties.has('await')) fault('handler-entry-unsupported', `${label}: KIR_EACH_AWAIT_UNSUPPORTED`);
  if (properties.has('entries')) fault('handler-entry-unsupported', `${label}: KIR_EACH_ENTRIES_UNSUPPORTED`);
  if (properties.has('entryKey') || properties.has('entryValue')) {
    fault('handler-entry-unsupported', `${label}: KIR_EACH_ENTRY_MODE_UNSUPPORTED`);
  }
  if (properties.has('pairKey') || properties.has('pairValue')) {
    fault('handler-entry-unsupported', `${label}: KIR_EACH_PAIR_MODE_UNSUPPORTED`);
  }
  const input = properties.get('in');
  if (input === undefined) fault('handler-entry-unsupported', `${label}.in: missing property`);
  const reference = canonicalRecord(input, ['form', 'source'], `${label}.in`);
  const form = propertyText(reference, 'form', `${label}.in`, meter);
  if (form !== 'binding') {
    fault('handler-entry-unsupported', `${label}: KIR_EACH_RECORD_FIELD_UNSUPPORTED`);
  }
  const source = propertyText(reference, 'source', `${label}.in`, meter);
  const sourceType = scope.parameters.get(source);
  if (sourceType === undefined) fault('handler-entry-unsupported', `${label}: KIR_EACH_SOURCE_NOT_PARAMETER`);
  if (sourceType.kind !== 'list') fault('handler-entry-unsupported', `${label}: KIR_EACH_SOURCE_NOT_LIST`);
  const item = propertyText(properties, 'name', label, meter);
  const index = properties.has('index') ? propertyText(properties, 'index', label, meter) : undefined;
  if (index === item) fault('handler-entry-unsupported', `${label}: duplicate binding ${item}`);
  for (const name of index === undefined ? [item] : [item, index]) {
    if (scope.bindings.has(name)) fault('handler-entry-unsupported', `${label}: duplicate binding ${name}`);
  }
  const bodyScope = {
    ...branchScope(scope),
    loopDepth: scope.loopDepth + 1,
    loopFinallyDepth: scope.finallyDepth,
  };
  const staticType = sourceType.element === 'text' ? undefined : sourceType.element;
  bindName(bodyScope, item, staticType, sourceType.element);
  bodyScope.eachBindings.add(item);
  if (index !== undefined) {
    bindName(bodyScope, index, 'integer', 'integer');
    bodyScope.eachBindings.add(index);
  }
  return Object.freeze({
    body: compileBranch(node, bodyScope, meter, `${label}.body`),
    ...(index === undefined ? {} : { index }),
    item,
    kind: 'each' as const,
    source,
  });
}

export function compileWhile(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
  compileBranch: BranchCompiler,
): LinkedKernKirStatement {
  meter.step();
  const properties = nodeProperties(node, label);
  propertySet(properties, ['cond'], [], label);
  const cond = properties.get('cond');
  if (cond === undefined) fault('handler-entry-unsupported', `${label}.cond`);
  const condition = compileLinkedExpression(cond, scope, meter, `${label}.cond`);
  assertAsyncCallPosition(condition, scope, `${label}.cond`, false);
  if (staticExpressionType(condition, scope) !== 'boolean') {
    fault('handler-entry-unsupported', `${label}.cond: KIR_WHILE_COND_NOT_BOOLEAN`);
  }
  const bodyScope = {
    ...branchScope(scope),
    loopDepth: scope.loopDepth + 1,
    loopFinallyDepth: scope.finallyDepth,
  };
  return Object.freeze({
    body: compileBranch(node, bodyScope, meter, `${label}.body`),
    condition,
    kind: 'while' as const,
  });
}
