/**
 * Security review rules — OWASP top 10 for TypeScript.
 *
 * All rules are AST-based — no taint analysis, no dataflow.
 * High precision, low false positive rate.
 *
 * Always active, regardless of target.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';
import {
  isAncestorOf,
  isInNonProductionBranch,
  resolveLiteralStringValue,
  unwrapMethodChainToReceiver,
} from './ast-helpers.js';

function span(file: string, line: number, col = 1): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  category: ReviewFinding['category'],
  message: string,
  file: string,
  line: number,
  extra?: Partial<ReviewFinding>,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category,
    message,
    primarySpan: span(file, line),
    fingerprint: createFingerprint(ruleId, line, 1),
    ...extra,
  };
}

// ── Rule S1: xss-unsafe-html ─────────────────────────────────────────────
// dangerouslySetInnerHTML (React), v-html (Vue), innerHTML assignment

function xssUnsafeHtml(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // React: dangerouslySetInnerHTML in JSX
  for (const attr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    if (attr.getNameNode().getText() === 'dangerouslySetInnerHTML') {
      findings.push(
        finding(
          'xss-unsafe-html',
          'error',
          'bug',
          'dangerouslySetInnerHTML creates XSS risk — sanitize with DOMPurify or use safe rendering',
          ctx.filePath,
          attr.getStartLineNumber(),
          { suggestion: 'Use DOMPurify.sanitize() or a safe markdown renderer instead' },
        ),
      );
    }
  }

  // Direct .innerHTML assignment
  for (const bin of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    const left = bin.getLeft();
    if (left.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = left as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() === 'innerHTML' || pa.getName() === 'outerHTML') {
      findings.push(
        finding(
          'xss-unsafe-html',
          'error',
          'bug',
          `Direct .${pa.getName()} assignment creates XSS risk — use textContent or sanitize`,
          ctx.filePath,
          bin.getStartLineNumber(),
          { suggestion: 'Use element.textContent for plain text, or DOMPurify.sanitize() for HTML' },
        ),
      );
    }
  }

  return findings;
}

// ── Rule S2: hardcoded-secret ────────────────────────────────────────────
// String literals that look like API keys, tokens, passwords

const SECRET_PATTERNS = [
  { pattern: /^(sk|pk)[-_](live|test|prod)[-_][a-zA-Z0-9]{16,}$/, label: 'API key' },
  { pattern: /^sk-[a-zA-Z0-9]{20,}$/, label: 'OpenAI/Stripe secret key' },
  { pattern: /^ghp_[a-zA-Z0-9]{36,}$/, label: 'GitHub token' },
  { pattern: /^gho_[a-zA-Z0-9]{36,}$/, label: 'GitHub OAuth token' },
  { pattern: /^github_pat_[a-zA-Z0-9_]{22,}$/, label: 'GitHub fine-grained PAT' },
  { pattern: /^xox[bpras]-[a-zA-Z0-9-]{10,}$/, label: 'Slack token' },
  { pattern: /^eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/, label: 'JWT token' },
  { pattern: /^AKIA[A-Z0-9]{16}$/, label: 'AWS access key' },
  { pattern: /^AIza[a-zA-Z0-9_-]{35}$/, label: 'Google API key' },
  { pattern: /^SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}$/, label: 'SendGrid key' },
  { pattern: /^-----BEGIN (RSA |EC |ED25519 )?PRIVATE KEY-----/, label: 'Private key' },
  { pattern: /^npm_[a-zA-Z0-9]{36,}$/, label: 'npm token' },
  { pattern: /^pypi-[a-zA-Z0-9_-]{50,}$/, label: 'PyPI token' },
  { pattern: /^(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]{10,}$/, label: 'Connection string' },
];

const SECRET_VAR_NAMES =
  /^(api[_-]?key|secret[_-]?key|auth[_-]?token|password|passwd|private[_-]?key|access[_-]?token|client[_-]?secret)$/i;

function hardcodedSecret(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;

      // Only check string literals
      if (init.getKind() !== SyntaxKind.StringLiteral) continue;
      const value = (init as import('ts-morph').StringLiteral).getLiteralValue();
      const varName = decl.getName();

      // Check if variable name suggests a secret
      if (SECRET_VAR_NAMES.test(varName) && value.length > 3) {
        // Skip if it's clearly an env reference placeholder
        if (value.startsWith('process.env') || value === '' || value === 'TODO' || value === 'CHANGE_ME') continue;

        const envVar = varName.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        findings.push(
          finding(
            'hardcoded-secret',
            'error',
            'bug',
            `Hardcoded secret in '${varName}' — use environment variables`,
            ctx.filePath,
            stmt.getStartLineNumber(),
            {
              suggestion: `Replace with process.env.${envVar} or a secret manager`,
              autofix: {
                type: 'replace',
                span: {
                  file: ctx.filePath,
                  startLine: init.getStartLineNumber(),
                  startCol: init.getStart() - ctx.sourceFile.getFullText().lastIndexOf('\n', init.getStart()),
                  endLine: init.getEndLineNumber(),
                  endCol: init.getEnd() - ctx.sourceFile.getFullText().lastIndexOf('\n', init.getEnd() - 1),
                },
                replacement: `process.env.${envVar}`,
                description: `Replace hardcoded secret with process.env.${envVar}`,
              },
            },
          ),
        );
        continue;
      }

      // Check if value matches known secret patterns
      for (const { pattern, label } of SECRET_PATTERNS) {
        if (pattern.test(value)) {
          const envKey = varName.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
          findings.push(
            finding(
              'hardcoded-secret',
              'error',
              'bug',
              `Hardcoded ${label} detected in '${varName}' — use environment variables`,
              ctx.filePath,
              stmt.getStartLineNumber(),
              {
                suggestion: `Move to .env file and use process.env.${envKey}`,
                autofix: {
                  type: 'replace',
                  span: {
                    file: ctx.filePath,
                    startLine: init.getStartLineNumber(),
                    startCol: init.getStart() - ctx.sourceFile.getFullText().lastIndexOf('\n', init.getStart()),
                    endLine: init.getEndLineNumber(),
                    endCol: init.getEnd() - ctx.sourceFile.getFullText().lastIndexOf('\n', init.getEnd() - 1),
                  },
                  replacement: `process.env.${envKey}`,
                  description: `Replace hardcoded ${label} with process.env.${envKey}`,
                },
              },
            ),
          );
          break;
        }
      }
    }
  }

  return findings;
}

// ── Rule S3: command-injection ───────────────────────────────────────────
// exec()/spawn()/execSync() with template literals or string concatenation

const EXEC_FUNCTIONS = new Set(['exec', 'execSync', 'spawn', 'spawnSync', 'execFile', 'execFileSync']);

function commandInjection(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    let funcName = '';

    if (callee.getKind() === SyntaxKind.Identifier) {
      funcName = callee.getText();
    } else if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      funcName = (callee as import('ts-morph').PropertyAccessExpression).getName();
    }

    if (!EXEC_FUNCTIONS.has(funcName)) continue;

    // Check first argument — if it's a template literal or concatenation, it's risky
    const args = call.getArguments();
    if (args.length === 0) continue;
    const firstArg = args[0];

    if (firstArg.getKind() === SyntaxKind.TemplateExpression) {
      findings.push(
        finding(
          'command-injection',
          'error',
          'bug',
          `${funcName}() with template literal — potential command injection`,
          ctx.filePath,
          call.getStartLineNumber(),
          { suggestion: 'Use spawn() with array arguments instead of string interpolation' },
        ),
      );
    } else if (firstArg.getKind() === SyntaxKind.BinaryExpression) {
      const binExpr = firstArg as import('ts-morph').BinaryExpression;
      if (binExpr.getOperatorToken().getKind() === SyntaxKind.PlusToken) {
        findings.push(
          finding(
            'command-injection',
            'error',
            'bug',
            `${funcName}() with string concatenation — potential command injection`,
            ctx.filePath,
            call.getStartLineNumber(),
            { suggestion: 'Use spawn() with array arguments instead of concatenation' },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule S4: no-eval ─────────────────────────────────────────────────────
// eval() and Function() constructor

function noEval(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() === SyntaxKind.Identifier && callee.getText() === 'eval') {
      findings.push(
        finding(
          'no-eval',
          'error',
          'bug',
          'eval() is a code injection risk — use safe alternatives',
          ctx.filePath,
          call.getStartLineNumber(),
          { suggestion: 'Use JSON.parse() for data, or a sandboxed VM for code execution' },
        ),
      );
    }
  }

  // new Function('...') constructor
  for (const newExpr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (newExpr.getExpression().getText() === 'Function') {
      findings.push(
        finding(
          'no-eval',
          'error',
          'bug',
          'new Function() is equivalent to eval() — code injection risk',
          ctx.filePath,
          newExpr.getStartLineNumber(),
          { suggestion: 'Avoid dynamic code construction' },
        ),
      );
    }
  }

  return findings;
}

// ── Rule S5: insecure-random ─────────────────────────────────────────────
// Math.random() used in security contexts (token/secret/password/key/id generation)

const SENSITIVE_NAME_TOKENS = new Set([
  'token',
  'secret',
  'key',
  'password',
  'hash',
  'salt',
  'nonce',
  'csrf',
  'session',
  'auth',
  'id',
]);

// Substring matching against `/token|secret|key|password|hash|salt|nonce|csrf|session|auth|id/i`
// fired on innocuous identifiers like `valid`, `paid`, `inside`, `monkey`. Decompose
// the name into camelCase / snake_case / acronym tokens and check exact tokens
// against the sensitive set instead.
//
//   apiKey      → ['api', 'key']     → match
//   APIKey      → ['api', 'key']     → match     (acronym + word)
//   SecretToken → ['secret', 'token']→ match     (PascalCase)
//   valid       → ['valid']           → skip
//   tokenless   → ['tokenless']       → skip      (concatenated word, not a real token)
function isSecuritySensitiveName(name: string): boolean {
  if (!name) return false;
  const tokens = name
    // ACRONYMWord — split runs of caps before a Cap+lower (`APIKey` → `API_Key`)
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    // camelCase — split lower→Upper boundary (`apiKey` → `api_Key`)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\-\s]+/)
    .filter(Boolean);
  return tokens.some((t) => SENSITIVE_NAME_TOKENS.has(t));
}

function insecureRandom(ctx: RuleContext): ReviewFinding[] {
  // Math.random in test fixtures and example files is rarely a real
  // security bug — most often it's seeded mock data. Suppress here to keep
  // the rule's signal-to-noise high. Production code paths still fire.
  if (ctx.fileRole === 'test' || ctx.fileRole === 'example') return [];

  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getExpression().getText() !== 'Math' || pa.getName() !== 'random') continue;

    // Check if used in a security-sensitive context (function name or variable name)
    let parent = call.getParent();
    let contextName = '';
    while (parent) {
      if (parent.getKind() === SyntaxKind.VariableDeclaration) {
        contextName = (parent as import('ts-morph').VariableDeclaration).getName();
        break;
      }
      if (parent.getKind() === SyntaxKind.FunctionDeclaration) {
        contextName = (parent as import('ts-morph').FunctionDeclaration).getName() || '';
        break;
      }
      parent = parent.getParent();
    }

    if (isSecuritySensitiveName(contextName)) {
      findings.push(
        finding(
          'insecure-random',
          'warning',
          'bug',
          `Math.random() in '${contextName}' is not cryptographically secure`,
          ctx.filePath,
          call.getStartLineNumber(),
          { suggestion: 'Use crypto.randomUUID() or crypto.getRandomValues() for security-sensitive values' },
        ),
      );
    }
  }

  return findings;
}

// ── Rule S6: cors-wildcard ───────────────────────────────────────────────
// cors({ origin: '*' }) in Express apps

function corsWildcard(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.Identifier || callee.getText() !== 'cors') continue;

    const args = call.getArguments();
    if (args.length === 0) {
      // cors() with no args = origin: '*' by default
      findings.push(
        finding(
          'cors-wildcard',
          'warning',
          'bug',
          'cors() without options defaults to origin: * — restrict to specific origins',
          ctx.filePath,
          call.getStartLineNumber(),
          { suggestion: "cors({ origin: ['https://yourdomain.com'] })" },
        ),
      );
      continue;
    }

    // Check for explicit origin: '*'
    const firstArg = args[0];
    if (firstArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
      const obj = firstArg as import('ts-morph').ObjectLiteralExpression;
      for (const prop of obj.getProperties()) {
        if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
        const pa = prop as import('ts-morph').PropertyAssignment;
        if (pa.getName() !== 'origin') continue;
        const init = pa.getInitializer();
        if (init && init.getKind() === SyntaxKind.StringLiteral) {
          if ((init as import('ts-morph').StringLiteral).getLiteralValue() === '*') {
            findings.push(
              finding(
                'cors-wildcard',
                'warning',
                'bug',
                "cors origin: '*' allows any domain — restrict in production",
                ctx.filePath,
                call.getStartLineNumber(),
                { suggestion: 'Set origin to specific domains or a validation function' },
              ),
            );
          }
        }
        if (init && init.getKind() === SyntaxKind.TrueKeyword) {
          findings.push(
            finding(
              'cors-wildcard',
              'warning',
              'bug',
              'cors origin: true reflects any origin — restrict in production',
              ctx.filePath,
              call.getStartLineNumber(),
              { suggestion: 'Set origin to specific domains or a validation function' },
            ),
          );
        }
      }
    }
  }

  return findings;
}

// ── Rule S6b: cors-wildcard-credentials ─────────────────────────────────
// `cors({ origin: '*', credentials: true })` (or `origin: true`) is far more
// dangerous than wildcard alone — most browsers refuse the literal `*` with
// credentials, which historically pushes apps to reflect `req.headers.origin`
// back, making CSRF trivial across any attacker-controlled origin. This rule
// flags the configuration AS WRITTEN; the reflective-origin variant is a
// separate concern best caught by taint-tracking.

function corsWildcardCredentials(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.Identifier || callee.getText() !== 'cors') continue;

    const args = call.getArguments();
    if (args.length === 0) continue; // bare cors() handled by cors-wildcard
    const firstArg = args[0];
    if (firstArg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

    const obj = firstArg as import('ts-morph').ObjectLiteralExpression;
    let originIsWildcard = false;
    let credentialsTrue = false;

    for (const prop of obj.getProperties()) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const pa = prop as import('ts-morph').PropertyAssignment;
      const name = pa.getName();
      const init = pa.getInitializer();
      if (!init) continue;

      if (name === 'origin') {
        const k = init.getKind();
        if (k === SyntaxKind.StringLiteral) {
          if ((init as import('ts-morph').StringLiteral).getLiteralValue() === '*') originIsWildcard = true;
        } else if (k === SyntaxKind.TrueKeyword) {
          // `origin: true` instructs the cors middleware to reflect the
          // request origin — equivalent to wildcard from a CSRF perspective.
          originIsWildcard = true;
        }
      } else if (name === 'credentials') {
        if (init.getKind() === SyntaxKind.TrueKeyword) credentialsTrue = true;
      }
    }

    if (originIsWildcard && credentialsTrue) {
      findings.push(
        finding(
          'cors-wildcard-credentials',
          'error',
          'bug',
          'CORS allows any origin with credentials — bypasses Same-Origin Policy and enables CSRF',
          ctx.filePath,
          call.getStartLineNumber(),
          {
            suggestion:
              "Restrict origin to a known allowlist (e.g. ['https://app.example.com']) or set credentials: false",
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule S7: helmet-missing ──────────────────────────────────────────────
// Express app without helmet middleware

function helmetMissing(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Check if this file creates an Express app
  let hasExpressApp = false;
  let appLine = 0;
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() === SyntaxKind.Identifier && callee.getText() === 'express') {
      hasExpressApp = true;
      appLine = call.getStartLineNumber();
      break;
    }
  }

  if (!hasExpressApp) return findings;

  // Check if helmet is used anywhere
  let hasHelmet = false;
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() === SyntaxKind.Identifier && callee.getText() === 'helmet') {
      hasHelmet = true;
      break;
    }
  }

  if (!hasHelmet) {
    findings.push(
      finding(
        'helmet-missing',
        'warning',
        'bug',
        'Express app without helmet — missing security headers (CSP, HSTS, X-Frame-Options)',
        ctx.filePath,
        appLine,
        { suggestion: 'npm install helmet && app.use(helmet())' },
      ),
    );
  }

  return findings;
}

// ── Rule S8: open-redirect ───────────────────────────────────────────────
// res.redirect() with req.query/req.params/req.body (unvalidated user input).
//
// Coexists with the taint engine's `taint-redirect` rule. The taint engine
// produces strictly higher-signal findings (it traces flows through bindings
// and applies sanitizer detection) BUT only walks top-level functions, named
// function declarations, methods, and arrow-functions assigned to variables.
// Express-style `app.get('/x', (req, res) => …)` callback arrows are not on
// that list, so taint silently misses the most common Node web pattern. The
// substring heuristic below covers the gap. When both fire on the same span
// the registry's `supersedes: ['open-redirect']` on `taint-redirect` keeps
// the higher-precision finding.

function openRedirect(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() !== 'redirect') continue;

    // Check arguments for req.query, req.params, req.body references
    const args = call.getArguments();
    for (const arg of args) {
      const text = arg.getText();
      if (text.includes('req.query') || text.includes('req.params') || text.includes('req.body')) {
        findings.push(
          finding(
            'open-redirect',
            'error',
            'bug',
            'res.redirect() with user input — open redirect vulnerability',
            ctx.filePath,
            call.getStartLineNumber(),
            { suggestion: 'Validate redirect URL against an allowlist of safe destinations' },
          ),
        );
        break;
      }
    }
  }

  return findings;
}

// ── Rule S10: error-leak ───────────────────────────────────────────────
// Caught exceptions leaked back to the client via HTTP response.
// Discloses stack traces, file paths, internal env, and DB internals.
// OWASP A04:2021 / CWE-209

const RESPONSE_SINKS = new Set(['send', 'json', 'end', 'write']);
const RESPONSE_OBJECTS = /^(res(ponse)?|reply|ctx|context|h|fastify)$/;

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
function isInBearerHeaderContext(node: import('ts-morph').Node): boolean {
  // Codex impl-review: the original gate accepted ANY ancestor
  // PropertyAssignment named `headers`, even when the literal lived under a
  // different (non-Authorization) header key — `{ headers: { 'X-Note':
  // 'Bearer foo' } }` would FP. We now require the literal's nearest
  // enclosing PropertyAssignment to have an Authorization-shaped key. A
  // generic `headers` ancestor without an Authorization key is rejected.
  let cur: import('ts-morph').Node | undefined = node.getParent();
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
  const candidates: import('ts-morph').Node[] = [];
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
        {
          suggestion:
            'Replace the literal with `Bearer ${process.env.TOKEN_NAME}` (read at request time) and load the token from a secret manager in production',
        },
      ),
    );
  }

  return findings;
}

// ── Exported Security Rules ──────────────────────────────────────────────

export const securityRules = [
  xssUnsafeHtml,
  hardcodedSecret,
  commandInjection,
  noEval,
  insecureRandom,
  corsWildcard,
  corsWildcardCredentials,
  helmetMissing,
  openRedirect,
  errorLeak,
  bearerTokenLiteral,
];
