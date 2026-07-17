import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import { assertDeferredMachineScalarPreflight } from './deferred-expression-preflight.js';
import {
  createInternalMachineClassInstance,
  makeInternalMachineClassMemberEnv,
} from './internal-effect-machine-class-activation.js';
import { internalMachineClassConstructorPlan } from './internal-effect-machine-class-construction.js';
import {
  assertInternalMachineClassGraph,
  internalMachineClassMethodForCall,
} from './internal-effect-machine-class-graph.js';
import { INTERNAL_MACHINE_PREFLIGHT_CLASS_OWNER } from './internal-effect-machine-class-instance.js';
import { internalMachineClassVisibleFields } from './internal-effect-machine-class-lineage.js';
import { preflightInternalMachineClassLet } from './internal-effect-machine-class-runtime.js';
import {
  classifyInternalMachineClassScalarValue,
  internalMachineClassValueUsesPrivateReceiver,
} from './internal-effect-machine-class-value.js';
import {
  internalMachineHelperCallInValue,
  isInternalMachineHelperCall,
} from './internal-effect-machine-helper-graph.js';
import {
  bindInternalEffectMachineState,
  internalEffectMachineStateForEnv,
} from './internal-effect-machine-helper-state.js';
import type { EvalPortableValue } from './portable-eval-types.js';
import { evalPortableValue } from './portable-machine-evaluator.js';
import { assertPortableMachineScalarShape } from './portable-machine-shape.js';
import type { RunnerClassInstanceValue, SemanticEnv } from './semantic-env.js';
import type { CompletionKind } from './trace.js';

type ClassBodyAnalyzer = (
  nodes: readonly IRNode[],
  loopDepth: number,
  env: SemanticEnv,
  unstableBindings: Set<string>,
  evaluateControls: boolean,
) => Set<CompletionKind>;

function assertScalarReturns(nodes: readonly IRNode[], env: SemanticEnv): void {
  for (const node of nodes) {
    if (node.type === 'return') {
      const value = node.props?.value;
      if (
        typeof value !== 'string' ||
        value === '' ||
        classifyInternalMachineClassScalarValue(parseExpression(value), env) === 'unsupported'
      ) {
        throw new Error('machine class: member must return a portable scalar');
      }
    }
    if (node.children) assertScalarReturns(node.children, env);
  }
}

function assertClassExpression(
  node: ReturnType<typeof parseExpression>,
  fields: ReadonlySet<string>,
  env: SemanticEnv,
  allowClassCall = false,
): void {
  if (
    node.kind === 'numLit' ||
    node.kind === 'strLit' ||
    node.kind === 'boolLit' ||
    node.kind === 'nullLit' ||
    node.kind === 'ident'
  ) {
    return;
  }
  if (node.kind === 'member') {
    if (node.optional || node.object.kind !== 'ident' || node.object.name !== 'this' || !fields.has(node.property)) {
      throw new Error('machine class: member expression references an unavailable field');
    }
    return;
  }
  if (node.kind === 'unary') {
    assertClassExpression(node.argument, fields, env, allowClassCall);
    return;
  }
  if (node.kind === 'binary') {
    assertClassExpression(node.left, fields, env, allowClassCall);
    assertClassExpression(node.right, fields, env, allowClassCall);
    return;
  }
  if (node.kind === 'conditional') {
    assertClassExpression(node.test, fields, env, allowClassCall);
    assertClassExpression(node.consequent, fields, env, allowClassCall);
    assertClassExpression(node.alternate, fields, env, allowClassCall);
    return;
  }
  if (node.kind === 'typeAssert' || node.kind === 'nonNull') {
    assertClassExpression(node.expression, fields, env, allowClassCall);
    return;
  }
  if (node.kind === 'tmplLit') {
    for (const expression of node.expressions) assertClassExpression(expression, fields, env, allowClassCall);
    return;
  }
  if (node.kind === 'objectLit') {
    for (const entry of node.entries) {
      assertClassExpression('kind' in entry ? entry.argument : entry.value, fields, env, allowClassCall);
    }
    return;
  }
  if (node.kind === 'arrayLit') {
    for (const item of node.items) assertClassExpression(item, fields, env, allowClassCall);
    return;
  }
  if (
    node.kind === 'call' &&
    !node.optional &&
    node.callee.kind === 'ident' &&
    isInternalMachineHelperCall(node.callee.name, node.args.length, env) &&
    allowClassCall
  ) {
    if (node.args.some(internalMachineClassValueUsesPrivateReceiver)) {
      throw new Error('machine class: helper arguments cannot contain the private receiver');
    }
    for (const argument of node.args) assertClassExpression(argument, fields, env, allowClassCall);
    return;
  }
  if (
    node.kind === 'call' &&
    !node.optional &&
    node.callee.kind === 'member' &&
    !node.callee.optional &&
    node.callee.object.kind === 'ident' &&
    (node.callee.object.name === 'super' || node.callee.object.name === 'this') &&
    allowClassCall
  ) {
    const resolved = internalMachineClassMethodForCall(node, env);
    if (!resolved || node.args.length !== resolved.method.params.length) {
      throw new Error('machine class: class method call is unavailable');
    }
    for (const argument of node.args) assertClassExpression(argument, fields, env, allowClassCall);
    return;
  }
  throw new Error(`machine class: expression kind "${node.kind}" is outside this frame slice`);
}

