/**
 * Express review rules — active when target = express.
 *
 * Catches common Express security and performance issues.
 */

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

  // Check for req.body access patterns
  const reqBodyRegex = /\breq\.(body|params|query)(?:\.\w+|\[)/g;
  let match;

  while ((match = reqBodyRegex.exec(fullText)) !== null) {
    const line = fullText.substring(0, match.index).split('\n').length;
    const lineText = lines[line - 1] || '';

    // Skip if there's a type assertion or validation nearby
    if (lineText.includes(' as ') || lineText.includes('typeof') ||
        lineText.includes('validate') || lineText.includes('.parse(') ||
        lineText.includes('schema')) continue;

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
  const hasApp = /(?:const|let)\s+\w+\s*=\s*express\s*\(\s*\)/g.test(fullText);
  if (!hasApp) return findings;

  // Check for error middleware (4-parameter function: err, req, res, next)
  const has4ParamMiddleware = /app\.use\s*\(\s*(?:function\s*)?\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)/g.test(fullText);
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

// ── Exported Express Rules ───────────────────────────────────────────────

export const expressRules = [
  unvalidatedInput,
  missingErrorMiddleware,
  syncInHandler,
];
