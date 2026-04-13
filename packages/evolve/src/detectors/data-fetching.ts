/**
 * Detector pack: Data fetching libraries (axios, ky)
 */

import type { SourceFile } from 'ts-morph';
import type { DetectionResult, DetectorPack } from '../types.js';

const axiosInstanceDetector: DetectorPack = {
  id: 'axios-instance',
  libraryName: 'Axios',
  packageNames: ['axios'],
  patternKind: 'data-fetching',
  detect(_sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: axios.create({ baseURL, headers, ... })
    const createRe = /(?:export\s+)?const\s+(\w+)\s*=\s*axios\.create\s*\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = createRe.exec(fullText)) !== null) {
      const varName = match[1];
      const startLine = fullText.substring(0, match.index).split('\n').length;

      const afterMatch = fullText.substring(match.index);
      const baseUrlMatch = afterMatch.match(/baseURL\s*:\s*['"]([^'"]+)['"]/);

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
        anchorImport: 'axios',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'instanceName', slotType: 'identifier', value: varName, optional: false },
          { name: 'baseURL', slotType: 'expr', value: baseUrlMatch?.[1] || '/api', optional: true },
        ],
        confidencePct: 82,
      });
    }

    // Pattern: axios interceptor setup
    const interceptorRe = /(\w+)\.interceptors\.(request|response)\.use\s*\(/g;
    while ((match = interceptorRe.exec(fullText)) !== null) {
      const instanceName = match[1];
      const interceptorType = match[2] as 'request' | 'response';
      const startLine = fullText.substring(0, match.index).split('\n').length;

      let pos = match.index + match[0].length;
      let parenDepth = 1;
      while (pos < fullText.length && parenDepth > 0) {
        if (fullText[pos] === '(') parenDepth++;
        if (fullText[pos] === ')') parenDepth--;
        pos++;
      }
      const endLine = fullText.substring(0, pos).split('\n').length;
      const snippet = fullText.substring(match.index, Math.min(pos, match.index + 300));

      results.push({
        anchorImport: 'axios',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'instanceName', slotType: 'identifier', value: instanceName, optional: false },
          { name: 'interceptorType', slotType: 'expr', value: interceptorType, optional: false },
        ],
        confidencePct: 78,
      });
    }

    return results;
  },
};

const kyDetector: DetectorPack = {
  id: 'ky-instance',
  libraryName: 'Ky',
  packageNames: ['ky'],
  patternKind: 'data-fetching',
  detect(_sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: ky.create({ prefixUrl, hooks })
    const createRe = /(?:export\s+)?const\s+(\w+)\s*=\s*ky\.create\s*\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = createRe.exec(fullText)) !== null) {
      const varName = match[1];
      const startLine = fullText.substring(0, match.index).split('\n').length;

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
        anchorImport: 'ky',
        startLine,
        endLine,
        snippet,
        extractedParams: [{ name: 'instanceName', slotType: 'identifier', value: varName, optional: false }],
        confidencePct: 78,
      });
    }

    return results;
  },
};

export const detectors: DetectorPack[] = [axiosInstanceDetector, kyDetector];
