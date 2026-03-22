/**
 * Vue review rules — active when target = vue | nuxt.
 *
 * Catches Vue 3 Composition API pitfalls.
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

// ── Rule 17: missing-ref-value ───────────────────────────────────────────
// Using ref() result without .value in script setup

function missingRefValue(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // AST-based: find ref() declarations via variable statements
  const refVarNames = new Map<string, number>(); // name → declaration line

  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;

      // Match ref() or ref<T>() calls
      if (init.getKind() === SyntaxKind.CallExpression) {
        const call = init as import('ts-morph').CallExpression;
        const calleeName = call.getExpression().getText();
        if (calleeName === 'ref') {
          refVarNames.set(decl.getName(), stmt.getStartLineNumber());
        }
      }
    }
  }

  if (refVarNames.size === 0) return findings;

  // Walk all identifiers and check if ref vars are used without .value
  for (const ident of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = ident.getText();
    if (!refVarNames.has(name)) continue;

    // Skip the declaration itself
    if (ident.getStartLineNumber() === refVarNames.get(name)) continue;

    const parent = ident.getParent();
    if (!parent) continue;

    // If parent is PropertyAccessExpression and ident is the object, check if accessing .value
    if (parent.getKind() === SyntaxKind.PropertyAccessExpression) {
      const propAccess = parent as import('ts-morph').PropertyAccessExpression;
      if (propAccess.getExpression() === ident) {
        if (propAccess.getName() === 'value') continue; // correct: ref.value
        // Accessing some other property on ref without .value — still a bug
      }
    }

    // Skip if ref is passed as a function argument (intentional: watch(myRef), toRef(myRef))
    if (parent.getKind() === SyntaxKind.CallExpression) continue;
    // Also skip if it's an argument in a call's argument list
    const grandparent = parent.getParent();
    if (grandparent?.getKind() === SyntaxKind.CallExpression) continue;

    // Skip type contexts
    if (parent.getKind() === SyntaxKind.TypeReference) continue;
    if (parent.getKind() === SyntaxKind.TypeQuery) continue;

    // Skip shorthand property assignments: { count } in object literals
    if (parent.getKind() === SyntaxKind.ShorthandPropertyAssignment) continue;

    // Skip imports and variable declarations
    if (parent.getKind() === SyntaxKind.ImportSpecifier) continue;
    if (parent.getKind() === SyntaxKind.VariableDeclaration) continue;

    // Likely a bug: ref used in expression context without .value
    if (parent.getKind() === SyntaxKind.BinaryExpression ||
        parent.getKind() === SyntaxKind.ConditionalExpression ||
        parent.getKind() === SyntaxKind.TemplateSpan ||
        parent.getKind() === SyntaxKind.ReturnStatement ||
        parent.getKind() === SyntaxKind.ElementAccessExpression) {
      findings.push(finding('missing-ref-value', 'warning', 'bug',
        `'${name}' is a ref — did you mean '${name}.value'?`,
        ctx.filePath, ident.getStartLineNumber(),
        { suggestion: `${name}.value` }));
      // One finding per ref variable to avoid noise
      refVarNames.delete(name);
    }
  }

  return findings;
}

// ── Rule 18: missing-onUnmounted ─────────────────────────────────────────
// watch/addEventListener without cleanup in onUnmounted

function missingOnUnmounted(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // AST pre-check: find onUnmounted/onBeforeUnmount CallExpressions
  let hasLifecycleCleanup = false;
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() === SyntaxKind.Identifier) {
      const name = callee.getText();
      if (name === 'onUnmounted' || name === 'onBeforeUnmount') {
        hasLifecycleCleanup = true;
        break;
      }
    }
  }

  // Check for watch() calls via AST
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.Identifier || callee.getText() !== 'watch') continue;

    // Check if parent is VariableDeclaration (stop handle assigned)
    const parent = call.getParent();
    const hasStopHandle = parent?.getKind() === SyntaxKind.VariableDeclaration;

    if (!hasStopHandle && !hasLifecycleCleanup) {
      findings.push(finding('missing-onUnmounted', 'error', 'bug',
        'watch() without stop handle or onUnmounted cleanup — potential memory leak',
        ctx.filePath, call.getStartLineNumber(),
        { suggestion: 'Assign watch to a variable and call stop() in onUnmounted, or use watchEffect (auto-stops)' }));
    }
  }

  // Check for addEventListener via AST
  let hasRemoveListener = false;
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      const pa = callee as import('ts-morph').PropertyAccessExpression;
      if (pa.getName() === 'removeEventListener') {
        hasRemoveListener = true;
        break;
      }
    }
  }

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (pa.getName() !== 'addEventListener') continue;

    if (!hasRemoveListener && !hasLifecycleCleanup) {
      findings.push(finding('missing-onUnmounted', 'error', 'bug',
        'addEventListener without removeEventListener in onUnmounted — memory leak',
        ctx.filePath, call.getStartLineNumber(),
        { suggestion: 'Clean up event listeners in onUnmounted()' }));
    }
  }

  return findings;
}

// ── Rule 19: setup-side-effect ───────────────────────────────────────────
// Async call in setup() without onMounted wrapper

function setupSideEffect(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  // Detect <script setup> or setup() function
  const isScriptSetup = fullText.includes('<script setup') || fullText.includes('defineComponent');

  if (!isScriptSetup) return findings;

  // Check for top-level await without onMounted
  const hasOnMounted = fullText.includes('onMounted');
  const awaitRegex = /(?:^|\n)[ \t]{0,20}(?:(?:const|let|var) \w+ ?= ?)?await /g;
  let match;

  while ((match = awaitRegex.exec(fullText)) !== null) {
    const line = fullText.substring(0, match.index).split('\n').length;
    // Skip if inside a function body
    const lineText = fullText.split('\n')[line - 1] || '';
    if (lineText.trim().startsWith('//') || lineText.trim().startsWith('*')) continue;

    if (!hasOnMounted) {
      findings.push(finding('setup-side-effect', 'warning', 'pattern',
        'Top-level await in setup — consider wrapping in onMounted() for SSR compatibility',
        ctx.filePath, line,
        { suggestion: 'onMounted(async () => { ... })' }));
    }
  }

  return findings;
}

// ── Rule 20: reactive-destructure ────────────────────────────────────────
// Destructuring reactive() loses reactivity

function reactiveDestructure(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  // Find const { ... } = reactive(...)
  const destructRegex = /(?:const|let)\s*\{[^}]+\}\s*=\s*reactive\s*\(/g;
  let match;

  while ((match = destructRegex.exec(fullText)) !== null) {
    const line = fullText.substring(0, match.index).split('\n').length;
    findings.push(finding('reactive-destructure', 'warning', 'bug',
      'Destructuring reactive() loses reactivity — use toRefs() or access properties directly',
      ctx.filePath, line,
      { suggestion: 'const state = reactive({...}); use state.prop, or const { prop } = toRefs(state)' }));
  }

  return findings;
}

// ── Exported Vue Rules ───────────────────────────────────────────────────

export const vueRules = [
  missingRefValue,
  missingOnUnmounted,
  setupSideEffect,
  reactiveDestructure,
];
