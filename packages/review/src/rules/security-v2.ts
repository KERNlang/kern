/**
 * Security v2 rules — deeper security analysis beyond OWASP basics.
 *
 * Covers: JWT verification, cookie hardening, CSRF, CSP strength,
 * path traversal, weak password hashing.
 *
 * All AST-based. Always active regardless of target.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext, SourceSpan } from '../types.js';
import { createFingerprint } from '../types.js';
import { resolveConfidence } from './confidence-baseline.js';

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
    confidence: resolveConfidence(ruleId, extra?.confidence),
  };
}

// ── Rule S9: jwt-weak-verification ───────────────────────────────────────
// jwt.decode() used for auth (no signature verification),
// jwt.verify() without algorithms allowlist,
// weak signing algorithms (HS256 with short secret)

function jwtWeakVerification(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();

    // jwt.decode() — no verification at all
    if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      const methodName = pa.getName();
      const objText = pa.getExpression().getText();

      if (methodName === 'decode' && /jwt|jsonwebtoken/i.test(objText)) {
        // Check context: if result is used in auth decisions, it's dangerous.
        // Skip if clearly inspection/logging (variable named like 'debug', 'log', 'inspect', 'preview')
        let contextVar = '';
        const parent = call.getParent();
        if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
          contextVar = (parent as import('ts-morph').VariableDeclaration).getName().toLowerCase();
        }
        const isInspection = /debug|log|inspect|preview|display|print/.test(contextVar);

        if (!isInspection) {
          findings.push(
            finding(
              'jwt-weak-verification',
              'warning',
              'bug',
              'jwt.decode() does not verify signatures — use jwt.verify() for authentication decisions',
              ctx.filePath,
              call.getStartLineNumber(),
              { suggestion: 'Replace jwt.decode() with jwt.verify(token, secret, { algorithms: ["RS256"] })' },
            ),
          );
        }
      }

      // jwt.verify() — check for missing algorithms option
      if (methodName === 'verify' && /jwt|jsonwebtoken/i.test(objText)) {
        const args = call.getArguments();
        // verify(token, secret) — no options at all
        if (args.length < 3) {
          findings.push(
            finding(
              'jwt-weak-verification',
              'warning',
              'bug',
              'jwt.verify() without algorithms allowlist — accepts any algorithm including "none"',
              ctx.filePath,
              call.getStartLineNumber(),
              { suggestion: 'Add { algorithms: ["RS256"] } as third argument' },
            ),
          );
        } else {
          const thirdArg = args[2];
          // verify(token, secret, callback) — callback form, no options
          if (
            thirdArg.getKind() === SyntaxKind.ArrowFunction ||
            thirdArg.getKind() === SyntaxKind.FunctionExpression ||
            thirdArg.getKind() === SyntaxKind.Identifier
          ) {
            // If 3rd is callback and no 4th arg (options), flag it
            if (
              args.length < 4 ||
              args[3]?.getKind() === SyntaxKind.ArrowFunction ||
              args[3]?.getKind() === SyntaxKind.FunctionExpression
            ) {
              findings.push(
                finding(
                  'jwt-weak-verification',
                  'warning',
                  'bug',
                  'jwt.verify() callback form without algorithms allowlist',
                  ctx.filePath,
                  call.getStartLineNumber(),
                  {
                    suggestion:
                      'Add { algorithms: ["RS256"] } as options: jwt.verify(token, secret, options, callback)',
                  },
                ),
              );
            }
          } else if (thirdArg.getKind() === SyntaxKind.ObjectLiteralExpression) {
            // verify(token, secret, options) — check options for algorithms
            const obj = thirdArg as import('ts-morph').ObjectLiteralExpression;
            const hasAlgorithms = obj.getProperties().some((p) => {
              if (p.getKind() !== SyntaxKind.PropertyAssignment) return false;
              return (p as import('ts-morph').PropertyAssignment).getName() === 'algorithms';
            });
            if (!hasAlgorithms) {
              findings.push(
                finding(
                  'jwt-weak-verification',
                  'warning',
                  'bug',
                  'jwt.verify() options missing "algorithms" — vulnerable to algorithm confusion attacks',
                  ctx.filePath,
                  call.getStartLineNumber(),
                  { suggestion: 'Add algorithms: ["RS256"] to the options object' },
                ),
              );
            }
          }
        }
      }
    }

    // jose: jwtVerify / SignJWT — check for weak algorithms
    if (callee.getKind() === SyntaxKind.Identifier) {
      const name = callee.getText();
      if (name === 'jwtVerify') {
        const args = call.getArguments();
        if (args.length >= 3) {
          const text = args[2].getText();
          if (text.includes("'none'") || text.includes('"none"')) {
            findings.push(
              finding(
                'jwt-weak-verification',
                'error',
                'bug',
                'JWT verification allows "none" algorithm — tokens can be forged',
                ctx.filePath,
                call.getStartLineNumber(),
              ),
            );
          }
        }
      }
    }
  }

  return findings;
}

// ── Rule S10: cookie-hardening ───────────────────────────────────────────
// Cookies missing httpOnly, secure, sameSite flags

function cookieHardening(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  function reportCookieOptions(
    cookieNameRaw: string,
    optionsArg: Node | undefined,
    line: number,
    missingOptionsMessage: string,
  ) {
    const cookieName = cookieNameRaw.replace(/['"]/g, '').toLowerCase();
    const isCsrfCookie = /csrf|xsrf/i.test(cookieName);
    const isAuthCookie = !isCsrfCookie && /session|token|auth|jwt|sid|refresh/i.test(cookieName);

    if (!optionsArg) {
      if (isAuthCookie) {
        findings.push(
          finding('cookie-hardening', 'error', 'bug', missingOptionsMessage, ctx.filePath, line, {
            suggestion: "Add { httpOnly: true, secure: true, sameSite: 'strict' } options",
          }),
        );
      }
      return;
    }

    if (!Node.isObjectLiteralExpression(optionsArg)) return;
    const obj = optionsArg;
    const propNames = new Set(
      obj
        .getProperties()
        .filter((p) => Node.isPropertyAssignment(p))
        .map((p) => (p as import('ts-morph').PropertyAssignment).getName()),
    );

    const missing: string[] = [];
    if (!propNames.has('httpOnly')) missing.push('httpOnly');
    if (!propNames.has('secure')) missing.push('secure');
    if (!propNames.has('sameSite')) missing.push('sameSite');

    if (missing.length > 0 && isAuthCookie) {
      findings.push(
        finding(
          'cookie-hardening',
          'error',
          'bug',
          `Auth cookie '${cookieName}' missing: ${missing.join(', ')}`,
          ctx.filePath,
          line,
          { suggestion: `Add ${missing.map((m) => `${m}: true`).join(', ')} to cookie options` },
        ),
      );
    } else if (missing.length > 0) {
      findings.push(
        finding(
          'cookie-hardening',
          'warning',
          'bug',
          `Cookie '${cookieName}' missing: ${missing.join(', ')}`,
          ctx.filePath,
          line,
        ),
      );
    }

    for (const prop of obj.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;
      if (
        prop.getName() === 'httpOnly' &&
        prop.getInitializer()?.getKind() === SyntaxKind.FalseKeyword &&
        isAuthCookie
      ) {
        findings.push(
          finding(
            'cookie-hardening',
            'error',
            'bug',
            `Auth cookie '${cookieName}' has httpOnly: false — XSS can steal it`,
            ctx.filePath,
            line,
          ),
        );
      }
    }
  }

  function unwrapCookieReceiver(node: Node): Node {
    let current = node;
    while (Node.isParenthesizedExpression(current) || Node.isAwaitExpression(current)) {
      current = current.getExpression();
    }
    return current;
  }

  function isCookiesCall(node: Node): boolean {
    const unwrapped = unwrapCookieReceiver(node);
    return (
      Node.isCallExpression(unwrapped) &&
      Node.isIdentifier(unwrapped.getExpression()) &&
      unwrapped.getExpression().getText() === 'cookies'
    );
  }

  const nextCookieStoreAliases = new Set<string>();
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (!Node.isIdentifier(nameNode)) continue;
    const init = decl.getInitializer();
    if (init && isCookiesCall(init)) nextCookieStoreAliases.add(nameNode.getText());
  }

  // Pattern 1: res.cookie('name', value, options) — Express
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() === 'set') {
      const receiver = unwrapCookieReceiver(pa.getExpression());
      const isNextCookieSet =
        (Node.isPropertyAccessExpression(receiver) && receiver.getName() === 'cookies') ||
        isCookiesCall(receiver) ||
        (Node.isIdentifier(receiver) && nextCookieStoreAliases.has(receiver.getText()));
      if (!isNextCookieSet) continue;

      const args = call.getArguments();
      const firstArg = args[0];
      if (!firstArg) continue;

      if (Node.isObjectLiteralExpression(firstArg)) {
        const nameProp = firstArg.getProperty('name');
        if (!nameProp || !Node.isPropertyAssignment(nameProp)) continue;
        const nameInit = nameProp.getInitializer();
        if (!nameInit) continue;
        reportCookieOptions(
          nameInit.getText(),
          firstArg,
          call.getStartLineNumber(),
          `Auth cookie '${nameInit.getText().replace(/['"]/g, '').toLowerCase()}' set without security flags — missing httpOnly, secure, sameSite`,
        );
      } else {
        reportCookieOptions(
          firstArg.getText(),
          args[2],
          call.getStartLineNumber(),
          `Auth cookie '${firstArg.getText().replace(/['"]/g, '').toLowerCase()}' set without security flags — missing httpOnly, secure, sameSite`,
        );
      }
      continue;
    }
    if (pa.getName() !== 'cookie') continue;

    const args = call.getArguments();
    if (args.length < 2) continue;

    reportCookieOptions(
      args[0].getText(),
      args[2],
      call.getStartLineNumber(),
      `Auth cookie '${args[0].getText().replace(/['"]/g, '').toLowerCase()}' set without security flags — missing httpOnly, secure, sameSite`,
    );
  }

  return findings;
}

// ── Rule S11: csrf-detection ─────────────────────────────────────────────
// Disabled CSRF protection in cookie-auth apps

function csrfDetection(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  // Only fire if the app uses cookie-based auth (per Codex: don't nag bearer-token APIs)
  // Passport with session: false is stateless JWT — not cookie auth
  const hasPassportStateless = fullText.includes('session: false') && fullText.includes('passport');
  const usesCookieAuth =
    fullText.includes('cookie-session') ||
    fullText.includes('express-session') ||
    fullText.includes('cookie-parser') ||
    (fullText.includes('passport') && !hasPassportStateless) ||
    /res\.cookie\s*\([^)]*(?:session|auth|token)/i.test(fullText);

  if (!usesCookieAuth) return findings;

  // Check for explicit CSRF disable
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const callText = callee.getText();

    // csurf with { ignoreMethods: ['POST'] } or similar
    if (callText === 'csrf' || callText === 'csurf') {
      const args = call.getArguments();
      if (args.length > 0) {
        const optText = args[0].getText();
        if (optText.includes('ignoreMethods') && /POST|PUT|DELETE|PATCH/.test(optText)) {
          findings.push(
            finding(
              'csrf-detection',
              'error',
              'bug',
              'CSRF protection ignores state-changing methods — defeats the purpose',
              ctx.filePath,
              call.getStartLineNumber(),
            ),
          );
        }
      }
    }
  }

  // Check: cookie-session app with state-changing routes but no CSRF middleware
  const hasCsrf =
    fullText.includes('csrf') ||
    fullText.includes('csurf') ||
    fullText.includes('csrfToken') ||
    fullText.includes('_csrf');
  const hasStateChangingRoutes = /\.(post|put|delete|patch)\s*\(/.test(fullText);

  if (!hasCsrf && hasStateChangingRoutes) {
    // Find the first route handler line
    const routeMatch = fullText.match(/\.(post|put|delete|patch)\s*\(/);
    if (routeMatch) {
      const line = fullText.substring(0, routeMatch.index).split('\n').length;
      findings.push(
        finding(
          'csrf-detection',
          'warning',
          'bug',
          'Cookie-auth app has state-changing routes but no CSRF protection',
          ctx.filePath,
          line,
          { suggestion: 'Add CSRF middleware (csrf-csrf, csurf) or use SameSite=Strict cookies' },
        ),
      );
    }
  }

  return findings;
}

// ── Rule S12: csp-strength ───────────────────────────────────────────────
// Weak Content-Security-Policy directives

function cspStrength(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const weakDirectives = [
    { pattern: /unsafe-inline/g, label: 'unsafe-inline', risk: 'allows inline scripts — XSS vector' },
    { pattern: /unsafe-eval/g, label: 'unsafe-eval', risk: 'allows eval() — code injection vector' },
    { pattern: /script-src\s+\*/g, label: "script-src '*'", risk: 'allows scripts from any origin' },
    { pattern: /default-src\s+\*/g, label: "default-src '*'", risk: 'allows all resources from any origin' },
  ];

  // Check string literals that look like CSP directives
  for (const str of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    const value = str.getLiteralValue();
    if (!value.includes('-src') && !value.includes('default-src')) continue;

    for (const { pattern, label, risk } of weakDirectives) {
      pattern.lastIndex = 0;
      if (pattern.test(value)) {
        findings.push(
          finding(
            'csp-strength',
            'warning',
            'bug',
            `Weak CSP: ${label} — ${risk}`,
            ctx.filePath,
            str.getStartLineNumber(),
            { suggestion: `Remove ${label} and use nonces or hashes instead` },
          ),
        );
      }
    }
  }

  // Check template literals too
  for (const tmpl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    const value = tmpl.getLiteralValue();
    if (!value.includes('-src') && !value.includes('default-src')) continue;

    for (const { pattern, label, risk } of weakDirectives) {
      pattern.lastIndex = 0;
      if (pattern.test(value)) {
        findings.push(
          finding(
            'csp-strength',
            'warning',
            'bug',
            `Weak CSP: ${label} — ${risk}`,
            ctx.filePath,
            tmpl.getStartLineNumber(),
          ),
        );
      }
    }
  }

  // Check for frame-ancestors missing (clickjacking)
  const fullText = ctx.sourceFile.getFullText();
  if (fullText.includes('helmet') || fullText.includes('contentSecurityPolicy')) {
    const hasFrameAncestors = fullText.includes('frame-ancestors') || fullText.includes('frameAncestors');
    if (!hasFrameAncestors) {
      // Find the CSP config line
      const cspMatch = fullText.match(/contentSecurityPolicy/);
      if (cspMatch) {
        const line = fullText.substring(0, cspMatch.index).split('\n').length;
        findings.push(
          finding(
            'csp-strength',
            'info',
            'bug',
            'CSP missing frame-ancestors — consider adding to prevent clickjacking',
            ctx.filePath,
            line,
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule S13: path-traversal ─────────────────────────────────────────────
// File system operations with user input (req.params, req.query, req.body)

const FS_READ_FUNCTIONS = new Set([
  'readFile',
  'readFileSync',
  'createReadStream',
  'readdir',
  'readdirSync',
  'stat',
  'statSync',
  'access',
  'accessSync',
  'existsSync',
]);

function pathTraversal(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    let funcName = '';

    if (callee.getKind() === SyntaxKind.Identifier) {
      funcName = callee.getText();
    } else if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      funcName = (callee as import('ts-morph').PropertyAccessExpression).getName();
    }

    if (!FS_READ_FUNCTIONS.has(funcName)) continue;

    // Check if any argument contains user input
    const args = call.getArguments();
    if (args.length === 0) continue;

    const firstArgText = args[0].getText();
    const hasUserInput =
      firstArgText.includes('req.params') || firstArgText.includes('req.query') || firstArgText.includes('req.body');

    if (!hasUserInput) continue;

    // Check if the same function scope has path validation before the fs call
    const parentBlock = call.getFirstAncestorByKind(SyntaxKind.Block);
    const blockText = parentBlock?.getText() || '';
    const callOffset = call.getStart() - (parentBlock?.getStart() || 0);
    const textBeforeCall = blockText.substring(0, callOffset);
    // Only count validation that appears BEFORE the fs call in the same block
    const hasPathValidation =
      (textBeforeCall.includes('path.resolve') && textBeforeCall.includes('startsWith')) ||
      (textBeforeCall.includes('path.normalize') && textBeforeCall.includes("'..'"));

    if (!hasPathValidation) {
      findings.push(
        finding(
          'path-traversal',
          'error',
          'bug',
          `${funcName}() with user input — path traversal vulnerability`,
          ctx.filePath,
          call.getStartLineNumber(),
          {
            suggestion: 'Validate: const safe = path.resolve(baseDir, userInput); if (!safe.startsWith(baseDir)) throw',
          },
        ),
      );
    }
  }

  // Also check res.sendFile with user input
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() !== 'sendFile' && pa.getName() !== 'download') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const argText = args[0].getText();

    if (argText.includes('req.params') || argText.includes('req.query')) {
      // Check if options object with { root } is passed — this is the safe pattern
      const hasRootOption =
        args.length >= 2 &&
        args.some((a) => {
          if (a.getKind() !== SyntaxKind.ObjectLiteralExpression) return false;
          return (a as import('ts-morph').ObjectLiteralExpression).getProperties().some((p) => {
            if (p.getKind() !== SyntaxKind.PropertyAssignment) return false;
            return (p as import('ts-morph').PropertyAssignment).getName() === 'root';
          });
        });

      if (!hasRootOption) {
        findings.push(
          finding(
            'path-traversal',
            'error',
            'bug',
            `res.${pa.getName()}() with user input — path traversal vulnerability`,
            ctx.filePath,
            call.getStartLineNumber(),
            { suggestion: 'Use { root: __dirname } option and validate the path' },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule S14: weak-password-hashing ──────────────────────────────────────
// MD5/SHA1 for passwords, raw createHash on passwords, low bcrypt rounds

function weakPasswordHashing(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();

    // crypto.createHash('md5'|'sha1') or direct createHash() import — in password context
    const isCreateHash =
      callee.getKind() === SyntaxKind.PropertyAccessExpression
        ? (callee as import('ts-morph').PropertyAccessExpression).getName() === 'createHash'
        : callee.getKind() === SyntaxKind.Identifier && callee.getText() === 'createHash';
    if (isCreateHash) {
      const args = call.getArguments();
      if (args.length > 0 && args[0].getKind() === SyntaxKind.StringLiteral) {
        const algo = (args[0] as import('ts-morph').StringLiteral).getLiteralValue().toLowerCase();
        if (algo === 'md5' || algo === 'sha1' || algo === 'sha256') {
          // Check context — is this for password hashing?
          let parent = call.getParent();
          let contextName = '';
          while (parent) {
            if (parent.getKind() === SyntaxKind.FunctionDeclaration) {
              contextName = (parent as import('ts-morph').FunctionDeclaration).getName() || '';
              break;
            }
            if (parent.getKind() === SyntaxKind.VariableDeclaration) {
              contextName = (parent as import('ts-morph').VariableDeclaration).getName();
              break;
            }
            parent = parent.getParent();
          }

          const isPasswordContext = /password|passwd|hash.*pass|pass.*hash|credential|secret/i.test(contextName);

          if (algo === 'md5' || algo === 'sha1') {
            // Only flag as error in password context; skip entirely for non-password use
            // (MD5 for checksums/ETags/Gravatar is fine)
            if (isPasswordContext) {
              findings.push(
                finding(
                  'weak-password-hashing',
                  'error',
                  'bug',
                  `createHash('${algo}') for password hashing — cryptographically broken`,
                  ctx.filePath,
                  call.getStartLineNumber(),
                  { suggestion: 'Use bcrypt, scrypt, or argon2 for passwords.' },
                ),
              );
            }
          } else if (algo === 'sha256' && isPasswordContext) {
            findings.push(
              finding(
                'weak-password-hashing',
                'error',
                'bug',
                'Raw SHA-256 for password hashing — too fast, vulnerable to brute force',
                ctx.filePath,
                call.getStartLineNumber(),
                { suggestion: 'Use bcrypt (rounds: 12+), scrypt, or argon2 — they are intentionally slow' },
              ),
            );
          }
        }
      }
    }

    // bcrypt.hash with low rounds
    if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      if ((pa.getName() === 'hash' || pa.getName() === 'hashSync') && /bcrypt/i.test(pa.getExpression().getText())) {
        const args = call.getArguments();
        // bcrypt.hash(password, saltRounds) — check saltRounds
        if (args.length >= 2) {
          const roundsArg = args[1];
          if (roundsArg.getKind() === SyntaxKind.NumericLiteral) {
            const rounds = parseInt(roundsArg.getText(), 10);
            if (rounds < 10) {
              findings.push(
                finding(
                  'weak-password-hashing',
                  'warning',
                  'bug',
                  `bcrypt with ${rounds} rounds — use at least 12 for adequate security`,
                  ctx.filePath,
                  call.getStartLineNumber(),
                  { suggestion: 'Increase salt rounds to 12 or higher' },
                ),
              );
            }
          }
        }
      }
    }

    // pbkdf2 with low iterations
    if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      if (pa.getName() === 'pbkdf2' || pa.getName() === 'pbkdf2Sync') {
        const args = call.getArguments();
        // pbkdf2(password, salt, iterations, keylen, digest)
        if (args.length >= 3) {
          const iterArg = args[2];
          if (iterArg.getKind() === SyntaxKind.NumericLiteral) {
            const iterations = parseInt(iterArg.getText(), 10);
            if (iterations < 100000) {
              findings.push(
                finding(
                  'weak-password-hashing',
                  'warning',
                  'bug',
                  `pbkdf2 with ${iterations.toLocaleString()} iterations — OWASP recommends 600,000+`,
                  ctx.filePath,
                  call.getStartLineNumber(),
                  { suggestion: 'Increase iterations to at least 600,000 (OWASP 2023 recommendation)' },
                ),
              );
            }
          }
        }
      }
    }
  }

  return findings;
}

// ── Browser security rules ──────────────────────────────────────────────

function isInsideTryBlock(node: Node): boolean {
  let cur: Node | undefined = node;
  while (cur) {
    const parent = cur.getParent();
    if (parent && Node.isTryStatement(parent) && parent.getTryBlock() === cur) return true;
    if (
      cur !== node &&
      (Node.isArrowFunction(cur) ||
        Node.isFunctionExpression(cur) ||
        Node.isFunctionDeclaration(cur) ||
        Node.isMethodDeclaration(cur))
    ) {
      return false;
    }
    cur = parent;
  }
  return false;
}

function unwrapExpression(node: Node): Node {
  let cur = node;
  while (
    Node.isParenthesizedExpression(cur) ||
    Node.isAsExpression(cur) ||
    Node.isTypeAssertion(cur) ||
    Node.isNonNullExpression(cur) ||
    Node.isSatisfiesExpression(cur)
  ) {
    cur = cur.getExpression();
  }
  return cur;
}

function isStorageGetItemCall(node: Node | undefined): boolean {
  if (!node) return false;
  const unwrapped = unwrapExpression(node);
  if (!Node.isCallExpression(unwrapped)) return false;
  const callee = unwrapped.getExpression();
  if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'getItem') return false;
  const target = callee.getExpression().getText();
  return /^(?:window\.)?(?:localStorage|sessionStorage)$/.test(target);
}

function containsStorageGetItemCall(node: Node | undefined): boolean {
  if (!node) return false;
  const unwrapped = unwrapExpression(node);
  if (isStorageGetItemCall(unwrapped)) return true;
  if (Node.isBinaryExpression(unwrapped)) {
    return containsStorageGetItemCall(unwrapped.getLeft()) || containsStorageGetItemCall(unwrapped.getRight());
  }
  if (Node.isConditionalExpression(unwrapped)) {
    return (
      containsStorageGetItemCall(unwrapped.getCondition()) ||
      containsStorageGetItemCall(unwrapped.getWhenTrue()) ||
      containsStorageGetItemCall(unwrapped.getWhenFalse())
    );
  }
  if (Node.isAwaitExpression(unwrapped)) return containsStorageGetItemCall(unwrapped.getExpression());
  if (unwrapped.getDescendantsOfKind(SyntaxKind.CallExpression).some(isStorageGetItemCall)) return true;
  return false;
}

function browserStorageJsonParseUnguarded(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== 'JSON.parse') continue;
    if (isInsideTryBlock(call)) continue;

    const firstArg = call.getArguments()[0];
    if (!firstArg) continue;

    if (!containsStorageGetItemCall(firstArg)) continue;

    findings.push(
      finding(
        'browser-storage-json-parse-unguarded',
        'warning',
        'bug',
        'JSON.parse() reads browser storage outside try/catch — corrupted or user-edited storage can crash the app',
        ctx.filePath,
        call.getStartLineNumber(),
        {
          suggestion: 'Wrap storage parsing in try/catch or route it through a shared safeParseStorage helper.',
        },
      ),
    );
  }

  return findings;
}

function isWildcardString(node: Node | undefined): boolean {
  return Boolean(
    node &&
      ((Node.isStringLiteral(node) && node.getLiteralValue() === '*') ||
        (Node.isNoSubstitutionTemplateLiteral(node) && node.getLiteralText() === '*')),
  );
}

function isGeneratedBrowserAssetPath(filePath: string): boolean {
  return (
    /(?:^|[/\\])(?:public|vendor|vendors|dist|build|coverage)(?:[/\\]|$)/i.test(filePath) ||
    /\.min\.js$/i.test(filePath)
  );
}

function postmessageWildcardTarget(ctx: RuleContext): ReviewFinding[] {
  if (isGeneratedBrowserAssetPath(ctx.filePath)) return [];

  const findings: ReviewFinding[] = [];
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (Node.isIdentifier(callee) && callee.getText() === 'postMessage') {
      if (!isWildcardString(call.getArguments()[1])) continue;
      const localBindings = callee
        .getSymbol()
        ?.getDeclarations()
        .filter((decl) => decl.getSourceFile() === ctx.sourceFile);
      if (localBindings && localBindings.length > 0) continue;
      findings.push(
        finding(
          'postmessage-wildcard-target',
          'warning',
          'bug',
          'postMessage() uses "*" as targetOrigin — messages can be delivered to an unexpected origin',
          ctx.filePath,
          call.getStartLineNumber(),
          { suggestion: 'Pass the exact expected origin as targetOrigin instead of "*".' },
        ),
      );
      continue;
    }

    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'postMessage') continue;
    if (!isWildcardString(call.getArguments()[1])) continue;

    const target = callee.getExpression().getText();
    if (!/(?:^window$|^globalThis$|^parent$|^opener$|^top$|\.top$|contentWindow$|^frames\b|\.frames\b)/.test(target)) {
      continue;
    }

    findings.push(
      finding(
        'postmessage-wildcard-target',
        'warning',
        'bug',
        'postMessage() uses "*" as targetOrigin — messages can be delivered to an unexpected origin',
        ctx.filePath,
        call.getStartLineNumber(),
        { suggestion: 'Pass the exact expected origin as targetOrigin instead of "*".' },
      ),
    );
  }

  return findings;
}

