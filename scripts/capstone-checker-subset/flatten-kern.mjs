import { parseDocument } from '../../packages/core/dist/parser.js';
import { parseExpression } from '../../packages/core/dist/parser-expression.js';
import { KERN_CHECKER_TABLES } from '../../packages/cli/dist/kern-checker-contract.js';
import {
  hasMixedParameterDeclarations,
  MIXED_PARAMETER_DECLARATION_MESSAGE,
} from '../../packages/core/dist/parameter-declarations.js';

// Frozen checkModule ABI tables; facts.2 carries paramOwnerStmt only at its entry boundary.
export const DATA_ARRAYS = Object.freeze(KERN_CHECKER_TABLES.slice(0, -1));

const EXPR_PROPS = Object.freeze(['value', 'cond', 'from', 'to']);

export function emptyFlatModule(path) {
  const out = { path };
  for (const [name] of KERN_CHECKER_TABLES) out[name] = [];
  return out;
}

export function flattenKernSource(path, source) {
  const ast = parseDocument(source);
  const out = emptyFlatModule(path);
  visitIr(ast, out, '', -1);
  return out;
}

function visitIr(node, out, currentFn, currentStmt) {
  if (!node || typeof node !== 'object') return;

  let stmtIndex = currentStmt;
  let nextFn = currentFn;
  if (node.type !== 'document' && node.type !== 'handler') {
    stmtIndex = pushStmt(out, node, currentFn, currentStmt);
  }

  if (node.type === 'fn') {
    nextFn = stringProp(node, 'name');
    const rawParams = stringProp(node, 'params');
    const paramChildren = Array.isArray(node.children)
      ? node.children.filter((child) => child?.type === 'param')
      : [];
    if (hasMixedParameterDeclarations(node)) {
      throw new TypeError(MIXED_PARAMETER_DECLARATION_MESSAGE);
    }
    const params = paramChildren.length > 0
      ? paramChildren.map((param) => structuredParamEntry(param))
      : parseParamEntries(rawParams);
    params.forEach((param, ordinal) => {
      out.paramFn.push(nextFn);
      out.paramName.push(param.name);
      out.paramType.push(param.type);
      out.paramOrdinal.push(ordinal);
      out.paramOwnerStmt.push(stmtIndex);
    });
  }

  const props = node.props ?? {};
  for (const prop of EXPR_PROPS) {
    if (typeof props[prop] !== 'string') continue;
    collectExpression(out, props[prop], nextFn, stmtIndex, node.type, node.loc);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (node.type === 'fn' && child?.type === 'param') continue;
      visitIr(child, out, nextFn, stmtIndex);
    }
  }
}

function structuredParamEntry(node) {
  const props = node.props ?? {};
  const unsupportedProps = Object.keys(props).filter((key) => key !== 'name' && key !== 'type');
  if (unsupportedProps.length > 0 || (Array.isArray(node.children) && node.children.length > 0)) {
    throw new TypeError('checker parameter facts support only `name` and `type`');
  }
  const name = stringProp(node, 'name').trim();
  const rawType = props.type;
  if (name === '' || (rawType !== undefined && typeof rawType !== 'string')) {
    throw new TypeError('checker structured parameter requires a string `name` and optional string `type`');
  }
  return { name, type: typeof rawType === 'string' ? rawType.trim() : '' };
}

