/**
 * MCP Security Rules — static analysis for Model Context Protocol servers.
 *
 * 9 rules mapped to OWASP MCP Top 10:
 *   MCP01: command-injection-tool-handler  — user params flow to shell commands
 *   MCP02: path-traversal-tool             — file ops with unvalidated paths
 *   MCP03: tool-description-poisoning      — hidden instructions in tool descriptions
 *   MCP04: secrets-in-tool-metadata        — hardcoded keys/tokens in server code
 *   MCP05: unsanitized-tool-response       — raw external data returned to LLM
 *   MCP06: missing-input-validation        — tool params used without validation
 *   MCP07: missing-auth-remote-server      — HTTP/SSE server without auth
 *   MCP08: namespace-typosquatting         — suspicious package name similarity
 *   MCP09: data-level-injection            — hidden instructions in string literals
 *
 * Supports TypeScript and Python MCP servers.
 * CWE-77, CWE-22, CWE-94, CWE-798, CWE-20, CWE-306
 */

import type { ReviewFinding, SourceSpan } from '@kernlang/review';
import { createFingerprint } from '@kernlang/review';

// ── Confidence defaults per rule ──────────────────────────────────────

const RULE_CONFIDENCE: Record<string, number> = {
  'mcp-command-injection':    0.95,  // Direct code execution
  'mcp-path-traversal':      0.90,  // Direct vulnerability
  'mcp-secrets-exposure':    0.90,  // Direct pattern match
  'mcp-tool-poisoning':      0.85,  // Pattern-based
  'mcp-typosquatting':       0.85,  // Levenshtein heuristic
  'mcp-unsanitized-response': 0.80, // Structural
  'mcp-missing-validation':  0.80,  // Structural
  'mcp-missing-auth':        0.80,  // Structural
  'mcp-data-injection':      0.70,  // Data-level heuristic
};

// ── Helpers ──────────────────────────────────────────────────────────

function span(file: string, line: number, col = 1): SourceSpan {
  return { file, startLine: line, startCol: col, endLine: line, endCol: col };
}

function finding(
  ruleId: string,
  severity: 'error' | 'warning' | 'info',
  message: string,
  file: string,
  line: number,
  suggestion?: string,
  confidence?: number,
): ReviewFinding {
  return {
    source: 'kern',
    ruleId,
    severity,
    category: 'bug',
    message,
    primarySpan: span(file, line),
    fingerprint: createFingerprint(ruleId, line, 1),
    ...(suggestion ? { suggestion } : {}),
    confidence: confidence ?? RULE_CONFIDENCE[ruleId] ?? 0.80,
  };
}

/** Check if a line is a comment (JS/TS single-line or Python) */
export function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

/** Find all 1-based line numbers where a pattern matches (skips comment lines) */
function findLines(source: string, pattern: RegExp): number[] {
  const lines: number[] = [];
  const srcLines = source.split('\n');
  for (let i = 0; i < srcLines.length; i++) {
    if (isCommentLine(srcLines[i])) continue;
    if (pattern.test(srcLines[i])) lines.push(i + 1);
  }
  return lines;
}

/** Get the function/handler body surrounding a line */
function getSurroundingBlock(lines: string[], lineIdx: number, maxUp = 50, maxDown = 50): string {
  const start = Math.max(0, lineIdx - maxUp);
  const end = Math.min(lines.length, lineIdx + maxDown);
  return lines.slice(start, end).join('\n');
}

// ── Shared patterns ──────────────────────────────────────────────────

