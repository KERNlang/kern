import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { assertAcyclicLambdaSetupClosures } from './lambda-closure-graph.js';
import { checkLambdaPreconditions } from './lambda-preconditions.js';
import { assertLambdaBinaryOperator, assertLambdaUnaryOperator } from './lambda-preflight-operators.js';
import {
  type StableArrayShape,
  type StableValue,
  stableArrayElementShape,
  stableArrayShape,
  stableValue,
} from './lambda-stable-value.js';
import { hasBinding, type SemanticEnv } from './semantic-env.js';

type LocalKind = 'closure' | 'closure-list' | 'value';
interface LocalFact {
  readonly kind: LocalKind;
  readonly callResult?: LocalFact;
  readonly closures?: readonly LocalClosureFact[];
}
interface LocalClosureFact {
  readonly body: ValueIR;
  readonly parameters: ReadonlySet<string>;
}
interface ParameterFacts {
  readonly deferred: ReadonlySet<string>;
  readonly shapes: ReadonlyMap<string, StableArrayShape>;
}
const VALUE_FACT: LocalFact = { kind: 'value' };
const CLOSURE_LIST_FACT: LocalFact = { kind: 'closure-list' };

export function assertLambdaPreflight(
  ir: IRNode,
  env: SemanticEnv,
  unstableBindings: ReadonlySet<string>,
  evaluateValues: boolean,
): void {
  if (!checkLambdaPreconditions(ir)) throw new Error('lambda preflight: malformed node');
  assertAcyclicLambdaSetupClosures(ir);
  const localKinds = new Map<string, LocalFact>();
  const localValues = new Map<string, StableValue>();
  const localShapes = new Map<string, StableArrayShape>();
  const readyClosures = new Set<LocalFact>();
  const setupNames = new Set<string>();
  const setupClosureNames = new Set<string>();
  const localKind = (name: string): LocalKind | undefined => localKinds.get(name)?.kind;
  for (const child of ir.children ?? []) {
    const name = (child.type === 'let' ? child.props?.name : child.props?.target) as string;
    setupNames.add(name);
    const rawValue = child.props?.value;
    if (rawValue !== undefined && rawValue !== '' && parseExpression(String(rawValue)).kind === 'lambda') {
      setupClosureNames.add(name);
    }
  }

  function validate(
    node: ValueIR,
    parameters: ReadonlySet<string>,
    callableParameters: ReadonlySet<string> = new Set(),
    checkValues = evaluateValues,
    deferredSetup = false,
    parameterFacts: ParameterFacts = { deferred: new Set(), shapes: new Map() },
  ): void {
    switch (node.kind) {
      case 'numLit':
      case 'strLit':
      case 'boolLit':
      case 'nullLit':
      case 'undefLit':
        return;
      case 'ident':
        if (
          checkValues &&
          !(deferredSetup && setupNames.has(node.name)) &&
          !parameters.has(node.name) &&
          !localKinds.has(node.name) &&
          !unstableBindings.has(node.name) &&
          !hasBinding(env, node.name)
        ) {
          throw new Error(`lambda preflight: binding "${node.name}" not found`);
        }
        return;
      case 'arrayLit':
        for (const item of node.items) {
          validate(item, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
        }
        return;
      case 'objectLit':
        for (const entry of node.entries) {
          if ('kind' in entry && entry.kind === 'spread') {
            validate(entry.argument, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
          } else {
            validate(
              (entry as { value: ValueIR }).value,
              parameters,
              callableParameters,
              checkValues,
              deferredSetup,
              parameterFacts,
            );
          }
        }
        return;
      case 'member':
        if (node.object.kind === 'ident' && node.object.name === 'List') {
          if (node.property !== 'map' && node.property !== 'filter') {
            throw new Error(`lambda preflight: unsupported List method "${node.property}"`);
          }
          return;
        }
        validate(node.object, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
        if (checkValues && !node.optional) {
          const object = stableValue(
            node.object,
            env,
            localKinds,
            unstableBindings,
            localValues,
            parameters,
            parameterFacts.deferred,
          );
          if (object.known && (object.value === null || object.value === undefined)) {
            throw new Error('lambda preflight: member receiver must not be nullish');
          }
        }
        if (isPrivateClosureExpression(node.object, callableParameters)) {
          throw new Error('lambda preflight: private closure member access is not supported');
        }
        return;
      case 'index': {
        validate(node.object, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
        if (isPrivateClosureExpression(node.object, callableParameters)) {
          throw new Error('lambda preflight: private closure index access is not supported');
        }
        const object = checkValues
          ? stableValue(
              node.object,
              env,
              localKinds,
              unstableBindings,
              localValues,
              parameters,
              parameterFacts.deferred,
            )
          : { known: false };
        if (!node.optional && object.known && (object.value === null || object.value === undefined)) {
          throw new Error('lambda preflight: index receiver must not be nullish');
        }
        const indexValues = !(node.optional && object.known && (object.value === null || object.value === undefined));
        validate(node.index, parameters, callableParameters, checkValues && indexValues, deferredSetup, parameterFacts);
        return;
      }
      case 'call':
        validateCall(node, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
        return;
      case 'lambda': {
        if (node.bodyBlock || !node.body) throw new Error('lambda preflight: block-bodied closure');
        const inner = new Set(parameters);
        const innerShapes = new Map(parameterFacts.shapes);
        const innerDeferred = new Set(parameterFacts.deferred);
        for (const parameter of node.params) {
          inner.add(parameter.name);
          innerShapes.delete(parameter.name);
          innerDeferred.delete(parameter.name);
        }
        const innerCallable = new Set(callableParameters);
        for (const name of setupClosureNames) innerCallable.add(name);
        validate(node.body, inner, innerCallable, checkValues, true, {
          deferred: innerDeferred,
          shapes: innerShapes,
        });
        return;
      }
      case 'binary': {
        assertLambdaBinaryOperator(node.op);
        validate(node.left, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
        let rightValues = checkValues;
        if (checkValues && (node.op === '&&' || node.op === '||' || node.op === '??')) {
          const left = stableValue(
            node.left,
            env,
            localKinds,
            unstableBindings,
            localValues,
            parameters,
            parameterFacts.deferred,
          );
          if (left.known) {
            if (node.op === '&&' && !left.value) rightValues = false;
            if (node.op === '||' && left.value) rightValues = false;
            if (node.op === '??' && left.value !== null && left.value !== undefined) rightValues = false;
          }
        }
        validate(node.right, parameters, callableParameters, rightValues, deferredSetup, parameterFacts);
        return;
      }
      case 'unary':
        assertLambdaUnaryOperator(node.op);
        validate(node.argument, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
        return;
      case 'conditional': {
        validate(node.test, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
        const test = checkValues
          ? stableValue(node.test, env, localKinds, unstableBindings, localValues, parameters, parameterFacts.deferred)
          : { known: false };
        validate(
          node.consequent,
          parameters,
          callableParameters,
          checkValues && (!test.known || !!test.value),
          deferredSetup,
          parameterFacts,
        );
        validate(
          node.alternate,
          parameters,
          callableParameters,
          checkValues && (!test.known || !test.value),
          deferredSetup,
          parameterFacts,
        );
        return;
      }
      case 'nonNull':
      case 'typeAssert':
        validate(node.expression, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
        return;
      default:
        throw new Error(`lambda preflight: unsupported expression kind "${node.kind}"`);
    }
  }

  function validateCallable(node: ValueIR, callableParameters: ReadonlySet<string>, label: string): void {
    if (node.kind === 'lambda') return;
    if (node.kind === 'ident' && (callableParameters.has(node.name) || localKind(node.name) === 'closure')) return;
    if (classifyLocal(node).kind === 'closure') return;
    throw new Error(`lambda preflight: ${label} must be a private closure`);
  }

  function isPrivateClosureExpression(node: ValueIR, callableParameters: ReadonlySet<string>): boolean {
    return (node.kind === 'ident' && callableParameters.has(node.name)) || classifyLocal(node).kind === 'closure';
  }

  function validateClosureFactReady(fact: LocalFact, checkValues: boolean): void {
    if (fact.kind !== 'closure' || !fact.closures) return;
    if (readyClosures.has(fact)) throw new Error('lambda preflight: recursive setup closure is not supported');
    readyClosures.add(fact);
    try {
      for (const closure of fact.closures) {
        validate(closure.body, closure.parameters, new Set(), checkValues, false);
      }
    } finally {
      readyClosures.delete(fact);
    }
  }

  function validateCallableReady(node: ValueIR, checkValues: boolean): void {
    validateClosureFactReady(classifyLocal(node), checkValues);
  }

  function validateCall(
    node: Extract<ValueIR, { kind: 'call' }>,
    parameters: ReadonlySet<string>,
    callableParameters: ReadonlySet<string>,
    checkValues: boolean,
    deferredSetup: boolean,
    parameterFacts: ParameterFacts,
  ): void {
    if (
      node.callee.kind === 'member' &&
      node.callee.object.kind === 'ident' &&
      node.callee.object.name === 'List' &&
      (node.callee.property === 'map' || node.callee.property === 'filter')
    ) {
      if (node.args.length !== 2) throw new Error(`lambda preflight: List.${node.callee.property} expects 2 args`);
      validate(node.args[0], parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
      const stableSource = stableValue(
        node.args[0],
        env,
        localKinds,
        unstableBindings,
        localValues,
        parameters,
        parameterFacts.deferred,
      );
      const callback = node.args[1];
      if (callback.kind === 'lambda') {
        if (callback.bodyBlock || !callback.body) throw new Error('lambda preflight: block-bodied closure');
        const innerParameters = new Set(parameters);
        const innerShapes = new Map(parameterFacts.shapes);
        const innerDeferred = new Set(parameterFacts.deferred);
        const elementShape = stableArrayElementShape(
          node.args[0],
          env,
          localKinds,
          unstableBindings,
          localValues,
          parameters,
          parameterFacts.deferred,
        );
        for (let index = 0; index < callback.params.length; index += 1) {
          const parameter = callback.params[index];
          innerParameters.add(parameter.name);
          innerShapes.set(parameter.name, index === 0 ? elementShape : 'non-array');
          if (index === 0 && stableSource.deferred) innerDeferred.add(parameter.name);
          else innerDeferred.delete(parameter.name);
        }
        const innerCallable = new Set(callableParameters);
        for (const name of setupClosureNames) innerCallable.add(name);
        if (producesPrivateClosureList(node.args[0]) && callback.params[0]) {
          innerCallable.add(callback.params[0].name);
        }
        validate(callback.body, innerParameters, innerCallable, checkValues, true, {
          deferred: innerDeferred,
          shapes: innerShapes,
        });
      } else validate(callback, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
      validateCallable(callback, callableParameters, `List.${node.callee.property} callback`);
      const sourceShape = stableArrayShape(
        node.args[0],
        env,
        localKinds,
        unstableBindings,
        localValues,
        localShapes,
        parameters,
        parameterFacts.shapes,
        parameterFacts.deferred,
      );
      if (sourceShape === 'non-array') {
        throw new Error(`lambda preflight: List.${node.callee.property} source must be an array`);
      }
      if (checkValues && sourceShape === 'unknown' && !stableSource.deferred) {
        throw new Error(`lambda preflight: List.${node.callee.property} source array shape is not provable`);
      }
      return;
    }
    validate(node.callee, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
    for (const argument of node.args) {
      validate(argument, parameters, callableParameters, checkValues, deferredSetup, parameterFacts);
    }
    validateCallable(node.callee, callableParameters, 'call target');
    validateCallableReady(node.callee, checkValues);
  }

  function producesPrivateClosureList(node: ValueIR): boolean {
    if (node.kind === 'ident') return localKind(node.name) === 'closure-list';
    if (node.kind === 'arrayLit') {
      return node.items.every(
        (item) => item.kind === 'lambda' || (item.kind === 'ident' && localKind(item.name) === 'closure'),
      );
    }
    if (
      node.kind === 'call' &&
      node.callee.kind === 'member' &&
      node.callee.object.kind === 'ident' &&
      node.callee.object.name === 'List'
    ) {
      if (node.callee.property === 'filter') return node.args[0] ? producesPrivateClosureList(node.args[0]) : false;
      if (node.callee.property === 'map') {
        const callback = node.args[1];
        if (!callback || callback.kind === 'call') return false;
        const callbackFact = classifyLocal(callback);
        return callbackFact.kind === 'closure' && callbackFact.callResult?.kind === 'closure';
      }
    }
    return false;
  }

  function classifyLocal(value: ValueIR): LocalFact {
    if (value.kind === 'lambda') {
      const callResult = value.bodyBlock || !value.body ? VALUE_FACT : classifyLocal(value.body);
      return {
        kind: 'closure',
        callResult,
        closures:
          value.bodyBlock || !value.body
            ? undefined
            : [{ body: value.body, parameters: new Set(value.params.map((parameter) => parameter.name)) }],
      };
    }
    if (value.kind === 'ident') {
      return localKinds.get(value.name) ?? VALUE_FACT;
    }
    if (value.kind === 'call') {
      const callee = classifyLocal(value.callee);
      if (callee.kind === 'closure') return callee.callResult ?? VALUE_FACT;
    }
    if (value.kind === 'conditional') {
      return mergeLocalFacts(classifyLocal(value.consequent), classifyLocal(value.alternate));
    }
    return producesPrivateClosureList(value) ? CLOSURE_LIST_FACT : VALUE_FACT;
  }

  function mergeLocalFacts(left: LocalFact, right: LocalFact): LocalFact {
    if (left.kind === 'closure-list' && right.kind === 'closure-list') return CLOSURE_LIST_FACT;
    if (left.kind !== 'closure' || right.kind !== 'closure') return VALUE_FACT;
    return {
      kind: 'closure',
      callResult: mergeLocalFacts(left.callResult ?? VALUE_FACT, right.callResult ?? VALUE_FACT),
      closures: [...(left.closures ?? []), ...(right.closures ?? [])],
    };
  }

  for (const child of ir.children ?? []) {
    const rawValue = child.props?.value;
    if (child.type === 'let') {
      const name = child.props?.name as string;
      if (rawValue !== undefined && rawValue !== '') {
        const value = parseExpression(String(rawValue));
        validate(value, new Set());
        localValues.set(name, stableValue(value, env, localKinds, unstableBindings, localValues));
        localShapes.set(name, stableArrayShape(value, env, localKinds, unstableBindings, localValues, localShapes));
        localKinds.set(name, classifyLocal(value));
      } else {
        localValues.set(name, { known: true, value: undefined });
        localShapes.set(name, 'non-array');
        localKinds.set(name, VALUE_FACT);
      }
    } else {
      const target = child.props?.target as string;
      const value = parseExpression(String(rawValue));
      validate(value, new Set());
      localValues.set(target, stableValue(value, env, localKinds, unstableBindings, localValues));
      localShapes.set(target, stableArrayShape(value, env, localKinds, unstableBindings, localValues, localShapes));
      localKinds.set(target, classifyLocal(value));
    }
  }
  for (const fact of localKinds.values()) validateClosureFactReady(fact, evaluateValues);
  validate(parseExpression(ir.props?.expr as string), new Set());
}

export function lambdaRequiresIterationBudget(ir: IRNode): boolean {
  if (!checkLambdaPreconditions(ir)) return false;
  const expressions = [
    parseExpression(ir.props?.expr as string),
    ...(ir.children ?? [])
      .filter((child) => child.props?.value !== undefined && child.props.value !== '')
      .map((child) => parseExpression(String(child.props?.value))),
  ];
  return expressions.some(valueContainsListIteration);
}

function valueContainsListIteration(node: ValueIR): boolean {
  switch (node.kind) {
    case 'call':
      if (
        node.callee.kind === 'member' &&
        node.callee.object.kind === 'ident' &&
        node.callee.object.name === 'List' &&
        (node.callee.property === 'map' || node.callee.property === 'filter')
      ) {
        return true;
      }
      return valueContainsListIteration(node.callee) || node.args.some(valueContainsListIteration);
    case 'arrayLit':
      return node.items.some(valueContainsListIteration);
    case 'objectLit':
      return node.entries.some((entry) =>
        'kind' in entry && entry.kind === 'spread'
          ? valueContainsListIteration(entry.argument)
          : valueContainsListIteration((entry as { value: ValueIR }).value),
      );
    case 'member':
      return valueContainsListIteration(node.object);
    case 'index':
      return valueContainsListIteration(node.object) || valueContainsListIteration(node.index);
    case 'lambda':
      return node.body ? valueContainsListIteration(node.body) : false;
    case 'binary':
      return valueContainsListIteration(node.left) || valueContainsListIteration(node.right);
    case 'unary':
      return valueContainsListIteration(node.argument);
    case 'conditional':
      return (
        valueContainsListIteration(node.test) ||
        valueContainsListIteration(node.consequent) ||
        valueContainsListIteration(node.alternate)
      );
    case 'nonNull':
    case 'typeAssert':
      return valueContainsListIteration(node.expression);
    default:
      return false;
  }
}
