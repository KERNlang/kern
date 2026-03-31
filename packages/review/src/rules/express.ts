/**
 * Express review rules — active when target = express.
 *
 * Catches common Express security and performance issues.
 */

import { SyntaxKind, Node } from 'ts-morph';
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

// ── Rule 24: unvalidated-input ───────────────────────────────────────────
// req.body/params used without validation

function unvalidatedInput(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();
  const lines = fullText.split('\n');

  // Track if file has any validation library imports
  const hasZod = fullText.includes('from \'zod\'') || fullText.includes('from "zod"');
  const hasJoi = fullText.includes('from \'joi\'') || fullText.includes('from "joi"');
  const hasYup = fullText.includes('from \'yup\'') || fullText.includes('from "yup"');
  const hasValidation = hasZod || hasJoi || hasYup || fullText.includes('validate(');

  if (hasValidation) return findings; // file uses a validation library

  // Check for custom validation functions (isValid*, validate*, check*)
  const hasCustomValidation = /\b(?:isValid\w*|validate\w*|check\w*)\s*\(/.test(fullText);

  // Check for req.body access patterns (property access, bracket access, AND destructuring)
  const reqBodyRegex = /\breq\.(body|params|query)\b/g;
  let match;

  while ((match = reqBodyRegex.exec(fullText)) !== null) {
    const line = fullText.substring(0, match.index).split('\n').length;
    const lineText = lines[line - 1] || '';

    // Skip if there's a type assertion or validation nearby
    if (lineText.includes(' as ') || lineText.includes('typeof') ||
        lineText.includes('validate') || lineText.includes('.parse(') ||
        lineText.includes('schema')) continue;

    // Skip if the enclosing function has a validation guard before this access
    // Look for if(!isValid...) or if(!validate...) pattern before this line
    const linesBefore = lines.slice(0, line - 1).join('\n');
    if (hasCustomValidation && /if\s*\(\s*!?\s*(?:isValid\w*|validate\w*|check\w*)\s*\(/.test(linesBefore)) continue;

    findings.push(finding('unvalidated-input', 'error', 'bug',
      `req.${match[1]} used without validation — potential injection vector`,
      ctx.filePath, line,
      { suggestion: 'Validate with zod, joi, or express-validator before using request data' }));
  }

  return findings;
}

// ── Rule 25: missing-error-middleware ─────────────────────────────────────
// Express app without error handler (4-param middleware)

function missingErrorMiddleware(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  // Check if this file creates an Express app
  const hasApp = /(?:const|let) \w+ ?= ?express\s?\(\s?\)/.test(fullText);
  if (!hasApp) return findings;

  // Check for error middleware (4-parameter function: err, req, res, next)
  const has4ParamMiddleware = /app\.use\s?\(\s?(?:function\s+)?\(\s?\w+,\s?\w+,\s?\w+,\s?\w+\s?\)/.test(fullText);
  const hasErrorHandler = has4ParamMiddleware || fullText.includes('errorHandler') || fullText.includes('error-handler');

  if (!hasErrorHandler) {
    // Find the app declaration line
    const appMatch = fullText.match(/(?:const|let)\s+(\w+)\s*=\s*express\s*\(\s*\)/);
    if (appMatch) {
      const line = fullText.substring(0, (appMatch.index ?? 0)).split('\n').length;
      findings.push(finding('missing-error-middleware', 'warning', 'pattern',
        'Express app has no error handling middleware — unhandled errors will crash the server',
        ctx.filePath, line,
        { suggestion: 'app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); })' }));
    }
  }

  return findings;
}

// ── Rule 26: sync-in-handler ─────────────────────────────────────────────
// Synchronous fs/crypto operations in request handlers

function syncInHandler(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  const syncOps = [
    { pattern: /\breadFileSync\s*\(/g, name: 'readFileSync', async: 'readFile' },
    { pattern: /\bwriteFileSync\s*\(/g, name: 'writeFileSync', async: 'writeFile' },
    { pattern: /\bexistsSync\s*\(/g, name: 'existsSync', async: 'access' },
    { pattern: /\bmkdirSync\s*\(/g, name: 'mkdirSync', async: 'mkdir' },
    { pattern: /\breaddirSync\s*\(/g, name: 'readdirSync', async: 'readdir' },
    { pattern: /\bstatSync\s*\(/g, name: 'statSync', async: 'stat' },
    { pattern: /\bcrypto\.pbkdf2Sync\s*\(/g, name: 'pbkdf2Sync', async: 'pbkdf2' },
    { pattern: /\bcrypto\.scryptSync\s*\(/g, name: 'scryptSync', async: 'scrypt' },
    { pattern: /\bcrypto\.randomBytes\s*\(/g, name: 'randomBytes (sync)', async: 'randomBytes (callback)' },
  ];

  // Check if we're in a route handler context
  const isRouteFile = /(?:app|router)\.(get|post|put|delete|patch|use)\s*\(/.test(fullText);
  if (!isRouteFile) return findings;

  for (const { pattern, name, async: asyncName } of syncOps) {
    let match;
    while ((match = pattern.exec(fullText)) !== null) {
      const line = fullText.substring(0, match.index).split('\n').length;
      findings.push(finding('sync-in-handler', 'warning', 'pattern',
        `${name} in request handler blocks the event loop — use ${asyncName} instead`,
        ctx.filePath, line,
        { suggestion: `Replace ${name} with async ${asyncName}` }));
    }
  }

  return findings;
}

// ── Rule: double-response ────────────────────────────────────────────────
// Express handler sends response (res.json/res.send) more than once without early return

const RESPONSE_METHODS = new Set(['json', 'send', 'end', 'redirect', 'render', 'sendFile', 'sendStatus']);

function doubleResponse(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  // Find functions with (req, res) or (req, res, next) parameters
  const allFns = [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
  ];

  for (const fn of allFns) {
    const params = fn.getParameters();
    const resParam = params.find(p =>
      /^(res|response)$/i.test(p.getName()) || /\bResponse\b/.test(p.getType().getText(p)));
    const reqLike = params.some(p =>
      /^(req|request|ctx)$/i.test(p.getName()) || /\b(Request|NextFunction)\b/.test(p.getType().getText(p)));
    if (!resParam || !reqLike) continue;

    const resName = resParam.getName();
    const body = fn.getBody();
    if (!body || !Node.isBlock(body)) continue;

    // Find all response calls in the body (excluding nested functions)
    const responseCalls: Array<{ line: number; method: string; hasReturn: boolean }> = [];
    for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      // Skip if inside a nested function
      let isNested = false;
      let cur: import('ts-morph').Node | undefined = call.getParent();
      while (cur && cur !== body) {
        if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur) ||
            Node.isFunctionDeclaration(cur) || Node.isMethodDeclaration(cur)) {
          isNested = true;
          break;
        }
        cur = cur.getParent();
      }
      if (isNested) continue;

      const expr = call.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) continue;
      const methodName = expr.getName();
      if (!RESPONSE_METHODS.has(methodName)) continue;

      // Check if the object is res or res.status(...)
      const obj = expr.getExpression();
      const isResCall = Node.isIdentifier(obj) && obj.getText() === resName;
      const isChainedRes = Node.isCallExpression(obj) && obj.getExpression().getText().startsWith(resName);
      if (!isResCall && !isChainedRes) continue;

      // Check if the response call is followed by a return/throw statement
      const exprStmt = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
      let hasReturn = false;
      if (exprStmt) {
        const nextSibling = exprStmt.getNextSibling();
        if (nextSibling) {
          const nextKind = nextSibling.getKind();
          hasReturn = nextKind === SyntaxKind.ReturnStatement || nextKind === SyntaxKind.ThrowStatement;
        }
      }

      responseCalls.push({ line: call.getStartLineNumber(), method: methodName, hasReturn });
    }

    // Check for response calls that aren't in mutually exclusive if/else branches
    if (responseCalls.length < 2) continue;

    // Only flag if a previous response call does NOT have a return after it
    const hasUnguardedPrior = responseCalls.slice(0, -1).some(c => !c.hasReturn);
    if (!hasUnguardedPrior) continue;

    // Flag from the second call onwards (only if a prior call lacks return)
    for (let i = 1; i < responseCalls.length; i++) {
      if (responseCalls[i - 1].hasReturn) continue; // prior call is guarded
      const { line, method } = responseCalls[i];
      findings.push(finding('double-response', 'error', 'bug',
        `Possible double response: ${resName}.${method}() may execute after an earlier response — add return after first send`,
        ctx.filePath, line,
        { suggestion: 'Return immediately after sending a response to prevent double-send errors' }));
    }
  }

  return findings;
}

// ── Exported Express Rules ───────────────────────────────────────────────

export const expressRules = [
  unvalidatedInput,
  missingErrorMiddleware,
  syncInHandler,
  doubleResponse,
];
