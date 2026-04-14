/**
 * Base review rules — always active, universal TS/KERN rules.
 *
 * These rules leverage the KERN IR for structural analysis.
 * AST-level rules that duplicate ESLint are excluded.
 */

import { countTokens } from '@kernlang/core';
import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, RuleContext } from '../types.js';
import {
  cleanupExpressionMatches,
  escapeRegex,
  findAssignedIdentifier,
  finding,
  getTopLevelCleanupExpressions,
  span,
} from './utils.js';

// ── Rule 1: floating-promise ─────────────────────────────────────────────
// fn body with call returning Promise but no await/void/return

function floatingPromise(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Collect known async function names from inferred results
  const asyncFns = new Set<string>();
  for (const r of ctx.inferred) {
    if (r.node.type === 'fn' && r.node.props?.async === 'true') {
      asyncFns.add(r.node.props.name as string);
    }
  }

  // Walk expression statements — standalone calls whose return value is discarded.
  // This is AST-based: it won't match .then() in strings, comments, or regex patterns.
  for (const exprStmt of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ExpressionStatement)) {
    const expr = exprStmt.getExpression();

    // Skip void/await wrappers (intentional discard)
    if (expr.getKind() === SyntaxKind.VoidExpression) continue;
    if (expr.getKind() === SyntaxKind.AwaitExpression) continue;
    if (expr.getKind() !== SyntaxKind.CallExpression) continue;

    const callExpr = expr as import('ts-morph').CallExpression;
    const calleeExpr = callExpr.getExpression();

    // Case 1: .then() chain — somePromise.then(...)
    if (calleeExpr.getKind() === SyntaxKind.PropertyAccessExpression) {
      const propAccess = calleeExpr as import('ts-morph').PropertyAccessExpression;
      if (propAccess.getName() === 'then') {
        const objText = propAccess.getExpression().getText();
        const thenLine = exprStmt.getStartLineNumber();
        const lastNlThen = ctx.sourceFile.getFullText().lastIndexOf('\n', exprStmt.getStart());
        const thenCol = lastNlThen === -1 ? exprStmt.getStart() + 1 : exprStmt.getStart() - lastNlThen;
        findings.push(
          finding(
            'floating-promise',
            'error',
            'bug',
            `Promise chain '${objText}.then(...)' is not awaited, returned, or voided`,
            ctx.filePath,
            thenLine,
            1,
            {
              autofix: {
                type: 'insert-before',
                span: span(ctx.filePath, thenLine, thenCol),
                replacement: 'await ',
                description: 'Add await to handle the promise',
              },
            },
          ),
        );
        continue;
      }
    }

    // Case 2: Direct call to known async function — asyncFn()
    if (calleeExpr.getKind() === SyntaxKind.Identifier) {
      const fnName = calleeExpr.getText();
      if (asyncFns.has(fnName)) {
        const matchingNode = ctx.inferred.find((r) => r.node.type === 'fn' && r.node.props?.name === fnName);
        const nodeRef = matchingNode != null ? { nodeIds: [matchingNode.nodeId] } : undefined;
        const asyncLine = exprStmt.getStartLineNumber();
        const lastNlAsync = ctx.sourceFile.getFullText().lastIndexOf('\n', exprStmt.getStart());
        const asyncCol = lastNlAsync === -1 ? exprStmt.getStart() + 1 : exprStmt.getStart() - lastNlAsync;
        findings.push(
          finding(
            'floating-promise',
            'error',
            'bug',
            `Async function '${fnName}()' called without await — floating promise`,
            ctx.filePath,
            asyncLine,
            1,
            {
              ...nodeRef,
              autofix: {
                type: 'insert-before',
                span: span(ctx.filePath, asyncLine, asyncCol),
                replacement: 'await ',
                description: `Add await before ${fnName}()`,
              },
            },
          ),
        );
        continue;
      }
    }

    // Case 3: TypeChecker — any call returning Promise<T> (catches fetch, imported async fns)
    if (ctx.project) {
      try {
        const returnType = callExpr.getReturnType();
        const typeText = returnType.getText();
        if (typeText.startsWith('Promise<') || typeText === 'Promise') {
          const callText = calleeExpr.getText().substring(0, 40);
          const promiseLine = exprStmt.getStartLineNumber();
          const lastNlPromise = ctx.sourceFile.getFullText().lastIndexOf('\n', exprStmt.getStart());
          const promiseCol = lastNlPromise === -1 ? exprStmt.getStart() + 1 : exprStmt.getStart() - lastNlPromise;
          findings.push(
            finding(
              'floating-promise',
              'error',
              'bug',
              `Call '${callText}(...)' returns Promise but is not awaited, returned, or voided`,
              ctx.filePath,
              promiseLine,
              1,
              {
                autofix: {
                  type: 'insert-before',
                  span: span(ctx.filePath, promiseLine, promiseCol),
                  replacement: 'await ',
                  description: `Add await before ${callText}()`,
                },
              },
            ),
          );
        }
      } catch {
        // TypeChecker may fail on some expressions — skip gracefully
      }
    }
  }

  return findings;
}

