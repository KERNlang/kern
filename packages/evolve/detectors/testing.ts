/**
 * Detector pack: Testing libraries (@testing-library/*)
 */

import type { SourceFile } from 'ts-morph';
import type { DetectorPack, DetectionResult } from '../src/types.js';

const testingLibraryDetector: DetectorPack = {
  id: 'testing-library',
  libraryName: 'Testing Library',
  packageNames: ['@testing-library/react', '@testing-library/vue', '@testing-library/user-event'],
  patternKind: 'testing',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: render(<Component />) with screen.getByX queries
    const renderBlockRe = /render\s*\(\s*<\s*(\w+)/g;
    let match: RegExpExecArray | null;
    while ((match = renderBlockRe.exec(fullText)) !== null) {
      const componentName = match[1];
      const startLine = fullText.substring(0, match.index).split('\n').length;

      // Find the test block this render is in
      const beforeRender = fullText.substring(0, match.index);
      const testMatch = beforeRender.match(/(?:it|test)\s*\(\s*['"]([^'"]+)['"]\s*,\s*(?:async\s*)?\(\)\s*=>\s*\{[^]*$/);

      // Count screen.getBy/findBy/queryBy calls after render
      const afterRender = fullText.substring(match.index);
      const screenCalls = (afterRender.match(/screen\.(getBy|findBy|queryBy)\w+/g) || []).length;

      if (screenCalls < 2) continue; // Not enough pattern to template

      // Find end of test block
      let pos = match.index;
      let braceDepth = 0;
      while (pos < fullText.length) {
        if (fullText[pos] === '{') braceDepth++;
        if (fullText[pos] === '}') {
          braceDepth--;
          if (braceDepth <= 0) break;
        }
        pos++;
      }
      const endLine = fullText.substring(0, pos).split('\n').length;
      const snippet = fullText.substring(match.index, Math.min(pos, match.index + 300));

      results.push({
        anchorImport: 'render',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'componentName', slotType: 'identifier', value: componentName, optional: false },
          { name: 'testDescription', slotType: 'expr', value: testMatch?.[1] || 'renders correctly', optional: true },
        ],
        confidencePct: 70,
      });
    }

    return results;
  },
};

export const detectors: DetectorPack[] = [testingLibraryDetector];
