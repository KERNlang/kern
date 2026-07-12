import { extractPythonKeywordArgument } from '@kernlang/review';
import type Parser from 'tree-sitter';
import { FASTAPI_DEFAULT_SUCCESS_STATUS, PY_API_SUCCESS_STATUS_CODES } from '../signatures.js';

// Phase 2 of cross-stack `status-code-drift`. Populates the
// `successStatusCodes` / `successStatusCodesResolved` payload fields so the
// rule can flag clients checking a 2xx the FastAPI server doesn't emit.
//
// Sources of evidence (per buddy plan-review consensus):
//   1. Decorator `status_code=N` (literal) or `status_code=status.HTTP_NNN_*`.
//   2. Body-side `Response(status_code=N)` / `JSONResponse(...)` returns.
//   3. Body-side `<param>.status_code = N` mutations (FastAPI's documented
//      pattern for routes that take a `Response` parameter).
//   4. When the decorator omits status_code AND the body has no explicit
//      Response / mutation, default to 200 — FastAPI's documented default
//      regardless of HTTP method. Codex caught Gemini's POST→201 premise as
//      wrong (FastAPI docs:
//      https://fastapi.tiangolo.com/tutorial/response-status-code/).
//
// Marked unresolved when:
//   - Decorator status_code is set to a non-literal/non-status-constant
//     expression (variable, function call).
//   - Any `Response(status_code=...)` / `<x>.status_code = ...` RHS is dynamic.
export function extractFastApiSuccessStatusCodes(
  decText: string,
  fnDef: Parser.SyntaxNode,
  source: string,
): { codes: readonly number[] | undefined; resolved: boolean } {
  let sawDynamic = false;

  // 1. Decorator `status_code=N` — applies ONLY to plain `return data` paths.
  //    For routes whose return paths all use explicit Response/JSONResponse,
  //    the decorator code is dead (Codex impl-review #1).
  const decoratorStatus = extractPythonKeywordArgument(decText, 'status_code');
  let decoratorCode: number | undefined;
  if (decoratorStatus !== undefined) {
    const code = parseFastApiStatusValue(decoratorStatus);
    if (code === undefined) sawDynamic = true;
    else if (PY_API_SUCCESS_STATUS_CODES.has(code)) decoratorCode = code;
  }

  const body = fnDef.childForFieldName('body') ?? fnDef.namedChildren.find((c) => c.type === 'block');
  const bodyText = body ? source.substring(body.startIndex, body.endIndex) : '';

  // 2. Response(status_code=N) / JSONResponse(...) etc. — applies only to
  //    that specific return path. Multiple Response codes contribute a
  //    multi-2xx route.
  const responseCodes = new Set<number>();
  const responseRe =
    /\b(?:Response|JSONResponse|HTMLResponse|PlainTextResponse|RedirectResponse|StreamingResponse|FileResponse|ORJSONResponse|UJSONResponse)\s*\([^)]*?\bstatus_code\s*=\s*([^,)\n]+)/g;
  for (const match of bodyText.matchAll(responseRe)) {
    const code = parseFastApiStatusValue(match[1].trim());
    if (code === undefined) sawDynamic = true;
    else if (PY_API_SUCCESS_STATUS_CODES.has(code)) responseCodes.add(code);
  }

  // 3. `<paramName>.status_code = N` — mutation on the injected Response
  //    parameter. The parameter name varies (`response`, `resp`, `r`, `out`,
  //    custom names — Codex impl-review #2). Match any identifier prefix
  //    rather than a name whitelist; the API_SUCCESS_STATUS_CODES filter
  //    keeps the noise tax low.
  const mutationCodes = new Set<number>();
  // `=(?!=)` distinguishes assignment from `==` comparison so
  // `if response.status_code == 200:` doesn't masquerade as a dynamic
  // mutation (forge round, Claude engine).
  const mutateRe = /\b[A-Za-z_]\w*\.status_code\s*=(?!=)\s*([^\n;]+)/g;
  for (const match of bodyText.matchAll(mutateRe)) {
    const code = parseFastApiStatusValue(match[1].trim());
    if (code === undefined) sawDynamic = true;
    else if (PY_API_SUCCESS_STATUS_CODES.has(code)) mutationCodes.add(code);
  }

  if (sawDynamic) return { codes: undefined, resolved: false };

  // Plain return paths inherit the route's "primary" success code, computed
  // as: mutation > decorator > FastAPI default 200. When a mutation is
  // present we treat it as the plain-return code (the conditional-mutation
  // case is a documented v1 false-negative — would require control-flow
  // analysis to disambiguate).
  const plainReturnRe =
    /\breturn\b(?!\s+(?:Response|JSONResponse|HTMLResponse|PlainTextResponse|RedirectResponse|StreamingResponse|FileResponse|ORJSONResponse|UJSONResponse)\s*\()/;
  const hasPlainReturn = plainReturnRe.test(bodyText);

  const final = new Set<number>();

  if (hasPlainReturn) {
    if (mutationCodes.size > 0) {
      for (const c of mutationCodes) final.add(c);
    } else if (decoratorCode !== undefined) {
      final.add(decoratorCode);
    } else {
      final.add(FASTAPI_DEFAULT_SUCCESS_STATUS);
    }
  } else if (decoratorCode !== undefined && responseCodes.size === 0 && mutationCodes.size === 0) {
    // Handler with no plain return, no Response, no mutation — likely an
    // implicit-None-return stub or all-raise. Decorator is the only signal.
    final.add(decoratorCode);
  }

  // Response and mutation codes ALWAYS contribute (they're explicit choices
  // for their respective return paths).
  for (const c of responseCodes) final.add(c);
  for (const c of mutationCodes) final.add(c);

  return {
    codes: Array.from(final).sort((a, b) => a - b),
    resolved: true,
  };
}

export function parseFastApiStatusValue(val: string): number | undefined {
  const trimmed = val.trim();
  // Literal 3-digit int.
  const litMatch = trimmed.match(/^(\d{3})$/);
  if (litMatch) return Number(litMatch[1]);
  // status.HTTP_NNN_NAME / starlette.status.HTTP_NNN_NAME / fastapi.status.HTTP_NNN_NAME.
  const httpMatch = trimmed.match(/HTTP_(\d{3})_/);
  if (httpMatch) return Number(httpMatch[1]);
  return undefined;
}
