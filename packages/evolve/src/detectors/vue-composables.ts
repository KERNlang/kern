/**
 * Detector pack: Vue composables (@vueuse/*)
 */

import type { SourceFile } from 'ts-morph';
import type { DetectorPack, DetectionResult } from '../types.js';

const vueUseDetector: DetectorPack = {
  id: 'vueuse-composable',
  libraryName: 'VueUse',
  packageNames: ['@vueuse/core', '@vueuse/integrations'],
  patternKind: 'composable',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Detect custom composables that wrap VueUse primitives
    // Pattern: function useX() { ... useSomeVueUse(...) ... return { ... } }
    const composableRe = /(?:export\s+)?function\s+(use\w+)\s*\([^)]*\)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = composableRe.exec(fullText)) !== null) {
      const fnName = match[1];
      const startLine = fullText.substring(0, match.index).split('\n').length;

      // Find the function body
      let pos = match.index + match[0].length;
      let braceDepth = 1;
      while (pos < fullText.length && braceDepth > 0) {
        if (fullText[pos] === '{') braceDepth++;
        if (fullText[pos] === '}') braceDepth--;
        pos++;
      }
      const fnBody = fullText.substring(match.index, pos);
      const endLine = fullText.substring(0, pos).split('\n').length;

      // Check if the function body uses any @vueuse import
      const vueUseImports = sourceFile.getImportDeclarations().filter(imp => {
        const mod = imp.getModuleSpecifierValue();
        return mod.startsWith('@vueuse/');
      });

      if (vueUseImports.length === 0) continue;

      const usedVueUseApis = vueUseImports.flatMap(imp =>
        imp.getNamedImports().map(n => n.getName()),
      ).filter(name => fnBody.includes(name));

      if (usedVueUseApis.length === 0) continue;

      const snippet = fnBody.substring(0, Math.min(fnBody.length, 300));

      results.push({
        anchorImport: usedVueUseApis[0],
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'composableName', slotType: 'identifier', value: fnName, optional: false },
          { name: 'wrappedApis', slotType: 'expr', value: usedVueUseApis.join(', '), optional: false },
        ],
        confidencePct: 75,
      });
    }

    return results;
  },
};

export const detectors: DetectorPack[] = [vueUseDetector];
