import {
  extractPythonKeywordArgument,
  type PythonStringDelimiter,
  scanPythonStructuralLine,
} from '../../python-response-contract.js';
import type { LineInfo } from '../helpers/lines.js';
import { API_SUCCESS_STATUS_CODES_FB, FASTAPI_DEFAULT_SUCCESS_FB } from '../signatures.js';

// P2-A fallback parity: mirror of `extractFastApiSuccessStatusCodes` in
// `packages/review-python/src/mapper.ts`. The fallback handles repos where
// the tree-sitter native build is unavailable. Both extractors must produce
// identical outputs for the same FastAPI source so cross-stack rules behave
// the same regardless of which path was used.
export function successStatusCodesFromDecoratorAndBody(
  decoratorText: string,
  body: string,
): { codes: readonly number[] | undefined; resolved: boolean } {
  let sawDynamic = false;

  const decoratorStatus = extractPythonKeywordArgument(decoratorText, 'status_code');
  let decoratorCode: number | undefined;
  if (decoratorStatus !== undefined) {
    const code = parseFastApiStatusValueFb(decoratorStatus);
    if (code === undefined) sawDynamic = true;
    else if (API_SUCCESS_STATUS_CODES_FB.has(code)) decoratorCode = code;
  }

  const responseCodes = new Set<number>();
  const responseRe =
    /\b(?:Response|JSONResponse|HTMLResponse|PlainTextResponse|RedirectResponse|StreamingResponse|FileResponse|ORJSONResponse|UJSONResponse)\s*\([^)]*?\bstatus_code\s*=\s*([^,)\n]+)/g;
  for (const match of body.matchAll(responseRe)) {
    const code = parseFastApiStatusValueFb(match[1].trim());
    if (code === undefined) sawDynamic = true;
    else if (API_SUCCESS_STATUS_CODES_FB.has(code)) responseCodes.add(code);
  }

  // Match any identifier prefix (Codex impl-review #2): the injected Response
  // param name varies — `response`, `resp`, `r`, `out`, etc.
  const mutationCodes = new Set<number>();
  // `=(?!=)` distinguishes assignment from `==` comparison (forge round, Claude engine).
  const mutateRe = /\b[A-Za-z_]\w*\.status_code\s*=(?!=)\s*([^\n;]+)/g;
  for (const match of body.matchAll(mutateRe)) {
    const code = parseFastApiStatusValueFb(match[1].trim());
    if (code === undefined) sawDynamic = true;
    else if (API_SUCCESS_STATUS_CODES_FB.has(code)) mutationCodes.add(code);
  }

  if (sawDynamic) return { codes: undefined, resolved: false };

  const plainReturnRe =
    /\breturn\b(?!\s+(?:Response|JSONResponse|HTMLResponse|PlainTextResponse|RedirectResponse|StreamingResponse|FileResponse|ORJSONResponse|UJSONResponse)\s*\()/;
  const hasPlainReturn = plainReturnRe.test(body);

  const final = new Set<number>();
  if (hasPlainReturn) {
    if (mutationCodes.size > 0) {
      for (const c of mutationCodes) final.add(c);
    } else if (decoratorCode !== undefined) {
      final.add(decoratorCode);
    } else {
      final.add(FASTAPI_DEFAULT_SUCCESS_FB);
    }
  } else if (decoratorCode !== undefined && responseCodes.size === 0 && mutationCodes.size === 0) {
    final.add(decoratorCode);
  }
  for (const c of responseCodes) final.add(c);
  for (const c of mutationCodes) final.add(c);

  return {
    codes: Array.from(final).sort((a, b) => a - b),
    resolved: true,
  };
}

/** Collect the full decorator text starting at line `startIdx`, walking
 *  forward through continuation lines until the outer parentheses balance.
 *  Used by the fallback success-status extraction so multi-line decorators
 *  like `@router.post(\n    "/x",\n    status_code=201,\n)` aren't truncated
 *  to the first line (Codex impl-review #3). */
export function collectFullDecoratorText(lines: readonly LineInfo[], startIdx: number): string {
  const parts: string[] = [];
  let depth = 0;
  let started = false;
  let quote: PythonStringDelimiter | undefined;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].text;
    parts.push(line);
    const structural = scanPythonStructuralLine(line, quote);
    quote = structural.quote;
    depth += structural.parenDelta;
    if (structural.sawOpenParen) started = true;
    if (started && depth === 0) break;
  }
  return parts.join('\n');
}

export function parseFastApiStatusValueFb(val: string): number | undefined {
  const trimmed = val.trim();
  const litMatch = trimmed.match(/^(\d{3})$/);
  if (litMatch) return Number(litMatch[1]);
  const httpMatch = trimmed.match(/HTTP_(\d{3})_/);
  if (httpMatch) return Number(httpMatch[1]);
  return undefined;
}