// ── Rule 2: state-mutation ───────────────────────────────────────────────
// Direct mutation of state variables (push, splice, delete, assignment to .prop)

function stateMutation(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const mutationMethods = new Set([
    'push',
    'splice',
    'pop',
    'shift',
    'unshift',
    'sort',
    'reverse',
    'fill',
    'copyWithin',
  ]);
  const stateNames = new Set(['state', 'store', 'data']);

  // AST-based: find mutation method calls on state-like objects
  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;

    const propAccess = callee as import('ts-morph').PropertyAccessExpression;
    const methodName = propAccess.getName();
    if (!mutationMethods.has(methodName)) continue;

    // Check if the root object is state-like
    const objText = propAccess.getExpression().getText();
    const rootObj = objText.split('.')[0];
    if (!stateNames.has(rootObj)) continue;

    // Skip if inside zustand set() or immer produce()
    if (isInsideCall(call, 'set') || isInsideCall(call, 'produce')) continue;

    findings.push(
      finding(
        'state-mutation',
        'error',
        'bug',
        `Direct state mutation via .${methodName}() on '${objText}' — use immutable update`,
        ctx.filePath,
        call.getStartLineNumber(),
      ),
    );
  }

  // AST-based: find delete expressions on state-like objects
  for (const del of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.DeleteExpression)) {
    const operand = del.getExpression().getText();
    const rootObj = operand.split('.')[0];
    if (!stateNames.has(rootObj)) continue;
    if (isInsideCall(del, 'set') || isInsideCall(del, 'produce')) continue;

    findings.push(
      finding(
        'state-mutation',
        'error',
        'bug',
        `Direct state mutation via delete on '${operand}' — use immutable update`,
        ctx.filePath,
        del.getStartLineNumber(),
      ),
    );
  }

  return findings;
}

/** Check if a node is inside a specific function call (e.g., set(), produce()) */
function isInsideCall(node: import('ts-morph').Node, callName: string): boolean {
  let parent = node.getParent();
  while (parent) {
    if (parent.getKind() === SyntaxKind.CallExpression) {
      const callExpr = parent as import('ts-morph').CallExpression;
      const callee = callExpr.getExpression();
      const text = callee.getText();
      if (text === callName || text.endsWith(`.${callName}`)) return true;
    }
    parent = parent.getParent();
  }
  return false;
}

// ── Rule 3: empty-catch ──────────────────────────────────────────────────
// Catch block that swallows exceptions silently