function pushStmt(out, node, currentFn, parentStmt) {
  const props = node.props ?? {};
  const primary = primaryExpression(props);
  const summary = primary ? summarizeExpression(primary) : emptySummary();
  const left = primary?.kind === 'binary' ? summarizeExpression(primary.left) : emptySummary();
  const right = primary?.kind === 'binary' ? summarizeExpression(primary.right) : emptySummary();
  const index = out.stmtKind.length;
  out.stmtKind.push(node.type ?? '');
  out.stmtFn.push(node.type === 'fn' ? stringProp(node, 'name') : currentFn);
  out.stmtParent.push(parentStmt);
  out.stmtLine.push(node.loc?.line ?? 0);
  out.stmtCol.push(node.loc?.col ?? 0);
  out.stmtName.push(stringProp(node, 'name'));
  out.stmtTarget.push(stringProp(node, 'target') || stringProp(node, 'as'));
  out.stmtValue.push(stringProp(node, 'value'));
  out.stmtTemplate.push(stringProp(node, 'template'));
  out.stmtExprKind.push(summary.kind);
  out.stmtExprName.push(summary.name);
  out.stmtExprLeftKind.push(left.kind);
  out.stmtExprLeftName.push(left.name);
  out.stmtExprLeftNum.push(left.num);
  out.stmtExprLeftMemberObject.push(left.memberObject);
  out.stmtExprLeftMemberProp.push(left.memberProp);
  out.stmtExprRightKind.push(right.kind);
  out.stmtExprRightName.push(right.name);
  out.stmtExprRightNum.push(right.num);
  out.stmtExprRightMemberObject.push(right.memberObject);
  out.stmtExprRightMemberProp.push(right.memberProp);
  out.stmtExprNum.push(summary.num);
  out.stmtExprCall.push(summary.call);
  out.stmtExprMemberObject.push(summary.memberObject);
  out.stmtExprMemberProp.push(summary.memberProp);
  out.stmtExprArgCount.push(summary.argCount);
  return index;
}

function collectExpression(out, raw, currentFn, stmtIndex, stmtKind, loc) {
  let expr;
  try {
    expr = parseExpression(raw);
  } catch {
    const callIndex = out.callName.length;
    out.callStmt.push(stmtIndex);
    out.callFn.push(currentFn);
    out.callStmtKind.push(stmtKind ?? '');
    out.callLine.push(loc?.line ?? 0);
    out.callCol.push(loc?.col ?? 0);
    out.callName.push('<parse-error>');
    out.callMemberObject.push('');
    out.callMemberProp.push('');
    out.callArgCount.push(0);
    return callIndex;
  }
  walkExpression(expr, out, currentFn, stmtIndex, stmtKind, loc);
}

function walkExpression(expr, out, currentFn, stmtIndex, stmtKind, loc) {
  if (!expr || typeof expr !== 'object') return;
  if (expr.kind === 'index') {
    const indexSummary = summarizeExpression(expr.index);
    out.idxStmt.push(stmtIndex);
    out.idxFn.push(currentFn);
    out.idxLine.push(loc?.line ?? 0);
    out.idxCol.push(loc?.col ?? 0);
    out.idxIndexKind.push(indexSummary.kind);
    out.idxIndexName.push(indexSummary.name || indexSummary.num);
  }
  if (expr.kind === 'call') {
    const callIndex = out.callName.length;
    const call = callSummary(expr);
    out.callStmt.push(stmtIndex);
    out.callFn.push(currentFn);
    out.callStmtKind.push(stmtKind ?? '');
    out.callLine.push(loc?.line ?? 0);
    out.callCol.push(loc?.col ?? 0);
    out.callName.push(call.name);
    out.callMemberObject.push(call.memberObject);
    out.callMemberProp.push(call.memberProp);
    out.callArgCount.push(expr.args.length);
    expr.args.forEach((arg, ordinal) => pushArg(out, callIndex, ordinal, arg));
  }
  for (const value of Object.values(expr)) {
    if (Array.isArray(value)) {
      for (const item of value) walkExpression(item, out, currentFn, stmtIndex, stmtKind, loc);
    } else if (value && typeof value === 'object') {
      walkExpression(value, out, currentFn, stmtIndex, stmtKind, loc);
    }
  }
}

function pushArg(out, callIndex, ordinal, expr) {
  const summary = summarizeExpression(expr);
  const left = expr?.kind === 'binary' ? summarizeExpression(expr.left) : emptySummary();
  const right = expr?.kind === 'binary' ? summarizeExpression(expr.right) : emptySummary();
  out.argCall.push(callIndex);
  out.argOrdinal.push(ordinal);
  out.argKind.push(summary.kind);
  out.argName.push(summary.name);
  out.argNum.push(summary.num);
  out.argOp.push(expr?.kind === 'binary' ? expr.op : '');
  out.argLeftKind.push(left.kind);
  out.argLeftName.push(left.name);
  out.argLeftNum.push(left.num);
  out.argRightKind.push(right.kind);
  out.argRightName.push(right.name);
  out.argRightNum.push(right.num);
}

