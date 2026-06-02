/**
 * Security v6 — error-disclosure & hardcoded-credential surface.
 *
 * Two AST-only rules carved out of `security.ts` to keep that file under the
 * size where its other 9 rules become hard to scan. Both rules consume the
 * shared AST primitives in `./ast-helpers.ts`.
 *
 *   S10 error-leak                 — caught exception leaked back to client
 *   S11 bearer-token-literal       — hardcoded `Authorization: Bearer …` value
 *   S12 redirect-non-3xx-status    — redirect helper called with non-redirect HTTP status
 *   S13 electron-open-external-unvalidated — shell.openExternal() with dynamic URL and no host allowlist
 *   S14 electron-localhost-wildcard-cors — localhost Electron server exposes mutating routes with wildcard CORS
 *   S15 inline-json-script-escape   — JSON.stringify injected into executable inline <script>
 *   S16 sensitive-console-log       — console logging request/auth/body data in runtime code
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import {
  isAncestorOf,
  isInNonProductionBranch,
  resolveLiteralStringValue,
  unwrapMethodChainToReceiver,
} from './ast-helpers.js';
import { finding } from './utils.js';

// ── Rule S10: error-leak ───────────────────────────────────────────────
// Caught exceptions leaked back to the client via HTTP response.
// Discloses stack traces, file paths, internal env, and DB internals.
// OWASP A04:2021 / CWE-209

const RESPONSE_SINKS = new Set(['send', 'json', 'end', 'write']);
const RESPONSE_OBJECTS = /^(res(ponse)?|reply|ctx|context|h|fastify|Response|NextResponse)$/;

/**
 * Returns true if the catch param 'name' is shadowed between 'node' and 'boundary'.
 * Checks function-like parameters and nested catch clauses.
 */
function isCatchParamShadowedAt(node: Node, name: string, boundary: Node): boolean {
  let cur: Node | undefined = node.getParent();
  while (cur && cur !== boundary) {
    if (
      Node.isArrowFunction(cur) ||
      Node.isFunctionExpression(cur) ||
      Node.isFunctionDeclaration(cur) ||
      Node.isMethodDeclaration(cur)
    ) {
      if (cur.getParameters().some((p) => p.getName() === name)) return true;
    }
    if (Node.isCatchClause(cur)) {
      const varDecl = cur.getVariableDeclaration();
      if (varDecl && varDecl.getName() === name) return true;
    }
    cur = cur.getParent();
  }
  return false;
}

function errorLeak(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const catchClause of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const varDecl = catchClause.getVariableDeclaration();
    if (!varDecl) continue;
    const catchVarName = varDecl.getName();

    for (const call of catchClause.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isPropertyAccessExpression(callee)) continue;
      const methodName = callee.getName();
      if (!RESPONSE_SINKS.has(methodName)) continue;

      const objName = unwrapMethodChainToReceiver(callee.getExpression()).getText();
      if (!RESPONSE_OBJECTS.test(objName)) continue;

      // Shadowing gate: skip if this call is inside a nested scope that re-binds the catch param.
      if (isCatchParamShadowedAt(call, catchVarName, catchClause)) continue;

      const args = call.getArguments();
      let leaked = false;
      let severity: 'error' | 'warning' = 'warning';

      for (const arg of args) {
        // Precise identifier walk to find references to the catch variable.
        // Filters out property keys and non-receiver property access names.
        // `getDescendantsOfKind` excludes the node itself, so include `arg`
        // explicitly for the bare-Identifier case (`res.json(err)`).
        const identifiers = arg.getDescendantsOfKind(SyntaxKind.Identifier);
        if (Node.isIdentifier(arg)) identifiers.push(arg);
        const refs = identifiers.filter((id) => {
          if (id.getText() !== catchVarName) return false;
          const parent = id.getParent();
          if (Node.isPropertyAssignment(parent) && parent.getNameNode() === id) return false;
          if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === id) return false;
          // Shorthand property assignment: `{ err }` IS a leak (resolves to `err: err`).
          // The Identifier's parent is ShorthandPropertyAssignment — keep it as a ref.
          return true;
        });

        if (refs.length === 0) continue;
        leaked = true;

        // err.message alone → warning. Anything else (err whole, err.stack, etc.) → error.
        const hasHighSeverityRef = refs.some((ref) => {
          const parent = ref.getParent();
          if (Node.isPropertyAccessExpression(parent) && parent.getExpression() === ref) {
            return parent.getName() !== 'message';
          }
          return true; // Bare identifier or other expression usage
        });

        if (hasHighSeverityRef) {
          severity = 'error';
        }
      }

      if (!leaked) continue;

      // Suppress if guarded by a branch that only runs in non-production.
      if (isInNonProductionBranch(call, catchClause)) continue;

      findings.push(
        finding(
          'error-leak',
          severity,
          'bug',
          severity === 'error'
            ? `Caught exception '${catchVarName}' leaked to response — discloses stack traces or internals`
            : `Exception message from '${catchVarName}' leaked to response — may disclose sensitive details`,
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          { suggestion: 'Send generic error messages to clients and log the full error server-side' },
        ),
      );
    }
  }

  return findings;
}