function isUrlSearchParamsExpression(node: Node | undefined): boolean {
  if (!node) return false;
  const unwrapped = unwrapExpression(node);
  if (Node.isNewExpression(unwrapped) && unwrapped.getExpression().getText() === 'URLSearchParams') return true;
  if (Node.isCallExpression(unwrapped) && unwrapped.getExpression().getText() === 'useSearchParams') return true;
  return false;
}

function isSearchParamsSource(node: Node): boolean {
  if (isUrlSearchParamsExpression(node)) return true;
  if (!Node.isPropertyAccessExpression(node) || node.getName() !== 'searchParams') return false;
  const source = unwrapExpression(node.getExpression());
  return Node.isNewExpression(source) && source.getExpression().getText() === 'URL';
}

function isQueryParamGetExpression(node: Node | undefined, paramVars: Set<string>): boolean {
  if (!node) return false;
  const unwrapped = unwrapExpression(node);
  if (Node.isBinaryExpression(unwrapped)) {
    return (
      isQueryParamGetExpression(unwrapped.getLeft(), paramVars) ||
      isQueryParamGetExpression(unwrapped.getRight(), paramVars)
    );
  }
  if (!Node.isCallExpression(unwrapped)) return false;
  const callee = unwrapped.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (callee.getName() !== 'get') {
    return (
      isQueryParamGetExpression(callee.getExpression(), paramVars) ||
      unwrapped.getArguments().some((arg) => isQueryParamGetExpression(arg, paramVars))
    );
  }
  const source = callee.getExpression();
  if (Node.isIdentifier(source) && paramVars.has(source.getText())) return true;
  return isSearchParamsSource(source);
}

