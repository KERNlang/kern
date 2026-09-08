import type { CanonicalValue } from '../../canonical-value/types.js';
import type { StructuralKirNode } from '../../kir-structural/types.js';
import type { RuntimeMeter } from '../inspect.js';
import { nodeChildren, nodeProperties } from '../inspect.js';
import type { LinkedKernKirExpression, LinkedKernKirStatement } from './contracts.js';
import {
  compileLinkedExpression,
  containsAsyncCall,
  crossCallExpressionType,
  staticExpressionType,
} from './expression.js';
import {
  assertLeaf,
  assignTargetName,
  bindName,
  branchScope,
  fault,
  type LinkScope,
  nodeKind,
  propertySet,
  propertyText,
} from './link-support.js';

// RT-4 rejected a capability anywhere in the reachable callee closure at every call position. RT-5
// narrows that to a callee reached from a position with no statement-value continuation, so the
// retained KIR_CALL_CALLEE_CAPABILITY label still names why the position gate refused.
const ASYNC_POSITION_LABEL = 'KIR_ASYNC_CALL_EXPRESSION_POSITION (KIR_CALL_CALLEE_CAPABILITY)';

const ABRUPT_KINDS = Object.freeze(['break', 'continue', 'return', 'throw']);

type LinkedKernKirTry = Extract<LinkedKernKirStatement, { readonly kind: 'try' }>;

function assertAsyncCallPosition(
  value: LinkedKernKirExpression,
  scope: LinkScope,
  label: string,
  statementValue: boolean,
): void {
  const misplaced =
    statementValue && value.kind === 'user-call'
      ? value.arguments.some((argument) => containsAsyncCall(argument, scope))
      : containsAsyncCall(value, scope);
  if (misplaced) fault('handler-entry-unsupported', `${label}: ${ASYNC_POSITION_LABEL}`);
}

function compileThrow(
  properties: ReadonlyMap<string, CanonicalValue>,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): LinkedKernKirStatement {
  if (!scope.tryFamily) fault('handler-entry-unsupported', `${label}: KIR_TRY_FAMILY_IN_HELPER`);
  propertySet(properties, ['value'], ['trailingComment'], label);
  const raw = properties.get('value') as CanonicalValue;
  const value = compileLinkedExpression(raw, scope, meter, `${label}.value`);
  assertAsyncCallPosition(value, scope, `${label}.value`, true);
  if (value.kind === 'identifier' && scope.payloads.has(value.name)) {
    return Object.freeze({ kind: 'throw' as const, value });
  }
  if (value.kind !== 'record') fault('handler-entry-unsupported', `${label}: KIR_THROW_PAYLOAD_SHAPE`);
  const entries = new Map(value.entries.map((entry) => [entry.key, entry.value]));
  const keys = [...entries.keys()].sort().join(',');
  const message = entries.get('message');
  const code = entries.get('code');
  const typed = (candidate: LinkedKernKirExpression | undefined): boolean =>
    candidate !== undefined &&
    (crossCallExpressionType(candidate, scope) === 'text' ||
      (candidate.kind === 'literal' && candidate.value.tag === 'null'));
  if ((keys !== 'message' && keys !== 'code,message') || !typed(message) || (code !== undefined && !typed(code))) {
    fault('handler-entry-unsupported', `${label}: KIR_THROW_PAYLOAD_SHAPE`);
  }
  const nullCode = { key: 'code', value: { kind: 'literal', value: { tag: 'null' } } } as const;
  const completed = code === undefined ? [nullCode, ...value.entries] : value.entries;
  return Object.freeze({
    kind: 'throw' as const,
    value: Object.freeze({ kind: 'record' as const, entries: Object.freeze(completed) }),
  });
}

