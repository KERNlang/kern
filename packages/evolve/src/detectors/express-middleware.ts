/**
 * Detector pack: Express middleware (cors, helmet, rate-limit)
 */

import type { SourceFile } from 'ts-morph';
import type { DetectionResult, DetectorPack } from '../types.js';

const expressMiddlewareDetector: DetectorPack = {
  id: 'express-middleware',
  libraryName: 'Express Middleware',
  packageNames: ['cors', 'helmet', 'express-rate-limit'],
  patternKind: 'middleware',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];
    const imports = sourceFile.getImportDeclarations();

    // Detect app.use(cors(...)) patterns — only multi-middleware stacks are template-worthy
    const appUseRe = /app\.use\s*\(\s*(\w+)\s*\(\s*(\{[^}]*\})?\s*\)\s*\)/g;
    const middlewareCalls: Array<{
      name: string;
      startLine: number;
      endLine: number;
      snippet: string;
      config: string;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = appUseRe.exec(fullText)) !== null) {
      const mwName = match[1];
      const config = match[2] || '';
      const startLine = fullText.substring(0, match.index).split('\n').length;
      const endLine = fullText.substring(0, match.index + match[0].length).split('\n').length;
      const snippet = match[0];

      // Only detect if the middleware import exists
      const hasImport = imports.some((imp) => {
        const names = imp.getNamedImports().map((n) => n.getName());
        const defaultName = imp.getDefaultImport()?.getText();
        return names.includes(mwName) || defaultName === mwName;
      });

      if (hasImport) {
        middlewareCalls.push({ name: mwName, startLine, endLine, snippet, config });
      }
    }

    // Only create a detection if there are 2+ middleware calls (pattern worth templating)
    if (middlewareCalls.length >= 2) {
      results.push({
        anchorImport: middlewareCalls[0].name,
        startLine: middlewareCalls[0].startLine,
        endLine: middlewareCalls[middlewareCalls.length - 1].endLine,
        snippet: middlewareCalls.map((m) => m.snippet).join('\n'),
        extractedParams: middlewareCalls.map((m) => ({
          name: m.name,
          slotType: 'expr' as const,
          value: m.config || '{}',
          optional: true,
        })),
        confidencePct: 72,
      });
    }

    return results;
  },
};

export const detectors: DetectorPack[] = [expressMiddlewareDetector];
