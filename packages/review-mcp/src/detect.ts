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

/**
 * Detect if source code implements an MCP server.
 * Returns the detected language or null.
 */
export function detectMCPServer(source: string, filePath: string): 'typescript' | 'python' | null {
  const isPython = filePath.endsWith('.py');
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx') || filePath.endsWith('.js');

  if (isTS) {
    const hasImport = TS_MCP_IMPORTS.some(p => p.test(source));
    const hasPattern = TS_MCP_PATTERNS.some(p => p.test(source));
    if (hasImport || (hasPattern && source.includes('server'))) return 'typescript';
  }

  if (isPython) {
    const hasImport = PY_MCP_IMPORTS.some(p => p.test(source));
    const hasPattern = PY_MCP_PATTERNS.some(p => p.test(source));
    if (hasImport || hasPattern) return 'python';
  }

  return null;
}
