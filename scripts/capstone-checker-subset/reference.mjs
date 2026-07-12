import { fmtContract } from '../../packages/core/dist/ir/semantics/fmt.js';
import { makeEnv } from '../../packages/core/dist/ir/semantics/index.js';
import { printContract } from '../../packages/core/dist/ir/semantics/print.js';

export function checkFlatModule(flat) {
  const issues = [];
  const reject = (line, col, code, detail) => {
    issues.push(formatVerdict(flat.path, line || 0, col || 0, code, 'reject', detail));
  };

  for (let i = 0; i < flat.stmtKind.length; i += 1) {
    const kind = flat.stmtKind[i];
    if (!isSurfaceKind(kind)) reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_SURFACE', `unsupported_${kind || 'missing'}`);
    if (flat.stmtLine[i] <= 0 || flat.stmtCol[i] <= 0) {
      reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_ROW', 'missing_loc');
    }
    if (kind === 'print' && flat.stmtFn[i] && flat.stmtFn[i] !== 'main') {
      reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_HELPER', 'helper_stdout');
    }
    if (kind === 'print') checkPrint(flat, i, reject);
    if (kind === 'fmt') checkFmt(flat, i, reject);
    if (kind === 'do') checkDo(flat, i, reject);
    if (kind === 'else') checkElse(flat, i, reject);
    if (kind === 'while') checkWhile(flat, i, reject);
  }

  for (let i = 0; i < flat.callName.length; i += 1) checkCall(flat, i, reject);
  for (let i = 0; i < flat.idxFn.length; i += 1) checkIndex(flat, i, reject);

  if (issues.length === 0) return [formatVerdict(flat.path, 1, 1, 'T10_MODULE', 'accept', 'ok')];
  return issues;
}

export function formatVerdict(path, line, col, code, action, detail) {
  return `${path}:${line}:${col}|${code}|${action}|${detail}`;
}

function isSurfaceKind(kind) {
  return [
    'use',
    'from',
    'fn',
    'let',
    'assign',
    'do',
    'for',
    'if',
    'else',
    'while',
    'return',
    'print',
    'fmt',
  ].includes(kind);
}

function checkElse(flat, i, reject) {
  const previous = previousSiblingIndex(flat, i);
  if (previous < 0) {
    reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_ELSE', 'orphan_else');
    return;
  }
  if (flat.stmtKind[previous] === 'else') {
    reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_ELSE', 'duplicate_else');
    return;
  }
  if (flat.stmtKind[previous] !== 'if') {
    reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_ELSE', 'invalid_predecessor');
    return;
  }
  if (!hasDirectChild(flat, i)) reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_ELSE', 'empty_body');
}

function checkWhile(flat, i, reject) {
  if (!hasDirectChild(flat, i)) {
    reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_WHILE', 'empty_body');
    return;
  }
  const kind = flat.stmtExprKind[i];
  const operator = flat.stmtExprName[i];
  if (kind === 'boolLit') {
    if (operator === 'true') reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_WHILE', 'literal_true');
    return;
  }
  const booleanBinary = ['==', '!=', '===', '!==', '<', '<=', '>', '>='].includes(operator);
  if (kind === 'binary' && booleanBinary) {
    const literalValue = literalComparisonValue(flat, i, operator);
    if (literalValue === true) {
      reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_WHILE', 'literal_true');
      return;
    }
    const literals = new Set(['numLit', 'strLit', 'boolLit', 'nullLit']);
    if (literals.has(flat.stmtExprLeftKind[i]) && literals.has(flat.stmtExprRightKind[i])) {
      reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_WHILE', 'non_boolean_condition');
      return;
    }
    if (comparisonOperandsOk(flat, i, operator)) return;
  }
  reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_WHILE', 'non_boolean_condition');
}

function literalComparisonValue(flat, i, operator) {
  const leftKind = flat.stmtExprLeftKind[i];
  const rightKind = flat.stmtExprRightKind[i];
  const literals = new Set(['numLit', 'strLit', 'boolLit', 'nullLit']);
  if (!literals.has(leftKind) || leftKind !== rightKind) return undefined;
  const left = literalValue(flat, i, 'Left', leftKind);
  const right = literalValue(flat, i, 'Right', rightKind);
  if (left === undefined || right === undefined) return undefined;
  if (operator === '==' || operator === '===') return left === right;
  if (operator === '!=' || operator === '!==') return left !== right;
  return undefined;
}

