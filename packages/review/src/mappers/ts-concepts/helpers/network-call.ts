import { SyntaxKind } from 'ts-morph';
import { AXIOS_STYLE_METHODS, HOST_LIKE_RE } from '../signatures.js';
import { type ConstLiteralMap, lookupConstLiteral } from './const-resolution.js';
import { extractPayloadFields, type FieldTypeMap } from './types.js';

export function extractSentFields(
  call: import('ts-morph').CallExpression,
  funcName: string,
): {
  fields: readonly string[] | undefined;
  resolved: boolean;
  types: FieldTypeMap | undefined;
} {
  const payload = extractNetworkPayloadExpression(call, funcName);
  if (!payload) return { fields: undefined, resolved: false, types: undefined };
  return extractPayloadFields(payload);
}

export function extractNetworkPayloadExpression(
  call: import('ts-morph').CallExpression,
  funcName: string,
): import('ts-morph').Node | undefined {
  const args = call.getArguments();
  if (args.length < 2) return undefined;

  if (AXIOS_STYLE_METHODS.has(funcName)) {
    return args[1];
  }

  if (funcName !== 'fetch') return undefined;
  const opts = args[1];
  if (opts.getKind() !== SyntaxKind.ObjectLiteralExpression) return undefined;
  const optsObj = opts as import('ts-morph').ObjectLiteralExpression;
  const bodyProp = optsObj.getProperty('body');
  if (!bodyProp) return undefined;
  if (bodyProp.getKind() !== SyntaxKind.PropertyAssignment) {
    return undefined;
  }
  const init = (bodyProp as import('ts-morph').PropertyAssignment).getInitializer();
  return init;
}

export function extractTarget(call: import('ts-morph').CallExpression, consts?: ConstLiteralMap): string | undefined {
  const args = call.getArguments();
  if (args.length === 0) return undefined;
  const first = args[0];
  if (first.getKind() === SyntaxKind.StringLiteral) {
    return (first as import('ts-morph').StringLiteral).getLiteralValue();
  }
  if (first.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return (first as import('ts-morph').NoSubstitutionTemplateLiteral).getLiteralValue();
  }
  if (first.getKind() === SyntaxKind.TemplateExpression) {
    return extractTemplateUrl(first as import('ts-morph').TemplateExpression, consts);
  }
  if (first.getKind() === SyntaxKind.Identifier && consts) {
    return lookupConstLiteral(first as import('ts-morph').Identifier, consts);
  }
  return undefined;
}

export function extractHost(target: string | undefined): string | undefined {
  if (!target) return undefined;
  if (!target.startsWith('http://') && !target.startsWith('https://')) return undefined;
  const hostStart = target.indexOf('://') + 3;
  const pathStart = target.indexOf('/', hostStart);
  const host = pathStart === -1 ? target.slice(hostStart) : target.slice(hostStart, pathStart);
  if (!HOST_LIKE_RE.test(host)) return undefined;
  return host.toLowerCase();
}

// Convert a template literal like `${API_BASE}/api/review/${slug}` into a
// server-route-shaped path like `/api/review/:slug` so cross-stack rules can
// correlate it against backend routes. Without this every `fetch(` \`${BASE}/…\` `)`
// call is silently dropped by `normalizeClientUrl` (which rejects targets that
// start with \`$ instead of \`/).
export function extractTemplateUrl(
  tmpl: import('ts-morph').TemplateExpression,
  consts?: ConstLiteralMap,
): string | undefined {
  const head = tmpl.getHead();
  let out = head.getLiteralText();
  const spans = tmpl.getTemplateSpans();
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    const expr = span.getExpression();
    const exprText = expr.getText();
    const isBareIdent = expr.getKind() === SyntaxKind.Identifier;

    // Phase 1 const resolution: substitute `${IDENT}` with its same-file literal
    // value when the symbol-resolved binding is a literal const we collected.
    // Lifts host extraction and route matching on the common
    // `${API_BASE}/users/${id}` shape. Symbol-based (not name-based) so that
    // a shadowing parameter / `let` / inner non-literal const cannot
    // fabricate a wrong absolute URL.
    if (isBareIdent && consts) {
      const resolved = lookupConstLiteral(expr as import('ts-morph').Identifier, consts);
      if (resolved !== undefined) {
        out += resolved;
        out += span.getLiteral().getLiteralText();
        continue;
      }
    }

    if (i === 0 && out === '' && isBareIdent && looksLikeBaseUrlName(exprText)) {
      // Drop a leading `${BASE_URL}` interpolation so the path starts with `/`.
    } else {
      out += `:${isBareIdent ? exprText : 'param'}`;
    }
    out += span.getLiteral().getLiteralText();
  }
  return out.length > 0 ? out : undefined;
}