function isClientRedirectSinkTarget(node: Node): boolean {
  if (!Node.isPropertyAccessExpression(node)) return false;
  const name = node.getName();
  const target = node.getExpression().getText();
  if (name === 'href' && /^(?:window\.|document\.)?location$/.test(target)) return true;
  return name === 'location' && /^(?:window|document)$/.test(target);
}

function isLocationNavigationCall(callee: Node): boolean {
  if (!Node.isPropertyAccessExpression(callee)) return false;
  const method = callee.getName();
  const target = callee.getExpression().getText();
  return (method === 'assign' || method === 'replace') && /^(?:window\.|document\.)?location$/.test(target);
}

function clientOpenRedirectFromQuery(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const paramVars = new Set<string>();
  const taintedVars = new Set<string>();

  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (!Node.isIdentifier(nameNode)) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    if (isUrlSearchParamsExpression(init)) paramVars.add(nameNode.getText());
  }

  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (!Node.isIdentifier(nameNode)) continue;
    const init = decl.getInitializer();
    if (!init) continue;
    if (isQueryParamGetExpression(init, paramVars)) taintedVars.add(nameNode.getText());
  }

  const isTaintedRedirectValue = (node: Node | undefined): boolean => {
    if (!node) return false;
    const unwrapped = unwrapExpression(node);
    if (Node.isIdentifier(unwrapped)) return taintedVars.has(unwrapped.getText());
    if (Node.isBinaryExpression(unwrapped)) {
      return isTaintedRedirectValue(unwrapped.getLeft()) || isTaintedRedirectValue(unwrapped.getRight());
    }
    if (Node.isTemplateExpression(unwrapped)) {
      return unwrapped.getTemplateSpans().some((span) => isTaintedRedirectValue(span.getExpression()));
    }
    return isQueryParamGetExpression(unwrapped, paramVars);
  };

  for (const bin of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;
    if (!isClientRedirectSinkTarget(bin.getLeft())) continue;
    if (!isTaintedRedirectValue(bin.getRight())) continue;

    findings.push(
      finding(
        'client-open-redirect-from-query',
        'error',
        'bug',
        'Client-side navigation assigns a query parameter directly to location.href — open redirect risk',
        ctx.filePath,
        bin.getStartLineNumber(),
        { suggestion: 'Validate the target against same-origin/path-only rules before navigating.' },
      ),
    );
  }

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isLocationNavigationCall(call.getExpression())) continue;
    if (!isTaintedRedirectValue(call.getArguments()[0])) continue;

    findings.push(
      finding(
        'client-open-redirect-from-query',
        'error',
        'bug',
        'Client-side navigation passes a query parameter directly to location.assign/replace — open redirect risk',
        ctx.filePath,
        call.getStartLineNumber(),
        { suggestion: 'Validate the target against same-origin/path-only rules before navigating.' },
      ),
    );
  }

  return findings;
}