function literalValue(flat, i, side, kind) {
  if (kind === 'numLit') {
    const raw = flat[`stmtExpr${side}Num`][i];
    return isSafeIntText(raw) ? BigInt(raw) : undefined;
  }
  if (kind === 'strLit') return flat[`stmtExpr${side}Name`][i];
  if (kind === 'boolLit') return flat[`stmtExpr${side}Name`][i] === 'true';
  if (kind === 'nullLit') return null;
  return undefined;
}

function comparisonOperandsOk(flat, i, operator) {
  const left = flat.stmtExprLeftKind[i];
  const right = flat.stmtExprRightKind[i];
  const ordered = ['<', '<=', '>', '>='].includes(operator);
  if (!ordered) return false;
  const fn = flat.stmtFn[i];
  const leftStep = operator === '<' || operator === '<=' ? '+' : '-';
  const rightStep = operator === '<' || operator === '<=' ? '-' : '+';
  const leftBinding = left === 'ident' && numericBindingProven(flat, i, fn, flat.stmtExprLeftName[i], leftStep);
  const rightBinding = right === 'ident' && numericBindingProven(flat, i, fn, flat.stmtExprRightName[i], rightStep);
  const leftLiteral = left === 'numLit' && isSafeIntText(flat.stmtExprLeftNum[i]);
  const rightLiteral = right === 'numLit' && isSafeIntText(flat.stmtExprRightNum[i]);
  const leftLength =
    left === 'member' &&
    flat.stmtExprLeftMemberProp[i] === 'length' &&
    lengthReceiverProven(flat, i, fn, flat.stmtExprLeftMemberObject[i]);
  const rightLength =
    right === 'member' &&
    flat.stmtExprRightMemberProp[i] === 'length' &&
    lengthReceiverProven(flat, i, fn, flat.stmtExprRightMemberObject[i]);
  return (leftBinding && (rightBinding || rightLiteral || rightLength)) || (rightBinding && (leftLiteral || leftLength));
}

function numericBindingProven(flat, row, fn, name, requiredStep) {
  let declared = false;
  let stepped = false;
  const end = subtreeEnd(flat, row);
  const fnRow = flat.stmtKind.findIndex((kind, i) => kind === 'fn' && flat.stmtName[i] === fn);
  for (let i = 0; i < flat.stmtKind.length; i += 1) {
    if (flat.stmtFn[i] !== fn) continue;
    if (i < row && flat.stmtParent[i] === fnRow && flat.stmtKind[i] === 'let' && flat.stmtName[i] === name) {
      if (declared || flat.stmtExprKind[i] !== 'numLit' || !isSafeIntText(flat.stmtExprNum[i])) return false;
      declared = true;
    }
    const relevant = i < row || (i > row && i < end);
    if (
      i > row &&
      i < end &&
      flat.stmtKind[i] === 'let' &&
      flat.stmtName[i] === name
    ) {
      return false;
    }
    if (relevant && flat.stmtKind[i] === 'assign' && flat.stmtTarget[i] === name) {
      const safeStep =
        flat.stmtExprName[i] === requiredStep &&
        flat.stmtExprLeftKind[i] === 'ident' &&
        flat.stmtExprLeftName[i] === name &&
        flat.stmtExprRightKind[i] === 'numLit' &&
        isPositiveSafeIntText(flat.stmtExprRightNum[i]);
      if (!safeStep) return false;
      if (i > row) stepped = true;
    }
  }
  return declared && stepped;
}

