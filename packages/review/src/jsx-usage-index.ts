import { Node, type Project, type SourceFile, SyntaxKind } from 'ts-morph';
import { canonicalize } from './path-canonical.js';
import type { GraphFile, GraphResult } from './types.js';

export interface JsxUsageSite {
  file: string;
  line: number;
  col: number;
  localName: string;
  parentComponentName?: string;
  inlinePropNames: string[];
}

export interface JsxUsageIndex {
  findUsages(file: string, exportName: string): JsxUsageSite[];
}

interface ResolvedBinding {
  targetFile: string;
  targetName: string;
}

interface ImportBinding extends ResolvedBinding {
  kind: 'named' | 'default' | 'namespace';
  members?: Map<string, ResolvedBinding>;
}

type JsxElementLike = import('ts-morph').JsxOpeningElement | import('ts-morph').JsxSelfClosingElement;

export function buildJsxUsageIndex(project: Project, graph: GraphResult): JsxUsageIndex {
  const graphFiles = new Map<string, GraphFile>();
  for (const gf of graph.files) graphFiles.set(canonicalize(gf.canonicalPath), gf);

  const buckets = new Map<string, JsxUsageSite[]>();

  for (const gf of graph.files) {
    const file = canonicalize(gf.canonicalPath);
    if (!isJsxFile(file) || isTestFile(file)) continue;
    const sf = project.getSourceFile(file) ?? project.getSourceFile(gf.path);
    if (!sf) continue;

    const bindings = buildImportBindings(sf, graphFiles);
    const elements: JsxElementLike[] = [
      ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ].sort((a, b) => a.getStart() - b.getStart());

    for (const el of elements) {
      const resolved = resolveJsxTag(el.getTagNameNode(), bindings);
      if (!resolved) continue;

      const pos = sf.getLineAndColumnAtPos(el.getStart());
      const site: JsxUsageSite = {
        file,
        line: pos.line,
        col: pos.column,
        localName: el.getTagNameNode().getText(),
        inlinePropNames: getInlinePropNames(el),
      };
      const parentComponentName = getParentComponentName(el);
      if (parentComponentName) site.parentComponentName = parentComponentName;

      const key = `${resolved.targetFile}#${resolved.targetName}`;
      const sites = buckets.get(key) ?? [];
      sites.push(site);
      buckets.set(key, sites);
    }
  }

  return {
    findUsages(file: string, exportName: string): JsxUsageSite[] {
      return (buckets.get(`${canonicalize(file)}#${exportName}`) ?? []).map((site) => ({
        ...site,
        inlinePropNames: [...site.inlinePropNames],
      }));
    },
  };
}

function buildImportBindings(sourceFile: SourceFile, graphFiles: Map<string, GraphFile>): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  for (const decl of sourceFile.getImportDeclarations()) {
    if (decl.isTypeOnly()) continue;
    const resolvedSf = resolveImportSourceFile(sourceFile, decl, graphFiles);
    if (!resolvedSf) continue;

    for (const named of decl.getNamedImports()) {
      if (named.isTypeOnly()) continue;
      const importedName = named.getName();
      const localName = named.getAliasNode()?.getText() ?? importedName;
      const target = resolveExportBinding(resolvedSf, importedName, graphFiles);
      if (target) bindings.set(localName, { kind: 'named', ...target });
    }

    const defaultImport = decl.getDefaultImport();
    if (defaultImport) {
      const target = resolveExportBinding(resolvedSf, 'default', graphFiles);
      if (target) bindings.set(defaultImport.getText(), { kind: 'default', ...target });
    }

    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport) {
      const targetFile = canonicalize(resolvedSf.getFilePath());
      bindings.set(namespaceImport.getText(), {
        kind: 'namespace',
        targetFile,
        targetName: '*',
        members: buildNamespaceMembers(resolvedSf, graphFiles),
      });
    }
  }

  return bindings;
}

function resolveImportSourceFile(
  sourceFile: SourceFile,
  decl: import('ts-morph').ImportDeclaration,
  graphFiles: Map<string, GraphFile>,
): SourceFile | undefined {
  try {
    const resolved = decl.getModuleSpecifierSourceFile() ?? undefined;
    if (resolved && graphFiles.has(canonicalize(resolved.getFilePath()))) return resolved;
  } catch {
    /* fall back to graph edge */
  }

  let specifier: string;
  try {
    specifier = decl.getModuleSpecifierValue();
  } catch {
    return undefined;
  }

  const graphFile = graphFiles.get(canonicalize(sourceFile.getFilePath()));
  const edge = graphFile?.importEdges.find((candidate) => candidate.specifier === specifier);
  return edge ? sourceFile.getProject().getSourceFile(edge.to) : undefined;
}

function buildNamespaceMembers(sourceFile: SourceFile, graphFiles: Map<string, GraphFile>): Map<string, ResolvedBinding> {
  const members = new Map<string, ResolvedBinding>();
  for (const exportName of sourceFile.getExportedDeclarations().keys()) {
    const resolved = resolveExportBinding(sourceFile, exportName, graphFiles);
    if (resolved) members.set(exportName, resolved);
  }
  return members;
}