// ── Rule: window-open-blank-missing-noopener ────────────────────────────
// window.open(url, '_blank') must include noopener/noreferrer in the feature
// string. The JSX anchor rule cannot see imperative tab opens.

function getStaticStringValue(node: Node | undefined): string | undefined {
  if (!node) return undefined;
  const unwrapped = unwrapExpression(node);
  if (Node.isStringLiteral(unwrapped) || Node.isNoSubstitutionTemplateLiteral(unwrapped)) {
    return unwrapped.getLiteralValue();
  }
  return undefined;
}

function featureStringHasNoopener(value: string): boolean {
  return /(?:^|[,;\s])(?:noopener|noreferrer)(?:[=,;\s]|$)/i.test(value);
}

function windowOpenBlankMissingNoopener(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getName() !== 'open') continue;
    const ownerText = callee.getExpression().getText();
    if (ownerText !== 'window' && ownerText !== 'globalThis' && ownerText !== 'self') continue;

    const args = call.getArguments();
    if (getStaticStringValue(args[1]) !== '_blank') continue;

    const features = getStaticStringValue(args[2]);
    if (features && featureStringHasNoopener(features)) continue;

    findings.push(
      finding(
        'window-open-blank-missing-noopener',
        'warning',
        'bug',
        "window.open(..., '_blank') without noopener/noreferrer lets the opened page control window.opener",
        ctx.filePath,
        call.getStartLineNumber(),
        {
          suggestion:
            "Pass a third argument containing 'noopener,noreferrer', then null out the opener if older browser support matters.",
        },
      ),
    );
  }

  return findings;
}

