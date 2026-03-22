import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { reviewMCPSource, detectMCPServer } from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURES, name), 'utf-8');
}

// ── Detection ─────────────────────────────────────────────────────────

describe('detectMCPServer', () => {
  test('detects TypeScript MCP server', () => {
    const source = loadFixture('vulnerable-ts-server.ts');
    expect(detectMCPServer(source, 'server.ts')).toBe('typescript');
  });

  test('detects Python MCP server', () => {
    const source = loadFixture('vulnerable-py-server.py');
    expect(detectMCPServer(source, 'server.py')).toBe('python');
  });

  test('returns null for non-MCP file', () => {
    expect(detectMCPServer('const x = 1;', 'app.ts')).toBeNull();
  });

  test('returns null for non-MCP Python file', () => {
    expect(detectMCPServer('import os\nprint("hello")', 'app.py')).toBeNull();
  });
});

// ── TypeScript Vulnerable Server ──────────────────────────────────────

describe('MCP security rules — TypeScript vulnerable server', () => {
  const source = loadFixture('vulnerable-ts-server.ts');
  const findings = reviewMCPSource(source, 'vulnerable-ts-server.ts');

  test('detects command injection in tool handler (MCP01)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-command-injection');
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0].severity).toBe('error');
  });

  test('detects path traversal in tool handler (MCP02)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-path-traversal');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('detects tool description poisoning (MCP03)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-tool-poisoning');
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0].severity).toBe('error');
  });

  test('detects hardcoded secrets (MCP04)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-secrets-exposure');
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0].severity).toBe('error');
  });

  test('detects unsanitized tool response (MCP05)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-unsanitized-response');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('detects missing input validation (MCP06)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-missing-validation');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('detects missing auth on remote server (MCP07)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-missing-auth');
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0].severity).toBe('error');
  });

  test('total: catches at least 7 unique rule IDs', () => {
    const ruleIds = new Set(findings.map(f => f.ruleId));
    expect(ruleIds.size).toBeGreaterThanOrEqual(7);
  });
});

// ── Python Vulnerable Server ──────────────────────────────────────────

describe('MCP security rules — Python vulnerable server', () => {
  const source = loadFixture('vulnerable-py-server.py');
  const findings = reviewMCPSource(source, 'vulnerable-py-server.py');

  test('detects command injection (MCP01)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-command-injection');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('detects path traversal (MCP02)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-path-traversal');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('detects tool description poisoning (MCP03)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-tool-poisoning');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('detects hardcoded secrets (MCP04)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-secrets-exposure');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('detects unsanitized response (MCP05)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-unsanitized-response');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('detects missing validation (MCP06)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-missing-validation');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('detects missing auth (MCP07)', () => {
    const f = findings.filter(f => f.ruleId === 'mcp-missing-auth');
    expect(f.length).toBeGreaterThanOrEqual(1);
  });

  test('total: catches at least 7 unique rule IDs', () => {
    const ruleIds = new Set(findings.map(f => f.ruleId));
    expect(ruleIds.size).toBeGreaterThanOrEqual(7);
  });
});

// ── TypeScript Safe Server (False Positive Check) ─────────────────────

describe('MCP security rules — TypeScript safe server (false positives)', () => {
  const source = loadFixture('safe-ts-server.ts');
  const findings = reviewMCPSource(source, 'safe-ts-server.ts');

  test('no command injection false positives', () => {
    expect(findings.filter(f => f.ruleId === 'mcp-command-injection')).toHaveLength(0);
  });

  test('no path traversal false positives', () => {
    expect(findings.filter(f => f.ruleId === 'mcp-path-traversal')).toHaveLength(0);
  });

  test('no tool poisoning false positives', () => {
    expect(findings.filter(f => f.ruleId === 'mcp-tool-poisoning')).toHaveLength(0);
  });

  test('no secrets false positives', () => {
    expect(findings.filter(f => f.ruleId === 'mcp-secrets-exposure')).toHaveLength(0);
  });

  test('no missing validation false positives', () => {
    expect(findings.filter(f => f.ruleId === 'mcp-missing-validation')).toHaveLength(0);
  });

  test('total findings should be minimal', () => {
    // Allow some info-level findings, but no errors
    const errors = findings.filter(f => f.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});

// ── Python Safe Server (False Positive Check) ─────────────────────────

describe('MCP security rules — Python safe server (false positives)', () => {
  const source = loadFixture('safe-py-server.py');
  const findings = reviewMCPSource(source, 'safe-py-server.py');

  test('no command injection false positives', () => {
    expect(findings.filter(f => f.ruleId === 'mcp-command-injection')).toHaveLength(0);
  });

  test('no path traversal false positives', () => {
    expect(findings.filter(f => f.ruleId === 'mcp-path-traversal')).toHaveLength(0);
  });

  test('no tool poisoning false positives', () => {
    expect(findings.filter(f => f.ruleId === 'mcp-tool-poisoning')).toHaveLength(0);
  });

  test('no secrets false positives', () => {
    expect(findings.filter(f => f.ruleId === 'mcp-secrets-exposure')).toHaveLength(0);
  });

  test('total errors should be zero', () => {
    const errors = findings.filter(f => f.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});

// ── Namespace Typosquatting ────────────────────────────────────────────

describe('MCP security rules — namespace typosquatting (MCP08)', () => {
  test('detects typosquat of mcp-server-filesystem', () => {
    const source = '{ "name": "mcp-server-filesytem", "version": "1.0.0" }';
    const findings = reviewMCPSource(source, 'package.json');
    const f = findings.filter(f => f.ruleId === 'mcp-typosquatting');
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f[0].message).toContain('mcp-server-filesystem');
  });

  test('does not flag exact match', () => {
    const source = '{ "name": "mcp-server-filesystem", "version": "1.0.0" }';
    const findings = reviewMCPSource(source, 'package.json');
    expect(findings.filter(f => f.ruleId === 'mcp-typosquatting')).toHaveLength(0);
  });

  test('detects typosquat of mcp-server-github', () => {
    const source = '{ "name": "mcp-server-githbu", "version": "1.0.0" }';
    const findings = reviewMCPSource(source, 'package.json');
    expect(findings.filter(f => f.ruleId === 'mcp-typosquatting').length).toBeGreaterThanOrEqual(1);
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────

describe('MCP security rules — edge cases', () => {
  test('invisible Unicode chars in tool description', () => {
    const source = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
const server = new McpServer({ name: 'test', version: '1.0.0' });
server.tool('evil', 'Normal tool\u200B\u200Bwith hidden chars', {}, async () => {
  return { content: [{ type: 'text', text: 'ok' }] };
});`;
    const findings = reviewMCPSource(source, 'server.ts');
    expect(findings.filter(f => f.ruleId === 'mcp-tool-poisoning').length).toBeGreaterThanOrEqual(1);
  });

  test('Python shell=True in subprocess', () => {
    const source = `
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("test")

@mcp.tool()
def run(cmd: str) -> str:
    """Run a command"""
    import subprocess
    result = subprocess.run(cmd, shell=True, capture_output=True)
    return result.stdout.decode()
`;
    const findings = reviewMCPSource(source, 'server.py');
    expect(findings.filter(f => f.ruleId === 'mcp-command-injection').length).toBeGreaterThanOrEqual(1);
  });
});