function emptyCatch(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const stmt of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const block = stmt.getBlock();
    const stmts = block.getStatements();
    if (stmts.length === 0) {
      const blockText = block.getText();
      if (/\/[/*]\s*(Intentional|Expected|@suppress|eslint-disable)/.test(blockText)) continue;
      const line = stmt.getStartLineNumber();
      // Build autofix: insert console.error into empty catch block
      const catchParam = stmt.getVariableDeclaration()?.getName() || 'error';
      const blockStartLine = block.getStartLineNumber();
      const _blockStartCol = block.getStart() - ctx.sourceFile.getFullText().lastIndexOf('\n', block.getStart()) || 1;
      findings.push(
        finding(
          'empty-catch',
          'warning',
          'bug',
          'Empty catch block swallows exception — at minimum log or rethrow',
          ctx.filePath,
          line,
          1,
          {
            autofix: {
              type: 'insert-after',
              span: span(ctx.filePath, blockStartLine, 1),
              replacement: `    console.error(${catchParam});`,
              description: `Log caught ${catchParam} to console`,
            },
          },
        ),
      );
    }
  }

  return findings;
}

// ── Rule 4: machine-gap ─────────────────────────────────────────────────
// Unreachable states + missing transitions in machine nodes

function machineGap(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const machines = ctx.inferred.filter((r) => r.node.type === 'machine');

  for (const m of machines) {
    const states = (m.node.children || []).filter((c) => c.type === 'state');
    const transitions = (m.node.children || []).filter((c) => c.type === 'transition');
    const stateNames = new Set(states.map((s) => (s.props?.name || s.props?.value) as string));

    if (stateNames.size === 0) continue;

    // Check: states that can never be reached (no transition leads to them)
    const initialState = states.find((s) => s.props?.initial === 'true');
    const reachable = new Set<string>();
    if (initialState) reachable.add((initialState.props?.name || initialState.props?.value) as string);

    for (const t of transitions) {
      const to = t.props?.to as string;
      if (to) reachable.add(to);
    }

    for (const name of stateNames) {
      if (!reachable.has(name)) {
        findings.push(
          finding(
            'machine-gap',
            'warning',
            'structure',
            `State '${name}' in machine '${m.node.props?.name}' has no transition leading to it — unreachable`,
            ctx.filePath,
            m.startLine,
            1,
            { nodeIds: [m.nodeId] },
          ),
        );
      }
    }

    // Check: terminal states (no transitions FROM them) that aren't clearly final
    const hasTransitionFrom = new Set<string>();
    for (const t of transitions) {
      const from = t.props?.from as string;
      if (from) {
        for (const f of from.split('|')) hasTransitionFrom.add(f.trim());
      }
    }

    const terminalStates = [...stateNames].filter((s) => !hasTransitionFrom.has(s));
    const clearlyFinal = ['completed', 'done', 'failed', 'cancelled', 'error', 'success', 'closed', 'terminated'];
    for (const ts of terminalStates) {
      if (!clearlyFinal.some((f) => ts.toLowerCase().includes(f))) {
        findings.push(
          finding(
            'machine-gap',
            'warning',
            'structure',
            `State '${ts}' in machine '${m.node.props?.name}' has no outgoing transitions — dead end?`,
            ctx.filePath,
            m.startLine,
            1,
            { nodeIds: [m.nodeId] },
          ),
        );
      }
    }

    // Check: transition references non-existent state
    for (const t of transitions) {
      const from = t.props?.from as string;
      const to = t.props?.to as string;
      if (from) {
        for (const f of from.split('|')) {
          if (f.trim() && !stateNames.has(f.trim())) {
            findings.push(
              finding(
                'machine-gap',
                'error',
                'bug',
                `Transition '${t.props?.name}' references unknown state '${f.trim()}'`,
                ctx.filePath,
                m.startLine,
                1,
                { nodeIds: [m.nodeId] },
              ),
            );
          }
        }
      }
      if (to && !stateNames.has(to)) {
        findings.push(
          finding(
            'machine-gap',
            'error',
            'bug',
            `Transition '${t.props?.name}' targets unknown state '${to}'`,
            ctx.filePath,
            m.startLine,
            1,
            { nodeIds: [m.nodeId] },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule 5: config-default-mismatch ──────────────────────────────────────
// Config interface fields vs DEFAULT_X const keys

function configDefaultMismatch(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const configs = ctx.inferred.filter((r) => r.node.type === 'config');

  for (const cfg of configs) {
    const fields = (cfg.node.children || [])
      .filter((c) => c.type === 'field')
      .map((c) => c.props?.name as string)
      .filter(Boolean);

    if (fields.length === 0) continue;

    // Find the DEFAULT_X constant via AST VariableDeclaration
    const configName = cfg.node.props?.name as string;
    const upperName = configName.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();

    let defaultKeys: Set<string> | null = null;

    for (const stmt of ctx.sourceFile.getVariableStatements()) {
      for (const decl of stmt.getDeclarations()) {
        const declName = decl.getName();
        if (declName !== `DEFAULT_${upperName}` && declName !== `default${configName}`) continue;

        const init = decl.getInitializer();
        if (!init || init.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;

        const objLiteral = init as import('ts-morph').ObjectLiteralExpression;
        defaultKeys = new Set<string>();

        for (const prop of objLiteral.getProperties()) {
          if (prop.getKind() === SyntaxKind.PropertyAssignment) {
            const pa = prop as import('ts-morph').PropertyAssignment;
            defaultKeys.add(pa.getName());
          } else if (prop.getKind() === SyntaxKind.ShorthandPropertyAssignment) {
            const spa = prop as import('ts-morph').ShorthandPropertyAssignment;
            defaultKeys.add(spa.getName());
          }
        }
        break;
      }
      if (defaultKeys) break;
    }

    if (!defaultKeys) continue;

    // Fields in interface but not in defaults
    for (const field of fields) {
      if (!defaultKeys.has(field)) {
        findings.push(
          finding(
            'config-default-mismatch',
            'warning',
            'pattern',
            `Config field '${field}' in ${configName} has no default value`,
            ctx.filePath,
            cfg.startLine,
            1,
            { nodeIds: [cfg.nodeId] },
          ),
        );
      }
    }

    // Keys in defaults but not in interface
    for (const key of defaultKeys) {
      if (!fields.includes(key)) {
        findings.push(
          finding(
            'config-default-mismatch',
            'warning',
            'pattern',
            `Default key '${key}' not defined in ${configName} interface`,
            ctx.filePath,
            cfg.startLine,
            1,
            { nodeIds: [cfg.nodeId] },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule 6: event-map-mismatch ───────────────────────────────────────────
// EventType values vs EventMap keys

function eventMapMismatch(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const events = ctx.inferred.filter((r) => r.node.type === 'event');

  for (const evt of events) {
    const eventValues = (evt.node.children || [])
      .filter((c) => c.type === 'type')
      .map((c) => (c.props?.value || c.props?.name) as string)
      .filter(Boolean);

    if (eventValues.length === 0) continue;

    // Look for matching EventMap interface
    const baseName = evt.node.props?.name as string;
    const eventMap = ctx.inferred.find((r) => r.node.type === 'interface' && r.node.props?.name === `${baseName}Map`);

    if (!eventMap) continue;

    const mapKeys = (eventMap.node.children || [])
      .filter((c) => c.type === 'field')
      .map((c) => c.props?.name as string)
      .filter(Boolean);

    // Events not in map
    for (const val of eventValues) {
      if (!mapKeys.includes(val)) {
        findings.push(
          finding(
            'event-map-mismatch',
            'warning',
            'pattern',
            `Event type '${val}' has no handler in ${baseName}Map`,
            ctx.filePath,
            evt.startLine,
            1,
            { nodeIds: [evt.nodeId, eventMap.nodeId] },
          ),
        );
      }
    }

    // Map keys not in events
    for (const key of mapKeys) {
      if (!eventValues.includes(key)) {
        findings.push(
          finding(
            'event-map-mismatch',
            'warning',
            'pattern',
            `Handler '${key}' in ${baseName}Map has no matching event type`,
            ctx.filePath,
            evt.startLine,
            1,
            { nodeIds: [evt.nodeId, eventMap.nodeId] },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule 7: non-exhaustive-switch ────────────────────────────────────────
// Switch over union/machine state that misses cases

function nonExhaustiveSwitch(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  // Collect known union types from inferred results
  const unionTypes = new Map<string, string[]>();
  for (const r of ctx.inferred) {
    if (r.node.type === 'type' && r.node.props?.values) {
      const name = r.node.props.name as string;
      const values = (r.node.props.values as string).split('|');
      unionTypes.set(name, values);
    }
    if (r.node.type === 'machine') {
      const name = `${r.node.props?.name as string}State`;
      const states = (r.node.children || [])
        .filter((c) => c.type === 'state')
        .map((c) => (c.props?.name || c.props?.value) as string);
      if (states.length > 0) unionTypes.set(name, states);
    }
  }

  if (unionTypes.size === 0) return findings;

  // Find switch statements
  for (const switchStmt of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.SwitchStatement)) {
    const expr = switchStmt.getExpression().getText();
    const line = switchStmt.getStartLineNumber();

    // Try to match switch expression to a known type
    // e.g., switch (state) where state: PlanState
    const cases = switchStmt.getCaseBlock().getClauses();
    const caseValues = new Set<string>();
    let hasDefault = false;

    for (const clause of cases) {
      if (clause.getKind() === SyntaxKind.DefaultClause) {
        hasDefault = true;
        continue;
      }
      // CaseClause has getExpression(), DefaultClause does not
      if (clause.getKind() === SyntaxKind.CaseClause) {
        const caseClause = clause as import('ts-morph').CaseClause;
        const caseExpr = caseClause.getExpression()?.getText() || '';
        const val = caseExpr.replace(/['"]/g, '');
        if (val) caseValues.add(val);
      }
    }

    if (hasDefault) continue; // default clause covers missing cases

    // Check each union type to see if this switch might be over it
    for (const [typeName, values] of unionTypes) {
      // Heuristic: if >50% of values match cases, it's likely a switch over this type
      const matchCount = values.filter((v) => caseValues.has(v)).length;
      if (matchCount < values.length * 0.5 || matchCount < 2) continue;

      const missing = values.filter((v) => !caseValues.has(v));
      if (missing.length > 0) {
        findings.push(
          finding(
            'non-exhaustive-switch',
            'warning',
            'pattern',
            `Switch on ${expr} appears to cover ${typeName} but misses: ${missing.map((m) => `'${m}'`).join(', ')}`,
            ctx.filePath,
            line,
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule 8: cognitive-complexity ─────────────────────────────────────────
// Sonar-compatible cognitive complexity metric (S3776)
//
// Codex review fixes applied:
// - Nested functions scored independently (not leaked into parent)
// - else if handled as flat chain (+1 only), not nested
// - .then()/.catch() not counted (callbacks are separate functions)
// - ?? included alongside && and ||
// - Recursion via text match (good enough for single-file scope)

const NESTING_STRUCTURES = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
]);

const NESTED_FUNCTION_KINDS = new Set([
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionExpression,
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration,
]);

const LOGICAL_OPS = new Set([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);

function calculateCognitiveComplexity(body: import('ts-morph').Node, fnName?: string): number {
  let complexity = 0;

  function walk(n: import('ts-morph').Node, nesting: number) {
    const kind = n.getKind();

    // Stop at nested function boundaries — they are scored independently
    if (NESTED_FUNCTION_KINDS.has(kind) && n !== body && n.getParent() !== body.getParent()) {
      return;
    }

    // Handle if/else-if/else chains specially
    if (kind === SyntaxKind.IfStatement) {
      const ifStmt = n as import('ts-morph').IfStatement;

      // +1 + nesting for the if itself
      complexity += 1 + nesting;

      // Walk the then-block at nesting+1
      const thenStmt = ifStmt.getThenStatement();
      thenStmt.forEachChild((child) => walk(child, nesting + 1));

      // Handle else / else-if
      const elseStmt = ifStmt.getElseStatement();
      if (elseStmt) {
        if (elseStmt.getKind() === SyntaxKind.IfStatement) {
          // else if: +1 only (flat chain, no nesting increment)
          complexity += 1;
          const elseIf = elseStmt as import('ts-morph').IfStatement;
          const elseThen = elseIf.getThenStatement();
          elseThen.forEachChild((child) => walk(child, nesting + 1));
          // Continue the chain
          const nextElse = elseIf.getElseStatement();
          if (nextElse) {
            if (nextElse.getKind() === SyntaxKind.IfStatement) {
              // Recurse for further else-if
              walk(nextElse, nesting);
            } else {
              // plain else at end of chain
              complexity += 1;
              nextElse.forEachChild((child) => walk(child, nesting + 1));
            }
          }
        } else {
          // plain else: +1 only
          complexity += 1;
          elseStmt.forEachChild((child) => walk(child, nesting + 1));
        }
      }
      return;
    }

    // Other nesting structures: +1 + nesting, increase depth
    if (NESTING_STRUCTURES.has(kind)) {
      complexity += 1 + nesting;
      n.forEachChild((child) => walk(child, nesting + 1));
      return;
    }

    // Logical operator sequences: +1 when operator type changes
    if (kind === SyntaxKind.BinaryExpression) {
      const binExpr = n as import('ts-morph').BinaryExpression;
      const op = binExpr.getOperatorToken().getKind();
      if (LOGICAL_OPS.has(op)) {
        const parent = n.getParent();
        let sameAsParent = false;
        if (parent?.getKind() === SyntaxKind.BinaryExpression) {
          const parentOp = (parent as import('ts-morph').BinaryExpression).getOperatorToken().getKind();
          if (parentOp === op) sameAsParent = true;
        }
        if (!sameAsParent) complexity += 1;
      }
    }

    // Recursion: direct call to own name
    if (kind === SyntaxKind.CallExpression && fnName) {
      const callText = (n as import('ts-morph').CallExpression).getExpression().getText();
      if (callText === fnName || callText === `this.${fnName}`) {
        complexity += 1;
      }
    }

    n.forEachChild((child) => walk(child, nesting));
  }

  body.forEachChild((child) => walk(child, 0));
  return complexity;
}

function cognitiveComplexity(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const threshold = ctx.config?.maxComplexity ?? 15;

  // Score every function-like body independently
  const functions = [
    ...ctx.sourceFile.getFunctions(),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.GetAccessor),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.SetAccessor),
    ...ctx.sourceFile.getDescendantsOfKind(SyntaxKind.Constructor),
  ];

  for (const fn of functions) {
    const body = fn.getBody();
    if (!body) continue;

    const name = (fn as any).getName?.() || undefined;
    const score = calculateCognitiveComplexity(body, name);
    if (score > threshold) {
      findings.push(
        finding(
          'cognitive-complexity',
          'warning',
          'structure',
          `Function '${name || 'anonymous'}' has cognitive complexity of ${score} (threshold: ${threshold})`,
          ctx.filePath,
          fn.getStartLineNumber(),
        ),
      );
    }
  }

  return findings;
}

// ── Rule 9: template-available ───────────────────────────────────────────
// Library pattern detected, matching template exists

function templateAvailable(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  if (!ctx.config?.registeredTemplates?.length) return findings;

  const registered = new Set(ctx.config.registeredTemplates);

  for (const t of ctx.templateMatches) {
    if (!registered.has(t.templateName)) continue;

    if (t.suggestedKern) {
      findings.push(
        finding(
          'template-available',
          'info',
          'pattern',
          `${t.libraryName} pattern should use KERN template '${t.templateName}'`,
          ctx.filePath,
          t.startLine,
          1,
          { suggestion: t.suggestedKern },
        ),
      );
    }
  }

  return findings;
}

// ── Rule 10: handler-extraction ──────────────────────────────────────────
// Large handler that should be extracted to a fn node

function handlerExtraction(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const r of ctx.inferred) {
    if (r.node.type !== 'fn') continue;
    const handler = (r.node.children || []).find((c) => c.type === 'handler');
    if (!handler?.props?.code) continue;

    const code = handler.props.code as string;
    const tokens = countTokens(code);

    if (tokens > 300) {
      findings.push(
        finding(
          'handler-extraction',
          'info',
          'structure',
          `Handler in '${r.node.props?.name}' (${tokens} tokens) is a candidate for extraction to separate fn node`,
          ctx.filePath,
          r.startLine,
          1,
          { nodeIds: [r.nodeId] },
        ),
      );
    }
  }

  return findings;
}

// ── Rule 11: handler-size ────────────────────────────────────────────────
// Handler blocks exceeding a line threshold suggest extraction

const HANDLER_LINE_LIMIT = 30;

function handlerSize(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const r of ctx.inferred) {
    // Check all node types that can contain handlers, not just fn
    const handlers = (r.node.children || []).filter((c) => c.type === 'handler');
    for (const handler of handlers) {
      const code = (handler.props?.code as string) || '';
      if (!code) continue;

      // Count non-empty, non-comment lines
      const lines = code.split('\n').filter((l) => {
        const trimmed = l.trim();
        return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('#');
      });

      if (lines.length > HANDLER_LINE_LIMIT) {
        const parentName = (r.node.props?.name as string) || r.node.type;
        findings.push(
          finding(
            'handler-size',
            'warning',
            'structure',
            `Handler in '${parentName}' is ${lines.length} lines (limit: ${HANDLER_LINE_LIMIT}). Extract logic into separate fn nodes for better structure and reviewability.`,
            ctx.filePath,
            handler.loc?.line ?? r.startLine,
            1,
            {
              nodeIds: [r.nodeId],
              suggestion: `Split the handler into smaller fn nodes called from the handler. KERN's value is structure — keep handlers under ${HANDLER_LINE_LIMIT} lines.`,
            },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule: memory-leak (from v1) ──────────────────────────────────────────
// useEffect/watch/onMounted that creates subscriptions without cleanup

const EFFECT_CALLEE_NAMES = new Set(['useEffect', 'watch', 'onMounted', 'watchEffect']);
const SUBSCRIPTION_CONSTRUCTORS = new Set([
  'WebSocket',
  'EventSource',
  'MutationObserver',
  'IntersectionObserver',
  'ResizeObserver',
]);

interface LeakSpec {
  label: string;
  line: number;
  cleanupPatterns: RegExp[];
  cleanupReturnIdentifiers?: string[];
  cleanupReturnCallPattern?: RegExp;
}

function buildLeakSpecs(
  callback: import('ts-morph').ArrowFunction | import('ts-morph').FunctionExpression,
): LeakSpec[] {
  const specs: LeakSpec[] = [];

  for (const desc of callback.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const descCallee = desc.getExpression();

    if (Node.isPropertyAccessExpression(descCallee)) {
      const method = descCallee.getName();
      const targetText = descCallee.getExpression().getText();

      if (method === 'addEventListener') {
        specs.push({
          label: 'addEventListener',
          line: desc.getStartLineNumber(),
          cleanupPatterns: [new RegExp(`${escapeRegex(targetText)}\\s*\\.\\s*removeEventListener\\s*\\(`)],
        });
        continue;
      }

      if (method === 'subscribe') {
        const assignedName = findAssignedIdentifier(desc);
        specs.push({
          label: 'subscribe',
          line: desc.getStartLineNumber(),
          cleanupPatterns: assignedName
            ? [
                new RegExp(`\\b${escapeRegex(assignedName)}\\s*\\(`),
                new RegExp(`\\b${escapeRegex(assignedName)}\\s*\\.\\s*(?:unsubscribe|dispose|destroy|off)\\s*\\(`),
              ]
            : [/\.\s*(?:unsubscribe|dispose|destroy|off)\s*\(/],
          cleanupReturnIdentifiers: assignedName ? [assignedName] : [],
          cleanupReturnCallPattern: /\.\s*subscribe\s*\(/,
        });
        continue;
      }

      if (method === 'on') {
        const assignedName = findAssignedIdentifier(desc);
        specs.push({
          label: 'on',
          line: desc.getStartLineNumber(),
          cleanupPatterns: assignedName
            ? [
                new RegExp(`\\b${escapeRegex(assignedName)}\\s*\\(`),
                new RegExp(`\\b${escapeRegex(assignedName)}\\s*\\.\\s*(?:unsubscribe|dispose|destroy|off|removeListener)\\s*\\(`),
                new RegExp(`${escapeRegex(targetText)}\\s*\\.\\s*(?:off|removeListener|unsubscribe)\\s*\\(`),
              ]
            : [/\.\s*(?:off|removeListener|unsubscribe|dispose|destroy)\s*\(/],
          cleanupReturnIdentifiers: assignedName ? [assignedName] : [],
          cleanupReturnCallPattern: /\.\s*on\s*\(/,
        });
        continue;
      }
    }

    if (Node.isIdentifier(descCallee)) {
      const name = descCallee.getText();
      const assignedName = findAssignedIdentifier(desc);
      if (name === 'setInterval' || name === 'setTimeout') {
        const clearName = name === 'setInterval' ? 'clearInterval' : 'clearTimeout';
        specs.push({
          label: name,
          line: desc.getStartLineNumber(),
          cleanupPatterns: assignedName
            ? [new RegExp(`\\b${clearName}\\s*\\(\\s*${escapeRegex(assignedName)}\\s*\\)`)]
            : [new RegExp(`\\b${clearName}\\s*\\(`)],
        });
      }
    }
  }

  for (const newExpr of callback.getDescendantsOfKind(SyntaxKind.NewExpression)) {
    const ctorName = newExpr.getExpression().getText();
    if (!SUBSCRIPTION_CONSTRUCTORS.has(ctorName)) continue;

    const assignedName = findAssignedIdentifier(newExpr);
    if (ctorName === 'WebSocket' || ctorName === 'EventSource') {
      specs.push({
        label: `new ${ctorName}`,
        line: newExpr.getStartLineNumber(),
        cleanupPatterns: assignedName
          ? [new RegExp(`\\b${escapeRegex(assignedName)}\\s*\\.\\s*close\\s*\\(`)]
          : [/\.\s*close\s*\(/],
      });
      continue;
    }

    specs.push({
      label: `new ${ctorName}`,
      line: newExpr.getStartLineNumber(),
      cleanupPatterns: assignedName
        ? [new RegExp(`\\b${escapeRegex(assignedName)}\\s*\\.\\s*(?:disconnect|unobserve)\\s*\\(`)]
        : [/\.\s*(?:disconnect|unobserve)\s*\(/],
    });
  }

  return specs;
}


function memoryLeak(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.Identifier) continue;
    if (!EFFECT_CALLEE_NAMES.has(callee.getText())) continue;

    // Get the callback (first argument)
    const args = call.getArguments();
    if (args.length === 0) continue;
    const callback = args[0];
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) continue;

    const leakSpecs = buildLeakSpecs(callback).filter(
      (spec, index, specs) => specs.findIndex((candidate) => candidate.label === spec.label && candidate.line === spec.line) === index,
    );
    if (leakSpecs.length === 0) continue;

    const cleanupExprs = getTopLevelCleanupExpressions(callback.getBody());
    const leakedSpec = leakSpecs.find((spec) => !cleanupExprs.some((expr) => cleanupExpressionMatches(expr, spec)));
    if (!leakedSpec) continue;

    findings.push(
      finding(
        'memory-leak',
        'error',
        'bug',
        `Effect creates ${leakedSpec.label}() but has no matching cleanup — memory leak`,
        ctx.filePath,
        call.getStartLineNumber(),
        1,
        { suggestion: 'Add cleanup: return () => { /* remove listener/clear interval */ }' },
      ),
    );
  }

  // Also check class methods and standalone functions for addEventListener without removeEventListener
  const _fullText = ctx.sourceFile.getFullText();
  for (const cls of ctx.sourceFile.getClasses()) {
    for (const method of cls.getMethods()) {
      const body = method.getBody();
      if (!body) continue;
      const bodyText = body.getText();

      // Check if method adds listeners
      if (bodyText.includes('addEventListener')) {
        // Check if ANY method in the class removes listeners
        const clsText = cls.getText();
        if (!clsText.includes('removeEventListener')) {
          findings.push(
            finding(
              'memory-leak',
              'error',
              'bug',
              `Class '${cls.getName() || 'anonymous'}' adds event listener in '${method.getName()}' but never removes it`,
              ctx.filePath,
              method.getStartLineNumber(),
              1,
              { suggestion: 'Add removeEventListener in a cleanup/destroy/dispose method' },
            ),
          );
        }
      }
    }
  }

  return findings;
}