function compileStatement(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): LinkedKernKirStatement {
  meter.step();
  const kind = nodeKind(node, label);
  const properties = nodeProperties(node, label);
  assertLeaf(node, label);
  if (kind === 'break' || kind === 'continue') {
    propertySet(properties, [], ['trailingComment'], label);
    if (scope.loopDepth === 0) {
      const reason = kind === 'break' ? 'KIR_BREAK_OUTSIDE_LOOP' : 'KIR_CONTINUE_OUTSIDE_LOOP';
      fault('handler-entry-unsupported', `${label}: ${reason}`);
    }
    if (scope.finallyDepth > scope.loopFinallyDepth) {
      fault('handler-entry-unsupported', `${label}: KIR_LOOP_JUMP_CROSSES_TRY`);
    }
    return Object.freeze({ kind });
  }
  if (kind === 'let') {
    propertySet(properties, ['name', 'value'], [], label);
    const name = propertyText(properties, 'name', label, meter);
    if (scope.bindings.has(name)) fault('handler-entry-unsupported', `${label}: duplicate binding ${name}`);
    const value = properties.get('value');
    if (value === undefined) fault('handler-entry-unsupported', `${label}.value`);
    const compiled = Object.freeze({
      kind: 'let' as const,
      name,
      value: compileLinkedExpression(value, scope, meter, `${label}.value`),
    });
    assertAsyncCallPosition(compiled.value, scope, `${label}.value`, true);
    bindName(scope, name, staticExpressionType(compiled.value, scope), crossCallExpressionType(compiled.value, scope));
    scope.assignable.add(name);
    return compiled;
  }
  if (kind === 'capability') {
    propertySet(properties, ['name', 'namespace', 'operation'], ['input'], label);
    const name = propertyText(properties, 'name', label, meter);
    if (scope.bindings.has(name)) fault('handler-entry-unsupported', `${label}: duplicate binding ${name}`);
    const input = properties.get('input');
    const compiled = Object.freeze({
      kind: 'capability' as const,
      name,
      namespace: propertyText(properties, 'namespace', label, meter),
      operation: propertyText(properties, 'operation', label, meter),
      input: input === undefined ? undefined : compileLinkedExpression(input, scope, meter, `${label}.input`),
    });
    if (compiled.input !== undefined) assertAsyncCallPosition(compiled.input, scope, `${label}.input`, false);
    bindName(scope, name, undefined, undefined);
    scope.assignable.add(name);
    return compiled;
  }
  if (kind === 'assign') {
    propertySet(properties, ['target', 'value'], ['op'], label);
    if (properties.has('op')) fault('handler-entry-unsupported', `${label}: KIR_ASSIGN_OP_UNSUPPORTED`);
    const target = assignTargetName(properties.get('target'), `${label}.target`, meter);
    if (!scope.bindings.has(target)) fault('handler-entry-unsupported', `${label}: KIR_ASSIGN_UNDECLARED ${target}`);
    if (!scope.assignable.has(target)) {
      const reason = scope.counters.has(target) ? 'KIR_ASSIGN_TO_LOOP_COUNTER' : 'KIR_ASSIGN_TARGET_NOT_LET';
      fault('handler-entry-unsupported', `${label}: ${reason} ${target}`);
    }
    const value = properties.get('value');
    if (value === undefined) fault('handler-entry-unsupported', `${label}.value`);
    const compiled = Object.freeze({
      kind: 'assign' as const,
      target,
      value: compileLinkedExpression(value, scope, meter, `${label}.value`),
    });
    assertAsyncCallPosition(compiled.value, scope, `${label}.value`, true);
    // An assign never rebinds a link-time type record, so every downstream gate that read the
    // binding's recorded type stays valid without re-deriving it.
    if (
      staticExpressionType(compiled.value, scope) !== scope.types.get(target) ||
      crossCallExpressionType(compiled.value, scope) !== scope.crossCallTypes.get(target)
    ) {
      fault('handler-entry-unsupported', `${label}: KIR_ASSIGN_TYPE_MISMATCH ${target}`);
    }
    return compiled;
  }
  if (kind === 'print' || kind === 'return') {
    propertySet(properties, ['value'], [], label);
    const value = properties.get('value');
    if (value === undefined) fault('handler-entry-unsupported', `${label}.value`);
    const compiled = Object.freeze({ kind, value: compileLinkedExpression(value, scope, meter, `${label}.value`) });
    assertAsyncCallPosition(compiled.value, scope, `${label}.value`, true);
    return compiled;
  }
  if (kind === 'throw') return compileThrow(properties, scope, meter, label);
  fault('handler-entry-unsupported', `${label}: statement kind ${kind} is outside RT-1`);
}