function primaryExpression(props) {
  for (const prop of EXPR_PROPS) {
    if (typeof props[prop] !== 'string') continue;
    try {
      return parseExpression(props[prop]);
    } catch {
      return { kind: 'parseError' };
    }
  }
  return undefined;
}

function summarizeExpression(expr) {
  if (!expr || typeof expr !== 'object') return emptySummary();
  if (expr.kind === 'ident') return { ...emptySummary(), kind: 'ident', name: expr.name ?? '' };
  if (expr.kind === 'numLit') return { ...emptySummary(), kind: 'numLit', num: expr.raw ?? String(expr.value ?? '') };
  if (expr.kind === 'strLit') return { ...emptySummary(), kind: 'strLit', name: expr.value ?? '' };
  if (expr.kind === 'boolLit') return { ...emptySummary(), kind: 'boolLit', name: expr.value ? 'true' : 'false' };
  if (expr.kind === 'nullLit') return { ...emptySummary(), kind: 'nullLit' };
  if (expr.kind === 'arrayLit') return { ...emptySummary(), kind: 'arrayLit' };
  if (expr.kind === 'member') {
    return {
      ...emptySummary(),
      kind: 'member',
      memberObject: expr.object?.kind === 'ident' ? expr.object.name : expr.object?.kind ?? '',
      memberProp: expr.property ?? '',
    };
  }
  if (expr.kind === 'call') {
    const call = callSummary(expr);
    return {
      ...emptySummary(),
      kind: 'call',
      call: call.name,
      memberObject: call.memberObject,
      memberProp: call.memberProp,
      argCount: expr.args.length,
    };
  }
  if (expr.kind === 'new') {
    const inner = summarizeExpression(expr.argument);
    return { ...emptySummary(), kind: 'new', call: inner.call || inner.name };
  }
  if (expr.kind === 'index') {
    const index = summarizeExpression(expr.index);
    return { ...emptySummary(), kind: 'index', name: index.name || index.num };
  }
  if (expr.kind === 'binary') return { ...emptySummary(), kind: 'binary', name: expr.op ?? '' };
  if (expr.kind === 'unary') return { ...emptySummary(), kind: 'unary', name: expr.op ?? '' };
  return { ...emptySummary(), kind: expr.kind ?? '<unknown>' };
}

function callSummary(expr) {
  const callee = expr.callee;
  if (callee?.kind === 'ident') {
    return { name: callee.name ?? '', memberObject: '', memberProp: '' };
  }
  if (callee?.kind === 'member') {
    const object = callee.object?.kind === 'ident' ? callee.object.name : callee.object?.kind ?? '';
    const prop = callee.property ?? '';
    return { name: `${object}.${prop}`, memberObject: object, memberProp: prop };
  }
  return { name: '<unsupported-callee>', memberObject: '', memberProp: '' };
}

function emptySummary() {
  return { kind: '', name: '', num: '', call: '', memberObject: '', memberProp: '', argCount: 0 };
}

function stringProp(node, name) {
  const value = node.props?.[name];
  return typeof value === 'string' ? value : '';
}

export function parseParams(raw) {
  return parseParamEntries(raw).map((param) => param.name);
}

function parseParamEntries(raw) {
  if (!raw) return [];
  return splitTopLevel(raw, ',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.indexOf(':');
      if (separator < 0) return { name: part, type: '' };
      return { name: part.slice(0, separator).trim(), type: part.slice(separator + 1).trim() };
    })
    .filter((param) => param.name !== '');
}

function splitTopLevel(raw, delimiter) {
  const out = [];
  let cur = '';
  let angle = 0;
  let quote = '';
  for (const ch of raw) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '<') angle += 1;
    if (ch === '>') angle = Math.max(0, angle - 1);
    if (ch === delimiter && angle === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function kernStringLiteral(raw) {
  return JSON.stringify(String(raw)).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