// TypeScript command execution sinks
const TS_EXEC_SINKS = /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|child_process)\s*\(|\beval\s*\(|\bnew\s+Function\s*\(/;
const TS_EXEC_LINE = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/;

// Python command execution sinks
const PY_EXEC_SINKS = /\b(os\.system|os\.popen|subprocess\.run|subprocess\.call|subprocess\.Popen|subprocess\.check_output|subprocess\.check_call|asyncio\.create_subprocess_exec|asyncio\.create_subprocess_shell)\s*\(/;
const PY_EVAL_SINKS = /\b(eval|exec)\s*\(/;
const PY_CODE_EXEC = /\bsys\.executable\b/;

// File system operations
const TS_FS_OPS = /\b(readFile|readFileSync|writeFile|writeFileSync|readdir|readdirSync|unlink|unlinkSync|mkdir|mkdirSync|createReadStream|createWriteStream|access|accessSync|stat|statSync|copyFile|copyFileSync|rename|renameSync|rm|rmSync)\s*\(/;
const PY_FS_OPS = /\b(open|os\.remove|os\.unlink|os\.rmdir|os\.rename|os\.listdir|os\.makedirs|shutil\.copy|shutil\.move|shutil\.rmtree|pathlib\.Path)\s*\(/;

// Path sanitization patterns
const TS_PATH_SANITIZE = /\b(path\.resolve|path\.normalize|path\.join|resolve)\s*\(|\.startsWith\s*\(|\.includes\s*\(\s*['"]\.\./;
const PY_PATH_SANITIZE = /\b(os\.path\.abspath|os\.path\.realpath|pathlib\.Path.*\.resolve|os\.path\.normpath)\s*\(|\.startswith\s*\(/;

// Secret patterns (high precision)
const SECRET_PATTERNS = /(?:api[_-]?key|secret[_-]?key|password|token|private[_-]?key|auth[_-]?token|access[_-]?key|client[_-]?secret)\s*[:=]\s*['"][^'"]{8,}['"]/i;
// Quoted object/header keys: "X-Api-Key": "value", 'Authorization': 'Bearer ...'
const QUOTED_SECRET_KEY = /['"](?:[\w-]*(?:api[_-]?key|secret|token|password|authorization)[\w-]*)['"]?\s*:\s*['"][^'"]{8,}['"]/i;
const HARDCODED_KEY = /['"](?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16}|xox[bpas]-[a-zA-Z0-9-]{10,})['"]/;
// Obfuscated secrets: base64-encoded credential arrays with deobfuscation function
const BASE64_OBFUSCATION = /Buffer\.from\s*\([^,]+,\s*['"]base64['"]\)|atob\s*\(|base64\.b64decode\s*\(/;

// Input validation patterns
const TS_VALIDATION = /\.parse\s*\(|\.safeParse\s*\(|\.validate\s*\(|typeof\s+\w+\s*[!=]==|instanceof\s+|Array\.isArray\s*\(/;
const PY_VALIDATION = /\bpydantic\b|\.model_validate\b|isinstance\s*\(|\.validate\s*\(/;

// Tool description suspicious patterns
const SUSPICIOUS_DESC_PATTERNS = [
  /ignore\s+(previous|above|all)\s+(instructions?|prompts?|context)/i,
  /disregard\s+(previous|above|all)/i,
  /you\s+are\s+now\b/i,
  /new\s+instructions?:/i,
  /^\s*system\s*:\s*/im,  // Only match "system:" at start of line/description, not mid-sentence
  /\<\|system\|\>/,
  /\<\|end\|\>/,
  /\[INST\]/,
  /\<\/?s\>/,
  /<<SYS>>/,
];

// Unicode direction markers and invisible characters
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2060\u2061\u2062\u2063\u2064\uFEFF\u00AD]/;
const DIRECTION_OVERRIDE = /[\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/;

// Data-level injection patterns — hidden instructions embedded in string literals
const DATA_INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\[SYSTEM INSTRUCTION[:\s]/i,       label: '[SYSTEM INSTRUCTION]' },
  { pattern: /<!--\s*HIDDEN\s*:/,                label: '<!-- HIDDEN: -->' },
  { pattern: /___INJECT___/,                     label: '___INJECT___' },
  { pattern: /___END_INJECT___/,                 label: '___END_INJECT___' },
  { pattern: /\bAssistant instruction\s*:/i,     label: 'Assistant instruction:' },
  { pattern: /\bmalicious_instruction\b/,        label: 'malicious_instruction' },
  { pattern: /\[HIDDEN INSTRUCTIONS?\]/i,        label: '[HIDDEN INSTRUCTION]' },
  { pattern: /\bINJECT_PAYLOAD\b/,              label: 'INJECT_PAYLOAD' },
  { pattern: /\bsystem_override\b/i,            label: 'system_override' },
];

// Auth patterns
const TS_AUTH_MIDDLEWARE = /\b(authenticate|authorization|auth|verifyToken|requireAuth|isAuthenticated|passport\.authenticate|jwt\.verify|bearerAuth)\b/i;
const PY_AUTH_MIDDLEWARE = /\b(authenticate|authorization|verify_token|require_auth|is_authenticated|jwt\.decode|HTTPBearer|Depends.*auth|api_key_header)\b/i;

// Remote server patterns
const TS_REMOTE_SERVER = /\b(createServer|express\s*\(|app\.listen|Hono|fastify|http\.createServer|SSEServerTransport|StreamableHTTPServerTransport)\b/;
const PY_REMOTE_SERVER = /\b(FastAPI|Flask|uvicorn\.run|app\.run|SseServerTransport|StreamableHTTPServer)\b/;

// Known popular MCP server names for typosquatting detection
const KNOWN_MCP_PACKAGES = [
  'modelcontextprotocol', 'mcp-server-filesystem', 'mcp-server-github',
  'mcp-server-postgres', 'mcp-server-sqlite', 'mcp-server-puppeteer',
  'mcp-server-brave-search', 'mcp-server-google-maps', 'mcp-server-slack',
  'mcp-server-memory', 'mcp-server-fetch', 'mcp-server-time',
  'mcp-server-sequential-thinking', 'mcp-server-everything',
  // Common short-form MCP server names
  'twitter-mcp', 'discord-mcp', 'whatsapp-mcp', 'google-mcp',
  'slack-mcp', 'github-mcp', 'filesystem-mcp', 'postgres-mcp',
];

// ── MCP01: command-injection-tool-handler ─────────────────────────────
// User-supplied tool parameters flow to shell command execution.
// CWE-77, OWASP MCP04

function commandInjectionTS(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  // Quick bail: no exec sinks at all
  if (!TS_EXEC_SINKS.test(source)) return findings;

  // Find tool handler regions (server.tool(...) calls)
  const toolHandlerRegions = findToolHandlerRegions(lines, 'typescript');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!TS_EXEC_SINKS.test(block)) continue;

    // Check each exec line (skip comments)
    for (let i = region.start; i < region.end; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      if (!TS_EXEC_LINE.test(line) && !/\beval\s*\(/.test(line)) continue;

      // Check if line uses template literals or string concat with params
      const usesParams = /\$\{/.test(line) || /\+\s*\w/.test(line) || /`[^`]*\$\{/.test(block.substring(0, i - region.start));
      // Check for execFileSync/spawn with array args (safer pattern)
      const usesArrayArgs = /\b(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*['"][^'"]+['"],\s*\[/.test(line);

      if (usesParams && !usesArrayArgs) {
        findings.push(finding(
          'mcp-command-injection', 'error',
          `Shell command execution in MCP tool handler with interpolated parameters — command injection risk`,
          filePath, i + 1,
          'Use execFile/spawn with array arguments instead of exec with string interpolation. Validate parameters against an allowlist.',
        ));
      }
    }
  }

  // Detect eval() inside tool handler regions (skip comments)
  for (const region of toolHandlerRegions) {
    for (let i = region.start; i < region.end; i++) {
      if (isCommentLine(lines[i])) continue;
      if (/\beval\s*\(/.test(lines[i])) {
        findings.push(finding(
          'mcp-command-injection', 'error',
          `eval() in MCP tool handler — arbitrary code execution risk`,
          filePath, i + 1,
          'Never use eval() with user-supplied input. Use JSON.parse for data, or a sandboxed interpreter.',
        ));
      }
    }
  }

  // Also catch exec/eval calls in the general file context if MCP patterns are present
  if (toolHandlerRegions.length === 0 && isMCPServerTS(source)) {
    for (const lineNum of findLines(source, TS_EXEC_LINE)) {
      const line = lines[lineNum - 1];
      if (/\$\{/.test(line) || /\+\s*\w/.test(line)) {
        findings.push(finding(
          'mcp-command-injection', 'warning',
          `Shell command execution with interpolated values in MCP server — potential command injection`,
          filePath, lineNum,
          'Use execFile/spawn with array arguments. Validate all parameters before shell execution.',
        ));
      }
    }
    // Catch eval() in general MCP server context
    for (const lineNum of findLines(source, /\beval\s*\(/)) {
      findings.push(finding(
        'mcp-command-injection', 'error',
        `eval() in MCP server — arbitrary code execution risk`,
        filePath, lineNum,
        'Never use eval() with user-supplied input. Use JSON.parse for data, or a sandboxed interpreter.',
      ));
    }
  }

  return findings;
}

function commandInjectionPython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  if (!PY_EXEC_SINKS.test(source) && !PY_EVAL_SINKS.test(source) && !PY_CODE_EXEC.test(source)) return findings;

  const toolHandlerRegions = findToolHandlerRegions(lines, 'python');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');

    for (let i = region.start; i < region.end; i++) {
      const line = lines[i];

      if (PY_EXEC_SINKS.test(line)) {
        // Check for f-strings, .format(), or % formatting with params
        const usesInterp = /f['"]/.test(line) || /\.format\s*\(/.test(line) || /%\s*\(/.test(line) || /\+\s*\w/.test(line);
        // subprocess.run with shell=True is always dangerous
        const shellTrue = /shell\s*=\s*True/.test(line);

        if (usesInterp || shellTrue) {
          findings.push(finding(
            'mcp-command-injection', 'error',
            `Shell command execution in MCP tool handler${shellTrue ? ' with shell=True' : ''} — command injection risk`,
            filePath, i + 1,
            'Use subprocess.run with a list of arguments (no shell=True). Validate parameters against an allowlist.',
          ));
        }
      }

      if (PY_EVAL_SINKS.test(line) && !/\bexec\s*\(\s*['"]/.test(line)) {
        findings.push(finding(
          'mcp-command-injection', 'error',
          `eval()/exec() in MCP tool handler — arbitrary code execution risk`,
          filePath, i + 1,
          'Never use eval/exec with user-supplied input. Use ast.literal_eval for data parsing or a sandboxed approach.',
        ));
      }

      // asyncio.create_subprocess_exec with sys.executable — arbitrary code execution
      if (/create_subprocess_exec/.test(line) && PY_CODE_EXEC.test(block)) {
        findings.push(finding(
          'mcp-command-injection', 'error',
          `Arbitrary code execution via subprocess with Python interpreter in MCP tool handler`,
          filePath, i + 1,
          'Do not execute user-supplied code via sys.executable. Use a sandboxed environment or restrict to predefined scripts.',
        ));
      }
    }
  }

  return findings;
}

// ── MCP02: path-traversal-tool ───────────────────────────────────────
// File system operations with unvalidated paths from tool parameters.
// CWE-22, OWASP MCP03

function pathTraversalTS(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  if (!TS_FS_OPS.test(source)) return findings;

  const toolHandlerRegions = findToolHandlerRegions(lines, 'typescript');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!TS_FS_OPS.test(block)) continue;

    // Check if path sanitization is present in the handler
    const hasSanitize = TS_PATH_SANITIZE.test(block);
    // Check for containment validation (startsWith check after resolve — with or without path. prefix)
    const hasContainment = /\.startsWith\s*\(/.test(block) && /\b(path\.)?resolve\s*\(/.test(block);

    if (!hasContainment) {
      for (let i = region.start; i < region.end; i++) {
        if (TS_FS_OPS.test(lines[i])) {
          findings.push(finding(
            'mcp-path-traversal', hasSanitize ? 'warning' : 'error',
            `File system operation in MCP tool handler without path containment check — path traversal risk`,
            filePath, i + 1,
            'Resolve the path with path.resolve() then verify it startsWith() the allowed base directory. Reject paths containing "..".',
          ));
        }
      }
    }
  }

  // Fallback: check in general MCP server context
  if (toolHandlerRegions.length === 0 && isMCPServerTS(source)) {
    for (const lineNum of findLines(source, TS_FS_OPS)) {
      const block = getSurroundingBlock(lines, lineNum - 1);
      const hasContainment = /\.startsWith\s*\(/.test(block) && /path\.resolve/.test(block);
      if (!hasContainment) {
        findings.push(finding(
          'mcp-path-traversal', 'warning',
          `File system operation in MCP server without path containment validation`,
          filePath, lineNum,
          'Use path.resolve() + startsWith() to ensure paths stay within the allowed directory.',
        ));
      }
    }
  }

  return findings;
}

function pathTraversalPython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  if (!PY_FS_OPS.test(source)) return findings;

  const toolHandlerRegions = findToolHandlerRegions(lines, 'python');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!PY_FS_OPS.test(block)) continue;

    const hasSanitize = PY_PATH_SANITIZE.test(block);
    const hasContainment = /\.startswith\s*\(/.test(block) && /(os\.path\.realpath|\.resolve\(\))/.test(block);

    if (!hasContainment) {
      for (let i = region.start; i < region.end; i++) {
        if (PY_FS_OPS.test(lines[i])) {
          findings.push(finding(
            'mcp-path-traversal', hasSanitize ? 'warning' : 'error',
            `File system operation in MCP tool handler without path containment check — path traversal risk`,
            filePath, i + 1,
            'Use os.path.realpath() then verify the path startswith() the allowed base directory.',
          ));
        }
      }
    }
  }

  return findings;
}

// ── MCP03: tool-description-poisoning ────────────────────────────────
// Hidden instructions, invisible characters, or prompt injection in tool descriptions.
// CWE-1427, OWASP MCP02

function toolDescriptionPoisoningTS(source: string, filePath: string): ReviewFinding[] {
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
      desc += lines[j] + '\n';
      // Stop when we find the schema object or callback
      if (j > i && /\}\s*,\s*(async\s+)?\(/.test(lines[j])) break;
      if (j > i && /\}\s*,\s*\{/.test(lines[j])) break;
    }

    checkDescriptionForPoisoning(desc, filePath, descStart + 1, findings);
  }

  return findings;
}

function toolDescriptionPoisoningPython(source: string, filePath: string): ReviewFinding[] {
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
            desc += lines[k] + '\n';
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

function checkDescriptionForPoisoning(desc: string, filePath: string, line: number, findings: ReviewFinding[]): void {
  // Check for prompt injection patterns
  for (const pattern of SUSPICIOUS_DESC_PATTERNS) {
    if (pattern.test(desc)) {
      findings.push(finding(
        'mcp-tool-poisoning', 'error',
        `Tool description contains prompt injection pattern: "${desc.match(pattern)?.[0]}" — tool poisoning risk`,
        filePath, line,
        'Tool descriptions should only describe the tool\'s functionality. Remove any instruction-like content.',
      ));
      break; // One finding per description is enough
    }
  }

  // Check for invisible/direction-override characters
  if (INVISIBLE_CHARS.test(desc)) {
    findings.push(finding(
      'mcp-tool-poisoning', 'error',
      `Tool description contains invisible Unicode characters — possible hidden instruction attack`,
      filePath, line,
      'Remove all invisible Unicode characters (zero-width spaces, direction overrides, etc.) from tool descriptions.',
    ));
  }

  if (DIRECTION_OVERRIDE.test(desc)) {
    findings.push(finding(
      'mcp-tool-poisoning', 'error',
      `Tool description contains Unicode direction override characters — text may appear differently to humans vs LLMs`,
      filePath, line,
      'Remove Unicode bidirectional override characters from tool descriptions.',
    ));
  }
}

// ── MCP04: secrets-in-tool-metadata ──────────────────────────────────
// Hardcoded API keys, tokens, passwords in MCP server source or descriptions.
// CWE-798, OWASP MCP01

function secretsInMetadata(source: string, filePath: string): ReviewFinding[] {
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

      findings.push(finding(
        'mcp-secrets-exposure', 'error',
        `Hardcoded secret or credential in MCP server source — credential exposure risk`,
        filePath, i + 1,
        'Use environment variables or a secrets manager. Never hardcode credentials in MCP server code.',
      ));
    }

    if (HARDCODED_KEY.test(line)) {
      if (/process\.env|os\.environ|os\.getenv/.test(line)) continue;

      findings.push(finding(
        'mcp-secrets-exposure', 'error',
        `Hardcoded API key pattern detected in MCP server (matches known key format)`,
        filePath, i + 1,
        'Move API keys to environment variables. Rotate the exposed key immediately.',
      ));
    }

    // Quoted header/object keys: "X-Api-Key": "bjlYhh..."
    if (QUOTED_SECRET_KEY.test(line) && !SECRET_PATTERNS.test(line)) {
      if (/process\.env|os\.environ|os\.getenv|ENV\[|config\.|settings\./.test(line)) continue;
      if (/['"]<[^>]+>['"]|['"]\{[^}]+\}['"]|['"]YOUR_|['"]REPLACE_|['"]xxx|['"]changeme/i.test(line)) continue;

      findings.push(finding(
        'mcp-secrets-exposure', 'error',
        `Hardcoded secret in quoted header/object key — credential exposure risk`,
        filePath, i + 1,
        'Use environment variables for API keys in headers. Never hardcode credentials.',
      ));
    }
  }

  // Detect base64 obfuscation of secrets — arrays of base64 strings with deobfuscation function
  if (BASE64_OBFUSCATION.test(source)) {
    // Count base64-like strings in the file — high count suggests credential obfuscation
    const base64Strings = source.match(/['"][A-Za-z0-9+/]{16,}={0,2}['"]/g) || [];
    if (base64Strings.length >= 5) {
      const obfLine = lines.findIndex(l => BASE64_OBFUSCATION.test(l));
      findings.push(finding(
        'mcp-secrets-exposure', 'warning',
        `MCP server uses base64 obfuscation (${base64Strings.length} encoded strings) — possible credential hiding`,
        filePath, obfLine >= 0 ? obfLine + 1 : 1,
        'Base64 is encoding, not encryption. Secrets should use environment variables, not obfuscation.',
      ));
    }
  }

  return findings;
}

// ── MCP05: unsanitized-tool-response ─────────────────────────────────
// Tool responses return raw external data that could contain prompt injection.
// CWE-1427, OWASP MCP05

function unsanitizedToolResponseTS(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  const toolHandlerRegions = findToolHandlerRegions(lines, 'typescript');
  if (toolHandlerRegions.length === 0) return findings;

  // External data sources that could contain injection payloads
  const externalDataSources = /\b(fetch|axios\.\w+|got\.\w+|db\.query|findOne|findMany|findById|collection\.find|\.findUnique|\.findFirst|readFile|readFileSync|createReadStream)\s*\(/;
  const sanitizeCall = /\bsanitize\w*\s*\(|\bescape\w*\s*\(|\bcleanForPrompt\s*\(|\bstripTags\s*\(/;

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!externalDataSources.test(block)) continue;
    if (sanitizeCall.test(block)) continue; // Has sanitization

    // Find return statements that pass external data
    for (let i = region.start; i < region.end; i++) {
      const line = lines[i];
      if (/\breturn\b/.test(line) || /content:\s*/.test(line)) {
        // Check if the returned value comes from an external source
        const blockAbove = lines.slice(region.start, i + 1).join('\n');
        if (externalDataSources.test(blockAbove) && !sanitizeCall.test(blockAbove)) {
          findings.push(finding(
            'mcp-unsanitized-response', 'warning',
            `MCP tool returns data from external source without sanitization — indirect prompt injection risk`,
            filePath, i + 1,
            'Sanitize external data before including in tool responses. External content may contain prompt injection payloads.',
          ));
          break; // One per handler
        }
      }
    }
  }

  return findings;
}

function unsanitizedToolResponsePython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  const toolHandlerRegions = findToolHandlerRegions(lines, 'python');
  if (toolHandlerRegions.length === 0) return findings;

  const externalDataSources = /\b(requests\.get|requests\.post|httpx\.\w+|aiohttp|cursor\.execute|\.fetchall|\.fetchone|open\s*\()\b/;
  const sanitizeCall = /\bsanitize\w*\s*\(|\bescape\w*\s*\(|\bclean\w*\s*\(/;

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!externalDataSources.test(block)) continue;
    if (sanitizeCall.test(block)) continue;

    for (let i = region.start; i < region.end; i++) {
      if (/\breturn\b/.test(lines[i])) {
        const blockAbove = lines.slice(region.start, i + 1).join('\n');
        if (externalDataSources.test(blockAbove)) {
          findings.push(finding(
            'mcp-unsanitized-response', 'warning',
            `MCP tool returns data from external source without sanitization — indirect prompt injection risk`,
            filePath, i + 1,
            'Sanitize external data before returning from tool handlers.',
          ));
          break;
        }
      }
    }
  }

  return findings;
}

// ── MCP06: missing-input-validation ──────────────────────────────────
// Tool handlers accept parameters without validation/schema checking.
// CWE-20, OWASP MCP04

function missingInputValidationTS(source: string, filePath: string): ReviewFinding[] {
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
      findings.push(finding(
        'mcp-missing-validation', 'warning',
        `MCP tool handler uses parameters without input validation — injection and type confusion risk`,
        filePath, region.start + 1,
        'Validate tool parameters with a schema (Zod, joi, etc.) or explicit type checks before use.',
      ));
    }

    // Param-to-eval flow: params flow to eval()/new Function() without Zod schema protection.
    // Array.isArray or typeof on unrelated vars don't protect against eval injection.
    // Only eval/new Function — execFile/spawn with array args are handled by command-injection rule.
    if (hasParams && !hasZodSchema && /\beval\s*\(|\bnew\s+Function\s*\(/.test(block)) {
      // Find the eval line for precise reporting
      for (let i = region.start; i < region.end; i++) {
        if (isCommentLine(lines[i])) continue;
        if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(lines[i])) {
          findings.push(finding(
            'mcp-missing-validation', 'error',
            `Tool parameters flow to eval/Function sink without schema validation — code execution via unvalidated input`,
            filePath, i + 1,
            'Validate and sanitize parameters with a schema (Zod, joi) before passing to eval. Use allowlists for acceptable values.',
          ));
          break; // One per region
        }
      }
    }
  }

  return findings;
}

function missingInputValidationPython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  const toolHandlerRegions = findToolHandlerRegions(lines, 'python');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');

    // Python type hints on function params count as basic validation (FastMCP enforces them)
    const defLine = lines.slice(region.start, region.start + 3).join(' ');
    const hasTypeHints = /:\s*(str|int|float|bool|list|dict|Optional|List|Dict)\b/.test(defLine);
    const hasValidation = PY_VALIDATION.test(block);

    // If it uses dict/Any params without validation, flag it
    const usesRawDict = /:\s*(dict|Dict|Any)\b/.test(defLine) || /arguments\s*\[/.test(block);
    if (usesRawDict && !hasValidation) {
      findings.push(finding(
        'mcp-missing-validation', 'warning',
        `MCP tool handler accepts untyped dict/Any parameters without validation`,
        filePath, region.start + 1,
        'Use typed parameters with Pydantic models or explicit isinstance() checks.',
      ));
    }
  }

  return findings;
}

// ── MCP07: missing-auth-remote-server ────────────────────────────────
// HTTP/SSE MCP servers without authentication middleware.
// CWE-306, OWASP MCP04

function missingAuthRemoteTS(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  if (!TS_REMOTE_SERVER.test(source)) return findings;
  if (!isMCPServerTS(source)) return findings;

  // Strip comments before checking for auth patterns (avoid matching "auth" in comment text)
  const codeOnly = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // Check for auth middleware/checks
  if (TS_AUTH_MIDDLEWARE.test(codeOnly)) return findings;

  // Check for OAuth/bearer token patterns
  if (/authorization.*header|bearer.*token|oauth/i.test(codeOnly)) return findings;

  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (TS_REMOTE_SERVER.test(lines[i])) {
      findings.push(finding(
        'mcp-missing-auth', 'error',
        `Remote MCP server (HTTP/SSE) without authentication — any client can connect and use tools`,
        filePath, i + 1,
        'Add authentication middleware (JWT, API key, OAuth). Remote MCP servers MUST verify client identity.',
      ));
      break; // One per file
    }
  }

  return findings;
}

function missingAuthRemotePython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  if (!PY_REMOTE_SERVER.test(source)) return findings;
  if (!isMCPServerPython(source)) return findings;

  if (PY_AUTH_MIDDLEWARE.test(source)) return findings;
  if (/authorization.*header|bearer.*token|oauth/i.test(source)) return findings;

  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (PY_REMOTE_SERVER.test(lines[i])) {
      findings.push(finding(
        'mcp-missing-auth', 'error',
        `Remote MCP server without authentication — any client can connect and use tools`,
        filePath, i + 1,
        'Add authentication (JWT, API key, OAuth2). Remote MCP servers MUST verify client identity.',
      ));
      break;
    }
  }

  return findings;
}

// ── MCP08: namespace-typosquatting ────────────────────────────────────
// Suspicious package names that look like typosquats of popular MCP packages.
// OWASP MCP06

function namespaceTyposquatting(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  // Collect candidate names from multiple sources
  const candidates: { name: string; source: string }[] = [];

  // Source 1: package.json "name" field
  const packageNameMatch = source.match(/"name"\s*:\s*"([^"]+)"/);
  if (packageNameMatch) {
    candidates.push({ name: packageNameMatch[1], source: 'package.json' });
  }

  // Source 2: TS constructor — new Server({name: "..."}) or new McpServer({name: "..."})
  const tsConstructorMatch = source.match(/new\s+(?:Mcp)?Server\s*\(\s*\{[^}]*name\s*:\s*['"]([^'"]+)['"]/);
  if (tsConstructorMatch) {
    candidates.push({ name: tsConstructorMatch[1], source: 'constructor' });
  }

  // Source 3: Python constructor — FastMCP("...") or Server("...")
  const pyConstructorMatch = source.match(/(?:FastMCP|Server)\s*\(\s*['"]([^'"]+)['"]/);
  if (pyConstructorMatch) {
    candidates.push({ name: pyConstructorMatch[1], source: 'constructor' });
  }

  if (candidates.length === 0) return findings;

  for (const candidate of candidates) {
    // Strip scope prefix and parenthetical suffixes like " (typosquatted)"
    const cleanName = candidate.name
      .replace(/^@[^/]+\//, '')
      .replace(/\s*\(.*\)\s*$/, '')
      .trim();

    for (const known of KNOWN_MCP_PACKAGES) {
      if (cleanName === known) continue;
      const distance = levenshtein(cleanName, known);
      const maxLen = Math.max(cleanName.length, known.length);

      if (distance > 0 && distance <= 2 && maxLen > 5) {
        const lineNum = lines.findIndex(l => l.includes(candidate.name)) + 1;
        findings.push(finding(
          'mcp-typosquatting', 'warning',
          `Server name "${cleanName}" is suspiciously similar to known MCP server "${known}" (edit distance: ${distance}) — potential typosquatting`,
          filePath, lineNum || 1,
          `Verify this is the intended name. Known server is "${known}".`,
        ));
        break; // One finding per candidate is enough
      }
    }
  }

  return findings;
}

// ── Levenshtein distance ─────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Tool handler region detection ────────────────────────────────────

export interface CodeRegion {
  start: number; // 0-based line index
  end: number;   // 0-based line index (exclusive)
}

export function findToolHandlerRegions(lines: string[], language: 'typescript' | 'python'): CodeRegion[] {
  const regions: CodeRegion[] = [];

  if (language === 'typescript') {
    // Pattern: server.tool('name', 'desc', schema, async (params) => { ... })
    // or: server.setRequestHandler(CallToolRequestSchema, async (request) => { ... })
    for (let i = 0; i < lines.length; i++) {
      if (/\.tool\s*\(/.test(lines[i]) || /setRequestHandler\s*\(\s*CallToolRequestSchema/.test(lines[i])) {
        // Find the handler function body
        let braceDepth = 0;
        let started = false;
        let end = Math.min(i + 200, lines.length);

        for (let j = i; j < lines.length; j++) {
          for (const ch of lines[j]) {
            if (ch === '{') { braceDepth++; started = true; }
            if (ch === '}') braceDepth--;
          }
          if (started && braceDepth <= 0) {
            end = j + 1;
            break;
          }
        }
        regions.push({ start: i, end });
      }
    }
  }

  if (language === 'python') {
    // Pattern 1: @mcp.tool() / @server.tool() / @server.call_tool() decorators
    // Pattern 2: Class methods named handle_*tool* or read_file/write_file/execute_code in MCP server classes
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*@(?:mcp|server)\.(?:tool|call_tool)/.test(lines[i]) ||
          /^\s*async\s+def\s+(?:handle_tools?_call|handle_call_tool|read_file|write_file|list_directory|execute_code)\s*\(/.test(lines[i])) {
        // Find the def line — may be the current line itself (class method) or the next line (decorator)
        let defLine = -1;
        if (/^\s*(?:async\s+)?def\s+/.test(lines[i])) {
          defLine = i; // Current line IS the def
        } else {
          for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
            if (/^\s*(?:async\s+)?def\s+/.test(lines[j])) {
              defLine = j;
              break;
            }
          }
        }
        if (defLine < 0) continue;

        // Find the end of the function (next def at same or lower indentation, or EOF)
        const indent = lines[defLine].match(/^(\s*)/)?.[1]?.length ?? 0;
        let end = lines.length;
        for (let j = defLine + 1; j < lines.length; j++) {
          const lineContent = lines[j];
          if (lineContent.trim() === '') continue;
          const lineIndent = lineContent.match(/^(\s*)/)?.[1]?.length ?? 0;
          if (lineIndent <= indent && /^\s*(?:@|def |class |async def )/.test(lineContent)) {
            end = j;
            break;
          }
        }
        regions.push({ start: i, end });
      }
    }
  }

  return regions;
}

// ── MCP server detection helpers ─────────────────────────────────────

function isMCPServerTS(source: string): boolean {
  return /@modelcontextprotocol/.test(source) || (/\bMcpServer\b/.test(source) && /\.tool\s*\(/.test(source)) ||
    /\bCallToolRequestSchema\b/.test(source) || /\bListToolsRequestSchema\b/.test(source);
}

function isMCPServerPython(source: string): boolean {
  return /from\s+mcp\.server/.test(source) || /\bFastMCP\b/.test(source) ||
    (/\bListToolsRequestSchema\b/.test(source) || /\bCallToolRequestSchema\b/.test(source)) ||
    (/\bhandle_tools?_call\b/.test(source) && /\bstdio\b/i.test(source)) ||
    // Raw MCP protocol: "tools/list" and "tools/call" method strings
    (/['"]tools\/list['"]/.test(source) && /['"]tools\/call['"]/.test(source));
}

export function isMCPServer(source: string, filePath: string): boolean {
  if (filePath.endsWith('.py')) return isMCPServerPython(source);
  return isMCPServerTS(source);
}

// ── MCP09: data-level-injection ───────────────────────────────────────
// Hidden instructions embedded in string literals (not just tool descriptions).
// Catches indirect prompt injection via document/response data.
// CWE-1427, OWASP MCP02

function dataLevelInjection(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  if (!isMCPServer(source, filePath)) return findings;

  const lines = source.split('\n');
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track block comments (TS: /* */, Python: """ """)
    if (/^\s*\/\*/.test(line) && !/\*\//.test(line)) { inBlockComment = true; continue; }
    if (/\*\//.test(line)) { inBlockComment = false; continue; }
    if (inBlockComment) continue;

    // Skip single-line comments
    if (/^\s*(\/\/|#|\*)/.test(trimmed)) continue;

    // Skip import/require lines
    if (/^\s*(import|from|require)\b/.test(trimmed)) continue;

    for (const { pattern, label } of DATA_INJECTION_PATTERNS) {
      if (pattern.test(line)) {
        findings.push(finding(
          'mcp-data-injection', 'warning',
          `String literal contains injection marker "${label}" — possible data-level prompt injection`,
          filePath, i + 1,
          'Remove injection markers from data. If this is test code, use kern-ignore to suppress.',
        ));
        break; // One finding per line
      }
    }
  }

  return findings;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Run all MCP security rules on source code.
 * Auto-detects language from file extension.
 */
export function runMCPSecurityRules(source: string, filePath: string): ReviewFinding[] {
  const isPython = filePath.endsWith('.py');
  const findings: ReviewFinding[] = [];

  if (isPython) {
    findings.push(...commandInjectionPython(source, filePath));
    findings.push(...pathTraversalPython(source, filePath));
    findings.push(...toolDescriptionPoisoningPython(source, filePath));
    findings.push(...secretsInMetadata(source, filePath));
    findings.push(...unsanitizedToolResponsePython(source, filePath));
    findings.push(...missingInputValidationPython(source, filePath));
    findings.push(...missingAuthRemotePython(source, filePath));
  } else {
    findings.push(...commandInjectionTS(source, filePath));
    findings.push(...pathTraversalTS(source, filePath));
    findings.push(...toolDescriptionPoisoningTS(source, filePath));
    findings.push(...secretsInMetadata(source, filePath));
    findings.push(...unsanitizedToolResponseTS(source, filePath));
    findings.push(...missingInputValidationTS(source, filePath));
    findings.push(...missingAuthRemoteTS(source, filePath));
  }

  // Language-agnostic rules
  findings.push(...dataLevelInjection(source, filePath));
  findings.push(...namespaceTyposquatting(source, filePath));

  // Dedup: data-injection should not duplicate tool-poisoning on same line
  const poisoningLines = new Set(
    findings.filter(f => f.ruleId === 'mcp-tool-poisoning').map(f => f.primarySpan.startLine),
  );
  return findings.filter(f =>
    f.ruleId !== 'mcp-data-injection' || !poisoningLines.has(f.primarySpan.startLine),
  );
}

/** All rule IDs exported by this module */
export const MCP_RULE_IDS = [
  'mcp-command-injection',
  'mcp-path-traversal',
  'mcp-tool-poisoning',
  'mcp-secrets-exposure',
  'mcp-unsanitized-response',
  'mcp-missing-validation',
  'mcp-missing-auth',
  'mcp-typosquatting',
  'mcp-data-injection',
] as const;
