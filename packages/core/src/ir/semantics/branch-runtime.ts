import type { IRNode } from '../../types.js';
import { getBinding, hasBinding, type SemanticEnv } from './semantic-env.js';

export interface BranchProps {
  on?: string;
  name?: string;
}

type BranchValue = string | number;

function asBranchProps(ir: IRNode): BranchProps {
  return (ir.props ?? {}) as BranchProps;
}

function isDefaultPath(path: IRNode): boolean {
  return path.props?.default === true || path.props?.default === 'true';
}

export function branchHasDefaultPath(ir: IRNode): boolean {
  return (ir.children ?? []).some(isDefaultPath);
}

function hasQuotedValue(path: IRNode): boolean {
  return path.__quotedProps?.includes('value') === true;
}

function isIdentifier(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text);
}

function isNumericLiteral(text: string): boolean {
  return /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text);
}

function assertPortableValue(value: unknown, label: string): BranchValue {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`branch: ${label} must resolve to a string or finite number`);
}

function evalExpressionInContractDomain(raw: unknown, env: SemanticEnv, label: string): BranchValue {
  // Branch equality intentionally uses a narrower grammar than `if` truthiness;
  // quoted source props arrive through `__quotedProps`, not single-quote syntax.
  if (typeof raw === 'number') return assertPortableValue(raw, label);
  if (typeof raw !== 'string') {
    throw new Error(`branch: ${label} must be a string/number literal or identifier`);
  }
  const text = raw.trim();
  if (text.length === 0) throw new Error(`branch: ${label} must not be empty`);
  if (isNumericLiteral(text)) return assertPortableValue(Number(text), label);
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    if (text.startsWith("'")) {
      throw new Error(`branch: ${label} single-quoted string expressions are outside the contract domain`);
    }
    return assertPortableValue(JSON.parse(text), label);
  }
  if (!isIdentifier(text)) throw new Error(`branch: ${label} expression is outside the contract domain`);
  if (!hasBinding(env, text)) throw new Error(`branch: binding "${text}" not found in env`);
  return assertPortableValue(getBinding(env, text), label);
}

function evalPathValue(path: IRNode, env: SemanticEnv): BranchValue {
  const raw = path.props?.value;
  if (hasQuotedValue(path)) {
    if (typeof raw !== 'string') throw new Error('branch: quoted path value must be a string literal');
    return raw;
  }
  return evalExpressionInContractDomain(raw, env, 'path value');
}

function pathShapeIsValid(path: IRNode): boolean {
  if (path.type !== 'path') return false;
  const hasValue = Object.hasOwn(path.props ?? {}, 'value');
  const hasDefault = isDefaultPath(path);
  return hasValue !== hasDefault;
}

function expressionShapeIsPortable(raw: unknown): boolean {
  if (typeof raw === 'number') return Number.isFinite(raw);
  if (typeof raw !== 'string') return false;
  const text = raw.trim();
  if (text.length === 0 || text.startsWith("'")) return false;
  if (isNumericLiteral(text) || isIdentifier(text)) return true;
  if (!text.startsWith('"') || !text.endsWith('"')) return false;
  try {
    return typeof JSON.parse(text) === 'string';
  } catch {
    return false;
  }
}

export function branchShapePreconditions(ir: IRNode): boolean {
  if (!expressionShapeIsPortable(asBranchProps(ir).on)) return false;
  const paths = ir.children ?? [];
  if (paths.length === 0) return false;
  let defaultCount = 0;
  for (const path of paths) {
    if (!pathShapeIsValid(path)) return false;
    if (isDefaultPath(path)) defaultCount += 1;
    else if (hasQuotedValue(path)) {
      if (typeof path.props?.value !== 'string') return false;
    } else if (!expressionShapeIsPortable(path.props?.value)) return false;
  }
  return defaultCount <= 1;
}

export function branchPreconditions(ir: IRNode, env: SemanticEnv): boolean {
  if (!branchShapePreconditions(ir)) return false;
  for (const path of ir.children ?? []) {
    if (isDefaultPath(path)) continue;
    try {
      evalPathValue(path, env);
    } catch {
      return false;
    }
  }
  try {
    evalExpressionInContractDomain(asBranchProps(ir).on, env, 'on');
  } catch {
    return false;
  }
  return true;
}

export function selectBranchPath(ir: IRNode, env: SemanticEnv): IRNode | undefined {
  const subject = evalExpressionInContractDomain(asBranchProps(ir).on, env, 'on');
  let defaultPath: IRNode | undefined;
  for (const path of ir.children ?? []) {
    if (isDefaultPath(path)) {
      defaultPath = path;
      continue;
    }
    const candidate = evalPathValue(path, env);
    if (typeof subject === typeof candidate && subject === candidate) return path;
  }
  return defaultPath;
}