function assertClassBodyExpressions(nodes: readonly IRNode[], fields: ReadonlySet<string>, env: SemanticEnv): void {
  for (const node of nodes) {
    if (node.type === 'assign' && typeof node.props?.target === 'string' && node.props.target.startsWith('this.')) {
      const field = /^this\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(node.props.target)?.[1];
      if (!field || !fields.has(field)) {
        throw new Error('machine class: assignment target references an unavailable field');
      }
    }
    for (const key of ['cond', 'expr', 'from', 'in', 'input', 'on', 'step', 'to', 'value'] as const) {
      if (
        key === 'value' &&
        node.type === 'path' &&
        (node.props?.default === true ||
          node.props?.default === 'true' ||
          node.__quotedProps?.includes('value') === true)
      ) {
        continue;
      }
      const value = node.props?.[key];
      if (typeof value === 'string' && value !== '') {
        const allowClassCall = key === 'value' && ['let', 'print', 'return'].includes(node.type);
        assertClassExpression(parseExpression(value), fields, env, allowClassCall);
      }
    }
    if (typeof node.props?.template === 'string') {
      assertClassExpression(parseExpression(`\`${node.props.template}\``), fields, env);
    }
    if (node.children) assertClassBodyExpressions(node.children, fields, env);
  }
}

function markDefiniteConstructorFieldAssignments(
  nodes: readonly IRNode[],
  instance: RunnerClassInstanceValue,
  fields: ReadonlySet<string>,
): void {
  for (const node of nodes) {
    const field =
      node.type === 'assign' && typeof node.props?.target === 'string'
        ? /^this\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(node.props.target)?.[1]
        : undefined;
    if (field && fields.has(field) && Object.hasOwn(instance.fields, field)) instance.fields[field] = null;
  }
}

export function assertInternalMachineClassFramePreflight(env: SemanticEnv, analyze: ClassBodyAnalyzer): void {
  const registry = assertInternalMachineClassGraph(env).classes;
  const activeState = internalEffectMachineStateForEnv(env);
  const preflightState = {
    classRegistry: registry,
    helperBodyRunner: activeState?.helperBodyRunner,
    helperRegistry: activeState?.helperRegistry,
    remainingIterations: undefined,
  };
  for (const cls of registry.values()) {
    const visibleFields = internalMachineClassVisibleFields(cls, registry);
    const constructorValues = (cls.constructor?.params ?? []).map(() => null);
    const { constructorEnv, instance } = createInternalMachineClassInstance(
      cls,
      env,
      constructorValues,
      evalPortableValue,
      INTERNAL_MACHINE_PREFLIGHT_CLASS_OWNER,
      registry,
    );
    if (cls.constructor) {
      const restore = bindInternalEffectMachineState(constructorEnv, preflightState);
      try {
        const plan = internalMachineClassConstructorPlan(cls, registry);
        for (const argument of plan.superArguments) {
          if (internalMachineHelperCallInValue(argument, constructorEnv)) {
            throw new Error(`machine class: constructor "${cls.name}" uses a helper in super arguments`);
          }
          assertPortableMachineScalarShape(argument, constructorEnv);
        }
        assertClassBodyExpressions(plan.body, visibleFields, constructorEnv);
        const completions = analyze(plan.body, 0, constructorEnv, new Set(cls.constructor.params), true);
        if (completions.size !== 1 || !completions.has('normal')) {
          throw new Error(`machine class: constructor "${cls.name}" must complete normally`);
        }
        markDefiniteConstructorFieldAssignments(plan.body, instance, visibleFields);
      } finally {
        restore();
      }
    }
    for (const member of [...cls.methods.values(), ...cls.getters.values()]) {
      const memberEnv = makeInternalMachineClassMemberEnv(
        cls,
        member,
        instance,
        member.params.map(() => null),
        env,
        registry,
      );
      const restore = bindInternalEffectMachineState(memberEnv, preflightState);
      try {
        assertClassBodyExpressions(member.body, visibleFields, memberEnv);
        const completions = analyze(member.body, 0, memberEnv, new Set([...member.params, 'this']), true);
        if (completions.size !== 1 || !completions.has('return')) {
          throw new Error(`machine class: member "${cls.name}.${member.name}" must return on every path`);
        }
        assertScalarReturns(member.body, memberEnv);
      } finally {
        restore();
      }
    }
  }
}

export function preflightDeferredInternalMachineClassLet(
  node: IRNode,
  env: SemanticEnv,
  evaluate: EvalPortableValue,
  deferredBindings: ReadonlySet<string>,
): boolean {
  return preflightInternalMachineClassLet(
    node,
    env,
    evaluate,
    false,
    deferredBindings,
    assertDeferredMachineScalarPreflight,
  );
}
