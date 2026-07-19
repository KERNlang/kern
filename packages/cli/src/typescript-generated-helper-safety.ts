import ts from 'typescript';

function bindingNameContains(name: ts.BindingName, reservedName: string): boolean {
  const names: ts.BindingName[] = [name];
  while (names.length > 0) {
    const current = names.pop();
    if (!current) continue;
    if (ts.isIdentifier(current)) {
      if (current.text === reservedName) return true;
      continue;
    }
    for (const element of current.elements) {
      if (!ts.isOmittedExpression(element)) names.push(element.name);
    }
  }
  return false;
}

function assignmentTargetContains(target: ts.Expression, reservedName: string): boolean {
  const targets: ts.Expression[] = [target];
  while (targets.length > 0) {
    const current = targets.pop();
    if (!current) continue;
    if (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      targets.push(current.expression);
      continue;
    }
    if (ts.isIdentifier(current)) {
      if (current.text === reservedName) return true;
      continue;
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      targets.push(current.left);
      continue;
    }
    if (ts.isArrayLiteralExpression(current)) {
      for (const element of current.elements) {
        if (!ts.isOmittedExpression(element)) {
          targets.push(ts.isSpreadElement(element) ? element.expression : element);
        }
      }
      continue;
    }
    if (ts.isObjectLiteralExpression(current)) {
      for (const property of current.properties) {
        if (ts.isShorthandPropertyAssignment(property)) {
          if (property.name.text === reservedName) return true;
        } else if (ts.isPropertyAssignment(property)) {
          targets.push(property.initializer);
        } else if (ts.isSpreadAssignment(property)) {
          targets.push(property.expression);
        }
      }
    }
  }
  return false;
}

export type TypeScriptGeneratedSourceKind = 'ts' | 'tsx';

function parseGeneratedTypeScript(code: string, sourceKind: TypeScriptGeneratedSourceKind): ts.SourceFile {
  const scriptKind = sourceKind === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  try {
    const sourceFile = ts.createSourceFile(
      `__kern_generated__.${sourceKind}`,
      code,
      ts.ScriptTarget.Latest,
      false,
      scriptKind,
    );
    const diagnostics = (sourceFile as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
    if (diagnostics && diagnostics.length > 0) {
      throw new Error('Generated TypeScript helper safety analysis failed closed.');
    }
    return sourceFile;
  } catch {
    throw new Error('Generated TypeScript helper safety analysis failed closed.');
  }
}

export interface TypeScriptGeneratedHelperUsage {
  calls: boolean;
  bindsOrWrites: boolean;
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
export function analyzeTypeScriptGeneratedHelperUsage(
  code: string,
  reservedName: string,
  sourceKind: TypeScriptGeneratedSourceKind = 'ts',
): TypeScriptGeneratedHelperUsage {
  if (!code.includes(reservedName)) return { calls: false, bindsOrWrites: false };

  const source = parseGeneratedTypeScript(code, sourceKind);
  const usage: TypeScriptGeneratedHelperUsage = { calls: false, bindsOrWrites: false };
  const nodes: ts.Node[] = [source];

  while (nodes.length > 0) {
    const node = nodes.pop();
    if (!node) continue;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === reservedName) {
      usage.calls = true;
    }
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) &&
      bindingNameContains(node.name, reservedName)
    ) {
      usage.bindsOrWrites = true;
    }
    if (declarationName(node)?.text === reservedName) {
      usage.bindsOrWrites = true;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      assignmentTargetContains(node.left, reservedName)
    ) {
      usage.bindsOrWrites = true;
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) &&
      assignmentTargetContains(node.operand, reservedName)
    ) {
      usage.bindsOrWrites = true;
    }
    if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer) &&
      assignmentTargetContains(node.initializer, reservedName)
    ) {
      usage.bindsOrWrites = true;
    }
    if (usage.calls && usage.bindsOrWrites) break;
    ts.forEachChild(node, (child) => {
      nodes.push(child);
    });
  }

  return usage;
}

/** Detect declarations, imports, or writes that capture a generated helper. */
export function typescriptCodeBindsOrWritesIdentifier(code: string, reservedName: string): boolean {
  return analyzeTypeScriptGeneratedHelperUsage(code, reservedName).bindsOrWrites;
}
