import { parseExpression } from '../../parser-expression.js';
import type { IRNode } from '../../types.js';
import type { ValueIR } from '../../value-ir.js';
import { isSafeIntegerLiteralIndex } from './portable-scalar-domain.js';
import { getBinding, hasBinding, isIntProvenanced, type SemanticEnv } from './semantic-env.js';

export interface ForProps {
  name?: string;
  from?: string | number;
  to?: string | number;
  step?: string | number;
}

function asForProps(ir: IRNode): ForProps {
  return (ir.props ?? {}) as ForProps;
}

export function forPreconditions(ir: IRNode, _env: SemanticEnv): boolean {
  return forShapePreconditions(ir);
}

export function forShapePreconditions(ir: IRNode): boolean {
  const props = asForProps(ir);
  if (typeof props.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(props.name)) return false;
  if (props.from === undefined || props.from === '') return false;
  if (props.to === undefined || props.to === '') return false;
  return Array.isArray(ir.children);
}

function evalValue(expr: ValueIR, env: SemanticEnv): unknown {
  switch (expr.kind) {
    case 'numLit':
      return expr.value;
    case 'ident':
      if (!hasBinding(env, expr.name)) throw new Error(`for: binding "${expr.name}" not found in env`);
      return getBinding(env, expr.name);
    case 'member': {
      if (expr.optional || expr.object.kind !== 'ident' || expr.property !== 'length') {
        throw new Error('for: unsupported member expression in range bound');
      }
      if (!hasBinding(env, expr.object.name)) {
        throw new Error(`for: binding "${expr.object.name}" not found in env`);
      }
      const array = getBinding(env, expr.object.name);
      if (!Array.isArray(array)) throw new Error('for: range bound .length requires an array binding');
      return array.length;
    }
    case 'index': {
      if (
        !isSafeIntegerLiteralIndex(expr.index) &&
        !(expr.index.kind === 'ident' && isIntProvenanced(env, expr.index.name))
      ) {
        throw new Error(
          'for: range-bound array index must be a safe-integer literal or an integer-provenanced loop counter',
        );
      }
      const target = evalValue(expr.object, env);
      const index = evalValue(expr.index, env);
      if (Array.isArray(target) && typeof index === 'number') return target[index];
      if (target && typeof target === 'object' && (typeof index === 'string' || typeof index === 'number')) {
        return (target as Record<string, unknown>)[String(index)];
      }
      throw new Error('for: unsupported index expression in range bound');
    }
    case 'unary': {
      const value = evalValue(expr.argument, env);
      if (typeof value !== 'number') throw new Error(`for: unary ${expr.op} requires a numeric operand`);
      if (expr.op === '-') return -value;
      if (expr.op === '+') return value;
      throw new Error(`for: unsupported unary operator ${expr.op}`);
    }
    default:
      throw new Error(`for: unsupported range expression kind ${expr.kind}`);
  }
}

function evalIntExpression(raw: string | number, env: SemanticEnv, propName: 'from' | 'to' | 'step'): number {
  const value = typeof raw === 'number' ? raw : evalValue(parseExpression(String(raw)), env);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`for ${propName}: expression must evaluate to a safe integer`);
  }
  return value;
}

export interface ForRuntimeRange {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly step: number;
  readonly children: readonly IRNode[];
}

export function forRuntimeRange(ir: IRNode, env: SemanticEnv): ForRuntimeRange {
  const props = asForProps(ir);
  const name = props.name as string;
  const from = evalIntExpression(props.from as string | number, env, 'from');
  const to = evalIntExpression(props.to as string | number, env, 'to');
  const step = evalIntExpression(
    props.step === undefined || props.step === '' ? 1 : (props.step as string | number),
    env,
    'step',
  );
  if (step === 0) throw new Error('for step: step must not be zero');
  return { name, from, to, step, children: ir.children ?? [] };
}
