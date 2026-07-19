import ts from 'typescript';

function bindingNameContains(name: ts.BindingName, reservedName: string): boolean {
  if (ts.isIdentifier(name)) return name.text === reservedName;
  return name.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingNameContains(element.name, reservedName),
  );
}

function assignmentTargetContains(target: ts.Expression, reservedName: string): boolean {
  if (ts.isIdentifier(target)) return target.text === reservedName;
  if (ts.isParenthesizedExpression(target)) return assignmentTargetContains(target.expression, reservedName);
  if (ts.isArrayLiteralExpression(target)) {
    return target.elements.some((element) => {
      if (ts.isOmittedExpression(element)) return false;
      return assignmentTargetContains(ts.isSpreadElement(element) ? element.expression : element, reservedName);
    });
  }
  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.some((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return property.name.text === reservedName;
      if (ts.isPropertyAssignment(property)) return assignmentTargetContains(property.initializer, reservedName);
      if (ts.isSpreadAssignment(property)) return assignmentTargetContains(property.expression, reservedName);
      return false;
    });
  }
  return false;
}

function declarationName(node: ts.Node): ts.Identifier | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node)
  ) {
    return node.name && ts.isIdentifier(node.name) ? node.name : undefined;
  }
  if (ts.isImportEqualsDeclaration(node)) return node.name;
  if (ts.isImportClause(node)) return node.name;
  if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) return node.name;
  return undefined;
}

/** Detect declarations, imports, or writes that capture a generated helper. */
export function typescriptCodeBindsOrWritesIdentifier(code: string, reservedName: string): boolean {
  const source = ts.createSourceFile('__kern_generated__.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let collision = false;

  const visit = (node: ts.Node): void => {
    if (collision) return;
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      bindingNameContains(node.name, reservedName)
    ) {
      collision = true;
      return;
    }
    if (declarationName(node)?.text === reservedName) {
      collision = true;
      return;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      assignmentTargetContains(node.left, reservedName)
    ) {
      collision = true;
      return;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
      assignmentTargetContains(node.operand, reservedName)
    ) {
      collision = true;
      return;
    }
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer) &&
      assignmentTargetContains(node.initializer, reservedName)
    ) {
      collision = true;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return collision;
}
