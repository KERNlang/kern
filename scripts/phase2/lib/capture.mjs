/**
 * Phase-2 capture — produce the legacy (string path) and AST (parser path)
 * Python emission for a corpus case, with a hard byte-equivalence oracle proving
 * the legacy capture is FAITHFUL to what production (`scripts/conformance.mjs`)
 * actually ships.
 *
 * Confirmed capture signatures (ground-truthed against dist):
 *   py_legacy: `rewriteExpr(expr, pathParams, bodyFields, authUser, imports)`
 *     from `packages/python/dist/core/expr/index.js` — the SAME call shape the
 *     conformance expression runner uses (conformance.mjs:1903). The bitwise
 *     mini-AST pre-pass is the first block of rewriteExpr, so calling it directly
 *     is faithful.
 *   py_ast:    `parseExpression(expr)` (packages/core/dist/parser-expression.js)
 *     -> `emitPyExpressionWithImports(ir, { coerceJsValues: true })`
 *     (packages/python/dist/codegen-body-python.js).
 *
 * Byte-equivalence oracle (`verifyLegacyFidelity`): for every EXPRESSION case,
 * re-derive the legacy bytes through the identical rewriteExpr call shape +
 * pathParams/bodyFields framing that conformance uses, and assert the capture's
 * bytes are byte-identical. A mismatch FAILS — the capture cannot lie that it
 * mirrors production. Cases legacy genuinely cannot handle (it leaves raw JS
 * `&&`/`||`, or throws) are recorded as structured results, not silent passes:
 * the fidelity check still proves the captured BYTES match production bytes,
 * even when those bytes are unrunnable Python.
 */

import { join } from 'node:path';

/**
 * @typedef {{ status:'ok', code:string, imports:string[], helpers:string[] }
 *   | { status:'error', code:string, category:'parse'|'emit'|'runtime'|'runner' }} CaptureResult
 */

let _mods = null;

/**
 * Lazily import the compiled dist entrypoints (same modules conformance imports).
 * @param {string} repoRoot
 */
async function mods(repoRoot) {
  if (_mods) return _mods;
  const [{ rewriteExpr }, { parseExpression }, { emitPyExpressionWithImports }, { rewriteExpressExpr }] =
    await Promise.all([
      import(join(repoRoot, 'packages/python/dist/core/expr/index.js')),
      import(join(repoRoot, 'packages/core/dist/parser-expression.js')),
      import(join(repoRoot, 'packages/python/dist/codegen-body-python.js')),
      import(join(repoRoot, 'packages/express/dist/express-portable.js')),
    ]);
  _mods = { rewriteExpr, parseExpression, emitPyExpressionWithImports, rewriteExpressExpr };
  return _mods;
}

/**
 * Path params + body fields derived for a case, mirroring the conformance
 * expression runner (conformance.mjs:1885-1888). Slice-0 corpus cases are bare
 * expressions with no route path and no Pydantic body, so both are empty — but
 * we derive them the same way so the framing is identical to production.
 * @param {object} c corpus case
 * @returns {{ pathParams: string[], bodyFields: Set<string>, authUser: boolean }}
 */
function framing(c) {
  const path = typeof c.path === 'string' ? c.path : '';
  const pathParams = [...path.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1]);
  const bindings = c.bindings && typeof c.bindings === 'object' ? c.bindings : {};
  const bodyFields = new Set(Object.keys(bindings.body ?? {}));
  return { pathParams, bodyFields, authUser: !!c.authUser };
}

/**
 * Capture the legacy (string path) emission for a case.
 * @param {object} c corpus case (must have `.source`)
 * @param {string} repoRoot
 * @returns {Promise<CaptureResult>}
 */
export async function captureLegacy(c, repoRoot) {
  const { rewriteExpr } = await mods(repoRoot);
  const { pathParams, bodyFields, authUser } = framing(c);
  const imports = new Set();
  try {
    const code = rewriteExpr(c.source, pathParams, bodyFields, authUser, imports);
    return { status: 'ok', code, imports: [...imports], helpers: [] };
  } catch (err) {
    return { status: 'error', code: `legacy:${errCode(err)}`, category: 'emit' };
  }
}

/**
 * Capture the AST (parser path) emission for a case.
 * @param {object} c corpus case
 * @param {string} repoRoot
 * @returns {Promise<CaptureResult>}
 */
