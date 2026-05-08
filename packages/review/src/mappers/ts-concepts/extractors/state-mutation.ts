import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';
import { getContainerId, span } from '../helpers/ast.js';

export function extractStateMutation(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // this.x = ..., this.x++, this.x += ...
  for (const binExpr of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    const op = binExpr.getOperatorToken().getKind();
    if (op !== SyntaxKind.EqualsToken && op !== SyntaxKind.PlusEqualsToken && op !== SyntaxKind.MinusEqualsToken)
      continue;

    const leftText = binExpr.getLeft().getText();
    if (!leftText.includes('.')) continue; // only property assignments

    const root = leftText.split('.')[0];

    let scope: 'local' | 'module' | 'global' | 'shared' = 'local';
    if (root === 'this' || root === 'self') scope = 'module';
    else if (/global|window|process\.env/i.test(root)) scope = 'global';
    else if (/state|store|cache|registry/i.test(root)) scope = 'shared';
    else continue;

    nodes.push({
      id: conceptId(filePath, 'state_mutation', binExpr.getStart()),
      kind: 'state_mutation',
      primarySpan: span(filePath, binExpr),
      evidence: binExpr.getText().substring(0, 100),
      confidence: scope === 'module' ? 0.9 : 0.75,
      language: 'ts',
      containerId: getContainerId(binExpr, filePath),
      payload: { kind: 'state_mutation', target: leftText, scope, via: 'assignment' },
    });
  }

  // Prefix/postfix: this.count++, state.value--
  for (const unary of [
    ...sf.getDescendantsOfKind(SyntaxKind.PostfixUnaryExpression),
    ...sf.getDescendantsOfKind(SyntaxKind.PrefixUnaryExpression),
  ]) {
    const operandText =
      unary.getKind() === SyntaxKind.PostfixUnaryExpression
        ? (unary as import('ts-morph').PostfixUnaryExpression).getOperand().getText()
        : (unary as import('ts-morph').PrefixUnaryExpression).getOperand().getText();

    if (!operandText.includes('.')) continue;
    const root = operandText.split('.')[0];

    let scope: 'local' | 'module' | 'global' | 'shared' = 'local';
    if (root === 'this' || root === 'self') scope = 'module';
    else if (/state|store|cache/i.test(root)) scope = 'shared';
    else continue;

    nodes.push({
      id: conceptId(filePath, 'state_mutation', unary.getStart()),
      kind: 'state_mutation',
      primarySpan: span(filePath, unary),
      evidence: unary.getText().substring(0, 80),
      confidence: 0.85,
      language: 'ts',
      containerId: getContainerId(unary, filePath),
      payload: { kind: 'state_mutation', target: operandText, scope, via: 'increment' },
    });
  }

  // Call-based: setState(), setCount(), dispatch(), store.dispatch()
  const NON_STATE_SETTERS =
    /^(setTimeout|setInterval|setImmediate|setAttribute|setProperty|setHeader|setRequestHeader|setItem|setCustomValidity)$/;
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const calleeText = call.getExpression().getText();
    const target = calleeText;
    let scope: 'local' | 'module' | 'global' | 'shared' = 'local';
    let api: string | undefined;
    let isStateMutation = false;

    if (calleeText === 'dispatch' || calleeText === 'this.setState') {
      isStateMutation = true;
      scope = calleeText.startsWith('this.') ? 'module' : 'local';
      api = calleeText === 'this.setState' ? 'setState' : 'dispatch';
    } else if (/^store\.dispatch|\.dispatch$/.test(calleeText)) {
      isStateMutation = true;
      scope = 'shared';
      api = 'dispatch';
    } else if (/^set[A-Z]/.test(calleeText) && !NON_STATE_SETTERS.test(calleeText)) {
      isStateMutation = true;
      scope = 'local';
      api = 'setter';
    }

    if (!isStateMutation) continue;

    nodes.push({
      id: conceptId(filePath, 'state_mutation', call.getStart()),
      kind: 'state_mutation',
      primarySpan: span(filePath, call),
      evidence: call.getText().substring(0, 100),
      confidence: 0.85,
      language: 'ts',
      containerId: getContainerId(call, filePath),
      payload: { kind: 'state_mutation', target, scope, via: 'call', api },
    });
  }
}
