import { parseDocument } from '../../packages/core/dist/parser.js';
import { parseExpression } from '../../packages/core/dist/parser-expression.js';

export const DATA_ARRAYS = Object.freeze([
  ['stmtKind', 'string'],
  ['stmtFn', 'string'],
  ['stmtLine', 'number'],
  ['stmtCol', 'number'],
  ['stmtName', 'string'],
  ['stmtTarget', 'string'],
  ['stmtValue', 'string'],
  ['stmtTemplate', 'string'],
  ['stmtExprKind', 'string'],
  ['stmtExprName', 'string'],
  ['stmtExprNum', 'string'],
  ['stmtExprCall', 'string'],
  ['stmtExprMemberObject', 'string'],
  ['stmtExprMemberProp', 'string'],
  ['stmtExprArgCount', 'number'],
  ['idxStmt', 'number'],
  ['idxFn', 'string'],
  ['idxLine', 'number'],
  ['idxCol', 'number'],
  ['idxIndexKind', 'string'],
  ['idxIndexName', 'string'],
  ['callStmt', 'number'],
  ['callFn', 'string'],
  ['callStmtKind', 'string'],
  ['callLine', 'number'],
  ['callCol', 'number'],
  ['callName', 'string'],
  ['callMemberObject', 'string'],
  ['callMemberProp', 'string'],
  ['callArgCount', 'number'],
  ['argCall', 'number'],
  ['argOrdinal', 'number'],
  ['argKind', 'string'],
  ['argName', 'string'],
  ['argNum', 'string'],
  ['argOp', 'string'],
  ['argLeftKind', 'string'],
  ['argLeftName', 'string'],
  ['argLeftNum', 'string'],
  ['argRightKind', 'string'],
  ['argRightName', 'string'],
  ['argRightNum', 'string'],
  ['paramFn', 'string'],
  ['paramName', 'string'],
  ['paramOrdinal', 'number'],
]);

const EXPR_PROPS = Object.freeze(['value', 'cond', 'from', 'to']);

export function emptyFlatModule(path) {
  const out = { path };
  for (const [name] of DATA_ARRAYS) out[name] = [];
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
    stmtIndex = pushStmt(out, node, currentFn);
  }

  if (node.type === 'fn') {
    nextFn = stringProp(node, 'name');
    const params = parseParams(stringProp(node, 'params'));
    params.forEach((param, ordinal) => {
      out.paramFn.push(nextFn);
      out.paramName.push(param);
      out.paramOrdinal.push(ordinal);
    });
  }

  const props = node.props ?? {};
  for (const prop of EXPR_PROPS) {
    if (typeof props[prop] !== 'string') continue;
    collectExpression(out, props[prop], nextFn, stmtIndex, node.type, node.loc);
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) visitIr(child, out, nextFn, stmtIndex);
  }
}

function pushStmt(out, node, currentFn) {
  const props = node.props ?? {};
  const primary = primaryExpression(props);
  const summary = primary ? summarizeExpression(primary) : emptySummary();
  const index = out.stmtKind.length;
  out.stmtKind.push(node.type ?? '');
  out.stmtFn.push(node.type === 'fn' ? stringProp(node, 'name') : currentFn);
  out.stmtLine.push(node.loc?.line ?? 0);
  out.stmtCol.push(node.loc?.col ?? 0);
  out.stmtName.push(stringProp(node, 'name'));
  out.stmtTarget.push(stringProp(node, 'target') || stringProp(node, 'as'));
  out.stmtValue.push(stringProp(node, 'value'));
  out.stmtTemplate.push(stringProp(node, 'template'));
  out.stmtExprKind.push(summary.kind);
  out.stmtExprName.push(summary.name);
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
  if (!raw) return [];
  return splitTopLevel(raw, ',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.split(':')[0]?.trim() ?? '')
    .filter(Boolean);
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
