/**
 * MCP10: unsafe-deserialization
 * Detects eval(), new Function(), pickle.loads(), yaml.unsafe_load(),
 * and other dangerous deserialization that can execute arbitrary code.
 * CWE-502
 */

import type { ReviewFinding } from '@kernlang/review';
import { finding } from '../mcp-types.js';
import { isCommentLine, createLexicalMask } from '../mcp-lexical.js';
import { isMCPServer } from '../mcp-regions.js';

const UNSAFE_DESER_TS = /\b(eval\s*\(|new\s+Function\s*\(|vm\.run|vm\.createContext|JSON\.parse\s*\(\s*[^'"`])/g;
const UNSAFE_DESER_PY = /\b(pickle\.loads?|marshal\.loads?|shelve\.open|yaml\.load\s*\(\s*[^,)]+\s*\)|yaml\.unsafe_load|eval\s*\(|exec\s*\(|compile\s*\()/g;

export function unsafeDeserialization(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  if (!isMCPServer(source, filePath)) return findings;

  const isPython = filePath.endsWith('.py');
  const pattern = isPython ? UNSAFE_DESER_PY : UNSAFE_DESER_TS;
  const masked = createLexicalMask(source);
  const lines = masked.split('\n');
  const rawLines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;

    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (match) {
      // Allow JSON.parse with string literal arg — that's safe
      if (match[0].startsWith('JSON.parse') && /JSON\.parse\s*\(\s*['"`]/.test(rawLines[i])) continue;
      // Allow yaml.safe_load — that's the safe variant
      if (match[0].startsWith('yaml.load') && /yaml\.safe_load/.test(rawLines[i])) continue;

      findings.push(finding(
        'mcp-unsafe-deserialization', 'error',
        `Unsafe deserialization: ${match[1] || match[0].trim()} can execute arbitrary code`,
        filePath, i + 1,
        isPython
          ? 'Use json.loads() for JSON, yaml.safe_load() for YAML, or ast.literal_eval() for Python literals'
          : 'Use JSON.parse() with validated input, or a safe schema validator like Zod',
      ));
    }
  }
  return findings;
}
