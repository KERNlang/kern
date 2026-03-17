/**
 * Detector pack: Animation libraries (framer-motion)
 */

import type { SourceFile } from 'ts-morph';
import type { DetectorPack, DetectionResult } from '../types.js';

const framerMotionDetector: DetectorPack = {
  id: 'framer-motion',
  libraryName: 'Framer Motion',
  packageNames: ['framer-motion', 'motion'],
  patternKind: 'animation',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: useAnimation() or useMotionValue() or motion.div with animate prop
    const animateRe = /(?:const|let)\s+(\w+)\s*=\s*useAnimation\s*\(\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = animateRe.exec(fullText)) !== null) {
      const varName = match[1];
      const startLine = fullText.substring(0, match.index).split('\n').length;
      const endLine = startLine;
      const snippet = fullText.substring(match.index, match.index + match[0].length);

      results.push({
        anchorImport: 'useAnimation',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'controlsName', slotType: 'identifier', value: varName, optional: false },
        ],
        confidencePct: 80,
      });
    }

    // Pattern: variants object for motion components
    const variantsRe = /(?:export\s+)?const\s+(\w+)\s*(?::\s*Variants)?\s*=\s*\{[^}]*(?:hidden|visible|initial|animate|exit|enter|center|closed|open)\s*:/g;
    while ((match = variantsRe.exec(fullText)) !== null) {
      const hasImport = sourceFile.getImportDeclarations().some(imp => {
        const mod = imp.getModuleSpecifierValue();
        return mod === 'framer-motion' || mod === 'motion' || mod.startsWith('motion/') || mod.startsWith('framer-motion/');
      });
      if (!hasImport) continue;

      const varName = match[1];
      const startLine = fullText.substring(0, match.index).split('\n').length;

      let pos = match.index + match[0].length;
      let braceDepth = 1;
      while (pos < fullText.length && braceDepth > 0) {
        if (fullText[pos] === '{') braceDepth++;
        if (fullText[pos] === '}') braceDepth--;
        pos++;
      }
      const endLine = fullText.substring(0, pos).split('\n').length;
      const snippet = fullText.substring(match.index, Math.min(pos, match.index + 300));

      results.push({
        anchorImport: 'Variants',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'variantsName', slotType: 'identifier', value: varName, optional: false },
        ],
        confidencePct: 75,
      });
    }

    return results;
  },
};

export const detectors: DetectorPack[] = [framerMotionDetector];