// ── Rule: unhandled-async (from v1) ──────────────────────────────────────
// Async functions with await but no try/catch

function unhandledAsync(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const fn of ctx.sourceFile.getFunctions()) {
    if (!fn.isAsync()) continue;
    const body = fn.getBody()?.getText() || '';
    const name = fn.getName() || 'anonymous';
    const line = fn.getStartLineNumber();

    // Use AST to check for try/catch — string matching is defeated by comments/strings
    const bodyNode = fn.getBody();
    const hasTryCatch = bodyNode ? bodyNode.getDescendantsOfKind(SyntaxKind.TryStatement).length > 0 : false;
    const hasDotCatch = body.includes('.catch(') || body.includes('.catch (');
    const hasThrow = bodyNode ? bodyNode.getDescendantsOfKind(SyntaxKind.ThrowStatement).length > 0 : false;

    if (!hasTryCatch && !hasDotCatch && !hasThrow) {
      const hasAwait = body.includes('await ');
      if (hasAwait) {
        findings.push(
          finding(
            'unhandled-async',
            'warning',
            'bug',
            `Async function '${name}' has await but no try/catch — unhandled rejection risk`,
            ctx.filePath,
            line,
            1,
            { suggestion: 'Wrap await calls in try/catch or add .catch() handler' },
          ),
        );
      }
    }
  }

  // Arrow function expressions with async
  for (const stmt of ctx.sourceFile.getVariableStatements()) {
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      const text = init.getText();
      if (!text.startsWith('async')) continue;

      const hasAwait = text.includes('await ');
      const hasTryCatch = text.includes('try') && text.includes('catch');
      const hasDotCatch = text.includes('.catch(');

      if (hasAwait && !hasTryCatch && !hasDotCatch) {
        findings.push(
          finding(
            'unhandled-async',
            'warning',
            'bug',
            `Async '${decl.getName()}' has await but no error handling`,
            ctx.filePath,
            stmt.getStartLineNumber(),
            1,
            { suggestion: 'Wrap await calls in try/catch' },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Exported Base Rules ──────────────────────────────────────────────────

// ── Rule: sync-in-async ──────────────────────────────────────────────────
// Blocking I/O (readFileSync, writeFileSync, execSync) inside async functions

const SYNC_BLOCKERS = new Set([
  'readFileSync',
  'writeFileSync',
  'appendFileSync',
  'mkdirSync',
  'rmdirSync',
  'unlinkSync',
  'renameSync',
  'copyFileSync',
  'readdirSync',
  'statSync',
  'existsSync',
  'execSync',
  'spawnSync',
  'execFileSync',
]);

function syncInAsync(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  const fns = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).filter((f) => f.isAsync());
  const arrows = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction).filter((f) => f.isAsync());
  const methods = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration).filter((f) => f.isAsync());

  for (const fn of [...fns, ...arrows, ...methods]) {
    const calls = fn.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
      // Skip calls inside nested (non-async) functions — those have their own scope
      let nestedFn = false;
      let cur = call.getParent();
      while (cur && cur !== fn) {
        const k = cur.getKind();
        if (
          (k === SyntaxKind.FunctionDeclaration ||
            k === SyntaxKind.ArrowFunction ||
            k === SyntaxKind.FunctionExpression ||
            k === SyntaxKind.MethodDeclaration) &&
          cur !== fn
        ) {
          nestedFn = true;
          break;
        }
        cur = cur.getParent();
      }
      if (nestedFn) continue;

      const callee = call.getExpression().getText();
      const calleeName = callee.split('.').pop() || callee;
      if (SYNC_BLOCKERS.has(calleeName)) {
        const line = call.getStartLineNumber();
        const fnName = 'getName' in fn && typeof fn.getName === 'function' ? fn.getName() || '<anonymous>' : '<arrow>';
        findings.push(
          finding(
            'sync-in-async',
            'warning',
            'bug',
            `'${calleeName}' blocks the event loop inside async function '${fnName}' — use the async variant`,
            ctx.filePath,
            line,
            1,
            { suggestion: `Replace ${calleeName} with its async counterpart (e.g., readFile, writeFile, exec)` },
          ),
        );
      }
    }
  }

  return findings;
}

