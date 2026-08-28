import type {
  ArrayLiteralExpression,
  CallExpression,
  Node,
  ObjectLiteralExpression,
  PropertyAssignment,
} from 'ts-morph';

const SPAWN_SINK_NAMES = new Set(['spawn', 'spawnSync']);
const EXEC_FILE_SINK_NAMES = new Set(['execFile', 'execFileSync']);

/**
 * Classify whether a command-call argument can affect executed code. argv
 * APIs treat arrays as data only when the executable is proven to be the
 * current Node runtime, shell execution is proven disabled, and a fixed
 * script boundary precedes the tainted data. Executables are always
 * sensitive; ambiguous argv remains sensitive.
 */
export function commandAcceptsArgIndex(call: CallExpression, sinkName: string, argIndex: number): boolean {
  if (EXEC_FILE_SINK_NAMES.has(sinkName)) return argIndex === 0 || argIndex === 1;
  if (!SPAWN_SINK_NAMES.has(sinkName)) return argIndex === 0;
  if (argIndex === 0) return true;
  if (argIndex !== 1) return false;
  const args = call.getArguments();
  const argv = args[1];
  if (!argv || argv.getKindName() === 'ObjectLiteralExpression') return false;
  if (commandMayUseShell(args)) return true;
  return !isProvenNodeDataArgv(args[0], argv);
}

function commandMayUseShell(args: Node[]): boolean {
  const options =
    args.length > 2 ? args[2] : args[1]?.getKindName() === 'ObjectLiteralExpression' ? args[1] : undefined;
  if (!options) return false;
  const kind = options.getKindName();
  if (kind === 'ArrowFunction' || kind === 'FunctionExpression') return false;
  if (kind !== 'ObjectLiteralExpression') return true;
  for (const property of (options as ObjectLiteralExpression).getProperties()) {
    const shellProperty = classifyShellProperty(property);
    if (shellProperty === 'ambiguous') return true;
    if (shellProperty !== 'shell') continue;
    if (property.getKindName() !== 'PropertyAssignment') return true;
    if ((property as PropertyAssignment).getInitializer()?.getKindName() !== 'FalseKeyword') return true;
  }
  return false;
}

function classifyShellProperty(property: Node): 'shell' | 'other' | 'ambiguous' {
  if (property.getKindName() === 'SpreadAssignment') return 'ambiguous';
  const nameNode = (property as any).getNameNode?.() as Node | undefined;
  if (!nameNode) return 'other';
  if (nameNode.getKindName() === 'ComputedPropertyName') {
    const computed = (nameNode as any).getExpression() as Node;
    const literal = directLiteralValue(computed);
    return literal == null ? 'ambiguous' : literal === 'shell' ? 'shell' : 'other';
  }
  return (property as any).getName?.() === 'shell' ? 'shell' : 'other';
}

function isProvenNodeDataArgv(executable: Node, argv: Node): boolean {
  if (!isProvenNodeExecutable(executable) || argv.getKindName() !== 'ArrayLiteralExpression') return false;
  const elements = (argv as ArrayLiteralExpression).getElements();
  return elements.length > 0 && isDirectLocalJavaScriptModule(elements[0]);
}

function isDirectLocalJavaScriptModule(node: Node): boolean {
  const literal = directLiteralValue(node);
  if (!literal || !(literal.startsWith('./') || literal.startsWith('.\\'))) return false;
  const relative = literal.slice(2);
  const segments = relative.split(/[\\/]/u);
  if (segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false;
  }
  return /\.(?:c|m)?js$/iu.test(segments.at(-1) ?? '');
}

function isProvenNodeExecutable(node: Node): boolean {
  const literal = directLiteralValue(node);
  if (literal != null) {
    const absolute = literal.startsWith('/') || /^[a-z]:[\\/]/iu.test(literal);
    const baseName =
      literal
        .split(/[\\/]/u)
        .at(-1)
        ?.toLowerCase()
        .replace(/\.exe$/u, '') ?? '';
    return absolute && /^node(?:js)?\d*$/u.test(baseName);
  }
  const kind = node.getKindName();
  if (kind === 'PropertyAccessExpression') {
    const access = node as any;
    return access.getName() === 'execPath' && isDirectProcessIdentifier(access.getExpression());
  }
  if (kind === 'ElementAccessExpression') {
    const access = node as any;
    if (access.getArgumentExpression()?.getText() !== '0') return false;
    const receiver = access.getExpression();
    return (
      receiver.getKindName() === 'PropertyAccessExpression' &&
      receiver.getName() === 'argv' &&
      isDirectProcessIdentifier(receiver.getExpression())
    );
  }
  return kind === 'Identifier' && isImportedNodeExecPath(node);
}

function isDirectProcessIdentifier(node: Node): boolean {
  if (node.getKindName() !== 'Identifier' || node.getText() !== 'process') return false;
  const declarations = (node as any).getSymbol?.()?.getDeclarations?.() ?? [];
  if (declarations.length === 0) return true;
  return declarations.every((declaration: Node) => {
    const kind = declaration.getKindName();
    return (kind === 'ImportClause' || kind === 'NamespaceImport') && isNodeProcessImport(declaration);
  });
}

function isImportedNodeExecPath(node: Node): boolean {
  const symbol = (node as any).getSymbol?.();
  for (const declaration of symbol?.getDeclarations?.() ?? []) {
    if (!isNodeProcessImport(declaration)) continue;
    if (
      declaration.getKindName?.() === 'ImportSpecifier' &&
      (declaration as any).getNameNode?.().getText() === 'execPath'
    ) {
      return true;
    }
  }
  return false;
}

function isNodeProcessImport(declaration: Node): boolean {
  let current: Node | undefined = declaration;
  while (current && current.getKindName() !== 'ImportDeclaration') current = current.getParent();
  const specifier = (current as any)?.getModuleSpecifierValue?.();
  return specifier === 'node:process' || specifier === 'process';
}

function directLiteralValue(node: Node): string | undefined {
  const kind = node.getKindName();
  if (kind === 'StringLiteral' || kind === 'NoSubstitutionTemplateLiteral') return (node as any).getLiteralText();
  return undefined;
}
