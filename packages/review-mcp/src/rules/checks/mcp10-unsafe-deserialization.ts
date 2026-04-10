/**
 * MCP10: unsafe-deserialization
 * Detects eval(), new Function(), pickle.loads(), yaml.unsafe_load(),
 * and other dangerous deserialization that can execute arbitrary code.
 * CWE-502
 */

import type { ReviewFinding } from '@kernlang/review';
import { createLexicalMask, isCommentLine } from '../mcp-lexical.js';
import { isMCPServer } from '../mcp-regions.js';
import { finding } from '../mcp-types.js';

const UNSAFE_DESER_TS = /\b(eval\s*\(|new\s+Function\s*\(|vm\.run|vm\.createContext|JSON\.parse\s*\(\s*[^'"`])/g;
const UNSAFE_DESER_PY =
  /\b(pickle\.loads?|marshal\.loads?|shelve\.open|yaml\.load\s*\(\s*[^,)]+\s*\)|yaml\.unsafe_load|eval\s*\(|exec\s*\(|(?<!re\.)compile\s*\()/g;

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
      // Allow JSON.parse when the same arg was sanitized/size-checked upstream (KERN transpiler guards)
      if (match[0].startsWith('JSON.parse')) {
        const argMatch = rawLines[i].match(/JSON\.parse\s*\(\s*([\w.[\]"']+)/);
        if (argMatch) {
          // Normalize: params["headers"] and params.headers → params.headers
          const argNorm = argMatch[1].replace(/\["([^"]+)"\]/g, '.$1').replace(/\['([^']+)'\]/g, '.$1');
          const preceding = rawLines.slice(Math.max(0, i - 30), i).join('\n');
          // Normalize preceding lines the same way for matching
          const precNorm = preceding.replace(/\["([^"]+)"\]/g, '.$1').replace(/\['([^']+)'\]/g, '.$1');
          const escaped = argNorm.replace(/[.*+?^${}()|\\]/g, '\\$&');
          const varRe = new RegExp(`\\b(sanitizeValue|Buffer\\.byteLength)\\s*\\(\\s*${escaped}`);
          if (varRe.test(precNorm)) continue;
        }
      }
      // Allow yaml.safe_load — that's the safe variant
      if (match[0].startsWith('yaml.load') && /yaml\.safe_load/.test(rawLines[i])) continue;

      findings.push(
        finding(
          'mcp-unsafe-deserialization',
          'error',
          `Unsafe deserialization: ${match[1] || match[0].trim()} can execute arbitrary code`,
          filePath,
          i + 1,
          isPython
            ? 'Use json.loads() for JSON, yaml.safe_load() for YAML, or ast.literal_eval() for Python literals'
            : 'Use JSON.parse() with validated input, or a safe schema validator like Zod',
        ),
      );
    }
  }
  return findings;
}