export function looksLikeBaseUrlName(name: string): boolean {
  return (
    /(^|_)(base|url|host|origin|endpoint|api|server)(_|$)/i.test(name) ||
    /(Base|Url|Host|Origin|Endpoint|Api|Server)$/.test(name)
  );
}

export function extractQueryParams(
  call: import('ts-morph').CallExpression,
  consts?: ConstLiteralMap,
): {
  params: readonly string[] | undefined;
  resolved: boolean;
} {
  const target = extractTarget(call, consts);
  if (!target) return { params: undefined, resolved: false };
  const q = target.indexOf('?');
  if (q === -1) return { params: [], resolved: true };
  const query = target.slice(q + 1).split('#')[0] ?? '';
  if (query.length === 0) return { params: [], resolved: true };
  const params: string[] = [];
  for (const part of query.split('&')) {
    if (!part) continue;
    const [rawName] = part.split('=');
    if (!rawName) continue;
    const name = rawName.replace(/^:+/, '');
    if (/^[A-Za-z_][\w-]*$/.test(name)) params.push(name);
  }
  return { params, resolved: true };
}

export function extractBodyKind(
  call: import('ts-morph').CallExpression,
  funcName: string,
): 'none' | 'static' | 'dynamic' | undefined {
  const args = call.getArguments();
  if (args.length < 2) return 'none';
  const arg = args[1];

  // Axios-style: the 2nd arg *is* the body.
  if (AXIOS_STYLE_METHODS.has(funcName)) {
    return classifyBodyExpression(arg);
  }

  // Fetch-style: the 2nd arg is an options object; body lives in `.body`.
  if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = arg as import('ts-morph').ObjectLiteralExpression;
    const bodyProp = obj.getProperty('body');
    if (!bodyProp) return 'none';
    if (bodyProp.getKind() === SyntaxKind.ShorthandPropertyAssignment) return 'dynamic';
    if (bodyProp.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
    const initializer = (bodyProp as import('ts-morph').PropertyAssignment).getInitializer();
    return classifyBodyExpression(initializer);
  }

  return undefined;
}

export function classifyBodyExpression(
  expr: import('ts-morph').Node | undefined,
): 'none' | 'static' | 'dynamic' | undefined {
  if (!expr) return undefined;
  const k = expr.getKind();

  if (k === SyntaxKind.StringLiteral || k === SyntaxKind.NoSubstitutionTemplateLiteral) return 'static';
  if (k === SyntaxKind.NumericLiteral || k === SyntaxKind.TrueKeyword || k === SyntaxKind.FalseKeyword) return 'static';
  if (k === SyntaxKind.NullKeyword || k === SyntaxKind.UndefinedKeyword) return 'none';

  if (k === SyntaxKind.TemplateExpression) return 'dynamic';

  if (k === SyntaxKind.ObjectLiteralExpression || k === SyntaxKind.ArrayLiteralExpression) {
    return objectOrArrayIsDynamic(expr) ? 'dynamic' : 'static';
  }

  if (k === SyntaxKind.CallExpression) {
    const call = expr as import('ts-morph').CallExpression;
    const calleeText = call.getExpression().getText();
    if (calleeText === 'JSON.stringify') {
      const arg = call.getArguments()[0];
      return classifyBodyExpression(arg);
    }
    return 'dynamic';
  }

  if (
    k === SyntaxKind.Identifier ||
    k === SyntaxKind.PropertyAccessExpression ||
    k === SyntaxKind.ElementAccessExpression ||
    k === SyntaxKind.BinaryExpression ||
    k === SyntaxKind.ConditionalExpression ||
    k === SyntaxKind.SpreadElement
  ) {
    return 'dynamic';
  }

  return undefined;
}

function objectOrArrayIsDynamic(expr: import('ts-morph').Node): boolean {
  if (expr.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = expr as import('ts-morph').ObjectLiteralExpression;
    for (const prop of obj.getProperties()) {
      if (prop.getKind() === SyntaxKind.ShorthandPropertyAssignment) return true;
      if (prop.getKind() === SyntaxKind.SpreadAssignment) return true;
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) return true;
      const init = (prop as import('ts-morph').PropertyAssignment).getInitializer();
      const kind = classifyBodyExpression(init);
      if (kind !== 'static' && kind !== 'none') return true;
    }
    return false;
  }
  if (expr.getKind() === SyntaxKind.ArrayLiteralExpression) {
    const arr = expr as import('ts-morph').ArrayLiteralExpression;
    for (const el of arr.getElements()) {
      const kind = classifyBodyExpression(el);
      if (kind !== 'static' && kind !== 'none') return true;
    }
    return false;
  }
  return true;
}

