/**
 * Security v4 rules — LLM prompt injection attack surface.
 *
 * Covers 10 attack vectors beyond basic prompt injection (v3):
 *   S14: indirect-prompt-injection — DB-stored data flows to LLM prompt
 *   S15: llm-output-execution — LLM output passed to eval/exec
 *   S16: system-prompt-leakage — system prompt exposed in responses
 *   S17: rag-poisoning — retrieval results flow unsanitized to prompt
 *   S18: tool-calling-manipulation — user input controls tool names/schemas
 *   S19: encoding-bypass — decoded content enters prompt unsanitized
 *   S20: delimiter-injection — user input with delimiters in prompt context
 *   S21: unsanitized-history — chat history pushed without sanitization
 *   S22: json-output-manipulation — JSON.parse on LLM output without schema
 *   S23: missing-output-validation — LLM output used without validation
 *
 * All AST-based. Always active regardless of target.
 * OWASP LLM01-LLM09
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

// ── Shared patterns ──────────────────────────────────────────────────

/** Escape a string for use inside a RegExp */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const DB_READ_PATTERNS = /\b(db\.query|findOne|findById|findMany|getItem|collection\.find|\.findUnique|\.findFirst)\b/;
const LLM_API_PATTERNS = /\bgenerateContent\b|\bchat\.completions\.create\b|\bcomplete\b|\bsendMessage\b|\bcreateCompletion\b|\bcreateChatCompletion\b/;
const LLM_RESPONSE_NAMES = /^(completion|llmResponse|llmResult|aiResponse|chatResponse|aiOutput|generatedText)$/i;
const PROMPT_CONTEXT = /prompt|system|instruction|context|template/i;
const SANITIZER_CALL = /\bsanitize\w*\s?\(|\bescape\w*\s?\(|\bclean\w*\s?\(|\bstripDelimiters\s?\(|\bcleanForPrompt\s?\(/;
const VALIDATION_CALL = /\.parse\s*\(|\.safeParse\s*\(|\.validate\s*\(|\.validateSync\s*\(/;
const RETRIEVAL_PATTERNS = /\bvectorStore\.search\b|\bvectorDb\.search\b|\bretrieve\b|\bsimilaritySearch\b|\bembedding\.query\b|\bindex\.query\b|\bsemantic[Ss]earch\b|\b\w+[Dd]b\.search\b|\b\w+[Ss]tore\.search\b/;
const EXEC_SINKS = /\beval\s*\(|\bnew\s+Function\s*\(|\bvm\.runInContext\s*\(|\bvm\.runInNewContext\s*\(|\bexec\s*\(|\bexecSync\s*\(/;

// ── Rule S14: indirect-prompt-injection ───────────────────────────────
// DB read results flow into LLM prompt construction without sanitization.
// CWE-77, OWASP LLM01

function indirectPromptInjection(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fileText = ctx.sourceFile.getFullText();

  if (!DB_READ_PATTERNS.test(fileText)) return findings;
  if (!LLM_API_PATTERNS.test(fileText) && !PROMPT_CONTEXT.test(fileText)) return findings;

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callText = call.getExpression().getText();
    if (!DB_READ_PATTERNS.test(callText)) continue;

    // Find variable this DB result is assigned to
    let varName = '';
    let parent = call.getParent();
    if (parent?.getKind() === SyntaxKind.AwaitExpression) parent = parent.getParent();
    if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
      varName = (parent as import('ts-morph').VariableDeclaration).getName();
    }
    if (!varName) continue;

    // Check if this variable appears in a prompt/LLM context
    const fnBody = call.getFirstAncestorByKind(SyntaxKind.Block);
    if (!fnBody) continue;
    const bodyText = fnBody.getText();

    const ev = escapeRegExp(varName);

    // Is it used in template interpolation or concat?
    const usedInTemplate = new RegExp(`\\$\\{[^}]*\\b${ev}\\b`).test(bodyText);
    const usedInConcat = new RegExp(`\\+\\s*${ev}\\b|${ev}\\b\\s*\\+`).test(bodyText);
    if (!usedInTemplate && !usedInConcat) continue;

    // Is this in a prompt context?
    if (!LLM_API_PATTERNS.test(bodyText) && !PROMPT_CONTEXT.test(bodyText)) continue;

    // Is it sanitized? Check if every template interpolation wraps the var in sanitize
    const sanitizeWraps = new RegExp(`\\$\\{[^}]*(?:sanitize\\w*|escape\\w*|cleanForPrompt)\\s*\\([^)]*\\b${ev}\\b`).test(bodyText);
    const sanitizeBefore = new RegExp(`(?:sanitize\\w*|escape\\w*|cleanForPrompt)\\s*\\(\\s*${ev}`).test(bodyText);
    if (sanitizeWraps || sanitizeBefore) continue;

    findings.push(finding('indirect-prompt-injection', 'warning', 'bug',
      `DB result '${varName}' from ${callText.substring(0, 40)} used in LLM prompt without sanitization — indirect injection risk`,
      ctx.filePath, call.getStartLineNumber(),
      { suggestion: 'Sanitize DB-sourced content before embedding in LLM prompts — stored data may contain injection payloads' }));
  }

  return findings;
}

// ── Rule S15: llm-output-execution ───────────────────────────────────
// LLM API response passed to eval(), new Function(), vm.runIn*(), exec().
// CWE-94, OWASP LLM02

function llmOutputExecution(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fileText = ctx.sourceFile.getFullText();

  if (!EXEC_SINKS.test(fileText)) return findings;

  // Collect variables assigned from LLM API calls
  const llmVars = new Set<string>();
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callText = call.getExpression().getText();
    if (!LLM_API_PATTERNS.test(callText)) continue;

    let parent = call.getParent();
    if (parent?.getKind() === SyntaxKind.AwaitExpression) parent = parent.getParent();
    if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
      llmVars.add((parent as import('ts-morph').VariableDeclaration).getName());
    }
  }

  // Only match LLM_RESPONSE_NAMES if file actually has LLM API calls (Fix 7)
  if (llmVars.size > 0) {
    for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (LLM_RESPONSE_NAMES.test(decl.getName())) {
        llmVars.add(decl.getName());
      }
    }
  }

  // Propagate: if const x = llmVar.something, x is also tainted
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer()?.getText() || '';
    for (const v of llmVars) {
      if (new RegExp(`\\b${escapeRegExp(v)}\\b`).test(init) && !llmVars.has(decl.getName())) {
        llmVars.add(decl.getName());
      }
    }
  }

  if (llmVars.size === 0) return findings;

  // Check call expressions that are exec sinks
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    if (!EXEC_SINKS.test(calleeText + '(')) continue;

    const argsText = call.getArguments().map(a => a.getText()).join(' ');
    for (const v of llmVars) {
      if (new RegExp(`\\b${v}\\b`).test(argsText)) {
        findings.push(finding('llm-output-execution', 'error', 'bug',
          `LLM output '${v}' passed to ${calleeText}() — arbitrary code execution risk`,
          ctx.filePath, call.getStartLineNumber(),
          { suggestion: 'Never execute LLM output directly. Validate against an allowlist or use a sandboxed interpreter' }));
        break;
      }
    }
  }

  // Check new Function(llmVar)
  for (const newExpr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    if (newExpr.getExpression().getText() !== 'Function') continue;
    const argsText = newExpr.getArguments().map(a => a.getText()).join(' ');
    for (const v of llmVars) {
      if (new RegExp(`\\b${v}\\b`).test(argsText)) {
        findings.push(finding('llm-output-execution', 'error', 'bug',
          `LLM output '${v}' passed to new Function() — arbitrary code execution risk`,
          ctx.filePath, newExpr.getStartLineNumber(),
          { suggestion: 'Never execute LLM output. Use a sandboxed interpreter or validate against an allowlist' }));
        break;
      }
    }
  }

  return findings;
}

// ── Rule S16: system-prompt-leakage ──────────────────────────────────
// System prompt variables exposed in error responses or API responses.
// CWE-209, OWASP LLM07

const SYSTEM_PROMPT_VARS = /\b(systemPrompt|SYSTEM_PROMPT|system_prompt|sysPrompt|systemInstruction|SYSTEM_INSTRUCTION)\b/;

function systemPromptLeakage(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    const methodName = pa.getName();

    // res.json(), res.send(), console.log()
    const isResponseMethod = methodName === 'json' || methodName === 'send';
    const isLogMethod = methodName === 'log' || methodName === 'error' || methodName === 'warn';
    if (!isResponseMethod && !isLogMethod) continue;

    // Walk up to check if it's on a response object or console
    let objText = pa.getExpression().getText();
    if (objText.includes('.status(')) {
      objText = objText.split('.')[0];
    }

    const isRes = /^res(ponse)?$/.test(objText);
    const isConsole = objText === 'console';
    if (!isRes && !isConsole) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const argText = args.map(a => a.getText()).join(' ');

    if (!SYSTEM_PROMPT_VARS.test(argText)) continue;

    if (isRes) {
      // Check if we're inside a catch block (error leak path)
      let ancestor = call.getParent();
      let inCatch = false;
      while (ancestor) {
        if (ancestor.getKind() === SyntaxKind.CatchClause) { inCatch = true; break; }
        ancestor = ancestor.getParent();
      }

      findings.push(finding('system-prompt-leakage', inCatch ? 'error' : 'warning', 'bug',
        `System prompt variable exposed in ${inCatch ? 'error ' : ''}response — leaks system instructions to client`,
        ctx.filePath, call.getStartLineNumber(),
        { suggestion: 'Never include system prompt content in API responses or error messages' }));
    } else {
      // Console logging of system prompt — may be visible in client-side logs
      findings.push(finding('system-prompt-leakage', 'info', 'bug',
        `System prompt variable logged via console.${methodName}() — may be visible in browser devtools`,
        ctx.filePath, call.getStartLineNumber(),
        { suggestion: 'Avoid logging system prompts; use server-side only logging if needed' }));
    }
  }

  // Also check: system prompt vars interpolated in template literals that are returned
  // (the caller may expose the prompt to clients)
  for (const template of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    const templateText = template.getText();
    if (!SYSTEM_PROMPT_VARS.test(templateText)) continue;

    // Is this template returned or assigned to a response?
    const parent = template.getParent();
    const isReturned = parent?.getKind() === SyntaxKind.ReturnStatement;
    const isAssignedToResponse = parent?.getKind() === SyntaxKind.VariableDeclaration &&
      /response|reply|output|result/i.test((parent as import('ts-morph').VariableDeclaration).getName());

    if (isReturned || isAssignedToResponse) {
      findings.push(finding('system-prompt-leakage', 'warning', 'bug',
        `System prompt variable interpolated in returned value — may be exposed to callers`,
        ctx.filePath, template.getStartLineNumber(),
        { suggestion: 'Avoid including system prompt content in return values that may reach clients' }));
    }
  }

  return findings;
}

// ── Rule S17: rag-poisoning ──────────────────────────────────────────
// Retrieval function outputs flow directly into prompt without sanitization.
// OWASP LLM01, LLM03

function ragPoisoning(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fileText = ctx.sourceFile.getFullText();

  if (!RETRIEVAL_PATTERNS.test(fileText)) return findings;
  if (!LLM_API_PATTERNS.test(fileText) && !PROMPT_CONTEXT.test(fileText)) return findings;

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callText = call.getExpression().getText();
    if (!RETRIEVAL_PATTERNS.test(callText)) continue;

    let varName = '';
    let parent = call.getParent();
    if (parent?.getKind() === SyntaxKind.AwaitExpression) parent = parent.getParent();
    if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
      varName = (parent as import('ts-morph').VariableDeclaration).getName();
    }
    if (!varName) continue;

    const fnBody = call.getFirstAncestorByKind(SyntaxKind.Block);
    if (!fnBody) continue;
    const bodyText = fnBody.getText();

    // Collect derived variables: const context = docs.map(...).join(...)
    const taintedVars = new Set([varName]);
    for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const initText = decl.getInitializer()?.getText() || '';
      for (const tv of taintedVars) {
        if (new RegExp(`\\b${tv}\\b`).test(initText)) {
          taintedVars.add(decl.getName());
          break;
        }
      }
    }

    // Used in template or concat? (check all tainted vars)
    let foundUsage = false;
    for (const tv of taintedVars) {
      const usedInTemplate = new RegExp(`\\$\\{[^}]*\\b${tv}\\b`).test(bodyText);
      const usedInConcat = new RegExp(`\\+\\s*${tv}\\b|${tv}\\b\\s*\\+`).test(bodyText);
      if (usedInTemplate || usedInConcat) { foundUsage = true; break; }
    }
    if (!foundUsage) continue;

    // In prompt context?
    if (!LLM_API_PATTERNS.test(bodyText) && !PROMPT_CONTEXT.test(bodyText)) continue;

    // Sanitized?
    let sanitized = false;
    for (const tv of taintedVars) {
      if (SANITIZER_CALL.test(bodyText) && new RegExp(`\\w+\\s*\\([^)]*\\b${tv}\\b`).test(bodyText)) {
        sanitized = true; break;
      }
    }
    if (sanitized) continue;

    findings.push(finding('rag-poisoning', 'warning', 'bug',
      `Retrieval result '${varName}' from ${callText.substring(0, 40)} embedded in prompt without sanitization — RAG poisoning risk`,
      ctx.filePath, call.getStartLineNumber(),
      { suggestion: 'Sanitize retrieved content before embedding in prompts — indexed documents may contain injection payloads' }));
  }

  return findings;
}

// ── Rule S18: tool-calling-manipulation ──────────────────────────────
// User input influences function/tool names or schemas in LLM tool-use APIs.
// OWASP LLM01, LLM07

const USER_INPUT_PATTERNS = /req\.(body|query|params|headers)\b/;
const TOOL_API_PROPERTIES = /\b(tools|functions|function_call|tool_choice|function_name)\b/;

function toolCallingManipulation(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fileText = ctx.sourceFile.getFullText();

  const hasToolProps = TOOL_API_PROPERTIES.test(fileText);
  const hasToolCalls = /tool_calls|toolCalls|function_calls/.test(fileText);
  if (!hasToolProps && !hasToolCalls) return findings;

  // Find object literals that contain tool/function configuration (requires user input)
  if (USER_INPUT_PATTERNS.test(fileText) && hasToolProps)
  for (const objLit of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    const objText = objLit.getText();
    if (!TOOL_API_PROPERTIES.test(objText)) continue;

    // Check if any property value references user input
    for (const prop of objLit.getProperties()) {
      if (prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const pa = prop as import('ts-morph').PropertyAssignment;
      const propName = pa.getName();

      if (!TOOL_API_PROPERTIES.test(propName)) continue;

      const valueText = pa.getInitializer()?.getText() || '';
      // Check direct user input OR aliased user input (const tool = req.body.tool → tool)
      const isUserInput = USER_INPUT_PATTERNS.test(valueText) ||
        /\b(userInput|input|query|message)\b/.test(valueText);
      // Also check if value is a variable that was assigned from user input
      let isAliasedInput = false;
      if (!isUserInput) {
        for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
          if (decl.getName() === valueText.trim()) {
            const initText = decl.getInitializer()?.getText() || '';
            if (USER_INPUT_PATTERNS.test(initText)) { isAliasedInput = true; break; }
          }
        }
      }
      if (isUserInput || isAliasedInput) {
        findings.push(finding('tool-calling-manipulation', 'error', 'bug',
          `User input controls '${propName}' in LLM tool configuration — attacker can invoke arbitrary tools`,
          ctx.filePath, pa.getStartLineNumber(),
          { suggestion: 'Never let user input control tool names or schemas. Use a fixed allowlist of tools' }));
      }
    }
  }

  // Check computed property access on tool arrays: tools[userInput]
  for (const elem of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ElementAccessExpression)) {
    const objText = elem.getExpression().getText();
    if (!/tool|function/i.test(objText)) continue;
    const argText = elem.getArgumentExpression()?.getText() || '';
    if (USER_INPUT_PATTERNS.test(argText) || /\b(userInput|input|query)\b/.test(argText)) {
      findings.push(finding('tool-calling-manipulation', 'error', 'bug',
        `User input used as index into tool array '${objText}' — tool selection manipulation`,
        ctx.filePath, elem.getStartLineNumber(),
        { suggestion: 'Validate tool selection against a fixed allowlist' }));
    }
  }

  // Check for executing LLM-returned tool_calls without validation:
  // response.tool_calls → executeTool(call.name, ...) without allowlist check
  for (const forOf of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ForOfStatement)) {
    const iterExpr = forOf.getExpression().getText();
    if (!/tool_calls|toolCalls|function_calls/.test(iterExpr)) continue;

    const forBody = forOf.getStatement().getText();
    // Is there an execute/call pattern using the loop variable's .name?
    if (/\b(execute|call|invoke|run|dispatch)\w*\s?\(/i.test(forBody) &&
        /\.name\b|\.function\b/.test(forBody)) {
      // Check if there's an allowlist/validation on the tool NAME before execution
      if (!/allowlist\w*\.has\s?\(\s?\w+\.name|whitelist\w*\.has\s?\(\s?\w+\.name|allowed\w*\.includes\s?\(\s?\w+\.name|validTools\w*\.has\s?\(\s?\w+\.name/.test(forBody)) {
        findings.push(finding('tool-calling-manipulation', 'error', 'bug',
          `LLM-returned tool calls executed without allowlist validation — attacker can invoke arbitrary tools via prompt injection`,
          ctx.filePath, forOf.getStartLineNumber(),
          { suggestion: 'Validate tool names against a fixed allowlist before executing LLM-returned tool_calls' }));
      }
    }
  }

  // Also check forEach on tool_calls
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    if (!/tool_calls\.forEach|toolCalls\.forEach|function_calls\.forEach/.test(calleeText)) continue;

    const argsText = call.getArguments().map(a => a.getText()).join(' ');
    if (/\b(execute|call|invoke|run|dispatch)\w*\s?\(/i.test(argsText) &&
        /\.name\b|\.function\b/.test(argsText)) {
      if (!/allowlist\w*\.has\s?\(\s?\w+\.name|whitelist\w*\.has\s?\(\s?\w+\.name|allowed\w*\.includes\s?\(\s?\w+\.name|validTools\w*\.has\s?\(\s?\w+\.name/.test(argsText)) {
        findings.push(finding('tool-calling-manipulation', 'error', 'bug',
          `LLM-returned tool calls executed without allowlist validation — attacker can invoke arbitrary tools via prompt injection`,
          ctx.filePath, call.getStartLineNumber(),
          { suggestion: 'Validate tool names against a fixed allowlist before executing LLM-returned tool_calls' }));
      }
    }
  }

  return findings;
}

// ── Rule S19: encoding-bypass ────────────────────────────────────────
// Decoded content (base64, hex, URI) enters prompt without re-sanitization.
// OWASP LLM01

const DECODE_PATTERNS = /\batob\s*\(|\bBuffer\.from\s*\([^)]*(['"]base64['"]|['"]hex['"])|\bdecodeURIComponent\s*\(|\bdecodeURI\s*\(/;

function encodingBypass(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fileText = ctx.sourceFile.getFullText();

  if (!DECODE_PATTERNS.test(fileText)) return findings;
  if (!LLM_API_PATTERNS.test(fileText) && !PROMPT_CONTEXT.test(fileText)) return findings;

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callText = call.getText();
    if (!DECODE_PATTERNS.test(callText)) continue;

    // Find what variable it's assigned to
    let varName = '';
    let parent = call.getParent();
    if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
      varName = (parent as import('ts-morph').VariableDeclaration).getName();
    }
    if (!varName) continue;

    const fnBody = call.getFirstAncestorByKind(SyntaxKind.Block);
    if (!fnBody) continue;
    const bodyText = fnBody.getText();

    // Used in prompt context?
    const usedInTemplate = new RegExp(`\\$\\{[^}]*\\b${varName}\\b`).test(bodyText);
    const usedInConcat = new RegExp(`\\+\\s*${varName}\\b|${varName}\\b\\s*\\+`).test(bodyText);
    if (!usedInTemplate && !usedInConcat) continue;

    if (!LLM_API_PATTERNS.test(bodyText) && !PROMPT_CONTEXT.test(bodyText)) continue;

    // Re-sanitized after decode?
    if (new RegExp(`sanitize\\w*\\s*\\(\\s*${varName}|escape\\w*\\s*\\(\\s*${varName}`).test(bodyText)) continue;

    const decodeFn = callText.includes('atob') ? 'atob()' :
      callText.includes('Buffer.from') ? 'Buffer.from()' : 'decodeURIComponent()';

    findings.push(finding('encoding-bypass', 'warning', 'bug',
      `Decoded content '${varName}' from ${decodeFn} used in prompt without re-sanitization — encoding bypass risk`,
      ctx.filePath, call.getStartLineNumber(),
      { suggestion: 'Sanitize decoded content before embedding in prompts — base64/hex encoding can bypass input filters' }));
  }

  return findings;
}

// ── Rule S20: delimiter-injection ────────────────────────────────────
// User input in prompt templates without stripping delimiters.
// OWASP LLM01

const DELIMITER_PATTERN = /`{3}|---|###|<\/?system>|<\/?instruction>|<\/?user>|<\/?assistant>|<\|system\|>|<\|user\|>|<\|end\|>|<\|assistant\|>|\[INST\]|\[\/INST\]/;

function delimiterInjection(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const template of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    const templateText = template.getText();

    // Is this a prompt template? Check for prompt-like content
    if (!PROMPT_CONTEXT.test(templateText) && !DELIMITER_PATTERN.test(templateText)) continue;

    // Does the template itself use delimiters to structure the prompt?
    const usesDelimiters = DELIMITER_PATTERN.test(templateText);
    if (!usesDelimiters) continue;

    // Must be in an LLM/prompt context — skip pure Markdown/frontmatter templates
    const fnBody = template.getFirstAncestorByKind(SyntaxKind.Block);
    if (fnBody) {
      const fnText = fnBody.getText();
      if (!LLM_API_PATTERNS.test(fnText) && !PROMPT_CONTEXT.test(fnText)) continue;
    }

    // Check if user input is interpolated without stripping delimiters
    const spans = template.getTemplateSpans();
    for (const sp of spans) {
      const exprText = sp.getExpression().getText();

      // Skip sanitized expressions
      if (SANITIZER_CALL.test(exprText)) continue;
      if (/stripDelimiters|escapeDelimiters|cleanDelimiters/.test(exprText)) continue;

      // Is this user-controlled?
      const isUserControlled = USER_INPUT_PATTERNS.test(exprText) ||
        /^(question|userInput|userMessage|message|input|query|caption|instruction)\b/.test(exprText);

      if (isUserControlled) {
        findings.push(finding('delimiter-injection', 'warning', 'bug',
          `User input '${exprText.substring(0, 50)}' in delimiter-structured prompt without stripping — delimiter injection risk`,
          ctx.filePath, template.getStartLineNumber(),
          { suggestion: 'Strip or escape delimiters (```, ---, ###, XML tags) from user input before embedding in structured prompts' }));
        break;
      }
    }
  }

  return findings;
}

// ── Rule S21: unsanitized-history ────────────────────────────────────
// Chat history arrays where user messages aren't sanitized before LLM API.
// OWASP LLM01

function unsanitizedHistory(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fileText = ctx.sourceFile.getFullText();

  // Pattern A: Spread unsanitized message arrays into LLM API calls
  // e.g., llm.complete({ messages: [...userMessages] }) or messages: [system, ...rawHistory]
  if (LLM_API_PATTERNS.test(fileText)) {
    for (const spread of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.SpreadElement)) {
      const spreadVar = spread.getExpression().getText();
      // Is this spreading a messages/history-like variable?
      if (!/message|history|conversation|chat|userMessage/i.test(spreadVar)) continue;
      // Skip if sanitized
      if (SANITIZER_CALL.test(spreadVar)) continue;
      // Is this inside an array that feeds an LLM call?
      const parentArray = spread.getFirstAncestorByKind(SyntaxKind.ArrayLiteralExpression);
      if (!parentArray) continue;
      const fnBody = spread.getFirstAncestorByKind(SyntaxKind.Block);
      if (!fnBody) continue;
      if (!LLM_API_PATTERNS.test(fnBody.getText())) continue;

      findings.push(finding('unsanitized-history', 'warning', 'bug',
        `Unsanitized message array '${spreadVar.substring(0, 40)}' spread into LLM API call — conversation injection risk`,
        ctx.filePath, spread.getStartLineNumber(),
        { suggestion: 'Sanitize user messages before spreading into conversation history sent to LLM APIs' }));
    }
  }

  // Pattern B: messages.push({ role: "user", content: unsanitizedVar })
  if (!(/\.push\s*\(/.test(fileText) && /role.*user|user.*role/.test(fileText))) return findings;

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() !== 'push') continue;

    // Is this pushing to a messages-like array?
    const arrayName = pa.getExpression().getText();
    if (!/message|history|conversation|chat/i.test(arrayName)) continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const argText = args[0].getText();

    // Does it contain role: "user" and a content field?
    if (!/role\s*:\s*['"]user['"]/.test(argText)) continue;
    if (!/content\s*:/.test(argText)) continue;

    // Extract the content value
    const contentMatch = argText.match(/content\s*:\s*([^,}]+)/);
    if (!contentMatch) continue;
    const contentValue = contentMatch[1].trim();

    // Is it sanitized?
    if (SANITIZER_CALL.test(contentValue)) continue;

    // Is it a literal string? (safe)
    if (/^['"]/.test(contentValue)) continue;

    // Check if there's a nearby LLM API call in the same function
    const fnBody = call.getFirstAncestorByKind(SyntaxKind.Block);
    if (!fnBody) continue;
    if (!LLM_API_PATTERNS.test(fnBody.getText())) continue;

    findings.push(finding('unsanitized-history', 'warning', 'bug',
      `Unsanitized content '${contentValue.substring(0, 40)}' pushed to chat history '${arrayName}' — conversation injection risk`,
      ctx.filePath, call.getStartLineNumber(),
      { suggestion: 'Sanitize user messages before adding to conversation history sent to LLM APIs' }));
  }

  return findings;
}

// ── Rule S22: json-output-manipulation ───────────────────────────────
// JSON.parse on LLM output without schema validation.
// OWASP LLM02

function jsonOutputManipulation(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fileText = ctx.sourceFile.getFullText();

  if (!/JSON\.parse/.test(fileText)) return findings;

  // Collect LLM response variables
  const llmVars = new Set<string>();
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callText = call.getExpression().getText();
    if (!LLM_API_PATTERNS.test(callText)) continue;

    let parent = call.getParent();
    if (parent?.getKind() === SyntaxKind.AwaitExpression) parent = parent.getParent();
    if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
      llmVars.add((parent as import('ts-morph').VariableDeclaration).getName());
    }
  }
  // Only match LLM_RESPONSE_NAMES if file actually has LLM API calls (Fix 7)
  if (llmVars.size > 0) {
    for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      if (LLM_RESPONSE_NAMES.test(decl.getName())) llmVars.add(decl.getName());
    }
  }

  // Propagate: const raw = llmVar.text → raw is also tainted (Fix 6)
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer()?.getText() || '';
    for (const v of llmVars) {
      if (new RegExp(`\\b${escapeRegExp(v)}\\b`).test(init) && !llmVars.has(decl.getName())) {
        llmVars.add(decl.getName());
      }
    }
  }

  if (llmVars.size === 0) return findings;

  // Find JSON.parse calls on LLM output
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== 'JSON.parse') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const argText = args[0].getText();

    // Does the argument reference an LLM output variable (including property access)?
    let matchedVar = '';
    for (const v of llmVars) {
      if (new RegExp(`\\b${v}\\b`).test(argText)) { matchedVar = v; break; }
    }
    // Also check if argument contains LLM-like names directly
    if (!matchedVar && LLM_RESPONSE_NAMES.test(argText)) {
      matchedVar = argText.substring(0, 30);
    }
    if (!matchedVar) continue;

    // Find what variable the parsed result is assigned to
    let parsedVar = '';
    let parent = call.getParent();
    if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
      parsedVar = (parent as import('ts-morph').VariableDeclaration).getName();
    }

    // Check if schema validation follows THIS specific JSON.parse call
    const fnBody = call.getFirstAncestorByKind(SyntaxKind.Block);
    if (!fnBody) continue;
    // Use the call's position relative to the block, not indexOf (which finds the first occurrence)
    const callOffset = call.getStart() - fnBody.getStart();
    const bodyAfterParse = fnBody.getText().slice(callOffset);
    // Remove the JSON.parse call itself to avoid false positive on .parse()
    const bodyAfterParseCall = bodyAfterParse.replace(/JSON\.parse\s*\([^)]*\)/, '');

    // Only suppress if parsedVar is known AND validated — empty parsedVar means we can't
    // verify which variable is being validated, so don't assume validation
    const hasValidation = parsedVar !== '' &&
      VALIDATION_CALL.test(bodyAfterParseCall) &&
      new RegExp(`\\b${parsedVar}\\b`).test(bodyAfterParseCall);
    if (hasValidation) continue;

    findings.push(finding('json-output-manipulation', 'warning', 'bug',
      `JSON.parse on LLM output '${matchedVar}' without schema validation — output may contain injected keys`,
      ctx.filePath, call.getStartLineNumber(),
      { suggestion: 'Validate parsed LLM output with zod/joi/.parse() before using in application logic' }));
  }

  return findings;
}

// ── Rule S23: missing-output-validation ──────────────────────────────
// LLM API response used directly in application logic without validation.
// OWASP LLM02

function missingOutputValidation(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Collect LLM response variables and their declaration lines
  const llmVars = new Map<string, number>(); // varName → line
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callText = call.getExpression().getText();
    if (!LLM_API_PATTERNS.test(callText)) continue;

    let parent = call.getParent();
    if (parent?.getKind() === SyntaxKind.AwaitExpression) parent = parent.getParent();
    if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
      const decl = parent as import('ts-morph').VariableDeclaration;
      llmVars.set(decl.getName(), decl.getStartLineNumber());
    }
  }

  if (llmVars.size === 0) return findings;

  for (const [varName, declLine] of llmVars) {
    // Check if this variable is validated before use
    const fnBody = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Block).find(b =>
      b.getStartLineNumber() <= declLine && b.getEndLineNumber() >= declLine
    );
    if (!fnBody) continue;
    const bodyText = fnBody.getText();

    const ev = escapeRegExp(varName);

    // Is it used in control flow or as a return value?
    const condMatch = new RegExp(`if\\s*\\([^)]*\\b${ev}\\b`).exec(bodyText);
    const retMatch = new RegExp(`return\\s+[^;]*\\b${ev}\\b`).exec(bodyText);
    const argMatch = new RegExp(`\\w+\\s*\\([^)]*\\b${ev}\\b[^)]*\\)`).exec(bodyText);
    const usedInCondition = !!condMatch;
    const usedInReturn = !!retMatch;
    const usedAsArg = !!argMatch;

    // Find earliest usage position
    const usagePos = Math.min(
      condMatch?.index ?? Infinity,
      retMatch?.index ?? Infinity,
      argMatch?.index ?? Infinity
    );

    // Is there validation BEFORE the first unsafe use?
    const validationMatch = new RegExp(`\\w+Schema\\.parse\\s*\\(\\s*${ev}|validate\\w*\\s*\\(\\s*${ev}|\\.parse\\s*\\(\\s*${ev}\\s*\\)|\\.safeParse\\s*\\(\\s*${ev}\\s*\\)`).exec(bodyText);
    if (validationMatch && validationMatch.index < usagePos) continue;

    if (!usedInCondition && !usedInReturn && !usedAsArg) continue;

    findings.push(finding('missing-output-validation', 'warning', 'bug',
      `LLM response '${varName}' used in application logic without validation`,
      ctx.filePath, declLine,
      { suggestion: 'Validate LLM output with a schema before using in conditionals, returns, or function arguments' }));
  }

  return findings;
}

// ── Exported Security v4 Rules ────────────────────────────────────────

export const securityV4Rules = [
  indirectPromptInjection,
  llmOutputExecution,
  systemPromptLeakage,
  ragPoisoning,
  toolCallingManipulation,
  encodingBypass,
  delimiterInjection,
  unsanitizedHistory,
  jsonOutputManipulation,
  missingOutputValidation,
];
