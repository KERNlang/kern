/**
 * MCP server auto-detection — identifies files that implement MCP servers.
 *
 * Detects:
 *   TypeScript: @modelcontextprotocol/sdk imports, McpServer/Server class usage
 *   Python:     mcp.server imports, FastMCP, @mcp.tool() decorators
 */

// ── TypeScript MCP patterns ──────────────────────────────────────────

const TS_MCP_IMPORTS = [
  /@modelcontextprotocol\/sdk/,
  /from\s+['"]@modelcontextprotocol/,
  /require\s*\(\s*['"]@modelcontextprotocol/,
  /\bMcpServer\b/,
  /\bnew\s+Server\s*\(.*['"].*['"]\s*[,)]/,
];

const TS_MCP_PATTERNS = [
  /\.tool\s*\(/,
  /\.resource\s*\(/,
  /\.prompt\s*\(/,
  /server\.setRequestHandler/,
  /CallToolRequestSchema/,
  /ListToolsRequestSchema/,
];

// ── Python MCP patterns ─────────────────────────────────────────────

const PY_MCP_IMPORTS = [
  /from\s+mcp\.server/,
  /from\s+mcp\s+import/,
  /import\s+mcp/,
  /\bFastMCP\b/,
];

const PY_MCP_PATTERNS = [
  /@mcp\.tool\b/,
  /@server\.call_tool\b/,
  /@server\.tool\b/,
  /\.tool\s*\(\s*\)/,  // decorator
];

// Raw MCP implementations (no SDK — direct JSON-RPC protocol)
const PY_MCP_RAW = [
  /['"]tools\/call['"]/,          // JSON-RPC method string
  /['"]tools\/list['"]/,          // JSON-RPC method string
  /['"]resources\/read['"]/,      // JSON-RPC method string
  /\bclass\s+\w*MCP\w*Server\b/i, // Class name containing "MCP" + "Server"
  /\bclass\s+\w*MCPServer\b/i,    // MCPServer class
  /handle_tools?_call/,           // Common handler method name
];

// ── Code generator detection ────────────────────────────────────────
// Files that GENERATE MCP server code (transpilers, codegen) should not
// be reviewed as MCP servers themselves. MCP patterns in string literals
// would cause false positives.

function isCodeGenerator(source: string, filePath: string): boolean {
  // Path-based: transpiler/codegen files
  if (/transpil|codegen|emit|generator/i.test(filePath)) return true;
  // Content-based: files that build source code via string push/concat
  const pushCount = (source.match(/\blines\.push\s*\(`/g) || []).length;
  if (pushCount > 10) return true;
  // Imports from KERN compiler packages
  if (/@kernlang\/(core|mcp)/.test(source) && /\btranspile|buildDiagnostics/.test(source)) return true;
  return false;
}

/**
 * Detect if source code implements an MCP server.
 * Returns the detected language or null.
 * Skips code generators that produce MCP server code (transpilers, codegen).
 */
export function detectMCPServer(source: string, filePath: string): 'typescript' | 'python' | null {
  // Code generators contain MCP patterns as string literals — skip them
  if (isCodeGenerator(source, filePath)) return null;

  const isPython = filePath.endsWith('.py');
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js');

  if (isTS) {
    const hasImport = TS_MCP_IMPORTS.some(p => p.test(source));
    const hasPattern = TS_MCP_PATTERNS.some(p => p.test(source));
    // Raw MCP: JSON-RPC method strings like "tools/call"
    const hasRaw = /['"]tools\/call['"]/.test(source) || /['"]tools\/list['"]/.test(source);
    if (hasImport || (hasPattern && source.includes('server')) || hasRaw) return 'typescript';
  }

  if (isPython) {
    const hasImport = PY_MCP_IMPORTS.some(p => p.test(source));
    const hasPattern = PY_MCP_PATTERNS.some(p => p.test(source));
    const hasRaw = PY_MCP_RAW.some(p => p.test(source));
    if (hasImport || hasPattern || hasRaw) return 'python';
  }

  return null;
}
