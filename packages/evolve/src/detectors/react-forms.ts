/**
 * Detector pack: React form libraries (react-hook-form, formik)
 */

import type { SourceFile } from 'ts-morph';
import type { DetectorPack, DetectionResult } from '../types.js';

const reactHookFormDetector: DetectorPack = {
  id: 'react-hook-form',
  libraryName: 'React Hook Form',
  packageNames: ['react-hook-form'],
  patternKind: 'form-hook',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: useForm<Schema>() with destructured register, handleSubmit, formState
    const useFormRe = /(?:const|let)\s+\{([^}]+)\}\s*=\s*useForm\s*(?:<\s*(\w+)\s*>)?\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = useFormRe.exec(fullText)) !== null) {
      const destructured = match[1].trim();
      const schemaType = match[2] || 'any';
      const startLine = fullText.substring(0, match.index).split('\n').length;

      // Find the enclosing function/component for end line
      const remaining = fullText.substring(match.index);
      const closingMatch = remaining.match(/\}\s*\)/);
      const endOffset = closingMatch ? match.index + closingMatch.index! + closingMatch[0].length : match.index + match[0].length;
      const endLine = fullText.substring(0, endOffset).split('\n').length;

      // Try to extract the component/function name
      const beforeMatch = fullText.substring(0, match.index);
      const fnNameMatch = beforeMatch.match(/(?:function|const)\s+(\w+)\s*(?:=|[\(<])[^]*?$/);
      const formName = fnNameMatch ? fnNameMatch[1] : 'Form';

      const snippet = fullText.substring(match.index, Math.min(endOffset, match.index + 300));

      results.push({
        anchorImport: 'useForm',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'formName', slotType: 'identifier', value: formName, optional: false },
          { name: 'schema', slotType: 'type', value: schemaType, optional: false },
          { name: 'fields', slotType: 'expr', value: destructured, optional: true },
        ],
        confidencePct: schemaType !== 'any' ? 90 : 75,
      });
    }

    return results;
  },
};

const formikDetector: DetectorPack = {
  id: 'formik',
  libraryName: 'Formik',
  packageNames: ['formik'],
  patternKind: 'form-hook',
  detect(sourceFile: SourceFile, fullText: string): DetectionResult[] {
    const results: DetectionResult[] = [];

    // Pattern: useFormik({ initialValues, validationSchema, onSubmit })
    const useFormikRe = /(?:const|let)\s+(\w+)\s*=\s*useFormik\s*(?:<\s*(\w+)\s*>)?\s*\(\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = useFormikRe.exec(fullText)) !== null) {
      const varName = match[1];
      const typeParam = match[2] || 'any';
      const startLine = fullText.substring(0, match.index).split('\n').length;

      // Find end of the useFormik call
      let braceDepth = 1;
      let pos = match.index + match[0].length;
      while (pos < fullText.length && braceDepth > 0) {
        if (fullText[pos] === '{') braceDepth++;
        if (fullText[pos] === '}') braceDepth--;
        pos++;
      }
      // Skip past the closing )
      if (pos < fullText.length && fullText[pos] === ')') pos++;
      const endLine = fullText.substring(0, pos).split('\n').length;
      const snippet = fullText.substring(match.index, Math.min(pos, match.index + 300));

      results.push({
        anchorImport: 'useFormik',
        startLine,
        endLine,
        snippet,
        extractedParams: [
          { name: 'formikName', slotType: 'identifier', value: varName, optional: false },
          { name: 'valuesType', slotType: 'type', value: typeParam, optional: false },
        ],
        confidencePct: typeParam !== 'any' ? 85 : 70,
      });
    }

    return results;
  },
};

export const detectors: DetectorPack[] = [reactHookFormDetector, formikDetector];