// ── Rule S11: bearer-token-literal ─────────────────────────────────────
// Hardcoded `Authorization: Bearer …` headers in fetch/axios/Headers calls.
// CWE-798 (use of hardcoded credentials), tightly scoped to the auth-header
// surface where the literal is unambiguously a deployment-risk token.
//
// Plan-review consensus (Codex + Gemini + OpenCode):
// - Don't require JWT shape — Stripe (`sk_live_*`), GitHub (`ghp_*`),
//   internal opaque tokens are all valid Bearer values.
// - Use known-secret-pattern match as a confidence/severity hint.
// - Walk ancestors with a predicate (find `'authorization'` / `'headers'`
//   key or HTTP-client call) — fixed hop counts miss the 4-5 levels of
//   nesting in real fetch/axios shapes.
// - Skip placeholder values (`'Bearer '`, `'Bearer <token>'`, `'Bearer TODO'`).
// - Const-literal alias tracing and `process.env` alias tracing are
//   deferred FN classes (out of scope for v1).

const BEARER_HEADER_NAME_RE = /^authorization$/i;
// Codex impl-review: HTTP auth schemes are case-insensitive — match
// `bearer`, `BEARER`, `Bearer` etc.
const BEARER_VALUE_RE = /^Bearer\s+(\S+)/i;
const BEARER_PLACEHOLDER_TOKENS = new Set([
  '',
  '<token>',
  '<your-token>',
  'YOUR_TOKEN',
  'YOUR-TOKEN',
  'TOKEN',
  'TODO',
  'CHANGE_ME',
  'CHANGEME',
  'example',
  'example-token',
  'token',
  'abc',
  'xxx',
  'xxxxx',
  '...',
]);
const HEADER_SETTER_METHODS = new Set(['set', 'append']);
// Known-secret patterns reused from S2 hardcoded-secret intent — when the
// Bearer token also matches one of these, escalate to error severity.
const KNOWN_SECRET_PATTERNS_AFTER_BEARER = [
  /^sk[-_]?(live|test|prod)?[-_]?[A-Za-z0-9]{16,}$/,
  /^sk-[A-Za-z0-9]{20,}$/,
  /^ghp_[A-Za-z0-9]{36,}$/,
  /^gho_[A-Za-z0-9]{36,}$/,
  /^github_pat_[A-Za-z0-9_]{22,}$/,
  /^xox[bpras]-[A-Za-z0-9-]{10,}$/,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // JWT three-segment shape
  /^AKIA[A-Z0-9]{16}$/,
  /^AIza[A-Za-z0-9_-]{35}$/,
];

/**
 * Walk ancestors looking for an HTTP-header context. Returns true if the
 * node sits inside one of:
 *   - PropertyAssignment whose name matches `Authorization` (any case)
 *   - PropertyAssignment whose name is `headers` (the value must be the
 *     enclosing object literal containing this node)
 *   - new Headers({...}) constructor argument
 *   - `<x>.headers.set('Authorization', <node>)` or `.append(...)`
 */
