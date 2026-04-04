/**
 * Detector pack: State management (recoil, redux-toolkit, mobx)
 */

import type { SourceFile } from 'ts-morph';
import type { DetectionResult, DetectorPack } from '../types.js';

const recoilAtomDetector: DetectorPack = {
  id: 'recoil-atom',
  libraryName: 'Recoil',
  packageNames: ['recoil'],
  patternKind: 'state-management',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: atom({ key, default }) or atom<Type>({ key, default })
    const atomRe = /(?:export\s+)?const\s+(\w+)\s*=\s*atom\s*(?:<\s*([^>]+)\s*>)?\s*\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = atomRe.exec(fullText)) !== null) {
      // Make sure it's recoil atom, not jotai
      const imports = sourceFile.getImportDeclarations();
      const isRecoil = imports.some(
        (imp) =>
          imp.getModuleSpecifierValue() === 'recoil' && imp.getNamedImports().some((n) => n.getName() === 'atom'),
      );
      if (!isRecoil) continue;

      const varName = match[1];
      const typeParam = match[2] || 'unknown';
      const startLine = fullText.substring(0, match.index).split('\n').length;

      // Extract key value
      const afterMatch = fullText.substring(match.index);
      const keyMatch = afterMatch.match(/key\s*:\s*['"]([^'"]+)['"]/);
      const defaultMatch = afterMatch.match(/default\s*:\s*([^,\n}]+)/);

      let pos = match.index + match[0].length;
      let braceDepth = 1;
      while (pos < fullText.length && braceDepth > 0) {
        if (fullText[pos] === '{') braceDepth++;
        if (fullText[pos] === '}') braceDepth--;
        pos++;
      }
      if (pos < fullText.length && fullText[pos] === ')') pos++;
      const endLine = fullText.substring(0, pos).split('\n').length;
      const snippet = fullText.substring(match.index, Math.min(pos, match.index + 300));

      results.push({
        anchorImport: 'atom',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'atomName', slotType: 'identifier', value: varName.replace(/State$|Atom$/, ''), optional: false },
          { name: 'atomType', slotType: 'type', value: typeParam.trim(), optional: false },
          { name: 'atomKey', slotType: 'expr', value: keyMatch?.[1] || varName, optional: false },
          { name: 'defaultValue', slotType: 'expr', value: defaultMatch?.[1]?.trim() || 'null', optional: true },
        ],
        confidencePct: 85,
      });
    }

    return results;
  },
};

const reduxSliceDetector: DetectorPack = {
  id: 'redux-toolkit-slice',
  libraryName: 'Redux Toolkit',
  packageNames: ['@reduxjs/toolkit'],
  patternKind: 'state-management',
  detect(_sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: createSlice({ name, initialState, reducers })
    const sliceRe = /(?:export\s+)?const\s+(\w+)\s*=\s*createSlice\s*\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = sliceRe.exec(fullText)) !== null) {
      const varName = match[1];
      const startLine = fullText.substring(0, match.index).split('\n').length;

      const afterMatch = fullText.substring(match.index);
      const nameMatch = afterMatch.match(/name\s*:\s*['"]([^'"]+)['"]/);

      let pos = match.index + match[0].length;
      let braceDepth = 1;
      while (pos < fullText.length && braceDepth > 0) {
        if (fullText[pos] === '{') braceDepth++;
        if (fullText[pos] === '}') braceDepth--;
        pos++;
      }
      if (pos < fullText.length && fullText[pos] === ')') pos++;
      const endLine = fullText.substring(0, pos).split('\n').length;
      const snippet = fullText.substring(match.index, Math.min(pos, match.index + 400));

      results.push({
        anchorImport: 'createSlice',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'sliceName', slotType: 'identifier', value: varName.replace(/Slice$/, ''), optional: false },
          { name: 'sliceKey', slotType: 'expr', value: nameMatch?.[1] || varName, optional: false },
        ],
        confidencePct: 88,
      });
    }

    return results;
  },
};

export const detectors: DetectorPack[] = [recoilAtomDetector, reduxSliceDetector];