function lengthReceiverProven(flat, row, fn, name) {
  let declared = false;
  const end = subtreeEnd(flat, row);
  const fnRow = flat.stmtKind.findIndex((kind, i) => kind === 'fn' && flat.stmtName[i] === fn);
  for (let i = 0; i < flat.paramFn.length; i += 1) {
    const type = flat.paramType[i];
    if (flat.paramFn[i] === fn && flat.paramName[i] === name && (type === 'string' || type.endsWith('[]'))) declared = true;
  }
  for (let i = 0; i < flat.stmtKind.length; i += 1) {
    if (flat.stmtFn[i] !== fn) continue;
    if (i < row && flat.stmtParent[i] === fnRow && flat.stmtKind[i] === 'let' && flat.stmtName[i] === name) {
      if (declared || !['arrayLit', 'strLit'].includes(flat.stmtExprKind[i])) return false;
      declared = true;
    }
    if ((i < row || (i > row && i < end)) && flat.stmtKind[i] === 'assign' && flat.stmtTarget[i] === name) return false;
  }
  return declared;
}

function isPositiveSafeIntText(raw) {
  return raw !== '0' && !raw.startsWith('-') && isSafeIntText(raw);
}

function subtreeEnd(flat, row) {
  for (let i = row + 1; i < flat.stmtParent.length; i += 1) {
    if (flat.stmtParent[i] < row) return i;
  }
  return flat.stmtParent.length;
}

function previousSiblingIndex(flat, i) {
  let previous = -1;
  for (let candidate = 0; candidate < i; candidate += 1) {
    if (flat.stmtParent[candidate] === flat.stmtParent[i]) previous = candidate;
  }
  return previous;
}

function hasDirectChild(flat, i) {
  return flat.stmtParent.some((parent) => parent === i);
}

function checkPrint(flat, i, reject) {
  const exprKind = flat.stmtExprKind[i];
  const raw = flat.stmtValue[i];
  if (exprKind === 'arrayLit') {
    reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_PRINT', 'array_literal');
    return;
  }
  if (exprKind === 'ident' && isArrayBinding(flat, flat.stmtFn[i], flat.stmtExprName[i])) {
    reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_PRINT', 'array_binding');
    return;
  }
  if (exprKind === 'numLit' && (!productionPrintAcceptsLiteral(raw) || !isCanonicalSafeIntText(raw))) {
    reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_PRINT', 'production_reject');
  }
}

function checkFmt(flat, i, reject) {
  const template = flat.stmtTemplate[i];
  if (!flat.stmtName[i]) {
    reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_FMT', 'production_reject');
    return;
  }
  if (!template.includes('${') && !productionFmtAcceptsLiteralTemplate(flat.stmtName[i], template)) {
    reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_FMT', 'production_reject');
  }
}

function checkDo(flat, i, reject) {
  const call = flat.stmtExprCall[i];
  const memberProp = flat.stmtExprMemberProp[i];
  if (memberProp === 'push') return;
  if (call === 'Map.set') return;
  reject(flat.stmtLine[i], flat.stmtCol[i], 'T10_EFFECT', 'unsupported_do');
}

function checkCall(flat, i, reject) {
  const name = flat.callName[i];
  const memberObject = flat.callMemberObject[i];
  const memberProp = flat.callMemberProp[i];
  if (name === '<parse-error>') {
    reject(flat.callLine[i], flat.callCol[i], 'T10_SURFACE', 'parse_error');
    return;
  }
  if (memberProp === 'delete' || memberProp === 'clear') {
    reject(flat.callLine[i], flat.callCol[i], 'T10_MAP', 'unsupported_method');
    return;
  }
  if (memberProp === 'push') {
    if (flat.callStmtKind[i] !== 'do') reject(flat.callLine[i], flat.callCol[i], 'T10_EFFECT', 'push_outside_do');
    return;
  }
  if (memberObject === 'Text') {
    if (!['length', 'charAt', 'startsWith'].includes(memberProp)) {
      reject(flat.callLine[i], flat.callCol[i], 'T10_SURFACE', 'unsupported_text_call');
    }
    return;
  }
  if (memberObject === 'Map') {
    checkMapCall(flat, i, reject);
    return;
  }
  if (name === 'String' || name === 'Map' || isUserCallable(flat, name)) return;
  reject(flat.callLine[i], flat.callCol[i], 'T10_SURFACE', 'unsupported_call');
}

