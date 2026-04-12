/**
 * Security v5 — XSS attribute surface, javascript: URLs, crypto misuse.
 *
 * Note: ssrf-fetch and sql-string-concat are handled automatically by the
 * shared taint engine via new sinks registered in taint-types.ts (Wave 0).
 * This file holds only the rules that can't be expressed as a sink category.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

// ── Rule: xss-href-javascript ────────────────────────────────────────────
// JSX href / src attribute set to a string starting with `javascript:`,
// or to an expression whose value can be traced to a literal javascript: URL.

function xssHrefJavascript(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const attr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attr.getNameNode().getText();
    if (name !== 'href' && name !== 'src' && name !== 'action' && name !== 'formAction') continue;

    const init = attr.getInitializer();
    if (!init) continue;

    // Literal string attribute: href="javascript:alert(1)"
    if (Node.isStringLiteral(init)) {
      const value = init.getLiteralValue();
      if (/^\s*javascript:/i.test(value)) {
        findings.push(
          finding(
            'xss-href-javascript',
            'error',
            'bug',
            `${name} uses a javascript: URL — executes arbitrary script on click`,
            ctx.filePath,
            attr.getStartLineNumber(),
            1,
            { suggestion: 'Replace javascript: URL with an onClick handler or a safe href' },
          ),
        );
      }
      continue;
    }

    // Expression attribute: href={someVar} — flag when the expression is a
    // template literal or string literal starting with javascript:
    if (Node.isJsxExpression(init)) {
      const expr = init.getExpression();
      if (!expr) continue;

      if (Node.isStringLiteral(expr)) {
        if (/^\s*javascript:/i.test(expr.getLiteralValue())) {
          findings.push(
            finding(
              'xss-href-javascript',
              'error',
              'bug',
              `${name} uses a javascript: URL — executes arbitrary script on click`,
              ctx.filePath,
              attr.getStartLineNumber(),
              1,
              { suggestion: 'Replace javascript: URL with an onClick handler or a safe href' },
            ),
          );
        }
      } else if (Node.isTemplateExpression(expr) || Node.isNoSubstitutionTemplateLiteral(expr)) {
        const text = expr.getText();
        if (/^[`'"]\s*javascript:/i.test(text)) {
          findings.push(
            finding(
              'xss-href-javascript',
              'error',
              'bug',
              `${name} is a template literal starting with javascript: — executes arbitrary script on click`,
              ctx.filePath,
              attr.getStartLineNumber(),
              1,
              { suggestion: 'Replace javascript: URL with an onClick handler or a safe href' },
            ),
          );
        }
      }
    }
  }

  return findings;
}

// ── Rule: crypto-iv-reuse ────────────────────────────────────────────────
// createCipheriv(algo, key, iv) with a literal/constant IV.
// A reused IV on GCM is catastrophic; on CBC it's merely broken.

function isLiteralOrConstant(node: Node | undefined): boolean {
  if (!node) return false;
  if (Node.isStringLiteral(node)) return true;
  if (Node.isNumericLiteral(node)) return true;
  if (Node.isNoSubstitutionTemplateLiteral(node)) return true;
  // Buffer.from("constant"), Buffer.from([1,2,3]), Buffer.alloc(16)
  if (Node.isCallExpression(node)) {
    const callee = node.getExpression().getText();
    if (callee === 'Buffer.from' || callee === 'Buffer.alloc') {
      const arg = node.getArguments()[0];
      if (!arg) return false;
      // Buffer.alloc(16) — all zeros, always unsafe
      if (callee === 'Buffer.alloc' && Node.isNumericLiteral(arg)) return true;
      if (Node.isStringLiteral(arg)) return true;
      if (Node.isNumericLiteral(arg)) return true;
      if (Node.isArrayLiteralExpression(arg)) {
        return arg.getElements().every((el) => Node.isNumericLiteral(el));
      }
    }
  }
  return false;
}

/** Resolve a variable reference to its initializer if it is a top-level const. */
function resolveConstInitializer(node: Node): Node | undefined {
  if (!Node.isIdentifier(node)) return undefined;
  const decls = node.getSymbol()?.getDeclarations() ?? [];
  for (const d of decls) {
    if (Node.isVariableDeclaration(d)) {
      // Must be a `const` declaration
      const statement = d.getVariableStatement();
      if (statement && statement.getDeclarationKind() === 'const') {
        return d.getInitializer();
      }
    }
  }
  return undefined;
}

function cryptoIvReuse(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'createCipheriv' && callee !== 'crypto.createCipheriv') continue;

    const args = call.getArguments();
    if (args.length < 3) continue;
    const ivArg = args[2];

    let unsafe = isLiteralOrConstant(ivArg);
    let reason = 'IV is a compile-time constant';

    if (!unsafe && Node.isIdentifier(ivArg)) {
      const init = resolveConstInitializer(ivArg);
      if (init && isLiteralOrConstant(init)) {
        unsafe = true;
        reason = `IV resolves to constant '${ivArg.getText()}' (declared as const with a literal initializer)`;
      }
    }

    if (unsafe) {
      findings.push(
        finding(
          'crypto-iv-reuse',
          'error',
          'bug',
          `createCipheriv called with a constant IV — ${reason}. Reusing an IV on AES-GCM leaks the key stream; on CBC it enables chosen-plaintext attacks.`,
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          {
            suggestion: 'Generate a fresh IV per encryption: `const iv = crypto.randomBytes(ivLength)` and prepend it to the ciphertext for decryption',
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: crypto-weak-kdf ────────────────────────────────────────────────
// pbkdf2(password, salt, iterations, keylen, digest) with iterations below
// the current OWASP minimum (600_000 for SHA-256 as of 2023, 210_000 for
// SHA-512). We use 100_000 as a hard floor to avoid flagging historical
// but still-passing callers; anything lower is indefensible.

const PBKDF2_MIN_ITERATIONS = 100_000;

function cryptoWeakKdf(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'pbkdf2' && callee !== 'pbkdf2Sync' && callee !== 'crypto.pbkdf2' && callee !== 'crypto.pbkdf2Sync') {
      continue;
    }

    const args = call.getArguments();
    if (args.length < 3) continue;
    const iterArg = args[2];

    let iterations: number | undefined;

    if (Node.isNumericLiteral(iterArg)) {
      iterations = Number(iterArg.getLiteralValue());
    } else if (Node.isIdentifier(iterArg)) {
      const init = resolveConstInitializer(iterArg);
      if (init && Node.isNumericLiteral(init)) {
        iterations = Number(init.getLiteralValue());
      }
    }

    if (iterations !== undefined && iterations < PBKDF2_MIN_ITERATIONS) {
      findings.push(
        finding(
          'crypto-weak-kdf',
          'error',
          'bug',
          `pbkdf2 called with only ${iterations} iterations — well below the OWASP minimum (600,000 for SHA-256, 210,000 for SHA-512). This key derivation can be brute-forced.`,
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          {
            suggestion: 'Use argon2id via `argon2` or increase iterations to at least 600,000 for SHA-256 / 210,000 for SHA-512',
          },
        ),
      );
    }
  }

  return findings;
}

// ── Exported Security v5 Rules ───────────────────────────────────────────

export const securityV5Rules = [xssHrefJavascript, cryptoIvReuse, cryptoWeakKdf];