function isInBearerHeaderContext(node: Node): boolean {
  // Codex impl-review: the original gate accepted ANY ancestor
  // PropertyAssignment named `headers`, even when the literal lived under a
  // different (non-Authorization) header key — `{ headers: { 'X-Note':
  // 'Bearer foo' } }` would FP. We now require the literal's nearest
  // enclosing PropertyAssignment to have an Authorization-shaped key. A
  // generic `headers` ancestor without an Authorization key is rejected.
  let cur: Node | undefined = node.getParent();
  while (cur) {
    const k = cur.getKind();

    if (k === SyntaxKind.PropertyAssignment) {
      const pa = cur as import('ts-morph').PropertyAssignment;
      const name = pa.getNameNode().getText().replace(/['"`]/g, '');
      if (BEARER_HEADER_NAME_RE.test(name)) return true;
      // Hitting any other PropertyAssignment first means this literal
      // belongs to that (non-Authorization) key. Stop walking — a `headers`
      // ancestor higher up doesn't retroactively make this an auth header.
      return false;
    }

    // headers.set('Authorization', <node>) / .append(...)
    if (k === SyntaxKind.CallExpression) {
      const call = cur as import('ts-morph').CallExpression;
      const callee = call.getExpression();
      if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
        const pae = callee as import('ts-morph').PropertyAccessExpression;
        if (HEADER_SETTER_METHODS.has(pae.getName())) {
          const firstArg = call.getArguments()[0];
          if (firstArg) {
            const headerName = resolveLiteralStringValue(firstArg);
            if (headerName && BEARER_HEADER_NAME_RE.test(headerName)) return true;
          }
        }
      }
    }

    // `new Headers([['Authorization', 'Bearer ...']])` tuple form.
    // Walk if the literal is the second element of an array literal whose
    // first element is `Authorization` AND that array is an element of an
    // outer array passed to `new Headers(...)`.
    if (k === SyntaxKind.ArrayLiteralExpression) {
      const arr = cur as import('ts-morph').ArrayLiteralExpression;
      const elements = arr.getElements();
      // The literal must be at index 1 (the value position).
      if (elements[1] === node || isAncestorOf(elements[1], node)) {
        const keyNode = elements[0];
        const keyValue = keyNode ? resolveLiteralStringValue(keyNode) : undefined;
        if (keyValue && BEARER_HEADER_NAME_RE.test(keyValue)) {
          // Verify outer context is `new Headers(...)` — the parent of arr
          // should be an ArrayLiteralExpression whose grandparent is a
          // NewExpression with constructor `Headers`.
          const outerArr = arr.getParent();
          if (outerArr && outerArr.getKind() === SyntaxKind.ArrayLiteralExpression) {
            const ne = outerArr.getParent();
            if (ne && ne.getKind() === SyntaxKind.NewExpression) {
              const ctor = (ne as import('ts-morph').NewExpression).getExpression();
              if (ctor.getKind() === SyntaxKind.Identifier && ctor.getText() === 'Headers') {
                return true;
              }
            }
          }
        }
      }
    }

    cur = cur.getParent();
  }
  return false;
}

function isBearerPlaceholder(token: string): boolean {
  if (BEARER_PLACEHOLDER_TOKENS.has(token)) return true;
  if (BEARER_PLACEHOLDER_TOKENS.has(token.toLowerCase())) return true;
  // <UPPER_CASE> placeholders, e.g. <API_TOKEN>
  if (/^<[^>]+>$/.test(token)) return true;
  // YOUR_* / EXAMPLE_*
  if (/^(YOUR|EXAMPLE|TEST|PLACEHOLDER)[_-]/i.test(token)) return true;
  return false;
}

function isHighConfidenceBearerToken(token: string): boolean {
  return KNOWN_SECRET_PATTERNS_AFTER_BEARER.some((p) => p.test(token));
}

function bearerTokenLiteral(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const reportedSpans = new Set<string>(); // dedupe by file:line:col

  // Walk all literal-shaped nodes in one pass.
  const candidates: Node[] = [];
  for (const k of [
    SyntaxKind.StringLiteral,
    SyntaxKind.NoSubstitutionTemplateLiteral,
    SyntaxKind.TemplateExpression,
    SyntaxKind.BinaryExpression,
  ] as const) {
    candidates.push(...ctx.sourceFile.getDescendantsOfKind(k));
  }

  for (const node of candidates) {
    const value = resolveLiteralStringValue(node);
    if (!value) continue;
    const match = BEARER_VALUE_RE.exec(value);
    if (!match) continue;
    const token = match[1];
    if (isBearerPlaceholder(token)) continue;
    if (!isInBearerHeaderContext(node)) continue;

    // Skip if a parent CallExpression node has already been reported (binary
    // and template often nest — emit on the outermost matched form).
    const line = node.getStartLineNumber();
    const col =
      node.getStart() -
      node
        .getSourceFile()
        .getFullText()
        .lastIndexOf('\n', node.getStart() - 1);
    const key = `${ctx.filePath}:${line}:${col}`;
    if (reportedSpans.has(key)) continue;
    reportedSpans.add(key);

    const highConfidence = isHighConfidenceBearerToken(token);
    findings.push(
      finding(
        'bearer-token-literal',
        highConfidence ? 'error' : 'warning',
        'bug',
        highConfidence
          ? 'Hardcoded Bearer token in HTTP header — matches a known secret pattern (Stripe / GitHub / JWT / AWS)'
          : 'Hardcoded Bearer token in HTTP header — move the credential to an environment variable',
        ctx.filePath,
        line,
        col,
        {
          suggestion:
            'Replace the literal with `Bearer ${process.env.TOKEN_NAME}` (read at request time) and load the token from a secret manager in production',
        },
      ),
    );
  }

  return findings;
}

// ── Rule S12: redirect-non-3xx-status ─────────────────────────────────
// Redirect helpers must use 3xx statuses. Passing 401/403/404/500 to
// res.redirect(), NextResponse.redirect(), or generic redirect() helpers often
// means browsers/clients will not follow the Location value.

function readNumericLiteral(node: Node | undefined): number | undefined {
  if (!node || !Node.isNumericLiteral(node)) return undefined;
  const raw = node.getText().replace(/_/g, '');
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readStatusFromObjectLiteral(node: Node | undefined): number | undefined {
  if (!node || !Node.isObjectLiteralExpression(node)) return undefined;

  for (const prop of node.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;
    const name = prop.getNameNode().getText().replace(/['"`]/g, '');
    if (name !== 'status') continue;
    return readNumericLiteral(prop.getInitializer());
  }

  return undefined;
}

function getRootIdentifierName(node: Node): string | undefined {
  if (Node.isIdentifier(node)) return node.getText();
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression();
    if (Node.isPropertyAccessExpression(callee)) return getRootIdentifierName(callee.getExpression());
  }
  if (Node.isPropertyAccessExpression(node)) return getRootIdentifierName(node.getExpression());
  return undefined;
}

function isHttpRedirectReceiver(node: Node): boolean {
  const root = getRootIdentifierName(node);
  return root !== undefined && /^(res|response|reply|ctx|context|Response|NextResponse)$/i.test(root);
}

function importedHttpRedirectNames(ctx: RuleContext): Set<string> {
  const names = new Set<string>();
  const redirectModules = /^(?:next\/navigation|next\/server|@remix-run\/.+|react-router|react-router-dom)$/;

  for (const decl of ctx.sourceFile.getImportDeclarations()) {
    if (!redirectModules.test(decl.getModuleSpecifierValue())) continue;
    for (const named of decl.getNamedImports()) {
      if (named.getName() !== 'redirect') continue;
      names.add(named.getAliasNode()?.getText() ?? named.getName());
    }
  }

  return names;
}

function redirectNon3xxStatus(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const redirectImports = importedHttpRedirectNames(ctx);

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    let isRedirectCall = false;

    if (Node.isPropertyAccessExpression(callee)) {
      isRedirectCall = callee.getName() === 'redirect' && isHttpRedirectReceiver(callee.getExpression());
    } else if (Node.isIdentifier(callee)) {
      isRedirectCall = redirectImports.has(callee.getText());
    }

    if (!isRedirectCall) continue;

    const args = call.getArguments();
    // args[0] covers Express/Next pages API `res.redirect(status, url)`;
    // args[1] covers Web/Next/Remix `redirect(url, status | { status })`.
    const status = readNumericLiteral(args[0]) ?? readNumericLiteral(args[1]) ?? readStatusFromObjectLiteral(args[1]);
    if (status === undefined || (status >= 300 && status <= 399)) continue;

    findings.push(
      finding(
        'redirect-non-3xx-status',
        'warning',
        'bug',
        `redirect() called with HTTP ${status} — only 3xx statuses trigger redirects reliably`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        { suggestion: 'Use a 3xx redirect status, or send the non-redirect error response without redirect().' },
      ),
    );
  }

  return findings;
}

// ── Rule S13: electron-open-external-unvalidated ───────────────────────

function enclosingFunctionLike(node: Node): Node | undefined {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (
      Node.isFunctionDeclaration(cur) ||
      Node.isFunctionExpression(cur) ||
      Node.isArrowFunction(cur) ||
      Node.isMethodDeclaration(cur)
    ) {
      return cur;
    }
    cur = cur.getParent();
  }
  return undefined;
}

function maskTsStringsAndComments(text: string): string {
  let out = '';
  let quote: string | undefined;
  let templateDepth = 0;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (ch === '\n') {
        out += '\n';
        lineComment = false;
      } else {
        out += ' ';
      }
      continue;
    }

    if (blockComment) {
      if (ch === '*' && next === '/') {
        out += '  ';
        i++;
        blockComment = false;
      } else {
        out += ch === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (quote) {
      if (quote === '`' && ch === '$' && next === '{') {
        out += '${';
        i++;
        templateDepth++;
        quote = undefined;
        continue;
      }
      out += ch === '\n' ? '\n' : ' ';
      if (ch === quote && text[i - 1] !== '\\') quote = undefined;
      continue;
    }

    if (templateDepth > 0 && ch === '}') {
      out += ch;
      templateDepth--;
      quote = '`';
      continue;
    }

    if (ch === '/' && next === '/') {
      out += '  ';
      i++;
      lineComment = true;
      continue;
    }
    if (ch === '/' && next === '*') {
      out += '  ';
      i++;
      blockComment = true;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ' ';
      continue;
    }

    out += ch;
  }

  return out;
}

function electronShellBindings(ctx: RuleContext): Set<string> {
  const names = new Set<string>();

  for (const imp of ctx.sourceFile.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== 'electron') continue;
    for (const named of imp.getNamedImports()) {
      if (named.getName() === 'shell') {
        names.add(named.getAliasNode()?.getText() ?? named.getNameNode().getText());
      }
    }
    const namespace = imp.getNamespaceImport()?.getText();
    if (namespace) names.add(`${namespace}.shell`);
  }

  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = decl.getInitializer();
    if (!initializer || !/\brequire\s*\(\s*['"]electron['"]\s*\)/.test(initializer.getText())) continue;
    const nameNode = decl.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const el of nameNode.getElements()) {
        const property = el.getPropertyNameNode()?.getText() ?? el.getNameNode().getText();
        if (property === 'shell') names.add(el.getNameNode().getText());
      }
    } else {
      names.add(`${nameNode.getText()}.shell`);
    }
  }

  return names;
}

