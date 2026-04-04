/**
 * Shared regex patterns for MCP security rules.
 *
 * Grouped by category: exec sinks, file-system ops, path sanitization,
 * secrets, validation, tool descriptions, auth, remote servers,
 * invisible chars, data injection, and known MCP packages.
 */

// ── Command execution sinks ─────────────────────────────────────────

// TypeScript command execution sinks
export const TS_EXEC_SINKS =
  /\b(exec|execSync|execFile|execFileSync|spawn|spawnSync|child_process)\s*\(|\beval\s*\(|\bnew\s+Function\s*\(/;
export const TS_EXEC_LINE = /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(/;

// Python command execution sinks
export const PY_EXEC_SINKS =
  /\b(os\.system|os\.popen|subprocess\.run|subprocess\.call|subprocess\.Popen|subprocess\.check_output|subprocess\.check_call|asyncio\.create_subprocess_exec|asyncio\.create_subprocess_shell)\s*\(/;
export const PY_EVAL_SINKS = /\b(eval|exec)\s*\(/;
export const PY_CODE_EXEC = /\bsys\.executable\b/;

// ── File system operations ──────────────────────────────────────────

export const TS_FS_OPS =
  /\b(readFile|readFileSync|writeFile|writeFileSync|readdir|readdirSync|unlink|unlinkSync|mkdir|mkdirSync|createReadStream|createWriteStream|access|accessSync|stat|statSync|copyFile|copyFileSync|rename|renameSync|rm|rmSync)\s*\(/;
export const PY_FS_OPS =
  /\b(open|os\.remove|os\.unlink|os\.rmdir|os\.rename|os\.listdir|os\.makedirs|shutil\.copy|shutil\.move|shutil\.rmtree|pathlib\.Path)\s*\(/;

// ── Path sanitization ───────────────────────────────────────────────

export const TS_PATH_SANITIZE =
  /\b(path\.resolve|path\.normalize|path\.join|resolve)\s*\(|\.startsWith\s*\(|\.includes\s*\(\s*['"]\.\./;
export const PY_PATH_SANITIZE =
  /\b(os\.path\.abspath|os\.path\.realpath|pathlib\.Path.*\.resolve|os\.path\.normpath)\s*\(|\.startswith\s*\(/;

// ── Secret patterns (high precision) ────────────────────────────────

export const SECRET_PATTERNS =
  /(?:api[_-]?key|secret[_-]?key|password|token|private[_-]?key|auth[_-]?token|access[_-]?key|client[_-]?secret)\s*[:=]\s*['"][^'"]{8,}['"]/i;
// Quoted object/header keys: "X-Api-Key": "value", 'Authorization': 'Bearer ...'
export const QUOTED_SECRET_KEY =
  /['"](?:[\w-]*(?:api[_-]?key|secret|token|password|authorization)[\w-]*)['"]?\s*:\s*['"][^'"]{8,}['"]/i;
export const HARDCODED_KEY =
  /['"](?:sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|AKIA[A-Z0-9]{16}|xox[bpas]-[a-zA-Z0-9-]{10,})['"]/;
// Obfuscated secrets: base64-encoded credential arrays with deobfuscation function
export const BASE64_OBFUSCATION = /Buffer\.from\s*\([^,]+,\s*['"]base64['"]\)|atob\s*\(|base64\.b64decode\s*\(/;

// ── Input validation ────────────────────────────────────────────────

export const TS_VALIDATION =
  /\.parse\s*\(|\.safeParse\s*\(|\.validate\s*\(|typeof\s+\w+\s*[!=]==|instanceof\s+|Array\.isArray\s*\(/;
export const PY_VALIDATION = /\bpydantic\b|\.model_validate\b|isinstance\s*\(|\.validate\s*\(/;

// ── Tool description suspicious patterns ────────────────────────────

export const SUSPICIOUS_DESC_PATTERNS = [
  /ignore\s+(previous|above|all)\s+(instructions?|prompts?|context)/i,
  /disregard\s+(previous|above|all)/i,
  /you\s+are\s+now\b/i,
  /new\s+instructions?:/i,
  /^\s*system\s*:\s*/im, // Only match "system:" at start of line/description, not mid-sentence
  /<\|system\|>/,
  /<\|end\|>/,
  /\[INST\]/,
  /<\/?s>/,
  /<<SYS>>/,
];

// ── Unicode direction markers and invisible characters ──────────────

export const INVISIBLE_CHARS =
  /[\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2060\u2061\u2062\u2063\u2064\uFEFF\u00AD]/;
export const DIRECTION_OVERRIDE = /[\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069]/;

// ── Data-level injection patterns ───────────────────────────────────

export const DATA_INJECTION_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\[SYSTEM INSTRUCTION[:\s]/i, label: '[SYSTEM INSTRUCTION]' },
  { pattern: /<!--\s*HIDDEN\s*:/, label: '<!-- HIDDEN: -->' },
  { pattern: /___INJECT___/, label: '___INJECT___' },
  { pattern: /___END_INJECT___/, label: '___END_INJECT___' },
  { pattern: /\bAssistant instruction\s*:/i, label: 'Assistant instruction:' },
  { pattern: /\bmalicious_instruction\b/, label: 'malicious_instruction' },
  { pattern: /\[HIDDEN INSTRUCTIONS?\]/i, label: '[HIDDEN INSTRUCTION]' },
  { pattern: /\bINJECT_PAYLOAD\b/, label: 'INJECT_PAYLOAD' },
  { pattern: /\bsystem_override\b/i, label: 'system_override' },
];

// ── Auth patterns ───────────────────────────────────────────────────

export const TS_AUTH_MIDDLEWARE =
  /\b(authenticate|authorization|auth|verifyToken|requireAuth|isAuthenticated|passport\.authenticate|jwt\.verify|bearerAuth)\b/i;
export const PY_AUTH_MIDDLEWARE =
  /\b(authenticate|authorization|verify_token|require_auth|is_authenticated|jwt\.decode|HTTPBearer|Depends.*auth|api_key_header)\b/i;

// ── Remote server patterns ──────────────────────────────────────────

export const TS_REMOTE_SERVER =
  /\b(createServer|express\s*\(|app\.listen|Hono|fastify|http\.createServer|SSEServerTransport|StreamableHTTPServerTransport)\b/;
export const PY_REMOTE_SERVER = /\b(FastAPI|Flask|uvicorn\.run|app\.run|SseServerTransport|StreamableHTTPServer)\b/;

// ── Known MCP packages (for typosquatting detection) ────────────────

export const KNOWN_MCP_PACKAGES = [
  'modelcontextprotocol',
  'mcp-server-filesystem',
  'mcp-server-github',
  'mcp-server-postgres',
  'mcp-server-sqlite',
  'mcp-server-puppeteer',
  'mcp-server-brave-search',
  'mcp-server-google-maps',
  'mcp-server-slack',
  'mcp-server-memory',
  'mcp-server-fetch',
  'mcp-server-time',
  'mcp-server-sequential-thinking',
  'mcp-server-everything',
  // Common short-form MCP server names
  'twitter-mcp',
  'discord-mcp',
  'whatsapp-mcp',
  'google-mcp',
  'slack-mcp',
  'github-mcp',
  'filesystem-mcp',
  'postgres-mcp',
];
