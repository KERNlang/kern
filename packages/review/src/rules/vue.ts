/**
 * Vue review rules — active when target = vue | nuxt.
 *
 * Catches Vue 3 Composition API pitfalls.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import { finding } from './utils.js';

// ── Rule 17: missing-ref-value ───────────────────────────────────────────
// Using ref() result without .value in script setup

function missingRefValue(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const refVarNames = new Map<string, number>();

  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init && Node.isCallExpression(init)) {
        const calleeName = init.getExpression().getText();
        if (calleeName === 'ref') {
          refVarNames.set(decl.getName(), stmt.getStartLineNumber());
        }
      }
    }
  }

  if (refVarNames.size === 0) return findings;

  for (const ident of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = ident.getText();
    if (!refVarNames.has(name)) continue;
    if (ident.getStartLineNumber() === refVarNames.get(name)) continue;

    const parent = ident.getParent();
    if (!parent) continue;

    if (Node.isPropertyAccessExpression(parent)) {
      if (parent.getExpression() === ident && parent.getName() === 'value') continue;
    }

    if (Node.isCallExpression(parent)) continue;
    const grandparent = parent.getParent();
    if (grandparent && Node.isCallExpression(grandparent)) continue;
    if (Node.isTypeReference(parent) || Node.isTypeQuery(parent)) continue;
    if (Node.isShorthandPropertyAssignment(parent)) continue;
    if (Node.isImportSpecifier(parent) || Node.isVariableDeclaration(parent)) continue;

    if (
      Node.isBinaryExpression(parent) ||
      Node.isConditionalExpression(parent) ||
      Node.isTemplateSpan(parent) ||
      Node.isReturnStatement(parent) ||
      Node.isElementAccessExpression(parent)
    ) {
      findings.push(
        finding(
          'missing-ref-value',
          'warning',
          'bug',
          `'${name}' is a ref — did you mean '${name}.value'?`,
          ctx.filePath,
          ident.getStartLineNumber(),
          1,
          { suggestion: `${name}.value` },
        ),
      );
      refVarNames.delete(name);
    }
  }

  return findings;
}

// ── Rule 18: missing-onUnmounted ─────────────────────────────────────────
// watch/watchEffect/addEventListener without cleanup in onUnmounted

const WATCH_FUNCTIONS = new Set(['watch', 'watchEffect', 'watchSyncEffect', 'watchPostEffect']);

function missingOnUnmounted(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  let hasLifecycleCleanup = false;
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee === 'onUnmounted' || callee === 'onBeforeUnmount') {
      hasLifecycleCleanup = true;
      break;
    }
  }

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (!WATCH_FUNCTIONS.has(callee)) continue;

    const parent = call.getParent();
    const hasStopHandle = Node.isVariableDeclaration(parent);

    if (!hasStopHandle && !hasLifecycleCleanup) {
      findings.push(
        finding(
          'missing-onUnmounted',
          'error',
          'bug',
          `${callee}() without stop handle or onUnmounted cleanup — potential memory leak`,
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          { suggestion: `Assign ${callee} to a variable and call stop() in onUnmounted` },
        ),
      );
    }
  }

  let hasRemoveListener = false;
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (Node.isPropertyAccessExpression(callee) && callee.getName() === 'removeEventListener') {
      hasRemoveListener = true;
      break;
    }
  }

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!Node.isPropertyAccessExpression(callee) || callee.getName() !== 'addEventListener') continue;

    if (!hasRemoveListener && !hasLifecycleCleanup) {
      findings.push(
        finding(
          'missing-onUnmounted',
          'error',
          'bug',
          'addEventListener without removeEventListener in onUnmounted — memory leak',
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          { suggestion: 'Clean up event listeners in onUnmounted()' },
        ),
      );
    }
  }

  return findings;
}

// ── Rule 19: setup-side-effect ───────────────────────────────────────────
// Top-level await in setup without onMounted wrapper (SSR safety)

function setupSideEffect(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  const isVueFile = ctx.filePath.endsWith('.vue') || fullText.includes('defineComponent');
  if (!isVueFile) return findings;

  const hasOnMounted = ctx.sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((c) => Node.isIdentifier(c.getExpression()) && c.getExpression().getText() === 'onMounted');

  if (hasOnMounted) return findings;

  for (const awaitExpr of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.AwaitExpression)) {
    let isInsideFunction = false;
    let cur: import('ts-morph').Node | undefined = awaitExpr.getParent();
    while (cur && cur !== ctx.sourceFile) {
      if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur) || Node.isFunctionDeclaration(cur)) {
        isInsideFunction = true;
        break;
      }
      // MethodDeclaration with name 'setup' counts as top-level setup scope
      if (Node.isMethodDeclaration(cur) && cur.getName() === 'setup') break;
      cur = cur.getParent();
    }
    if (isInsideFunction) continue;

    findings.push(
      finding(
        'setup-side-effect',
        'warning',
        'pattern',
        'Top-level await in setup — consider wrapping in onMounted() for SSR compatibility',
        ctx.filePath,
        awaitExpr.getStartLineNumber(),
        1,
        { suggestion: 'onMounted(async () => { ... })' },
      ),
    );
  }

  return findings;
}

// ── Rule 20: reactive-destructure ────────────────────────────────────────
// Destructuring reactive() loses reactivity

function reactiveDestructure(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) continue;

    const init = decl.getInitializer();
    if (init && Node.isCallExpression(init)) {
      const callee = init.getExpression().getText();
      if (callee === 'reactive') {
        findings.push(
          finding(
            'reactive-destructure',
            'warning',
            'bug',
            'Destructuring reactive() loses reactivity — use toRefs() or access properties directly',
            ctx.filePath,
            decl.getStartLineNumber(),
            1,
            { suggestion: 'const state = reactive({...}); use state.prop, or const { prop } = toRefs(state)' },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule: computed-side-effect ───────────────────────────────────────────
// Side effects inside computed() properties

function computedSideEffect(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== 'computed') continue;

    const args = call.getArguments();
    if (args.length === 0) continue;
    const getter = args[0];
    if (!Node.isArrowFunction(getter) && !Node.isFunctionExpression(getter)) continue;

    // Detect side-effect calls: fetch, axios.*, set* (state setters)
    const sideEffectCalls = getter.getDescendantsOfKind(SyntaxKind.CallExpression).filter((c) => {
      const name = c.getExpression().getText();
      return name === 'fetch' || name.startsWith('axios.');
    });

    // Detect mutations: assignments (=, +=, -=, etc.) and ++/--
    const mutations = getter.getDescendantsOfKind(SyntaxKind.BinaryExpression).filter((b) => {
      const op = b.getOperatorToken().getKind();
      return op === SyntaxKind.EqualsToken || op === SyntaxKind.PlusEqualsToken || op === SyntaxKind.MinusEqualsToken;
    });
    const prefixMutations = getter.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression).filter((p) => {
      const op = p.getOperatorToken();
      return op === SyntaxKind.PlusPlusToken || op === SyntaxKind.MinusMinusToken;
    });
    const postfixMutations = getter.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression).filter((p) => {
      const op = p.getOperatorToken();
      return op === SyntaxKind.PlusPlusToken || op === SyntaxKind.MinusMinusToken;
    });

    if (
      sideEffectCalls.length > 0 ||
      mutations.length > 0 ||
      prefixMutations.length > 0 ||
      postfixMutations.length > 0
    ) {
      findings.push(
        finding(
          'computed-side-effect',
          'warning',
          'bug',
          'Side effect detected inside computed property — computed should be pure',
          ctx.filePath,
          call.getStartLineNumber(),
          1,
          { suggestion: 'Move side effects to watch() or a method' },
        ),
      );
    }
  }

  return findings;
}

// ── Rule: shallow-ref-mutation ───────────────────────────────────────────
// Deep mutation on shallowRef without triggerRef — change won't be reactive
// Source: vuejs.org/api/reactivity-advanced.html#shallowref

function shallowRefMutation(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Collect shallowRef variable names
  const shallowRefs = new Set<string>();
  for (const decl of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (init && Node.isCallExpression(init) && init.getExpression().getText() === 'shallowRef') {
      shallowRefs.add(decl.getName());
    }
  }

  if (shallowRefs.size === 0) return findings;

  // Collect which shallowRefs have matching triggerRef(refName) calls
  const triggeredRefs = new Set<string>();
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== 'triggerRef') continue;
    const args = call.getArguments();
    if (args.length > 0 && Node.isIdentifier(args[0])) {
      triggeredRefs.add(args[0].getText());
    }
  }

  // Find deep property access: state.value.prop = ... (not state.value = ...)
  for (const bin of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const op = bin.getOperatorToken().getKind();
    if (op !== SyntaxKind.EqualsToken && op !== SyntaxKind.PlusEqualsToken && op !== SyntaxKind.MinusEqualsToken)
      continue;

    const left = bin.getLeft();
    if (!Node.isPropertyAccessExpression(left)) continue;

    // Check for pattern: shallowRef.value.deepProp = ...
    const obj = left.getExpression();
    if (!Node.isPropertyAccessExpression(obj)) continue;
    if (obj.getName() !== 'value') continue;

    const root = obj.getExpression();
    if (!Node.isIdentifier(root) || !shallowRefs.has(root.getText())) continue;
    const refName = root.getText();

    // Only suppress if triggerRef is called on THIS specific ref
    if (!triggeredRefs.has(refName)) {
      findings.push(
        finding(
          'shallow-ref-mutation',
          'warning',
          'bug',
          `Deep mutation on shallowRef '${refName}' won't trigger reactivity — use triggerRef() or reassign .value`,
          ctx.filePath,
          bin.getStartLineNumber(),
          1,
          {
            suggestion: `Use ${refName}.value = { ...${refName}.value, ${left.getName()}: newVal } or call triggerRef(${refName})`,
          },
        ),
      );
    }
  }

  return findings;
}

// ── Exported Vue Rules ───────────────────────────────────────────────────

export const vueRules = [
  missingRefValue,
  missingOnUnmounted,
  setupSideEffect,
  reactiveDestructure,
  computedSideEffect,
  shallowRefMutation,
];