function hasHostAllowlistNear(node: Node): boolean {
  const fn = enclosingFunctionLike(node);
  const container = fn ?? node.getSourceFile();
  const text = maskTsStringsAndComments(container.getText());
  const beforeCall = text.slice(0, Math.max(0, node.getStart() - container.getStart()));
  const allowlistName = '(?:allowed|trusted|safe|approved|white|allow)[A-Za-z0-9_]*(?:Hosts|Origins|Urls|Domains|List)';
  const hostExpr = String.raw`(?:[A-Za-z_$][\w$]*|new\s+URL\s*\([^)]*\))\.(?:hostname|host)`;
  const allowlistCheck = String.raw`\b${allowlistName}\s*\.\s*(?:has|includes)\s*\(\s*${hostExpr}\s*\)`;
  return (
    new RegExp(String.raw`\bif\s*\(\s*!\s*${allowlistCheck}\s*\)\s*(?:\{[\s\S]{0,160})?\b(?:throw|return)\b`, 'i').test(
      beforeCall,
    ) || /\bswitch\s*\([^)]*\b(?:hostname|host)\b[^)]*\)/.test(beforeCall)
  );
}

function isStaticHttpUrl(node: Node | undefined): boolean {
  if (!node) return false;
  if (!Node.isStringLiteral(node) && !Node.isNoSubstitutionTemplateLiteral(node)) return false;
  return /^https?:\/\/[A-Za-z0-9.-]+(?:\/|$)/.test(node.getLiteralText());
}