function compileBranch(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): readonly LinkedKernKirStatement[] {
  const children = nodeChildren(node, label);
  if (children.length === 0) fault('handler-entry-unsupported', `${label}: branch block is empty`);
  return compileBlock(children, branchScope(scope), meter, label);
}

function compileCatch(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): Pick<LinkedKernKirTry, 'binding' | 'catchBody'> {
  const properties = nodeProperties(node, label);
  propertySet(properties, [], ['name'], label);
  const catchScope = branchScope(scope);
  const binding = properties.has('name') ? propertyText(properties, 'name', label, meter) : undefined;
  if (binding !== undefined) {
    if (catchScope.bindings.has(binding)) fault('handler-entry-unsupported', `${label}: duplicate binding ${binding}`);
    catchScope.bindings.add(binding);
    catchScope.payloads.add(binding);
  }
  const catchBody = compileBranch(node, catchScope, meter, label);
  return binding === undefined ? { catchBody } : { binding, catchBody };
}

function compileFinally(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): readonly LinkedKernKirStatement[] {
  propertySet(nodeProperties(node, label), [], [], label);
  const abrupt = (nodes: readonly StructuralKirNode[], at: string): boolean =>
    nodes.some((child, index) => {
      const childLabel = `${at}.children[${index}]`;
      const kind = nodeKind(child, childLabel);
      return ABRUPT_KINDS.includes(kind) || abrupt(nodeChildren(child, childLabel), childLabel);
    });
  const stray = `${label}: KIR_ABRUPT_FINALLY_UNSUPPORTED`;
  if (abrupt(nodeChildren(node, label), label)) fault('handler-entry-unsupported', stray);
  return compileBranch(node, scope, meter, label);
}

// F5 admits a clause both as a child of the `try` and as its following sibling, so the partition runs
// over the concatenation -- and a clause that follows a NESTED try belongs to that try, not to this one.
function compileTry(
  node: StructuralKirNode,
  siblings: readonly StructuralKirNode[],
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): LinkedKernKirStatement {
  if (!scope.tryFamily) fault('handler-entry-unsupported', `${label}: KIR_TRY_FAMILY_IN_HELPER`);
  propertySet(nodeProperties(node, label), [], [], label);
  const children = nodeChildren(node, label);
  let claimed = false;
  const clauseAt = children.findIndex((child, index) => {
    const kind = nodeKind(child, `${label}.children[${index}]`);
    if (kind === 'catch' || kind === 'finally') return !claimed;
    claimed = kind === 'try';
    return false;
  });
  const bodyNodes = clauseAt < 0 ? children : children.slice(0, clauseAt);
  if (bodyNodes.length === 0) fault('handler-entry-unsupported', `${label}.body: branch block is empty`);
  const clauses = [...(clauseAt < 0 ? [] : children.slice(clauseAt)), ...siblings];
  let catchNode: StructuralKirNode | undefined;
  let finallyNode: StructuralKirNode | undefined;
  for (let index = 0; index < clauses.length; index += 1) {
    const clauseLabel = `${label}.clauses[${index}]`;
    const kind = nodeKind(clauses[index], clauseLabel);
    if (kind === 'catch') {
      if (finallyNode !== undefined) fault('handler-entry-unsupported', `${clauseLabel}: KIR_CATCH_AFTER_FINALLY`);
      if (catchNode !== undefined) fault('handler-entry-unsupported', `${clauseLabel}: KIR_DUPLICATE_CATCH`);
      catchNode = clauses[index];
    } else if (kind === 'finally') {
      if (finallyNode !== undefined) fault('handler-entry-unsupported', `${clauseLabel}: KIR_DUPLICATE_FINALLY`);
      finallyNode = clauses[index];
    } else {
      fault('handler-entry-unsupported', `${clauseLabel}: KIR_TRY_BODY_AFTER_CLAUSE`);
    }
  }
  const unclaused = `${label}: KIR_TRY_REQUIRES_CATCH_OR_FINALLY`;
  if (catchNode === undefined && finallyNode === undefined) fault('handler-entry-unsupported', unclaused);
  const guarded = { ...branchScope(scope), finallyDepth: scope.finallyDepth + (finallyNode === undefined ? 0 : 1) };
  const body = compileBlock(bodyNodes, branchScope(guarded), meter, `${label}.body`);
  const caught = catchNode === undefined ? undefined : compileCatch(catchNode, guarded, meter, `${label}.catch`);
  const cleanup =
    finallyNode === undefined ? undefined : compileFinally(finallyNode, guarded, meter, `${label}.finally`);
  return Object.freeze({
    body,
    catchBody: Object.freeze([]),
    ...caught,
    ...(cleanup === undefined ? {} : { finallyBody: cleanup }),
    kind: 'try' as const,
  });
}