function checkMapCall(flat, i, reject) {
  const prop = flat.callMemberProp[i];
  if (!['set', 'get', 'has'].includes(prop)) {
    reject(flat.callLine[i], flat.callCol[i], 'T10_MAP', 'unsupported_method');
    return;
  }
  if (prop === 'set' && flat.callStmtKind[i] !== 'do') {
    reject(flat.callLine[i], flat.callCol[i], 'T10_MAP', 'set_outside_do');
    return;
  }
  const key = mapKeyToken(flat, i);
  if (!key.ok) {
    reject(flat.callLine[i], flat.callCol[i], 'T10_MAP', 'computed_key');
    return;
  }
  if (prop === 'get' && !mapKnownBefore(flat, i)) {
    reject(flat.callLine[i], flat.callCol[i], 'T10_MAP', 'missing_key_proof');
  }
}

function checkIndex(flat, i, reject) {
  const fn = flat.idxFn[i];
  const kind = flat.idxIndexKind[i];
  const name = flat.idxIndexName[i];
  if (kind === 'numLit') {
    if (!isSafeIntText(name)) reject(flat.idxLine[i], flat.idxCol[i], 'T10_INDEX', 'unsafe_literal');
    return;
  }
  if (kind !== 'ident') {
    reject(flat.idxLine[i], flat.idxCol[i], 'T10_INDEX', 'unsupported_index_expr');
    return;
  }
  if (isForCounter(flat, fn, name) && !isIndexRebound(flat, fn, name)) return;
  if (
    isFunctionParam(flat, fn, name) &&
    !isIndexRebound(flat, fn, name) &&
    paramCallsitesOk(flat, fn, paramOrdinal(flat, fn, name))
  ) {
    return;
  }
  reject(flat.idxLine[i], flat.idxCol[i], 'T10_INDEX', 'missing_provenance');
}

// production wrapper: packages/core/src/ir/semantics/print.ts:printContract.preconditions
function productionPrintAcceptsLiteral(value) {
  return printContract.preconditions({ type: 'print', props: { value }, children: [] }, makeEnv());
}

// production wrapper: packages/core/src/ir/semantics/fmt.ts:fmtContract.preconditions
function productionFmtAcceptsLiteralTemplate(name, template) {
  return fmtContract.preconditions({ type: 'fmt', props: { name, template }, children: [] }, makeEnv());
}

function isArrayBinding(flat, fn, name) {
  for (let i = 0; i < flat.stmtKind.length; i += 1) {
    if (flat.stmtFn[i] === fn && flat.stmtKind[i] === 'let' && flat.stmtName[i] === name && flat.stmtExprKind[i] === 'arrayLit') {
      return true;
    }
  }
  return false;
}

function isUserCallable(flat, name) {
  for (let i = 0; i < flat.stmtKind.length; i += 1) {
    if (flat.stmtKind[i] === 'fn' && flat.stmtName[i] === name) return true;
    if (flat.stmtKind[i] === 'from' && flat.stmtTarget[i] === name) return true;
    if (flat.stmtKind[i] === 'from' && flat.stmtTarget[i] === '' && flat.stmtName[i] === name) return true;
  }
  return false;
}

function isForCounter(flat, fn, name) {
  for (let i = 0; i < flat.stmtKind.length; i += 1) {
    if (flat.stmtFn[i] === fn && flat.stmtKind[i] === 'for' && flat.stmtName[i] === name) return true;
  }
  return false;
}

function isAssigned(flat, fn, name) {
  for (let i = 0; i < flat.stmtKind.length; i += 1) {
    if (flat.stmtFn[i] === fn && flat.stmtKind[i] === 'assign' && flat.stmtTarget[i] === name) return true;
  }
  return false;
}

function isIndexRebound(flat, fn, name) {
  for (let i = 0; i < flat.stmtKind.length; i += 1) {
    if (flat.stmtFn[i] !== fn) continue;
    if (flat.stmtKind[i] === 'assign' && flat.stmtTarget[i] === name) return true;
    if (flat.stmtKind[i] === 'let' && flat.stmtName[i] === name) return true;
  }
  return false;
}

function isFunctionParam(flat, fn, name) {
  return paramOrdinal(flat, fn, name) >= 0;
}