function electronOpenExternalUnvalidated(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  const text = ctx.sourceFile.getFullText();
  if (!/\bfrom\s+['"]electron['"]|\brequire\s*\(\s*['"]electron['"]\s*\)/.test(text)) return [];
  const shellBindings = electronShellBindings(ctx);

  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getName() !== 'openExternal') continue;
    if (!shellBindings.has(callee.getExpression().getText())) continue;
    const target = call.getArguments()[0];
    if (isStaticHttpUrl(target)) continue;
    if (hasHostAllowlistNear(call)) continue;

    findings.push(
      finding(
        'electron-open-external-unvalidated',
        'warning',
        'bug',
        'Electron shell.openExternal() receives a dynamic URL without an obvious host allowlist — renderer or backend data can open arbitrary sites',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Parse the URL and allow only trusted hosts before calling shell.openExternal(); protocol-only checks are not enough.',
        },
      ),
    );
  }
  return findings;
}

// ── Rule S14: electron-localhost-wildcard-cors ─────────────────────────

function electronLocalhostWildcardCors(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  const text = ctx.sourceFile.getFullText();
  if (!/\b(?:127\.0\.0\.1|localhost)\b/.test(text)) return [];
  if (
    !/Access-Control-Allow-Origin['"`]?\s*,\s*['"`]\*['"`]|origin\s*:\s*['"`]\*['"`]|cors\s*\(\s*\{[^}]*origin\s*:\s*['"`]\*['"`]/s.test(
      text,
    )
  ) {
    return [];
  }
  if (
    !/\.(?:post|put|patch|delete)\s*\(/.test(text) &&
    !/\breq\.method\b[\s\S]{0,120}\b(?:POST|PUT|PATCH|DELETE)\b/.test(text)
  ) {
    return [];
  }
  if (hasLocalhostMutationGuard(text)) return [];

  const line = text.split('\n').findIndex((l) => /Access-Control-Allow-Origin|cors\s*\(/.test(l)) + 1 || 1;
  return [
    finding(
      'electron-localhost-wildcard-cors',
      'warning',
      'bug',
      'Electron localhost server combines wildcard CORS with mutating endpoints — browser pages can drive local state-changing actions',
      ctx.filePath,
      line,
      1,
      {
        suggestion:
          'Require a per-session token/nonce or strict origin allowlist for mutating localhost endpoints, even when bound to 127.0.0.1.',
      },
    ),
  ];
}

function hasLocalhostMutationGuard(text: string): boolean {
  const searchable = maskTsStringsAndComments(text);
  const guardName =
    /\b(?:requireNonce|verifyNonce|nonceGuard|requireCsrf|verifyCsrf|csrfGuard|requireAuth|authToken|verifyOrigin|validateOrigin|originAllowlist|allowedOrigins|trustedOrigins)\b/i;
  if (
    /\.(?:use|all)\s*\([^)]*(?:requireNonce|verifyNonce|nonceGuard|requireCsrf|verifyCsrf|csrfGuard|requireAuth|authToken|verifyOrigin|validateOrigin|originAllowlist|allowedOrigins|trustedOrigins)[^)]*\)/i.test(
      searchable,
    )
  ) {
    return true;
  }

  const routeRe = /\.(?:post|put|patch|delete)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = routeRe.exec(searchable)) !== null) {
    const routeWindow = searchable.slice(match.index, match.index + 360);
    if (guardName.test(routeWindow)) return true;
  }

  return false;
}

// ── Rule S15: inline-json-script-escape ────────────────────────────────

function hasHtmlEscapingChain(node: Node): boolean {
  let cur: Node | undefined = node;
  while (cur) {
    if (Node.isCallExpression(cur)) {
      const callee = cur.getExpression();
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'replace') {
        const receiver = callee.getExpression();
        if (receiver.getStart() > node.getStart() || receiver.getEnd() < node.getEnd()) {
          cur = cur.getParent();
          continue;
        }
        const firstArg = cur.getArguments()[0]?.getText() ?? '';
        if (/[<]|u003c/i.test(firstArg)) return true;
      }
    }
    cur = cur.getParent();
  }
  return false;
}

function inlineJsonScriptEscape(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== 'JSON.stringify') continue;
    const template = call.getFirstAncestorByKind(SyntaxKind.TemplateExpression);
    const binary = call.getFirstAncestorByKind(SyntaxKind.BinaryExpression);
    const templateText = template?.getText() ?? '';
    const binaryText = binary?.getText() ?? '';
    const containerText = templateText || binaryText;
    if (!/<script[\s>]/i.test(containerText)) continue;
    if (/type\s*=\s*(?:"application\/json"|'application\/json'|application\/json)/i.test(containerText)) continue;
    if (hasHtmlEscapingChain(call)) continue;

    findings.push(
      finding(
        'inline-json-script-escape',
        'warning',
        'bug',
        'JSON.stringify() is injected into an executable inline <script> without escaping "<" — data containing </script> can break out',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion:
            'Escape at least "<" as "\\u003c" before injecting JSON into executable scripts, or put JSON in <script type="application/json">.',
        },
      ),
    );
  }

  return findings;
}

// ── Rule S16: sensitive-console-log ────────────────────────────────────

const SENSITIVE_LOG_RE =
  /\b(?:authorization|bearer|access[_-]?token|refresh[_-]?token|id[_-]?token|password|secret|headers?|requestHeaders?|body|email|patient(?:Id|Name|Email|Data|Record|Info)|health(?:Data|Record|Info|Profile))\b/i;
const SENSITIVE_LITERAL_LABEL_RE =
  /\b(?:authorization|bearer|access[_-]?token|refresh[_-]?token|id[_-]?token|password|secret|email|patient(?:Id|Name|Email|Data|Record|Info)|health(?:Data|Record|Info|Profile))\b/i;
const REDACTION_RE = /\b(?:redact|sanitize|mask|safeLog|debugOnly|cleanHeaders|redacted)\b/i;

function isStringLikeLiteral(node: Node): boolean {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node);
}

function sensitiveConsoleLog(ctx: RuleContext): ReviewFinding[] {
  if (ctx.fileRole !== 'runtime') return [];
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getExpression().getText() !== 'console') continue;
    if (!['log', 'debug', 'info', 'warn', 'error'].includes(callee.getName())) continue;
    const args = call.getArguments();
    const valueArgs = args.filter((arg) => !isStringLikeLiteral(arg));
    const valueArgsText = valueArgs.map((arg) => arg.getText()).join(' ');
    const literalLabelText = args
      .filter(isStringLikeLiteral)
      .map((arg) =>
        Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg) ? arg.getLiteralText() : '',
      )
      .join(' ');
    const argsText = `${valueArgsText} ${literalLabelText}`;
    if (!SENSITIVE_LOG_RE.test(argsText)) continue;
    const hasUnredactedSensitiveValue = valueArgs.some((arg) => {
      const text = arg.getText();
      return SENSITIVE_LOG_RE.test(text) && !REDACTION_RE.test(text);
    });
    const hasSensitiveLabelWithUnredactedValue =
      SENSITIVE_LITERAL_LABEL_RE.test(literalLabelText) && valueArgs.some((arg) => !REDACTION_RE.test(arg.getText()));
    if (!hasUnredactedSensitiveValue && !hasSensitiveLabelWithUnredactedValue) continue;

    findings.push(
      finding(
        'sensitive-console-log',
        'warning',
        'bug',
        'Runtime console log includes request/auth/body/PII-looking data — logs can leak credentials or personal data',
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        {
          suggestion: 'Log only non-sensitive metadata, or pass values through a redaction helper before logging.',
        },
      ),
    );
  }

  return findings;
}

// ── Exported Security v6 Rules ───────────────────────────────────────────

export const securityV6Rules = [
  errorLeak,
  bearerTokenLiteral,
  redirectNon3xxStatus,
  electronOpenExternalUnvalidated,
  electronLocalhostWildcardCors,
  inlineJsonScriptEscape,
  sensitiveConsoleLog,
];
