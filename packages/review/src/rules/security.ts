/**
 * Security review rules — OWASP top 10 for TypeScript.
 *
 * All rules are AST-based — no taint analysis, no dataflow.
 * High precision, low false positive rate.
 *
 * Always active, regardless of target.
 */

import { SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';

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

function insecureRandom(ctx: RuleContext): ReviewFinding[] {
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

    const securityNames = /token|secret|key|password|hash|salt|nonce|csrf|session|auth|id/i;
    if (securityNames.test(contextName)) {
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
// res.redirect() with req.query/req.params/req.body (unvalidated user input)

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

// ── Exported Security Rules ──────────────────────────────────────────────

export const securityRules = [
  xssUnsafeHtml,
  hardcodedSecret,
  commandInjection,
  noEval,
  insecureRandom,
  corsWildcard,
  helmetMissing,
  openRedirect,
];