function paramOrdinal(flat, fn, name) {
  for (let i = 0; i < flat.paramFn.length; i += 1) {
    if (flat.paramFn[i] === fn && flat.paramName[i] === name) return flat.paramOrdinal[i];
  }
  return -1;
}

function paramCallsitesOk(flat, callee, ordinal) {
  let found = false;
  for (let i = 0; i < flat.callName.length; i += 1) {
    if (flat.callName[i] !== callee) continue;
    found = true;
    const arg = argIndex(flat, i, ordinal);
    if (arg < 0 || !argProvenanced(flat, arg)) return false;
  }
  return found;
}

function argIndex(flat, call, ordinal) {
  for (let i = 0; i < flat.argCall.length; i += 1) {
    if (flat.argCall[i] === call && flat.argOrdinal[i] === ordinal) return i;
  }
  return -1;
}

function argProvenanced(flat, arg) {
  const call = flat.argCall[arg];
  const fn = flat.callFn[call];
  if (flat.argKind[arg] === 'numLit') return isSafeIntText(flat.argNum[arg]);
  if (flat.argKind[arg] === 'ident') return termProvenanced(flat, fn, 'ident', flat.argName[arg], '');
  if (flat.argKind[arg] === 'binary' && (flat.argOp[arg] === '+' || flat.argOp[arg] === '-')) {
    const left = termProvenanced(flat, fn, flat.argLeftKind[arg], flat.argLeftName[arg], flat.argLeftNum[arg]);
    const right = termProvenanced(flat, fn, flat.argRightKind[arg], flat.argRightName[arg], flat.argRightNum[arg]);
    return left && right;
  }
  return false;
}

function termProvenanced(flat, fn, kind, name, num) {
  if (kind === 'numLit') return isSafeIntText(num);
  if (kind !== 'ident') return false;
  if (isForCounter(flat, fn, name) && !isIndexRebound(flat, fn, name)) return true;
  if (isFunctionParam(flat, fn, name) && !isIndexRebound(flat, fn, name)) return true;
  return false;
}

function mapKnownBefore(flat, call) {
  const map = mapArg(flat, call, 0);
  const key = mapKeyToken(flat, call);
  if (!map.ok || !key.ok) return false;
  for (let i = 0; i < flat.callName.length; i += 1) {
    if (i === call) break;
    if (flat.callFn[i] !== flat.callFn[call]) continue;
    if (flat.callMemberObject[i] !== 'Map' || flat.callMemberProp[i] !== 'set') continue;
    const priorMap = mapArg(flat, i, 0);
    const priorKey = mapKeyToken(flat, i);
    if (priorMap.ok && priorMap.token === map.token && priorKey.ok && priorKey.token === key.token) return true;
  }
  return false;
}

function mapArg(flat, call, ordinal) {
  const arg = argIndex(flat, call, ordinal);
  if (arg < 0 || flat.argKind[arg] !== 'ident') return { ok: false, token: '' };
  return { ok: true, token: flat.argName[arg] };
}

function mapKeyToken(flat, call) {
  const arg = argIndex(flat, call, 1);
  if (arg < 0) return { ok: false, token: '' };
  if (flat.argKind[arg] === 'strLit') return { ok: true, token: `lit:${flat.argName[arg]}` };
  if (flat.argKind[arg] === 'ident' && !isAssigned(flat, flat.callFn[call], flat.argName[arg])) {
    return { ok: true, token: `var:${flat.argName[arg]}` };
  }
  return { ok: false, token: '' };
}

function isSafeIntText(raw) {
  return isCanonicalSafeIntText(raw);
}

function isCanonicalSafeIntText(raw) {
  const negative = raw.startsWith('-');
  const magnitude = negative ? raw.slice(1) : raw;
  if (magnitude === '' || (magnitude.length > 1 && magnitude.startsWith('0'))) return false;
  if (negative && magnitude === '0') return false;
  if (!/^[0-9]+$/u.test(magnitude)) return false;
  if (magnitude.length < 16) return true;
  if (magnitude.length > 16) return false;
  return magnitude <= '9007199254740991';
}