function compileIf(
  node: StructuralKirNode,
  elseNode: StructuralKirNode | undefined,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): LinkedKernKirStatement {
  meter.step();
  const properties = nodeProperties(node, label);
  propertySet(properties, ['cond'], [], label);
  const cond = properties.get('cond');
  if (cond === undefined) fault('handler-entry-unsupported', `${label}.cond`);
  const condition = compileLinkedExpression(cond, scope, meter, `${label}.cond`);
  assertAsyncCallPosition(condition, scope, `${label}.cond`, false);
  if (staticExpressionType(condition, scope) !== 'boolean') {
    fault('handler-entry-unsupported', `${label}.cond: KIR_IF_COND_NOT_BOOLEAN`);
  }
  const thenBranch = compileBranch(node, scope, meter, `${label}.then`);
  let elseBranch: readonly LinkedKernKirStatement[] | undefined;
  if (elseNode !== undefined) {
    const elseLabel = `${label}.else`;
    propertySet(nodeProperties(elseNode, elseLabel), [], [], elseLabel);
    elseBranch = compileBranch(elseNode, scope, meter, elseLabel);
  }
  return Object.freeze({ kind: 'if' as const, condition, thenBranch, elseBranch });
}

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

function compileFor(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
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

function compileWhile(
  node: StructuralKirNode,
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
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

export function compileBlock(
  nodes: readonly StructuralKirNode[],
  scope: LinkScope,
  meter: RuntimeMeter,
  label: string,
): readonly LinkedKernKirStatement[] {
  const statements: LinkedKernKirStatement[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const childLabel = `${label}.children[${index}]`;
    const node = nodes[index];
    const kind = nodeKind(node, childLabel);
    if (kind === 'for') {
      statements.push(compileFor(node, scope, meter, childLabel));
      continue;
    }
    if (kind === 'while') {
      statements.push(compileWhile(node, scope, meter, childLabel));
      continue;
    }
    if (kind === 'try') {
      const clauses: StructuralKirNode[] = [];
      while (nodes[index + 1] !== undefined) {
        const nextLabel = `${label}.children[${index + 1}]`;
        const nextKind = nodeKind(nodes[index + 1], nextLabel);
        if (nextKind !== 'catch' && nextKind !== 'finally') break;
        clauses.push(nodes[index + 1]);
        index += 1;
      }
      statements.push(compileTry(node, clauses, scope, meter, childLabel));
      continue;
    }
    if (kind === 'catch') fault('handler-entry-unsupported', `${childLabel}: KIR_CATCH_WITHOUT_TRY`);
    if (kind === 'finally') fault('handler-entry-unsupported', `${childLabel}: KIR_FINALLY_WITHOUT_TRY`);
    if (kind !== 'if') {
      statements.push(compileStatement(node, scope, meter, childLabel));
      continue;
    }
    const next = nodes[index + 1];
    const paired = next !== undefined && nodeKind(next, `${label}.children[${index + 1}]`) === 'else';
    statements.push(compileIf(node, paired ? next : undefined, scope, meter, childLabel));
    if (paired) index += 1;
  }
  meter.collection(statements.length, label);
  return Object.freeze(statements);
}