/**
 * Derive the HTTP method of a network call. Returns uppercase method string
 * (`GET`, `POST`, …) when confident, `undefined` when the method lives in a
 * runtime variable we can't read statically (e.g. `axios({ method: verb })`).
 * Feeds the `contract-method-drift` cross-stack rule.
 *
 * Resolution rules (in order):
 *   1. Wrapped client (`apiClient.post(…)`) or library method (`axios.get(…)`)
 *      → `funcName.toUpperCase()`. `funcName === 'request'` is intentionally
 *      skipped — for `axios.request({ method })` we'd need to read the config.
 *   2. Raw `fetch(url, { method: 'POST' })` — read the string literal. Any
 *      spread (`{ method: 'GET', ...opts }`) downgrades to `undefined` since
 *      we can't tell if opts overrides method at runtime.
 *   3. Raw `fetch(url)` / `axios(url)` with no options arg → `GET` (WHATWG +
 *      axios spec default).
 *   4. Raw call with variable options arg → `undefined` (requires dataflow).
 */
export function extractHttpMethod(
  call: import('ts-morph').CallExpression,
  funcName: string,
  isDirectNetwork: boolean,
  isKnownLibraryMethod: boolean,
  isWrappedClientCall: boolean,
): string | undefined {
  if (isKnownLibraryMethod || isWrappedClientCall) {
    if (funcName === 'request') return undefined;
    return funcName.toUpperCase();
  }
  if (!isDirectNetwork) return undefined;

  const args = call.getArguments();
  if (args.length < 2) return 'GET';

  const opts = args[1];
  if (opts.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const obj = opts as import('ts-morph').ObjectLiteralExpression;
    const hasSpread = obj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment);
    if (hasSpread) return undefined;
    const methodProp = obj.getProperty('method');
    if (!methodProp) return 'GET';
    if (methodProp.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
    const initializer = (methodProp as import('ts-morph').PropertyAssignment).getInitializer();
    if (!initializer) return undefined;
    const iKind = initializer.getKind();
    if (iKind === SyntaxKind.StringLiteral) {
      return (initializer as import('ts-morph').StringLiteral).getLiteralValue().toUpperCase();
    }
    if (iKind === SyntaxKind.NoSubstitutionTemplateLiteral) {
      return (initializer as import('ts-morph').NoSubstitutionTemplateLiteral).getLiteralValue().toUpperCase();
    }
    return undefined;
  }
  return undefined;
}

/**
 * Detect whether a network call's options literal carries an `Authorization`
 * header. Returns `true`/`false` when the options object is inspectable,
 * `undefined` when it's a variable, spread, or missing. Only looks at raw
 * `fetch(…)` — wrapped clients typically inject auth inside the wrapper.
 * Feeds the `auth-drift` rule, which only fires when the mapper is confident.
 */
export function extractHasAuthHeader(call: import('ts-morph').CallExpression, funcName: string): boolean | undefined {
  if (funcName !== 'fetch') return undefined;
  const args = call.getArguments();
  if (args.length < 2) return false;
  const opts = args[1];
  if (opts.getKind() !== SyntaxKind.ObjectLiteralExpression) return undefined;
  const obj = opts as import('ts-morph').ObjectLiteralExpression;
  if (obj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment)) return undefined;

  // Cookie / session auth: `fetch(url, { credentials: 'include' })` or
  // `'same-origin'` sends session cookies without an Authorization header.
  // We can't tell from the call alone whether the server accepts that auth
  // channel, so downgrade to `undefined` and let auth-drift stay silent.
  // Codex review: without this, cookie-based apps fire auth-drift on every
  // protected route even though they're authenticated.
  const credentialsProp = obj.getProperty('credentials');
  if (credentialsProp && credentialsProp.getKind() === SyntaxKind.PropertyAssignment) {
    const init = (credentialsProp as import('ts-morph').PropertyAssignment).getInitializer();
    if (init) {
      const k = init.getKind();
      if (k === SyntaxKind.StringLiteral || k === SyntaxKind.NoSubstitutionTemplateLiteral) {
        const v = (init as import('ts-morph').StringLiteral).getLiteralValue();
        if (v === 'include' || v === 'same-origin') return undefined;
      } else {
        return undefined;
      }
    }
  }

  const headersProp = obj.getProperty('headers');
  if (!headersProp) return false;
  if (headersProp.getKind() !== SyntaxKind.PropertyAssignment) return undefined;
  const headersInit = (headersProp as import('ts-morph').PropertyAssignment).getInitializer();
  if (!headersInit) return undefined;
  if (headersInit.getKind() !== SyntaxKind.ObjectLiteralExpression) return undefined;
  const headersObj = headersInit as import('ts-morph').ObjectLiteralExpression;
  if (headersObj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment)) return undefined;
  for (const prop of headersObj.getProperties()) {
    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
      const pa = prop as import('ts-morph').PropertyAssignment;
      if (/^['"]?authorization['"]?$/i.test(pa.getName())) return true;
    }
  }
  return false;
}

