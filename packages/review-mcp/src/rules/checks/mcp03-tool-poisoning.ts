/**
 * MCP03: tool-description-poisoning
 * Hidden instructions, invisible characters, or prompt injection in tool descriptions.
 * CWE-1427, OWASP MCP02
 */

import type { ReviewFinding } from '@kernlang/review';
import { DIRECTION_OVERRIDE, INVISIBLE_CHARS, SUSPICIOUS_DESC_PATTERNS } from '../mcp-patterns.js';
import { finding } from '../mcp-types.js';

export function toolDescriptionPoisoningTS(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  // Find tool registration calls: server.tool('name', 'description', ...)
  const toolCallPattern = /\.tool\s*\(\s*['"][^'"]*['"]\s*,\s*(['"`])/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!toolCallPattern.test(line)) continue;

    // Extract the description — may span multiple lines
    const descStart = i;
    let desc = '';
    for (let j = i; j < Math.min(i + 20, lines.length); j++) {
      desc += `${lines[j]}\n`;
      // Stop when we find the schema object or callback
      if (j > i && /\}\s*,\s*(async\s+)?\(/.test(lines[j])) break;
      if (j > i && /\}\s*,\s*\{/.test(lines[j])) break;
    }

    checkDescriptionForPoisoning(desc, filePath, descStart + 1, findings);
  }

  return findings;
}

export function toolDescriptionPoisoningPython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  // Find tool function docstrings (used as descriptions in FastMCP)
  // Pattern: @mcp.tool() / def name(...): / """description"""
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*@(?:mcp|server)\.tool/.test(lines[i])) continue;

    // Find the docstring
    for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
      if (/^\s*(?:"""|''')/.test(lines[j])) {
        let desc = '';
        const docStart = j;
        // Single-line docstring
        if (/(?:"""|''').*(?:"""|''')/.test(lines[j])) {
          desc = lines[j];
        } else {
          // Multi-line docstring
          for (let k = j; k < Math.min(j + 30, lines.length); k++) {
            desc += `${lines[k]}\n`;
            if (k > j && /(?:"""|''')/.test(lines[k])) break;
          }
        }
        checkDescriptionForPoisoning(desc, filePath, docStart + 1, findings);
        break;
      }
    }
  }

  // Also check tool() decorator with description= parameter
  for (let i = 0; i < lines.length; i++) {
    const descMatch = lines[i].match(/\.tool\s*\(\s*(?:description\s*=\s*)?(['"])(.*?)\1/);
    if (descMatch) {
      checkDescriptionForPoisoning(descMatch[2], filePath, i + 1, findings);
    }
  }

  return findings;
}

export function checkDescriptionForPoisoning(
  desc: string,
  filePath: string,
  line: number,
  findings: ReviewFinding[],
): void {
  // Check for prompt injection patterns
  for (const pattern of SUSPICIOUS_DESC_PATTERNS) {
    if (pattern.test(desc)) {
      findings.push(
        finding(
          'mcp-tool-poisoning',
          'error',
          `Tool description contains prompt injection pattern: "${desc.match(pattern)?.[0]}" — tool poisoning risk`,
          filePath,
          line,
          "Tool descriptions should only describe the tool's functionality. Remove any instruction-like content.",
        ),
      );
      break; // One finding per description is enough
    }
  }

  // Check for invisible/direction-override characters
  if (INVISIBLE_CHARS.test(desc)) {
    findings.push(
      finding(
        'mcp-tool-poisoning',
        'error',
        `Tool description contains invisible Unicode characters — possible hidden instruction attack`,
        filePath,
        line,
        'Remove all invisible Unicode characters (zero-width spaces, direction overrides, etc.) from tool descriptions.',
      ),
    );
  }

  if (DIRECTION_OVERRIDE.test(desc)) {
    findings.push(
      finding(
        'mcp-tool-poisoning',
        'error',
        `Tool description contains Unicode direction override characters — text may appear differently to humans vs LLMs`,
        filePath,
        line,
        'Remove Unicode bidirectional override characters from tool descriptions.',
      ),
    );
  }
}
