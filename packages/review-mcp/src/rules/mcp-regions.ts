/**
 * Tool handler region detection and MCP server detection helpers.
 *
 * - findToolHandlerRegions: locate tool handler function bodies
 * - isMCPServerTS / isMCPServerPython / isMCPServer: detect MCP server files
 */

import { createLexicalMask } from './mcp-lexical.js';

// ── Tool handler region detection ────────────────────────────────────

export interface CodeRegion {
  start: number; // 0-based line index
  end: number; // 0-based line index (exclusive)
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

        // Use masked lines for brace counting to avoid strings/comments
        const maskedSource = createLexicalMask(lines.join('\n'));
        const maskedLines = maskedSource.split('\n');
        for (let j = i; j < maskedLines.length; j++) {
          for (const ch of maskedLines[j]) {
            if (ch === '{') {
              braceDepth++;
              started = true;
            }
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
      if (
        /^\s*@(?:mcp|server)\.(?:tool|call_tool)/.test(lines[i]) ||
        /^\s*async\s+def\s+(?:handle_tools?_call|handle_call_tool|read_file|write_file|list_directory|execute_code)\s*\(/.test(
          lines[i],
        )
      ) {
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

export function isMCPServerTS(source: string): boolean {
  return (
    /@modelcontextprotocol/.test(source) ||
    (/\bMcpServer\b/.test(source) && /\.tool\s*\(/.test(source)) ||
    /\bCallToolRequestSchema\b/.test(source) ||
    /\bListToolsRequestSchema\b/.test(source)
  );
}

export function isMCPServerPython(source: string): boolean {
  return (
    /from\s+mcp\.server/.test(source) ||
    /\bFastMCP\b/.test(source) ||
    /\bListToolsRequestSchema\b/.test(source) ||
    /\bCallToolRequestSchema\b/.test(source) ||
    (/\bhandle_tools?_call\b/.test(source) && /\bstdio\b/i.test(source)) ||
    // Raw MCP protocol: "tools/list" and "tools/call" method strings
    (/['"]tools\/list['"]/.test(source) && /['"]tools\/call['"]/.test(source))
  );
}

export function isMCPServer(source: string, filePath: string): boolean {
  if (filePath.endsWith('.py')) return isMCPServerPython(source);
  return isMCPServerTS(source);
}