type JsxOpeningLike = import('ts-morph').JsxOpeningElement | import('ts-morph').JsxSelfClosingElement;

function getJsxAttr(jsx: JsxOpeningLike, name: string): import('ts-morph').JsxAttribute | undefined {
  return jsx
    .getAttributes()
    .find(
      (attr): attr is import('ts-morph').JsxAttribute =>
        Node.isJsxAttribute(attr) && attr.getNameNode().getText() === name,
    );
}

function hasJsxSpreadAttribute(jsx: JsxOpeningLike): boolean {
  return jsx.getAttributes().some((attr) => Node.isJsxSpreadAttribute(attr));
}

function iframeSrcNeedsSandbox(attr: import('ts-morph').JsxAttribute | undefined): boolean {
  if (!attr) return false;
  const init = attr.getInitializer();
  if (!init) return false;

  if (Node.isStringLiteral(init)) {
    return /^(?:https?:)?\/\//i.test(init.getLiteralValue());
  }
  if (!Node.isJsxExpression(init)) return false;

  const expr = init.getExpression();
  if (!expr) return false;
  const value = getStaticStringValue(expr);
  if (value !== undefined) return /^(?:https?:)?\/\//i.test(value);
  return true;
}

function iframeSrcDocNeedsSandbox(attr: import('ts-morph').JsxAttribute | undefined): boolean {
  if (!attr) return false;
  const init = attr.getInitializer();
  if (!init) return false;
  if (Node.isStringLiteral(init)) return false;
  if (!Node.isJsxExpression(init)) return false;
  const expr = init.getExpression();
  return !!expr && getStaticStringValue(expr) === undefined;
}

