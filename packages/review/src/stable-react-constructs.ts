import {
  type BindingElement,
  type Identifier,
  Node,
  Project,
  type SourceFile,
  SyntaxKind,
  type VariableDeclaration,
} from 'ts-morph';

// Codex review 2026-05-13 (confidence 0.96): only LIFETIME-stable constructs
// belong here. useMemo/useCallback re-allocate when their deps change — they
// are NOT lifetime-stable, so suppressing on them would drop legitimate
// `exhaustive-deps` findings like:
//   const v = useMemo(..., [id]);  // v changes when id changes
//   useEffect(() => f(v), []);     // exhaustive-deps correctly flags missing v
// useRef is lifetime-stable. useState's setter and useReducer's dispatch are
// always identity-stable per React's contract.
type StableKind = 'useRef' | 'useState-setter' | 'useReducer-dispatch';
type HookKind = 'useRef' | 'useState' | 'useReducer';

type StableReactConstruct = { stable: true; kind: StableKind } | { stable: false };

const REACT_HOOK_MODULES = new Set(['react', 'preact/hooks']);
const REACT_NAMESPACE_NAMES = new Set(['React', 'react']);
const REACT_HOOKS = new Set<HookKind>(['useRef', 'useState', 'useReducer']);

export function isStableReactConstruct(opts: {
  sourceCode: string;
  file: string;
  line: number;
  col: number;
}): StableReactConstruct {
  const project = new Project({
    compilerOptions: { strict: true, target: 99 },
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  const sourceFile = project.createSourceFile(opts.file, opts.sourceCode, { overwrite: true });
  const pos = positionFromLineCol(opts.sourceCode, opts.line, opts.col);
  if (pos === undefined) return { stable: false };

  const identifier = findIdentifierAt(sourceFile, pos);
  if (!identifier) return { stable: false };

  const hookAliases = collectReactHookAliases(sourceFile);
  const declaration = findBindingDeclaration(identifier);
  if (!declaration) return { stable: false };

  if (Node.isVariableDeclaration(declaration)) {
    return classifyVariableDeclaration(declaration, hookAliases);
  }

  if (Node.isBindingElement(declaration)) {
    return classifyBindingElement(declaration, hookAliases);
  }

  return { stable: false };
}

function positionFromLineCol(sourceCode: string, line: number, col: number): number | undefined {
  if (!Number.isInteger(line) || !Number.isInteger(col) || line < 1 || col < 1) return undefined;

  let lineStart = 0;
  for (let currentLine = 1; currentLine < line; currentLine++) {
    const nextNewline = sourceCode.indexOf('\n', lineStart);
    if (nextNewline === -1) return undefined;
    lineStart = nextNewline + 1;
  }

  const pos = lineStart + col - 1;
  return pos <= sourceCode.length ? pos : undefined;
}

function findIdentifierAt(sourceFile: SourceFile, pos: number): Identifier | undefined {
  let node = sourceFile.getDescendantAtPos(pos);
  while (node) {
    if (Node.isIdentifier(node) && node.getStart() <= pos && pos < node.getEnd()) return node;
    node = node.getParent();
  }
  return undefined;
}

function collectReactHookAliases(sourceFile: SourceFile): Map<string, HookKind> {
  const aliases = new Map<string, HookKind>();

  for (const importDeclaration of sourceFile.getImportDeclarations()) {
    if (!REACT_HOOK_MODULES.has(importDeclaration.getModuleSpecifierValue())) continue;

    for (const specifier of importDeclaration.getNamedImports()) {
      const importedName = specifier.getName();
      if (!isReactHook(importedName)) continue;

      const localName = specifier.getAliasNode()?.getText() ?? importedName;
      aliases.set(localName, importedName);
    }
  }

  return aliases;
}

function findBindingDeclaration(identifier: Identifier): VariableDeclaration | BindingElement | undefined {
  const symbolDeclarations = identifier.getSymbol()?.getDeclarations() ?? [];
  for (const declaration of symbolDeclarations) {
    const bindingDeclaration = declarationToBindingDeclaration(declaration);
    if (bindingDeclaration) return bindingDeclaration;
  }

  return declarationToBindingDeclaration(identifier);
}

function declarationToBindingDeclaration(node: Node): VariableDeclaration | BindingElement | undefined {
  let current: Node | undefined = node;
  while (current) {
    if (Node.isVariableDeclaration(current) || Node.isBindingElement(current)) return current;
    current = current.getParent();
  }
  return undefined;
}

function classifyVariableDeclaration(
  declaration: VariableDeclaration,
  hookAliases: ReadonlyMap<string, HookKind>,
): StableReactConstruct {
  if (!Node.isIdentifier(declaration.getNameNode())) return { stable: false };

  const hookKind = getCallHookKind(declaration.getInitializer(), hookAliases);
  if (hookKind === 'useRef') return { stable: true, kind: 'useRef' };
  return { stable: false };
}

function classifyBindingElement(
  declaration: BindingElement,
  hookAliases: ReadonlyMap<string, HookKind>,
): StableReactConstruct {
  const arrayPattern = declaration.getParentIfKind(SyntaxKind.ArrayBindingPattern);
  const variableDeclaration = arrayPattern?.getParentIfKind(SyntaxKind.VariableDeclaration);
  if (!arrayPattern || !variableDeclaration) return { stable: false };

  const elements = arrayPattern.getElements();
  const index = elements.findIndex((element) => element === declaration);
  // Only index 1 of a tuple destructure (the setter/dispatch) is stable.
  if (index !== 1) return { stable: false };

  const hookKind = getCallHookKind(variableDeclaration.getInitializer(), hookAliases);
  if (hookKind === 'useState') return { stable: true, kind: 'useState-setter' };
  if (hookKind === 'useReducer') return { stable: true, kind: 'useReducer-dispatch' };
  return { stable: false };
}

// Resolve a call expression's hook identity, supporting both
// `useRef(...)` (named import or alias) and `React.useRef(...)` (namespace).
function getCallHookKind(node: Node | undefined, hookAliases: ReadonlyMap<string, HookKind>): HookKind | undefined {
  if (!Node.isCallExpression(node)) return undefined;

  const callee = node.getExpression();
  if (Node.isIdentifier(callee)) {
    return hookAliases.get(callee.getText());
  }
  if (Node.isPropertyAccessExpression(callee)) {
    const left = callee.getExpression();
    if (!Node.isIdentifier(left)) return undefined;
    if (!REACT_NAMESPACE_NAMES.has(left.getText())) return undefined;
    const name = callee.getName();
    return isReactHook(name) ? name : undefined;
  }
  return undefined;
}

function isReactHook(name: string): name is HookKind {
  return REACT_HOOKS.has(name as HookKind);
}
