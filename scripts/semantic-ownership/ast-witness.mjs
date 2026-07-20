import ts from 'typescript';

function fail(message) {
  throw new Error(`semantic ownership: ${message}`);
}

function parsedSource(source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((sourceFile.parseDiagnostics ?? []).length > 0) fail(`cannot parse witness source ${sourcePath}`);
  return sourceFile;
}

function importDeclarationFor(specifier) {
  const declaration = specifier.parent?.parent?.parent;
  return ts.isImportDeclaration(declaration) ? declaration : undefined;
}

function enclosingFunctionName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
  }
  return undefined;
}

function callHasShape(call, kind, target) {
  let parent = call.parent;
  while (ts.isAwaitExpression(parent) || ts.isParenthesizedExpression(parent)) parent = parent.parent;
  if (kind === 'assigned-imported-call') {
    return (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(parent.left) &&
      parent.left.text === target
    );
  }
  return kind === 'returned-imported-call' && ts.isReturnStatement(parent);
}

function declaresIdentifier(node, name) {
  if (
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node) ||
    ts.isImportEqualsDeclaration(node)
  ) {
    return node.name && ts.isIdentifier(node.name) && node.name.text === name;
  }
  return false;
}

function importedCallMatches(sourceFile, kind, parts) {
  const [importedName, localName, moduleName, functionName, target] = parts;
  let imported = false;
  let matched = false;
  let shadowed = false;
  function visit(node) {
    if (ts.isImportSpecifier(node)) {
      const declaration = importDeclarationFor(node);
      imported ||=
        (node.propertyName?.text ?? node.name.text) === importedName &&
        node.name.text === localName &&
        declaration !== undefined &&
        ts.isStringLiteral(declaration.moduleSpecifier) &&
        declaration.moduleSpecifier.text === moduleName;
    } else if (declaresIdentifier(node, localName)) {
      shadowed = true;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === localName) {
      matched ||= enclosingFunctionName(node) === functionName && callHasShape(node, kind, target);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return imported && matched && !shadowed;
}

function callArrayMatches(sourceFile, parts) {
  const [callee, arrayIndexText, arrayText, commandText] = parts;
  const expected = arrayText?.split(',') ?? [];
  const expectedCommand = commandText?.split('.') ?? [];
  let matched = false;
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === callee) {
      const command = node.arguments[0];
      const argument = node.arguments[Number(arrayIndexText)];
      const commandMatches =
        expectedCommand.length === 2 &&
        command &&
        ts.isPropertyAccessExpression(command) &&
        ts.isIdentifier(command.expression) &&
        command.expression.text === expectedCommand[0] &&
        command.name.text === expectedCommand[1];
      if (commandMatches && argument && ts.isArrayLiteralExpression(argument)) {
        const actual = argument.elements.map((element) =>
          ts.isIdentifier(element) || ts.isStringLiteral(element) ? element.text : '',
        );
        matched ||= actual.length === expected.length && actual.every((value, index) => value === expected[index]);
      }
    }
    if (!matched) ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return matched;
}

export function astWitnessMatches(source, sourcePath, descriptor) {
  const [kind, ...parts] = descriptor.split(':');
  const sourceFile = parsedSource(source, sourcePath);
  if (kind === 'assigned-imported-call' || kind === 'returned-imported-call') {
    return importedCallMatches(sourceFile, kind, parts);
  }
  if (kind === 'call-array') return callArrayMatches(sourceFile, parts);
  fail(`unknown AST witness kind ${kind}`);
}
