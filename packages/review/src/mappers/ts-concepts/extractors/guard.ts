import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';
import { getContainerId, span } from '../helpers/ast.js';
import { AUTH_KEYWORDS, GUARD_ARG_RE, GUARD_HELPER_RE, VALIDATION_CALLS } from '../signatures.js';

export function extractGuards(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // Pattern 1: early return/throw after auth check: if (!req.user) return/throw
  for (const ifStmt of sf.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const condText = ifStmt.getExpression().getText();
    if (!AUTH_KEYWORDS.test(condText)) continue;

    const thenBlock = ifStmt.getThenStatement();
    const thenText = thenBlock.getText();

    const isEarlyExit =
      thenText.includes('return') ||
      thenText.includes('throw') ||
      thenText.includes('401') ||
      thenText.includes('403') ||
      thenText.includes('redirect');

    if (!isEarlyExit) continue;

    nodes.push({
      id: conceptId(filePath, 'guard', ifStmt.getStart()),
      kind: 'guard',
      primarySpan: span(filePath, ifStmt),
      evidence: ifStmt.getText().substring(0, 120),
      confidence: 0.8,
      language: 'ts',
      containerId: getContainerId(ifStmt, filePath),
      payload: { kind: 'guard', subtype: 'auth', name: condText.substring(0, 60) },
    });
  }

  // Pattern 2: schema.parse(), validator.validate() calls
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    const pa = callee as import('ts-morph').PropertyAccessExpression;
    if (!VALIDATION_CALLS.has(pa.getName())) continue;

    const objText = pa.getExpression().getText();
    if (/schema|validator|zod|yup|joi|valibot/i.test(objText) || /Schema$/.test(objText)) {
      nodes.push({
        id: conceptId(filePath, 'guard', call.getStart()),
        kind: 'guard',
        primarySpan: span(filePath, call),
        evidence: call.getText().substring(0, 100),
        confidence: 0.9,
        language: 'ts',
        containerId: getContainerId(call, filePath),
        payload: { kind: 'guard', subtype: 'validation', name: objText },
      });
    }
  }

  // Pattern 3: helper-call naming heuristic — requireAdminOrigin(), assertSession(),
  // checkPermissions(), validateBody(), ensureAuthenticated() etc.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    let calleeName: string | undefined;
    if (callee.getKind() === SyntaxKind.Identifier) {
      calleeName = callee.getText();
    } else if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      calleeName = (callee as import('ts-morph').PropertyAccessExpression).getName();
    } else {
      continue;
    }

    const m = calleeName?.match(GUARD_HELPER_RE);
    if (!m) continue;
    const verb = m[1];

    // Second condition: the call must look like a guard, not a utility
    // sharing the verb prefix.
    const args = call.getArguments();
    if (args.length > 0) {
      const firstArg = args[0];
      if (firstArg.getKind() !== SyntaxKind.Identifier) continue;
      if (!GUARD_ARG_RE.test(firstArg.getText())) continue;
    }

    const subtype: 'auth' | 'validation' = verb === 'validate' ? 'validation' : 'auth';

    nodes.push({
      id: conceptId(filePath, 'guard', call.getStart()),
      kind: 'guard',
      primarySpan: span(filePath, call),
      evidence: call.getText().substring(0, 100),
      confidence: 0.7,
      language: 'ts',
      containerId: getContainerId(call, filePath),
      payload: { kind: 'guard', subtype, name: calleeName },
    });
  }

  // Pattern 4: header-builder calls — `buildRequestHeaders(init, url, accessToken)`,
  // `withAuth(req)`, `signRequest(req, token)`, `attachAuth(req)`,
  // `getAuthHeaders(token)`. Emits an auth guard for the containing function
  // ONLY when the callee name matches the header-builder regex.
  //
  // Codex review: the standalone token-arg signal (`hash(accessToken)`) was
  // dropped because it suppressed unrelated unguarded effects in the same
  // container. A function passing a token to any helper is "auth-aware" only
  // if the helper itself is an auth-applying primitive — encode that via the
  // name regex, not via the arg shape alone. The token-arg signal is now a
  // SECONDARY confidence boost on header-builder matches, never standalone.
  // See RULE-FEEDBACK.md #6.
  const HEADER_BUILDER_RE = /^(?:build[A-Z]\w*Headers?|with[A-Z]\w*Auth|signRequest|attachAuth|getAuthHeaders?)$/;
  const TOKEN_ARG_RE = /^(?:accessToken|authToken|apiKey|credentials|bearer|bearerToken)$/;
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    let calleeName: string | undefined;
    if (callee.getKind() === SyntaxKind.Identifier) {
      calleeName = callee.getText();
    } else if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
      calleeName = (callee as import('ts-morph').PropertyAccessExpression).getName();
    }
    if (!calleeName) continue;
    if (!HEADER_BUILDER_RE.test(calleeName)) continue;

    let hasTokenArg = false;
    for (const arg of call.getArguments()) {
      if (arg.getKind() !== SyntaxKind.Identifier) continue;
      if (TOKEN_ARG_RE.test(arg.getText())) {
        hasTokenArg = true;
        break;
      }
    }

    nodes.push({
      id: conceptId(filePath, 'guard', call.getStart()),
      kind: 'guard',
      primarySpan: span(filePath, call),
      evidence: call.getText().substring(0, 100),
      confidence: hasTokenArg ? 0.75 : 0.6,
      language: 'ts',
      containerId: getContainerId(call, filePath),
      payload: { kind: 'guard', subtype: 'auth', name: calleeName },
    });
  }

  // Pattern 5 (REMOVED — Codex review):
  // The previous `{ context: "auth" }` extraction emitted a container-wide
  // guard, which suppressed any unrelated unguarded effect in the same
  // function (e.g. `log('x', { context: 'auth' }); await db.update(...)`).
  // Author-explicit auth-context markers must be evaluated at the network
  // effect site itself, not promoted to a container guard — that work is
  // tracked separately (will become a payload flag on the effect). For
  // now, the narrow RFC auth-endpoint URL list in unguarded-effect.ts
  // handles the static-URL cases. RULE-FEEDBACK #8 dynamic-URL flow
  // (`getOccPath('/token', {context:'auth'})`) is a documented gap.
}
