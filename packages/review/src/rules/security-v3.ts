/**
 * Security v3 rules — OWASP gap closure.
 *
 * Covers: Regex DoS, missing input validation, prototype pollution,
 * information exposure (stack traces in responses).
 *
 * All AST-based. Always active regardless of target.
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

// ── Rule S9: regex-dos ────────────────────────────────────────────────
// Regex literals with nested quantifiers or unbounded repetition that
// can cause catastrophic backtracking (ReDoS).
//
// Detects: (a+)+, (a|a)+, (.*a){n}, nested quantifiers in groups
// CWE-1333

/**
 * Check if a regex pattern contains ReDoS-vulnerable constructs.
 * Looks for: nested quantifiers, overlapping alternation with quantifiers,
 * and ambiguous repetition patterns.
 */
export function isReDoSVulnerable(pattern: string): string | null {
  // Nested quantifiers: (x+)+ , (x*)* , (x+)* , (x*)+, (x{n,})+ etc.
  // These cause exponential backtracking
  if (/\([^)]*[+*]\)[+*{]/.test(pattern)) {
    return 'nested quantifier — causes exponential backtracking';
  }

  // Quantified group containing alternation with overlap: (a|a)+, (a|ab)+
  // Simplified: group with | and outer quantifier
  if (/\([^)]*\|[^)]*\)[+*]{1,2}/.test(pattern)) {
    // Check for character overlap in alternation branches
    const groupMatch = pattern.match(/\(([^)]*\|[^)]*)\)[+*]/);
    if (groupMatch) {
      const branches = groupMatch[1].split('|');
      if (branches.length >= 2) {
        const first = branches[0].replace(/[+*?{}\\[\]()]/g, '');
        const second = branches[1].replace(/[+*?{}\\[\]()]/g, '');
        // If branches share starting characters, it's ambiguous
        if (first.length > 0 && second.length > 0 && first[0] === second[0]) {
          return 'overlapping alternation with quantifier — ambiguous matching causes backtracking';
        }
      }
    }
  }

  // Quantified group with .* or .+ inside: (.*something)+ or (.+x){2,}
  if (/\([^)]*\.\*[^)]*\)[+*{]/.test(pattern) || /\([^)]*\.\+[^)]*\)[+*{]/.test(pattern)) {
    return '.* or .+ inside quantified group — unbounded matching causes backtracking';
  }

  // Adjacent overlapping quantifiers with same class: \s*\s*, \d+\d+, \w*\w+
  // Only flag when BOTH classes are the same (or uppercase/lowercase pair) — \w*\s* is safe
  const adjMatch = pattern.match(/\\([dswDSW])[+*]\\([dswDSW])[+*]/);
  if (adjMatch) {
    const a = adjMatch[1].toLowerCase();
    const b = adjMatch[2].toLowerCase();
    if (a === b) {
      return 'adjacent overlapping quantifiers — ambiguous boundary causes backtracking';
    }
  }

  return null;
}

function regexDos(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Check regex literals: /pattern/flags
  for (const node of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.RegularExpressionLiteral)) {
    const text = node.getText();
    // Extract pattern (between first / and last /)
    const lastSlash = text.lastIndexOf('/');
    if (lastSlash <= 0) continue;
    const pattern = text.slice(1, lastSlash);

    const vulnerability = isReDoSVulnerable(pattern);
    if (vulnerability) {
      findings.push(finding('regex-dos', 'warning', 'bug',
        `Regex vulnerable to ReDoS: ${vulnerability}`,
        ctx.filePath, node.getStartLineNumber(),
        { suggestion: 'Rewrite regex to avoid nested quantifiers, or use a linear-time regex engine (RE2)' }));
    }
  }

  // Check new RegExp('pattern') constructors
  for (const newExpr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (newExpr.getExpression().getText() !== 'RegExp') continue;
    const args = newExpr.getArguments();
    if (args.length === 0) continue;
    const firstArg = args[0];
    if (firstArg.getKind() !== SyntaxKind.StringLiteral) continue;
    const pattern = (firstArg as import('ts-morph').StringLiteral).getLiteralValue();

    const vulnerability = isReDoSVulnerable(pattern);
    if (vulnerability) {
      findings.push(finding('regex-dos', 'warning', 'bug',
        `RegExp constructor vulnerable to ReDoS: ${vulnerability}`,
        ctx.filePath, newExpr.getStartLineNumber(),
        { suggestion: 'Rewrite regex to avoid nested quantifiers, or use a linear-time regex engine (RE2)' }));
    }
  }

  return findings;
}