// ── Rule: iframe-dynamic-src-missing-sandbox ────────────────────────────
// Dynamic or external iframe sources should be sandboxed. Same-origin static
// paths are skipped to avoid noisy findings for internal app frames.

function iframeDynamicSrcMissingSandbox(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const iframes: JsxOpeningLike[] = [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const jsx of iframes) {
    if (jsx.getTagNameNode().getText() !== 'iframe') continue;
    if (getJsxAttr(jsx, 'sandbox')) continue;
    if (hasJsxSpreadAttribute(jsx)) continue;

    const srcAttr = getJsxAttr(jsx, 'src');
    const srcDocAttr = getJsxAttr(jsx, 'srcDoc');
    if (!iframeSrcNeedsSandbox(srcAttr) && !iframeSrcDocNeedsSandbox(srcDocAttr)) continue;

    findings.push(
      finding(
        'iframe-dynamic-src-missing-sandbox',
        'warning',
        'bug',
        'iframe uses a dynamic/external src or srcDoc without sandbox — embedded content can script, navigate, or submit forms with full frame privileges',
        ctx.filePath,
        jsx.getStartLineNumber(),
        { suggestion: 'Add a sandbox attribute with the minimum allow-* tokens required by the embedded content.' },
      ),
    );
  }

  return findings;
}

// ── Exported Security v2 Rules ───────────────────────────────────────────

export const securityV2Rules = [
  jwtWeakVerification,
  cookieHardening,
  csrfDetection,
  cspStrength,
  pathTraversal,
  weakPasswordHashing,
  browserStorageJsonParseUnguarded,
  postmessageWildcardTarget,
  clientOpenRedirectFromQuery,
  windowOpenBlankMissingNoopener,
  iframeDynamicSrcMissingSandbox,
];
