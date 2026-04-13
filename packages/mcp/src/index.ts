/**
 * @kernlang/mcp — MCP server transpiler
 *
 * Compiles .kern MCP definitions to secure TypeScript MCP servers
 * using @modelcontextprotocol/sdk. Security guards are enforced
 * by construction — validation, logging, and path containment
 * are auto-injected.
 */
export { transpileMCP, transpileMCPResult } from './transpiler-mcp.js';
export { transpileMCPPython } from './transpiler-mcp-python.js';