// ── Rule S10: missing-input-validation ────────────────────────────────
// HTTP handler params (req.body, req.query, req.params) used directly
// in logic without validation (no schema.parse, no if-check, no
// parseInt/Number, no sanitize call).
// CWE-20

const USER_INPUT_PATTERNS = /req\.(body|query|params|headers)\b/;
const VALIDATION_PATTERNS = /\.parse\(|\.validate\(|\.safeParse\(|parseInt\(|Number\(|Boolean\(|sanitize|validator\.|zod\.|yup\.|joi\.|ajv\.|superstruct|valibot/;

function missingInputValidation(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Find Express-style route handlers: (req, res) => { ... } or function(req, res) { ... }
  for (const fn of [
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
  ]) {
    const params = fn.getParameters();
    if (params.length < 2) continue;

    // Heuristic: first param named req/request, second named res/response
    const firstName = params[0].getName();
    const secondName = params[1].getName();
    if (!/^req(uest)?$/.test(firstName) || !/^res(ponse)?$/.test(secondName)) continue;

    const body = fn.getBody();
    if (!body) continue;
    const bodyText = body.getText();

    // Check if handler uses user input
    if (!USER_INPUT_PATTERNS.test(bodyText)) continue;

    // Check if any validation is present in the handler
    if (VALIDATION_PATTERNS.test(bodyText)) continue;

    // Extract which input sources are used
    const sources: string[] = [];
    const bodyMatch = bodyText.match(/req\.body/);
    const queryMatch = bodyText.match(/req\.query/);
    const paramsMatch = bodyText.match(/req\.params/);
    if (bodyMatch) sources.push('req.body');
    if (queryMatch) sources.push('req.query');
    if (paramsMatch) sources.push('req.params');

    findings.push(finding('missing-input-validation', 'warning', 'bug',
      `HTTP handler uses ${sources.join(', ')} without input validation`,
      ctx.filePath, fn.getStartLineNumber(),
      { suggestion: 'Validate input with zod, joi, or manual checks before using in business logic' }));
  }

  return findings;
}

// ── Rule S11: prototype-pollution ─────────────────────────────────────
// Object.assign() or spread from unvalidated external input.
// Detects: Object.assign(target, req.body), { ...req.body }, merge(target, userInput)
// CWE-1321

const MERGE_FUNCTIONS = new Set(['merge', 'defaults', 'defaultsDeep', 'extend', 'assign']);

function prototypePollution(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Object.assign(target, untrustedSource)
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();

    // Object.assign(...)
    if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      if (pa.getExpression().getText() === 'Object' && pa.getName() === 'assign') {
        const args = call.getArguments();
        // Check if any argument after the first is user input
        for (let i = 1; i < args.length; i++) {
          const text = args[i].getText();
          if (USER_INPUT_PATTERNS.test(text) || /\bJSON\.parse\b/.test(text)) {
            findings.push(finding('prototype-pollution', 'error', 'bug',
              `Object.assign() with user input (${text.substring(0, 40)}) — prototype pollution risk`,
              ctx.filePath, call.getStartLineNumber(),
              { suggestion: 'Use a safe merge utility, or validate/strip __proto__ and constructor keys first' }));
            break;
          }
        }
      }
    }

    // Deep merge utilities: merge(target, userInput), _.defaults(target, userInput)
    if (callee.getKind() === SyntaxKind.Identifier) {
      const funcName = callee.getText();
      if (MERGE_FUNCTIONS.has(funcName)) {
        const args = call.getArguments();
        for (const arg of args) {
          const text = arg.getText();
          if (USER_INPUT_PATTERNS.test(text) || /\bJSON\.parse\b/.test(text)) {
            findings.push(finding('prototype-pollution', 'warning', 'bug',
              `${funcName}() with user input — potential prototype pollution`,
              ctx.filePath, call.getStartLineNumber(),
              { suggestion: 'Validate input keys or use Object.create(null) as target' }));
            break;
          }
        }
      }
    }

    // lodash-style: _.merge, _.defaults, _.defaultsDeep, _.extend
    if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      const objText = pa.getExpression().getText();
      if ((objText === '_' || objText === 'lodash') && MERGE_FUNCTIONS.has(pa.getName())) {
        const args = call.getArguments();
        for (const arg of args) {
          const text = arg.getText();
          if (USER_INPUT_PATTERNS.test(text) || /\bJSON\.parse\b/.test(text)) {
            findings.push(finding('prototype-pollution', 'warning', 'bug',
              `${objText}.${pa.getName()}() with user input — potential prototype pollution`,
              ctx.filePath, call.getStartLineNumber(),
              { suggestion: 'Use a prototype-safe merge, or strip __proto__/constructor from input' }));
            break;
          }
        }
      }
    }
  }

  // Spread from user input in object literal: { ...req.body }
  for (const spread of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.SpreadAssignment)) {
    const expr = spread.getExpression();
    const text = expr.getText();
    if (USER_INPUT_PATTERNS.test(text) || /\bJSON\.parse\b/.test(text)) {
      findings.push(finding('prototype-pollution', 'warning', 'bug',
        `Spread from user input (${text.substring(0, 40)}) — prototype pollution risk if input contains __proto__`,
        ctx.filePath, spread.getStartLineNumber(),
        { suggestion: 'Destructure only known fields, or strip __proto__ and constructor keys' }));
    }
  }

  return findings;
}

// ── Rule S12: information-exposure ────────────────────────────────────
// Error responses that include stack traces, internal paths, or
// unfiltered error objects sent to clients.
// CWE-209

function informationExposure(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    const methodName = pa.getName();

    // res.json(), res.send(), res.status().json()
    const isResponseMethod = methodName === 'json' || methodName === 'send';
    if (!isResponseMethod) continue;

    // Walk up to check if this is on a response object (res.json or res.status(N).json)
    let objText = pa.getExpression().getText();
    // Handle chained: res.status(500).json(...)
    if (objText.includes('.status(')) {
      objText = objText.split('.')[0];
    }
    if (!/^res(ponse)?$/.test(objText)) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const argText = args[0].getText();

    // Pattern 1: Sending raw error object — res.json(err), res.json({ error: err })
    // err.stack, err.message with stack included, error.stack
    if (/\.stack\b/.test(argText)) {
      findings.push(finding('information-exposure', 'error', 'bug',
        'Stack trace sent in response — exposes internal paths and code structure',
        ctx.filePath, call.getStartLineNumber(),
        { suggestion: 'Send a generic error message to clients; log the stack server-side' }));
      continue;
    }

    // Pattern 2: Sending raw error in catch block — res.json(err) or res.send(err)
    // Check if we're inside a catch clause
    let ancestor = call.getParent();
    let inCatch = false;
    let catchVarName = '';
    while (ancestor) {
      if (ancestor.getKind() === SyntaxKind.CatchClause) {
        inCatch = true;
        const clause = ancestor as import('ts-morph').CatchClause;
        const varDecl = clause.getVariableDeclaration();
        if (varDecl) catchVarName = varDecl.getName();
        break;
      }
      ancestor = ancestor.getParent();
    }

    if (inCatch && catchVarName) {
      // Sending the raw error variable: res.json(err), res.json({ error: err })
      const errRef = new RegExp(`\\b${catchVarName}\\b`);
      if (errRef.test(argText)) {
        // Check it's not just err.message (which is often safe)
        const onlyMessage = new RegExp(`^\\{?\\s*\\w+:\\s*${catchVarName}\\.message\\s*\\}?$`);
        if (!onlyMessage.test(argText.trim())) {
          findings.push(finding('information-exposure', 'warning', 'bug',
            `Raw error object '${catchVarName}' sent in response — may expose stack traces and internal details`,
            ctx.filePath, call.getStartLineNumber(),
            { suggestion: `Send only ${catchVarName}.message or a generic error string` }));
        }
      }
    }

    // Pattern 3: process.env or __dirname in response
    if (/process\.env\b/.test(argText) || /\b__dirname\b/.test(argText) || /\b__filename\b/.test(argText)) {
      findings.push(finding('information-exposure', 'warning', 'bug',
        'Internal path or environment variable sent in response',
        ctx.filePath, call.getStartLineNumber(),
        { suggestion: 'Never expose process.env, __dirname, or __filename to clients' }));
    }
  }

  return findings;
}

// ── Rule S13: prompt-injection ─────────────────────────────────────────
// User input embedded into LLM prompts without sanitization.
// Detects: template literals or string concatenation that include user input
// flowing to LLM API calls (generateContent, chat.completions, etc.)
// CWE-77 (Injection), OWASP LLM01

/** Known LLM API call patterns */
const LLM_API_PATTERNS = /\bgenerateContent\b|\bchat\.completions\b|\bcreate\b.*\bmodel\b|\bgenerate\b|\bsendMessage\b|\bcomplete\b/;
/** Common prompt builder function names */
const PROMPT_BUILDER_PATTERNS = /\bbuildPrompt\b|\bgeneratePrompt\b|\bsystemPrompt\b|\buserPrompt\b|\bcreatePrompt\b/;
/** Sanitization function patterns */
const PROMPT_SANITIZER_PATTERNS = /\bsanitizeForPrompt\b|\bescapePrompt\b|\bcleanPrompt\b|\bsanitize\w*\(/;

function promptInjection(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Check template literals that embed user input and flow to LLM calls
  for (const template of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    const text = template.getText();

    // Does this template contain user input references?
    const hasUserInput = USER_INPUT_PATTERNS.test(text) ||
      /\b(question|userInput|userMessage|message|input|query|prompt|instruction|caption)\b/.test(text);
    if (!hasUserInput) continue;

    // Is there a sanitizer wrapping the user input in this template?
    if (PROMPT_SANITIZER_PATTERNS.test(text)) continue;

    // Check if this template is used in an LLM context
    // 1. Inside a function whose name suggests prompt building
    let parent: import('ts-morph').Node | undefined = template.getParent();
    let inPromptContext = false;
    while (parent) {
      if (parent.getKind() === SyntaxKind.FunctionDeclaration ||
          parent.getKind() === SyntaxKind.ArrowFunction ||
          parent.getKind() === SyntaxKind.MethodDeclaration) {
        const parentText = parent.getText().substring(0, 200);
        if (PROMPT_BUILDER_PATTERNS.test(parentText) || LLM_API_PATTERNS.test(parentText)) {
          inPromptContext = true;
        }
        // Check function name
        if (parent.getKind() === SyntaxKind.FunctionDeclaration) {
          const fnName = (parent as import('ts-morph').FunctionDeclaration).getName() || '';
          if (/prompt|build.*prompt|generate.*prompt|system.*prompt/i.test(fnName)) {
            inPromptContext = true;
          }
        }
        break;
      }
      parent = parent.getParent() as import('ts-morph').Node | undefined;
    }

    // 2. Variable assigned to a name like "systemPrompt", "userPrompt"
    const assignParent = template.getParent();
    if (assignParent?.getKind() === SyntaxKind.VariableDeclaration) {
      const varName = (assignParent as import('ts-morph').VariableDeclaration).getName();
      if (/prompt|system|instruction/i.test(varName)) {
        inPromptContext = true;
      }
    }
    // Also check if template is assigned via `const x = ...`
    if (assignParent?.getKind() === SyntaxKind.BinaryExpression) {
      const leftText = (assignParent as import('ts-morph').BinaryExpression).getLeft().getText();
      if (/prompt|system|instruction/i.test(leftText)) {
        inPromptContext = true;
      }
    }

    if (!inPromptContext) continue;

    // Find which user input variable is unsanitized
    const spans = template.getTemplateSpans();
    for (const span of spans) {
      const exprText = span.getExpression().getText();
      // Skip if this specific expression is wrapped in sanitize
      if (PROMPT_SANITIZER_PATTERNS.test(exprText)) continue;
      // Skip simple property access on known safe objects
      if (/^(intent|mixContext|analysisResults)\b/.test(exprText)) continue;

      // Check if this is a user-controlled value
      const isUserControlled = USER_INPUT_PATTERNS.test(exprText) ||
        /^(question|userInput|userMessage|message|input|caption|instruction)\b/.test(exprText);

      if (isUserControlled) {
        findings.push(finding('prompt-injection', 'warning', 'bug',
          `User input '${exprText.substring(0, 50)}' embedded in LLM prompt without sanitization — prompt injection risk`,
          ctx.filePath, template.getStartLineNumber(),
          { suggestion: 'Wrap user input with sanitizeForPrompt() or equivalent before embedding in prompts' }));
        break; // One finding per template
      }
    }
  }

  // Check string concatenation in prompt context: "You are... " + userInput
  for (const bin of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getKind() !== SyntaxKind.PlusToken) continue;

    const rightText = bin.getRight().getText();
    const leftText = bin.getLeft().getText();
    const fullText = bin.getText();

    // Is this string concat involving user input?
    const hasUserInput = USER_INPUT_PATTERNS.test(rightText) ||
      /^(question|userInput|message|input|caption|instruction)\b/.test(rightText);
    if (!hasUserInput) continue;

    // Is the left side a prompt-like string?
    const isPromptConcat = /prompt|instruction|system|you are|analyze|review/i.test(leftText);
    if (!isPromptConcat) continue;

    // Is it sanitized?
    if (PROMPT_SANITIZER_PATTERNS.test(fullText)) continue;

    findings.push(finding('prompt-injection', 'warning', 'bug',
      `User input concatenated into LLM prompt without sanitization — prompt injection risk`,
      ctx.filePath, bin.getStartLineNumber(),
      { suggestion: 'Use sanitizeForPrompt() on user input before concatenating into prompts' }));
  }

  return findings;
}

// ── Exported Security v3 Rules ────────────────────────────────────────

export const securityV3Rules = [
  regexDos,
  missingInputValidation,
  prototypePollution,
  informationExposure,
  promptInjection,
];
