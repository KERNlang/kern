import type { ConceptNode } from '@kernlang/core';
import { conceptId } from '@kernlang/core';
import { type SourceFile, SyntaxKind } from 'ts-morph';
import { span } from '../helpers/ast.js';
import { NEXTJS_HTTP_METHODS } from '../signatures.js';

function hasUseServerDirective(sf: SourceFile): boolean {
  const text = sf.getFullText();
  return /^\s*['"]use server['"];?\s*$/m.test(text.substring(0, 200));
}

export function extractNextjsHandlers(sf: SourceFile, filePath: string, nodes: ConceptNode[]): void {
  // Track offsets we already emitted as entrypoints, to avoid duplication with extractEntrypoints
  const emittedOffsets = new Set<number>();

  // 1. App Router API route handlers: export async function GET/POST/PUT/DELETE/PATCH/HEAD/OPTIONS
  for (const [name, decls] of sf.getExportedDeclarations()) {
    if (!NEXTJS_HTTP_METHODS.has(name)) continue;
    for (const decl of decls) {
      if (decl.getKind() !== SyntaxKind.FunctionDeclaration) continue;
      const fn = decl as import('ts-morph').FunctionDeclaration;
      emittedOffsets.add(fn.getStart());
      nodes.push({
        id: conceptId(filePath, 'entrypoint', fn.getStart()),
        kind: 'entrypoint',
        primarySpan: span(filePath, fn),
        evidence: fn.getText().substring(0, 120),
        confidence: 0.95,
        language: 'ts',
        payload: {
          kind: 'entrypoint',
          subtype: 'route',
          name,
          httpMethod: name,
        },
      });
    }
  }

  // 2. Pages Router: default export with NextApiRequest/NextApiResponse params OR file in api/ path
  const isApiPath = /\/api\//.test(filePath) || /\/pages\/api\//.test(filePath);
  for (const [name, decls] of sf.getExportedDeclarations()) {
    if (name !== 'default') continue;
    for (const decl of decls) {
      if (decl.getKind() !== SyntaxKind.FunctionDeclaration) continue;
      const fn = decl as import('ts-morph').FunctionDeclaration;
      if (emittedOffsets.has(fn.getStart())) continue;

      const params = fn.getParameters();
      const paramTypes = params.map((p) => p.getType().getText()).join(',');
      const hasNextApiParams =
        /NextApiRequest|NextApiResponse/.test(paramTypes) ||
        /NextApiRequest|NextApiResponse/.test(params.map((p) => p.getText()).join(','));

      if (hasNextApiParams || isApiPath) {
        emittedOffsets.add(fn.getStart());
        nodes.push({
          id: conceptId(filePath, 'entrypoint', fn.getStart()),
          kind: 'entrypoint',
          primarySpan: span(filePath, fn),
          evidence: fn.getText().substring(0, 120),
          confidence: hasNextApiParams ? 0.95 : 0.85,
          language: 'ts',
          payload: {
            kind: 'entrypoint',
            subtype: 'handler',
            name: fn.getName() || 'default',
          },
        });
      }
    }
  }

  // 3. Server actions: files with 'use server' directive — all exported async functions are server actions
  if (hasUseServerDirective(sf)) {
    for (const [name, decls] of sf.getExportedDeclarations()) {
      if (name === 'default') continue;
      for (const decl of decls) {
        if (decl.getKind() !== SyntaxKind.FunctionDeclaration) continue;
        const fn = decl as import('ts-morph').FunctionDeclaration;
        if (!fn.isAsync()) continue;
        if (emittedOffsets.has(fn.getStart())) continue;

        nodes.push({
          id: conceptId(filePath, 'entrypoint', fn.getStart()),
          kind: 'entrypoint',
          primarySpan: span(filePath, fn),
          evidence: fn.getText().substring(0, 120),
          confidence: 0.95,
          language: 'ts',
          payload: {
            kind: 'entrypoint',
            subtype: 'handler',
            name: fn.getName() || name,
          },
        });
      }
    }
  }
}
