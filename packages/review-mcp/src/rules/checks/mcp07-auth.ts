/**
 * MCP07: missing-auth-remote-server
 * HTTP/SSE MCP servers without authentication middleware.
 * CWE-306, OWASP MCP04
 */

import type { ReviewFinding } from '@kernlang/review';
import { PY_AUTH_MIDDLEWARE, PY_REMOTE_SERVER, TS_AUTH_MIDDLEWARE, TS_REMOTE_SERVER } from '../mcp-patterns.js';
import { isMCPServerPython, isMCPServerTS } from '../mcp-regions.js';
import { finding } from '../mcp-types.js';

export function missingAuthRemoteTS(source: string, filePath: string): ReviewFinding[] {
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
      findings.push(
        finding(
          'mcp-missing-auth',
          'error',
          `Remote MCP server (HTTP/SSE) without authentication — any client can connect and use tools`,
          filePath,
          i + 1,
          'Add authentication middleware (JWT, API key, OAuth). Remote MCP servers MUST verify client identity.',
        ),
      );
      break; // One per file
    }
  }

  return findings;
}

export function missingAuthRemotePython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];

  if (!PY_REMOTE_SERVER.test(source)) return findings;
  if (!isMCPServerPython(source)) return findings;

  if (PY_AUTH_MIDDLEWARE.test(source)) return findings;
  if (/authorization.*header|bearer.*token|oauth/i.test(source)) return findings;

  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (PY_REMOTE_SERVER.test(lines[i])) {
      findings.push(
        finding(
          'mcp-missing-auth',
          'error',
          `Remote MCP server without authentication — any client can connect and use tools`,
          filePath,
          i + 1,
          'Add authentication (JWT, API key, OAuth2). Remote MCP servers MUST verify client identity.',
        ),
      );
      break;
    }
  }

  return findings;
}
