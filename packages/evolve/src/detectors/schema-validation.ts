/**
 * Detector pack: Schema validation (yup, valibot)
 */

import type { SourceFile } from 'ts-morph';
import type { DetectionResult, DetectorPack } from '../types.js';

const yupSchemaDetector: DetectorPack = {
  id: 'yup-schema',
  libraryName: 'Yup',
  packageNames: ['yup'],
  patternKind: 'schema-validation',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: yup.object({ field: yup.string().required() })
    const schemaRe = /(?:export\s+)?const\s+(\w+)\s*=\s*(?:yup\s*\.\s*)?object\s*\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = schemaRe.exec(fullText)) !== null) {
      const hasYupImport = sourceFile.getImportDeclarations().some((imp) => imp.getModuleSpecifierValue() === 'yup');
      if (!hasYupImport) continue;

      const varName = match[1];
      const startLine = fullText.substring(0, match.index).split('\n').length;

      let pos = match.index + match[0].length;
      let braceDepth = 1;
      while (pos < fullText.length && braceDepth > 0) {
        if (fullText[pos] === '{') braceDepth++;
        if (fullText[pos] === '}') braceDepth--;
        pos++;
      }
      // Skip closing parens
      while (pos < fullText.length && (fullText[pos] === ')' || fullText[pos] === ';')) pos++;
      const endLine = fullText.substring(0, pos).split('\n').length;
      const snippet = fullText.substring(match.index, Math.min(pos, match.index + 400));

      results.push({
        anchorImport: 'yup',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'schemaName', slotType: 'identifier', value: varName.replace(/Schema$/, ''), optional: false },
        ],
        confidencePct: 82,
      });
    }

    return results;
  },
};

const valibotDetector: DetectorPack = {
  id: 'valibot-schema',
  libraryName: 'Valibot',
  packageNames: ['valibot'],
  patternKind: 'schema-validation',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: v.object({ field: v.string() })
    const schemaRe = /(?:export\s+)?const\s+(\w+)\s*=\s*v\s*\.\s*object\s*\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = schemaRe.exec(fullText)) !== null) {
      const hasImport = sourceFile.getImportDeclarations().some((imp) => imp.getModuleSpecifierValue() === 'valibot');
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
      while (pos < fullText.length && (fullText[pos] === ')' || fullText[pos] === ';')) pos++;
      const endLine = fullText.substring(0, pos).split('\n').length;
      const snippet = fullText.substring(match.index, Math.min(pos, match.index + 400));

      results.push({
        anchorImport: 'valibot',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'schemaName', slotType: 'identifier', value: varName.replace(/Schema$/, ''), optional: false },
        ],
        confidencePct: 80,
      });
    }

    return results;
  },
};

export const detectors: DetectorPack[] = [yupSchemaDetector, valibotDetector];
