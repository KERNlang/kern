import { createHash } from 'node:crypto';

export const SAFE_PATTERN_DIGEST_FORMAT = 'typescript-token-tree-sha256.v1';
export const SAFE_PATTERN_HELPER_NAME = 'classBodyRequiresIterationBudget';

function bindingIdentifiers(ts, name, out = []) {
  if (ts.isIdentifier(name)) out.push(name);
  else for (const element of name.elements ?? []) {
    if (ts.isBindingElement(element)) bindingIdentifiers(ts, element.name, out);
  }
  return out;
}

function helperBindings(ts, sourceFile) {
  const bindings = [];
  function add(name) {
    for (const identifier of bindingIdentifiers(ts, name)) {
      if (identifier.text === SAFE_PATTERN_HELPER_NAME) bindings.push(identifier);
    }
  }
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name) add(node.name);
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) add(node.name);
    if (ts.isImportClause(node) && node.name) add(node.name);
    if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) add(node.name);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return bindings;
}

export function approvedSafePatternHelper(ts, sourceFile) {
  const helpers = sourceFile.statements.filter((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === SAFE_PATTERN_HELPER_NAME);
  if (helpers.length !== 1) return null;
  const bindings = helperBindings(ts, sourceFile);
  return bindings.length === 1 && bindings[0] === helpers[0].name ? helpers[0] : null;
}

export function safePatternSyntaxDigest(ts, root, sourceFile) {
  function encode(node) {
    const children = node.getChildren(sourceFile).filter((child) => !(ts.isJSDoc?.(child) ?? false));
    if (children.length === 0) {
      const text = node.getText(sourceFile);
      return `L${node.kind}:${Buffer.byteLength(text)}:${text}`;
    }
    const payload = children.map((child) => encode(child)).map((child) => `${Buffer.byteLength(child)}:${child}`).join('');
    return `N${node.kind}:${children.length}:${Buffer.byteLength(payload)}:${payload}`;
  }
  return createHash('sha256').update(encode(root)).digest('hex');
}

export function digestSafePatternSource(ts, source, sourcePath) {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((sourceFile.parseDiagnostics ?? []).length > 0) return null;
  const helper = approvedSafePatternHelper(ts, sourceFile);
  return helper ? safePatternSyntaxDigest(ts, helper, sourceFile) : null;
}
