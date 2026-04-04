/**
 * MCP04: secrets-in-tool-metadata
 * Hardcoded API keys, tokens, passwords in MCP server source or descriptions.
 * CWE-798, OWASP MCP01
 */

import type { ReviewFinding } from '@kernlang/review';
import { BASE64_OBFUSCATION, HARDCODED_KEY, QUOTED_SECRET_KEY, SECRET_PATTERNS } from '../mcp-patterns.js';
import { isMCPServer } from '../mcp-regions.js';
import { finding } from '../mcp-types.js';

export function secretsInMetadata(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  // Only check MCP server files
  if (!isMCPServer(source, filePath)) return findings;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip comments
    if (/^\s*(\/\/|#|\/\*|\*)/.test(line)) continue;
    // Skip import/require lines
    if (/^\s*(import|from|require|const\s+\{)/.test(line) && !/:=/.test(line)) continue;

    if (SECRET_PATTERNS.test(line)) {
      // Verify it's not an env var reference or placeholder
      if (/process\.env|os\.environ|os\.getenv|ENV\[|config\.|settings\./.test(line)) continue;
      if (/['"]<[^>]+>['"]|['"]\{[^}]+\}['"]|['"]YOUR_|['"]REPLACE_|['"]xxx|['"]changeme/i.test(line)) continue;

      findings.push(
        finding(
          'mcp-secrets-exposure',
          'error',
          `Hardcoded secret or credential in MCP server source — credential exposure risk`,
          filePath,
          i + 1,
          'Use environment variables or a secrets manager. Never hardcode credentials in MCP server code.',
        ),
      );
    }

    if (HARDCODED_KEY.test(line)) {
      if (/process\.env|os\.environ|os\.getenv/.test(line)) continue;

      findings.push(
        finding(
          'mcp-secrets-exposure',
          'error',
          `Hardcoded API key pattern detected in MCP server (matches known key format)`,
          filePath,
          i + 1,
          'Move API keys to environment variables. Rotate the exposed key immediately.',
        ),
      );
    }

    // Quoted header/object keys: "X-Api-Key": "bjlYhh..."
    if (QUOTED_SECRET_KEY.test(line) && !SECRET_PATTERNS.test(line)) {
      if (/process\.env|os\.environ|os\.getenv|ENV\[|config\.|settings\./.test(line)) continue;
      if (/['"]<[^>]+>['"]|['"]\{[^}]+\}['"]|['"]YOUR_|['"]REPLACE_|['"]xxx|['"]changeme/i.test(line)) continue;

      findings.push(
        finding(
          'mcp-secrets-exposure',
          'error',
          `Hardcoded secret in quoted header/object key — credential exposure risk`,
          filePath,
          i + 1,
          'Use environment variables for API keys in headers. Never hardcode credentials.',
        ),
      );
    }
  }

  // Detect base64 obfuscation of secrets — arrays of base64 strings with deobfuscation function
  if (BASE64_OBFUSCATION.test(source)) {
    // Count base64-like strings in the file — high count suggests credential obfuscation
    const base64Strings = source.match(/['"][A-Za-z0-9+/]{16,}={0,2}['"]/g) || [];
    if (base64Strings.length >= 5) {
      const obfLine = lines.findIndex((l) => BASE64_OBFUSCATION.test(l));
      findings.push(
        finding(
          'mcp-secrets-exposure',
          'warning',
          `MCP server uses base64 obfuscation (${base64Strings.length} encoded strings) — possible credential hiding`,
          filePath,
          obfLine >= 0 ? obfLine + 1 : 1,
          'Base64 is encoding, not encryption. Secrets should use environment variables, not obfuscation.',
        ),
      );
    }
  }

  return findings;
}
