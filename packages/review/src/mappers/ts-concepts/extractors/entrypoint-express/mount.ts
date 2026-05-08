import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { SyntaxKind } from 'ts-morph';
import { getContainerId, span } from '../../helpers/ast.js';

// Express `app.use('/api/prefix', ...middlewares, subRouter)`: emit a
// route-mount concept so `collectRoutesAcrossGraph` can join the sub-router's
// bare paths (`router.get('/foo')`) with the mount prefix (`/api/prefix/foo`).
// Mirrors the FastAPI `app.include_router()` emission in review-python.
// Caller must have already filtered to `.use()` calls whose object matches
// `app|router|server`.
export function extractRouteMount(call: import('ts-morph').CallExpression, mountFile: string): ConceptNode | undefined {
  const args = call.getArguments();
  if (args.length < 2) return undefined;
  if (args[0].getKind() !== SyntaxKind.StringLiteral) return undefined;
  const prefix = (args[0] as import('ts-morph').StringLiteral).getLiteralValue();
  if (!prefix.startsWith('/')) return undefined;

  // The sub-router is the LAST arg; intermediate args are middlewares.
  const last = args[args.length - 1];
  if (last.getKind() !== SyntaxKind.Identifier) return undefined;
  const ident = last as import('ts-morph').Identifier;
  const routerName = ident.getText();

  const sourceModule = resolveImportedFileSuffix(ident, mountFile);
  return {
    id: conceptId(mountFile, 'entrypoint', call.getStart()),
    kind: 'entrypoint',
    primarySpan: span(mountFile, call),
    evidence: call.getText().substring(0, 120),
    confidence: 0.9,
    language: 'ts',
    containerId: getContainerId(call, mountFile),
    payload: {
      kind: 'entrypoint',
      subtype: 'route-mount',
      name: prefix,
      routerName,
      sourceModule,
    },
  };
}

// Given an identifier used in a mount call, resolve it back to the file it
// was imported from, and return a trailing path suffix (relative to the mount
// file's directory, with extension) usable by `cross-stack-utils`'s
// `routeFile.endsWith('/' + sourceModule)` matcher.
function resolveImportedFileSuffix(ident: import('ts-morph').Identifier, mountFile: string): string | undefined {
  const symbol = ident.getSymbol();
  if (!symbol) return undefined;
  for (const decl of symbol.getDeclarations()) {
    const kind = decl.getKind();
    if (kind !== SyntaxKind.ImportClause && kind !== SyntaxKind.ImportSpecifier) continue;
    const importDecl = decl.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    if (!importDecl) continue;
    const resolved = importDecl.getModuleSpecifierSourceFile();
    if (resolved) {
      return pathSuffixBetween(mountFile, resolved.getFilePath());
    }
    const specifier = importDecl.getModuleSpecifierValue();
    const guess = guessResolvedSuffix(specifier, mountFile);
    if (guess) return guess;
  }
  return undefined;
}

function pathSuffixBetween(mountFile: string, targetFile: string): string {
  const parts = targetFile.split('/');
  const mountParts = mountFile.split('/');
  let commonLen = 0;
  while (
    commonLen < parts.length - 1 &&
    commonLen < mountParts.length - 1 &&
    parts[commonLen] === mountParts[commonLen]
  ) {
    commonLen++;
  }
  const tail = parts.slice(commonLen).join('/');
  return tail || parts.slice(-2).join('/');
}

function guessResolvedSuffix(specifier: string, mountFile: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const mountDir = mountFile.split('/').slice(0, -1).join('/');
  const segments: string[] = [];
  for (const seg of specifier.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (mountDir.length === 0) continue;
      segments.pop();
    } else {
      segments.push(seg);
    }
  }
  if (segments.length === 0) return undefined;
  const base = segments[segments.length - 1];
  const swapped = base.replace(/\.(js|mjs|cjs)$/i, '.ts');
  segments[segments.length - 1] = /\.(ts|tsx)$/i.test(swapped) ? swapped : `${swapped}.ts`;
  return segments.join('/');
}
