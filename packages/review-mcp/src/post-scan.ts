/**
 * Post-scan enhancements that rely on string-level analysis beyond KERN IR.
 */

import { createFingerprint, type ReviewFinding } from '@kernlang/review';

const SECRET_PREFIXES = /^(sk-|ghp_|gho_|github_pat_|xox[bpas]-|AKIA|AIza|Bearer\s|glpat-|npm_|pypi-)/;
const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const SENSITIVE_URL = /\b(api|secret|token|auth|key|password|credential)/i;
const ANY_URL = /^https?:\/\//;
const BASE64_IN_SOURCE = /["'`]([A-Za-z0-9+/]{16,}={0,2})["'`]/g;
const IP_DISCLOSURE_ENDPOINTS = /\b(icanhazip\.com|ifconfig\.me|ipinfo\.io|checkip\.|whatismyip|api\.ipify\.org|ipecho\.net)/i;
const SYSTEM_INFO_CALLS = /\bos\.(hostname|homedir|userInfo|cpus|networkInterfaces)\s*\(\)/g;
const BASE64_DECODE_CALL = /Buffer\.from\([^,]+,\s*["']base64["']\)/;

function isValidBase64(s: string): boolean {
  try {
    const decoded = Buffer.from(s, 'base64').toString('utf8');
    return /^[\x20-\x7e\n\r\t]+$/.test(decoded) && decoded.length >= 4;
  } catch {
    return false;
  }
}

function makeSpan(file: string, line: number, col = 1, len = 1): ReviewFinding['primarySpan'] {
  return { file, startLine: line, endLine: line, startCol: col, endCol: col + len };
}

function makeFinding(
  ruleId: string,
  severity: ReviewFinding['severity'],
  message: string,
  primarySpan: ReviewFinding['primarySpan'],
  suggestion?: string,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category: 'bug',
    message,
    suggestion,
    primarySpan,
    fingerprint: createFingerprint(ruleId, primarySpan.startLine, primarySpan.startCol),
  };
}

export function runPostScan(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  let base64StringCount = 0;
  let firstBase64Line = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    let match: RegExpExecArray | null;
    BASE64_IN_SOURCE.lastIndex = 0;

    while ((match = BASE64_IN_SOURCE.exec(line)) !== null) {
      const encoded = match[1];
      if (!isValidBase64(encoded)) continue;

      base64StringCount++;
      if (base64StringCount === 1) firstBase64Line = lineNum;

      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const span = {
        file: filePath,
        startLine: lineNum,
        endLine: lineNum,
        startCol: match.index + 1,
        endCol: match.index + 1 + match[0].length,
      };

      if (SECRET_PREFIXES.test(decoded)) {
        const redacted = decoded.slice(0, 6) + '...' + decoded.slice(-4);
        findings.push(makeFinding(
          'mcp-secrets-exposure',
          'error',
          `Base64-encoded secret decoded to "${redacted}" — credential hiding via obfuscation`,
          span,
          'Use environment variables instead of obfuscated secrets. Base64 is not encryption.',
        ));
      } else if (EMAIL_PATTERN.test(decoded)) {
        findings.push(makeFinding(
          'mcp-secret-leakage',
          'warning',
          `Base64-encoded email address: ${decoded} — PII exposure risk`,
          span,
          'Do not hardcode email addresses. Use configuration or environment variables.',
        ));
      } else if (SENSITIVE_URL.test(decoded)) {
        findings.push(makeFinding(
          'mcp-secrets-exposure',
          'warning',
          `Base64-encoded sensitive URL: ${decoded.slice(0, 60)}${decoded.length > 60 ? '...' : ''} — possible credential or internal endpoint hiding`,
          span,
          'Obfuscating URLs with base64 provides no security. Use configuration files.',
        ));
      } else if (ANY_URL.test(decoded)) {
        findings.push(makeFinding(
          'mcp-secrets-exposure',
          'warning',
          `Base64-encoded URL: ${decoded.slice(0, 60)}${decoded.length > 60 ? '...' : ''} — hidden external endpoint`,
          span,
          'URLs hidden via base64 encoding are a red flag. Declare endpoints explicitly.',
        ));
      }
    }

    if (IP_DISCLOSURE_ENDPOINTS.test(line)) {
      const col = line.search(IP_DISCLOSURE_ENDPOINTS) + 1;
      findings.push(makeFinding(
        'mcp-secret-leakage',
        'warning',
        "IP disclosure endpoint detected — exposes server's public IP address to the LLM",
        makeSpan(filePath, lineNum, col, 20),
        'Avoid exposing infrastructure details. If needed, restrict access and redact from tool responses.',
      ));
    }

    SYSTEM_INFO_CALLS.lastIndex = 0;
    let sysMatch: RegExpExecArray | null;
    while ((sysMatch = SYSTEM_INFO_CALLS.exec(line)) !== null) {
      findings.push(makeFinding(
        'mcp-secret-leakage',
        'warning',
        `System info exposure: os.${sysMatch[1]}() — leaks host details to the LLM`,
        makeSpan(filePath, lineNum, sysMatch.index + 1, sysMatch[0].length),
        'Avoid exposing system details (hostname, home directory, CPU info) via MCP tool responses.',
      ));
    }
  }

  if (base64StringCount >= 5 && BASE64_DECODE_CALL.test(source)) {
    findings.push(makeFinding(
      'mcp-secrets-exposure',
      'error',
      `Obfuscation array detected: ${base64StringCount} base64-encoded strings with runtime decoder — deliberate hiding of server behavior`,
      makeSpan(filePath, firstBase64Line, 1, 1),
      'Base64 arrays with runtime decoding are a strong indicator of intentional obfuscation. Inspect all decoded values carefully.',
    ));
  }

  return findings;
}
