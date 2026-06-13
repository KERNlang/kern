/**
 * Phase-2 capture — produce the legacy (string path) and AST (parser path)
 * Python emission for a corpus case, with a CALL-CONVENTION consistency oracle.
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
 * Consistency oracle (`verifyLegacyFidelity`): for every EXPRESSION case it
 * proves TWO things, NOT a cross-shipment byte diff:
 *   1. The capture uses production's DOCUMENTED `rewriteExpr` call convention
 *      (conformance.mjs:1903): `captureLegacy` and the oracle both go through
 *      that same `rewriteExpr(expr, pathParams, bodyFields, authUser, imports)`
 *      signature, so the bytes agree by construction for that call shape.
 *   2. The framing derivation is INDEPENDENTLY consistent: the oracle derives
 *      pathParams/bodyFields/authUser with a SEPARATE function
 *      (`framingIndependent`) — not the shared `framing()` the capture uses — and
 *      asserts the framing TUPLE matches. A bug in `framing()` therefore diverges
 *      the tuple (and the resulting bytes), and the oracle CATCHES it. With a
 *      single shared `framing()` on both sides the check would be tautological
 *      (f(x) === f(x), proving only that rewriteExpr is deterministic).
 *
 * This is NOT a claim that the captured bytes were verified against an
 * independent PRODUCTION SHIPMENT of the same expression. For slice-0 bare
 * expressions there is no separate production route emission to diff against;
 * the `rewriteExpr` call convention IS the production expression path.
 *
 * NOTE: a full production-ROUTE-REPLAY cross-check — lowering the expression
 * through the FastAPI route generator, a genuinely different code path, and
 * diffing its emitted bytes — is DEFERRED to the route-corpus slice. That is the
 * check that would prove fidelity against a distinct production code path; this
 * oracle deliberately does not claim it.
 *
 * Cases legacy genuinely cannot handle (it leaves raw JS `&&`/`||`, or throws)
 * are recorded as structured results, not silent passes.
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
 * INDEPENDENT second derivation of the framing tuple, used ONLY by the
 * consistency oracle. It deliberately does NOT call `framing()` — it re-derives
 * the same tuple by a separate route (split-based path-param scan, explicit body
 * key collection) so a bug introduced into `framing()` produces a DIVERGENT tuple
 * the oracle can catch. If both sides shared `framing()`, the check would be
 * tautological. Kept structurally simple and equivalent-by-spec, not copy-pasted.
 * @param {object} c corpus case
 * @returns {{ pathParams: string[], bodyFields: Set<string>, authUser: boolean }}
 */
function framingIndependent(c) {
  const path = typeof c.path === 'string' ? c.path : '';
  // Independent path-param scan: split on '/' and pull ':'-prefixed segments,
  // rather than the global regex matchAll the shared deriver uses.
  const pathParams = [];
  for (const seg of path.split('/')) {
    if (seg.startsWith(':')) {
      const name = seg.slice(1).match(/^[A-Za-z_]\w*/);
      if (name) pathParams.push(name[0]);
    }
  }
  const bindings = c.bindings && typeof c.bindings === 'object' ? c.bindings : {};
  const body = bindings.body ?? {};
  const bodyFields = new Set();
  for (const k of Object.keys(body)) bodyFields.add(k);
  return { pathParams, bodyFields, authUser: c.authUser === true };
}

/**
 * Structural equality of two framing tuples (order-sensitive pathParams,
 * set-equal bodyFields, equal authUser). Used by the consistency oracle.
 * @param {{pathParams:string[], bodyFields:Set<string>, authUser:boolean}} a
 * @param {{pathParams:string[], bodyFields:Set<string>, authUser:boolean}} b
 * @returns {boolean}
 */
function framingEqual(a, b) {
  if (a.authUser !== b.authUser) return false;
  if (a.pathParams.length !== b.pathParams.length) return false;
  for (let i = 0; i < a.pathParams.length; i += 1) {
    if (a.pathParams[i] !== b.pathParams[i]) return false;
  }
  if (a.bodyFields.size !== b.bodyFields.size) return false;
  for (const f of a.bodyFields) {
    if (!b.bodyFields.has(f)) return false;
  }
  return true;
}

/**
 * Capture the legacy (string path) emission for a case.
 * @param {object} c corpus case (must have `.source`)
 * @param {string} repoRoot
 * @param {{pathParams:string[], bodyFields:Set<string>, authUser:boolean}} [framingOverride]
 *   Optional framing override. Production always uses the shared `framing(c)`;
 *   the consistency self-test injects a DIVERGENT framing here to prove the
 *   oracle's independent re-derivation catches the resulting byte divergence
 *   (i.e. the oracle is not tautological).
 * @returns {Promise<CaptureResult>}
 */