function resolveExportBinding(
  sourceFile: SourceFile,
  exportName: string,
  graphFiles: Map<string, GraphFile>,
  visited: Set<string> = new Set(),
): ResolvedBinding | undefined {
  const sourcePath = canonicalize(sourceFile.getFilePath());
  const key = `${sourcePath}#${exportName}`;
  if (visited.has(key)) return undefined;
  visited.add(key);

  const chased = chaseExportThroughBarrels(sourceFile, exportName, graphFiles, visited);
  if (chased) return chased;

  const decls = sourceFile.getExportedDeclarations().get(exportName);
  if (!decls || decls.length === 0) return undefined;
  for (const decl of decls) {
    const targetFile = canonicalize(decl.getSourceFile().getFilePath());
    if (!graphFiles.has(targetFile)) continue;
    // Normalize `export default function Foo` / `export default class Foo` to
    // the declaration's own name — mirrors call-graph.ts so cross-file lookups
    // by declaration name work the same way. Anonymous `export default { ... }`
    // keeps `default` as its key.
    let targetName = exportName;
    if (exportName === 'default') {
      const declName =
        Node.isFunctionDeclaration(decl) || Node.isClassDeclaration(decl)
          ? decl.getName()
          : undefined;
      if (declName) targetName = declName;
    }
    return { targetFile, targetName };
  }
  return undefined;
}

function chaseExportThroughBarrels(
  sourceFile: SourceFile,
  exportName: string,
  graphFiles: Map<string, GraphFile>,
  visited: Set<string>,
): ResolvedBinding | undefined {
  for (const exportDecl of sourceFile.getExportDeclarations()) {
    if (exportDecl.isTypeOnly() || !exportDecl.hasModuleSpecifier()) continue;

    let targetSf: SourceFile | undefined;
    try {
      targetSf = exportDecl.getModuleSpecifierSourceFile() ?? undefined;
    } catch {
      continue;
    }
    if (!targetSf || !graphFiles.has(canonicalize(targetSf.getFilePath()))) continue;

    const namedExports = exportDecl.getNamedExports();
    if (namedExports.length === 0) {
      const resolved = resolveExportBinding(targetSf, exportName, graphFiles, visited);
      if (resolved) return resolved;
      continue;
    }

    for (const named of namedExports) {
      if (named.isTypeOnly()) continue;
      const outgoingName = named.getAliasNode()?.getText() ?? named.getName();
      if (outgoingName !== exportName) continue;
      const resolved = resolveExportBinding(targetSf, named.getName(), graphFiles, visited);
      if (resolved) return resolved;
    }
  }
  return undefined;
}

function resolveJsxTag(tag: import('ts-morph').JsxTagNameExpression, bindings: Map<string, ImportBinding>): ResolvedBinding | undefined {
  if (Node.isIdentifier(tag)) {
    const binding = bindings.get(tag.getText());
    return binding?.kind === 'namespace' ? undefined : binding;
  }
  if (!Node.isPropertyAccessExpression(tag)) return undefined;

  const receiver = tag.getExpression();
  if (!Node.isIdentifier(receiver)) return undefined;
  const binding = bindings.get(receiver.getText());
  if (!binding) return undefined;
  if (binding.kind === 'namespace') return binding.members?.get(tag.getName());
  // Member access on a default import (`<Lib.Foo />` where `Lib` came from a
  // default export, typically `export default { Foo }`) is indexed against the
  // source's default export — there's no per-member resolution for object
  // defaults, so we surface the parent binding instead.
  if (binding.kind === 'default') {
    return { targetFile: binding.targetFile, targetName: binding.targetName };
  }
  return undefined;
}

function getInlinePropNames(el: JsxElementLike): string[] {
  const names: string[] = [];
  for (const attr of el.getAttributes()) {
    if (!Node.isJsxAttribute(attr)) continue;
    const init = attr.getInitializer();
    if (!init || !Node.isJsxExpression(init)) continue;
    const expr = init.getExpression();
    if (
      expr &&
      (Node.isObjectLiteralExpression(expr) ||
        Node.isArrayLiteralExpression(expr) ||
        Node.isArrowFunction(expr) ||
        Node.isFunctionExpression(expr))
    ) {
      names.push(attr.getNameNode().getText());
    }
  }
  return [...names].sort();
}

function getParentComponentName(node: Node): string | undefined {
  let cur = node.getParent();
  while (cur) {
    if (Node.isFunctionDeclaration(cur)) return cur.getName() ?? undefined;
    if (Node.isArrowFunction(cur) || Node.isFunctionExpression(cur)) {
      const parent = cur.getParent();
      if (parent && Node.isVariableDeclaration(parent)) return parent.getNameNode().getText();
    }
    cur = cur.getParent();
  }
  return undefined;
}

function isJsxFile(file: string): boolean {
  return /\.(t|j)sx$/i.test(file);
}

function isTestFile(file: string): boolean {
  return /\.test\.(t|j)sx?$/i.test(file) || /\.spec\.(t|j)sx?$/i.test(file) || /(^|[\\/])__tests__([\\/]|$)/.test(file);
}