export function extractAuthPropagation(
  call: import('ts-morph').CallExpression,
  funcName: string,
  objName: string,
  isWrappedClientCall: boolean,
  hasAuthHeader: boolean | undefined,
): 'present' | 'absent' | 'unknown' {
  if (hasAuthHeader === true) return 'present';
  if (hasCookieOrSessionEvidence(call, funcName)) return 'present';
  if (isWrappedClientCall) return /auth|session|private|secure/i.test(objName) ? 'present' : 'unknown';
  if (funcName === 'fetch') return hasAuthHeader === false ? 'absent' : 'unknown';
  const config = networkConfigArgument(call, funcName);
  if (!config) return 'absent';
  if (config.getKind() !== SyntaxKind.ObjectLiteralExpression) return 'unknown';
  const obj = config as import('ts-morph').ObjectLiteralExpression;
  if (obj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment)) return 'unknown';
  return configObjectHasAuthEvidence(obj) ? 'present' : 'absent';
}

function hasCookieOrSessionEvidence(call: import('ts-morph').CallExpression, funcName: string): boolean {
  const config = funcName === 'fetch' ? call.getArguments()[1] : networkConfigArgument(call, funcName);
  if (!config || config.getKind() !== SyntaxKind.ObjectLiteralExpression) return false;
  return configObjectHasAuthEvidence(config as import('ts-morph').ObjectLiteralExpression);
}

export function networkConfigArgument(
  call: import('ts-morph').CallExpression,
  funcName: string,
): import('ts-morph').Node | undefined {
  const args = call.getArguments();
  if (funcName === 'fetch') return args[1];
  if (AXIOS_STYLE_METHODS.has(funcName)) return args[2];
  return args[1];
}

function configObjectHasAuthEvidence(obj: import('ts-morph').ObjectLiteralExpression): boolean {
  const credentialsProp = obj.getProperty('credentials');
  if (credentialsProp?.getKind() === SyntaxKind.PropertyAssignment) {
    const init = (credentialsProp as import('ts-morph').PropertyAssignment).getInitializer();
    if (
      init &&
      (init.getKind() === SyntaxKind.StringLiteral || init.getKind() === SyntaxKind.NoSubstitutionTemplateLiteral)
    ) {
      const value = (init as import('ts-morph').StringLiteral).getLiteralValue();
      if (value === 'include' || value === 'same-origin') return true;
    }
  }

  const withCredentialsProp = obj.getProperty('withCredentials');
  if (withCredentialsProp?.getKind() === SyntaxKind.PropertyAssignment) {
    const init = (withCredentialsProp as import('ts-morph').PropertyAssignment).getInitializer();
    if (init?.getKind() === SyntaxKind.TrueKeyword) return true;
  }

  const headersProp = obj.getProperty('headers');
  if (headersProp?.getKind() !== SyntaxKind.PropertyAssignment) return false;
  const headersInit = (headersProp as import('ts-morph').PropertyAssignment).getInitializer();
  if (!headersInit || headersInit.getKind() !== SyntaxKind.ObjectLiteralExpression) return false;
  const headersObj = headersInit as import('ts-morph').ObjectLiteralExpression;
  if (headersObj.getProperties().some((p) => p.getKind() === SyntaxKind.SpreadAssignment)) return false;
  for (const prop of headersObj.getProperties()) {
    if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const name = (prop as import('ts-morph').PropertyAssignment).getName().replace(/['"]/g, '').toLowerCase();
    if (name === 'authorization' || name === 'cookie' || name === 'x-session' || name === 'x-csrf-token') return true;
  }
  return false;
}