export async function captureLegacy(c, repoRoot, framingOverride) {
  const { rewriteExpr } = await mods(repoRoot);
  const { pathParams, bodyFields, authUser } = framingOverride ?? framing(c);
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
 * Call-convention consistency oracle. For every EXPRESSION case it proves the
 * capture uses production's documented `rewriteExpr` call convention AND that the
 * framing derivation is independently consistent — see the file header for what
 * this does and does NOT prove (it is NOT a cross-shipment byte diff).
 *
 * For each case it:
 *   1. Re-derives the framing tuple INDEPENDENTLY (`framingIndependent`, NOT the
 *      shared `framing()`) and asserts it equals what the capture used. A bug in
 *      `framing()` diverges the tuple and FAILS here.
 *   2. Re-emits the legacy bytes through that independent framing + the same
 *      `rewriteExpr` convention and asserts the bytes are byte-identical to the
 *      capture. (With identical framing the bytes agree by construction; a
 *      framing divergence — e.g. an injected bogus pathParam — flips the bytes
 *      and is caught, which is what makes this non-tautological.)
 *
 * Returns a structured report; `ok === false` if ANY case diverges.
 * @param {object[]} cases corpus cases
 * @param {string} repoRoot
 * @param {{ captureFramingOverride?: (c:object)=>({pathParams:string[],bodyFields:Set<string>,authUser:boolean}) }} [opts]
 *   Test-only hook: supplies a DIVERGENT framing to the CAPTURE side so the
 *   self-test can prove the oracle catches the resulting framing/byte divergence.
 * @returns {Promise<{ ok:boolean, rows:Array<{id:string, match:boolean, framingMatch:boolean, capturedSha:string|null, oracleSha:string|null, legacyRunnable:boolean, note:string}> }>}
 */
export async function verifyLegacyFidelity(cases, repoRoot, opts = {}) {
  const { rewriteExpr } = await mods(repoRoot);
  const { createHash } = await import('node:crypto');
  const sha = (s) => createHash('sha256').update(s).digest('hex');
  const rows = [];
  let ok = true;
  for (const c of cases) {
    if (c.kind !== 'expr') continue; // oracle is for EXPRESSION cases

    // The capture side: production's shared framing, unless the test injects a
    // divergent override to prove the oracle bites.
    const captureFraming = opts.captureFramingOverride
      ? opts.captureFramingOverride(c)
      : framing(c);
    const captured = await captureLegacy(c, repoRoot, captureFraming);

    // The oracle side: framing derived INDEPENDENTLY (separate function).
    const oracleFraming = framingIndependent(c);
    const framingMatch = framingEqual(captureFraming, oracleFraming);
    if (!framingMatch) ok = false;

    // Re-emit through the independent framing + the same rewriteExpr convention.
    const imports = new Set();
    let oracleCode = null;
    let oracleThrew = false;
    let oracleErrCode = null;
    try {
      oracleCode = rewriteExpr(
        c.source,
        oracleFraming.pathParams,
        oracleFraming.bodyFields,
        oracleFraming.authUser,
        imports,
      );
    } catch (err) {
      oracleThrew = true;
      oracleErrCode = `legacy:${errCode(err)}`;
    }

    if (captured.status === 'error') {
      // C2: a "both threw" match must compare ERROR CATEGORIES (here: the
      // structured error code/category), not merely a boolean. Capture-errored
      // AND oracle-threw is only a faithful match if BOTH the framing is
      // consistent AND the failures are the same category — otherwise two
      // different failures would be silently accepted as "both threw".
      const sameFailure = oracleThrew && captured.code === oracleErrCode;
      const match = framingMatch && sameFailure;
      if (!match) ok = false;
      rows.push({
        id: c.id,
        match,
        framingMatch,
        capturedSha: null,
        oracleSha: oracleThrew ? null : sha(/** @type {string} */ (oracleCode)),
        legacyRunnable: false,
        note: !framingMatch
          ? 'FRAMING DIVERGENCE (capture vs independent oracle)'
          : oracleThrew
            ? sameFailure
              ? `both threw same category (${captured.category})`
              : `both threw but DIFFERENT failure: capture=${captured.code} oracle=${oracleErrCode}`
            : 'capture errored but oracle emitted',
      });
      continue;
    }

    if (oracleThrew) {
      ok = false;
      rows.push({
        id: c.id,
        match: false,
        framingMatch,
        capturedSha: sha(captured.code),
        oracleSha: null,
        legacyRunnable: false,
        note: 'capture emitted but oracle threw',
      });
      continue;
    }

    const capturedSha = sha(captured.code);
    const oracleSha = sha(/** @type {string} */ (oracleCode));
    const bytesMatch = capturedSha === oracleSha;
    const match = framingMatch && bytesMatch;
    if (!match) ok = false;
    // "Runnable" heuristic: legacy leaves raw JS `&&`/`||`/`=>`/`?:`-only as
    // tokens that are not valid Python. Flag those so the report documents WHY
    // a faithful capture is still LEGACY_BLOCKED at runtime — not a silent pass.
    const legacyRunnable = !/(\|\||&&|=>)/.test(captured.code);
    rows.push({
      id: c.id,
      match,
      framingMatch,
      capturedSha,
      oracleSha,
      legacyRunnable,
      note: !framingMatch
        ? 'FRAMING DIVERGENCE (capture vs independent oracle)'
        : bytesMatch
          ? legacyRunnable
            ? 'bytes consistent (production rewriteExpr convention + independent framing)'
            : 'bytes consistent (legacy leaves raw JS — unrunnable Python, expected LEGACY_BLOCKED)'
          : 'BYTE DIVERGENCE (capture vs independent re-emission)',
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