// ── Rule 14: bare-rethrow ────────────────────────────────────────────────
// catch(e) { throw e } — pointless rethrow that adds no context

function bareRethrow(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  for (const catchClause of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
    const block = catchClause.getBlock();
    const stmts = block.getStatements();
    if (stmts.length === 0) continue; // empty-catch handles this

    // Get the caught variable name
    const varDecl = catchClause.getVariableDeclaration();
    if (!varDecl) continue;
    const errorVar = varDecl.getName();

    // Find the throw statement — must be the ONLY statement (or last after logging)
    const lastStmt = stmts[stmts.length - 1];
    if (lastStmt.getKind() !== SyntaxKind.ThrowStatement) continue;

    const throwStmt = lastStmt as import('ts-morph').ThrowStatement;
    const throwExpr = throwStmt.getExpression();
    if (!throwExpr) continue;

    // Only flag if throwing the exact same error variable (bare rethrow)
    if (throwExpr.getText() !== errorVar) continue;

    // Skip if other statements do meaningful work (logging is OK but still flagged if ONLY logging + rethrow)
    // If there are 2+ statements before the throw, assume intentional (side effects before rethrow)
    if (stmts.length > 2) continue;

    // If there's exactly one statement before throw, check if it's just console.log/warn/error
    if (stmts.length === 2) {
      const firstStmt = stmts[0];
      const firstText = firstStmt.getText();
      // Only flag if the pre-throw statement is pure logging — otherwise the catch does real work
      if (!/^console\.(log|warn|error|info|debug)\s*\(/.test(firstText.trim())) continue;
    }

    const line = catchClause.getStartLineNumber();
    findings.push(
      finding(
        'bare-rethrow',
        'warning',
        'pattern',
        `Catch rethrows '${errorVar}' without adding context — wrap with new Error('context', { cause: ${errorVar} })`,
        ctx.filePath,
        line,
        1,
        { suggestion: `throw new Error('descriptive message', { cause: ${errorVar} })` },
      ),
    );
  }

  return findings;
}

export const baseRules = [
  floatingPromise,
  stateMutation,
  emptyCatch,
  machineGap,
  configDefaultMismatch,
  eventMapMismatch,
  nonExhaustiveSwitch,
  cognitiveComplexity,
  templateAvailable,
  handlerExtraction,
  handlerSize,
  memoryLeak,
  unhandledAsync,
  syncInAsync,
  bareRethrow,
];
