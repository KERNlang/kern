/**
 * MCP06: missing-input-validation
 * Tool handlers accept parameters without validation/schema checking.
 * CWE-20, OWASP MCP04
 */

import type { ReviewFinding } from '@kernlang/review';
import { isCommentLine } from '../mcp-lexical.js';
import { PY_VALIDATION, TS_VALIDATION } from '../mcp-patterns.js';
import { findToolHandlerRegions } from '../mcp-regions.js';
import { finding } from '../mcp-types.js';

export function missingInputValidationTS(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  const toolHandlerRegions = findToolHandlerRegions(lines, 'typescript');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');

    // Check if handler has any params
    const hasParams = /\b(params|arguments|args|input)\b/.test(block);
    if (!hasParams) continue;

    // Check for validation
    const hasValidation = TS_VALIDATION.test(block);
    // Zod schema in tool registration counts as validation
    const hasZodSchema = /z\.\w+\(/.test(block);

    if (!hasValidation && !hasZodSchema) {
      findings.push(
        finding(
          'mcp-missing-validation',
          'warning',
          `MCP tool handler uses parameters without input validation — injection and type confusion risk`,
          filePath,
          region.start + 1,
          'Validate tool parameters with a schema (Zod, joi, etc.) or explicit type checks before use.',
        ),
      );
    }

    // Param-to-eval flow: params flow to eval()/new Function() without Zod schema protection.
    // Array.isArray or typeof on unrelated vars don't protect against eval injection.
    // Only eval/new Function — execFile/spawn with array args are handled by command-injection rule.
    if (hasParams && !hasZodSchema && /\beval\s*\(|\bnew\s+Function\s*\(/.test(block)) {
      // Find the eval line for precise reporting
      for (let i = region.start; i < region.end; i++) {
        if (isCommentLine(lines[i])) continue;
        if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(lines[i])) {
          findings.push(
            finding(
              'mcp-missing-validation',
              'error',
              `Tool parameters flow to eval/Function sink without schema validation — code execution via unvalidated input`,
              filePath,
              i + 1,
              'Validate and sanitize parameters with a schema (Zod, joi) before passing to eval. Use allowlists for acceptable values.',
            ),
          );
          break; // One per region
        }
      }
    }
  }

  return findings;
}

export function missingInputValidationPython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  const toolHandlerRegions = findToolHandlerRegions(lines, 'python');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');

    // Python type hints on function params count as basic validation (FastMCP enforces them)
    const defLine = lines.slice(region.start, region.start + 3).join(' ');
    const _hasTypeHints = /:\s*(str|int|float|bool|list|dict|Optional|List|Dict)\b/.test(defLine);
    const hasValidation = PY_VALIDATION.test(block);

    // If it uses dict/Any params without validation, flag it
    const usesRawDict = /:\s*(dict|Dict|Any)\b/.test(defLine) || /arguments\s*\[/.test(block);
    if (usesRawDict && !hasValidation) {
      findings.push(
        finding(
          'mcp-missing-validation',
          'warning',
          `MCP tool handler accepts untyped dict/Any parameters without validation`,
          filePath,
          region.start + 1,
          'Use typed parameters with Pydantic models or explicit isinstance() checks.',
        ),
      );
    }
  }

  return findings;
}