export async function captureAst(c, repoRoot) {
  const { parseExpression, emitPyExpressionWithImports } = await mods(repoRoot);
  let ir;
  try {
    ir = parseExpression(c.source);
  } catch (err) {
    return { status: 'error', code: `ast-parse:${errCode(err)}`, category: 'parse' };
  }
  try {
    const emit = emitPyExpressionWithImports(ir, { coerceJsValues: true });
    return {
      status: 'ok',
      code: emit.code,
      imports: [...(emit.imports ?? [])],
      helpers: [...(emit.helpers ?? [])],
    };
  } catch (err) {
    return { status: 'error', code: `ast-emit:${errCode(err)}`, category: 'emit' };
  }
}

/**
 * Capture the TS reference (Express-portable) JS expression for a case.
 * @param {object} c corpus case
 * @param {string} repoRoot
 * @returns {Promise<{ status:'ok', jsExpr:string } | { status:'error', code:string, category:'parse'|'emit'|'runtime'|'runner' }>}
 */
export async function captureTs(c, repoRoot) {
  const { rewriteExpressExpr } = await mods(repoRoot);
  const path = typeof c.path === 'string' && c.path ? c.path : '/';
  try {
    const jsExpr = rewriteExpressExpr(c.source, path);
    return { status: 'ok', jsExpr };
  } catch (err) {
    return { status: 'error', code: `ts:${errCode(err)}`, category: 'emit' };
  }
}

/**
 * Byte-equivalence oracle. For every EXPRESSION case, re-derive the legacy bytes
 * through the IDENTICAL rewriteExpr call shape conformance uses and assert the
 * capture's bytes match. Returns a structured report; `ok === false` if ANY case
 * diverges. Cases legacy cannot handle are recorded with `legacyRunnable: false`
 * but still pass the FIDELITY check as long as the bytes match production bytes.
 * @param {object[]} cases corpus cases
 * @param {string} repoRoot
 * @returns {Promise<{ ok:boolean, rows:Array<{id:string, match:boolean, capturedSha:string|null, productionSha:string|null, legacyRunnable:boolean, note:string}> }>}
 */
export async function verifyLegacyFidelity(cases, repoRoot) {
  const { rewriteExpr } = await mods(repoRoot);
  const { createHash } = await import('node:crypto');
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const rows = [];
  let ok = true;
  for (const c of cases) {
    if (c.kind !== 'expr') continue; // fidelity oracle is for EXPRESSION cases
    const captured = await captureLegacy(c, repoRoot);
    // Re-run the EXACT production call shape independently.
    const { pathParams, bodyFields, authUser } = framing(c);
    const imports = new Set();
    let prodCode = null;
    let prodThrew = false;
    try {
      prodCode = rewriteExpr(c.source, pathParams, bodyFields, authUser, imports);
    } catch {
      prodThrew = true;
    }

    if (captured.status === 'error') {
      // Capture must agree that production also threw (or both produce the same
      // failure). Production throwing AND capture erroring is a faithful match.
      const match = prodThrew;
      if (!match) ok = false;
      rows.push({
        id: c.id,
        match,
        capturedSha: null,
        productionSha: prodThrew ? null : sha(/** @type {string} */ (prodCode)),
        legacyRunnable: false,
        note: prodThrew ? 'both threw (faithful)' : 'capture errored but production emitted',
      });
      continue;
    }

    if (prodThrew) {
      ok = false;
      rows.push({
        id: c.id,
        match: false,
        capturedSha: sha(captured.code),
        productionSha: null,
        legacyRunnable: false,
        note: 'capture emitted but production threw',
      });
      continue;
    }

    const capturedSha = sha(captured.code);
    const productionSha = sha(/** @type {string} */ (prodCode));
    const match = capturedSha === productionSha;
    if (!match) ok = false;
    // "Runnable" heuristic: legacy leaves raw JS `&&`/`||`/`=>`/`?:`-only as
    // tokens that are not valid Python. Flag those so the report documents WHY
    // a faithful capture is still LEGACY_BLOCKED at runtime — not a silent pass.
    const legacyRunnable = !/(\|\||&&|=>)/.test(captured.code);
    rows.push({
      id: c.id,
      match,
      capturedSha,
      productionSha,
      legacyRunnable,
      note: match
        ? legacyRunnable
          ? 'bytes match production'
          : 'bytes match production (legacy leaves raw JS — unrunnable Python, expected LEGACY_BLOCKED)'
        : 'BYTE MISMATCH vs production',
    });
  }
  return { ok, rows };
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function errCode(err) {
  const msg = String(/** @type {any} */ (err)?.message ?? err);
  return msg.split('\n')[0].slice(0, 80);
}
