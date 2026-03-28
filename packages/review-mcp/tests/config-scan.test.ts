import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanMcpConfigs } from '../src/config-scan.js';
import type { ConfigScanResult, McpServerEntry, ConfigIssue } from '../src/config-scan.js';

let testConfigPath = '';

function withTempConfig(config: object, fn: (servers: McpServerEntry[], result: ConfigScanResult) => void): void {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kern-config-test-'));
  const cursorDir = path.join(tmpDir, '.cursor');
  fs.mkdirSync(cursorDir);
  testConfigPath = path.join(cursorDir, 'mcp.json');
  fs.writeFileSync(testConfigPath, JSON.stringify(config));
  try {
    const result = scanMcpConfigs(tmpDir);
    const servers = result.servers.filter(s => s.configPath === testConfigPath);
    fn(servers, result);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function issuesOf(servers: McpServerEntry[]): ConfigIssue[] {
  return servers.flatMap(s => s.issues);
}

describe('secret detection', () => {
  it('detects sk- prefix as hardcoded secret', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'node', args: ['server.js'], env: { API_KEY: 'sk-1234567890abcdef' } },
      },
    }, (servers) => {
      assert.ok(issuesOf(servers).some(i => i.type === 'hardcoded-secret'));
    });
  });

  it('detects ghp_ prefix as hardcoded secret', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'node', args: [], env: { TOKEN: 'ghp_abcdefghijklmnop' } },
      },
    }, (servers) => {
      assert.ok(issuesOf(servers).some(i => i.type === 'hardcoded-secret'));
    });
  });

  it('detects secret key names regardless of value', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'node', args: [], env: { api_key: 'myvalue123' } },
      },
    }, (servers) => {
      assert.ok(issuesOf(servers).some(i => i.type === 'hardcoded-secret'));
    });
  });

  it('detects high-entropy strings as potential secrets', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'node', args: [], env: { CUSTOM: 'aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0u' } },
      },
    }, (servers) => {
      assert.ok(issuesOf(servers).some(i => i.type === 'hardcoded-secret'));
    });
  });

  it('does NOT flag low-entropy safe values', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'node', args: [], env: { NODE_ENV: 'production' } },
      },
    }, (servers) => {
      assert.ok(!issuesOf(servers).some(i => i.type === 'hardcoded-secret'));
    });
  });

  it('redacts secret values in output', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'node', args: [], env: { TOKEN: 'sk-1234567890abcdef1234' } },
      },
    }, (servers) => {
      const server = servers.find(s => s.name === 'test');
      assert.ok(server, 'test server should exist in results');
      assert.ok(server.env.TOKEN.includes('...'), 'Secret should be redacted');
      assert.ok(!server.env.TOKEN.includes('sk-1234567890abcdef1234'), 'Full secret should not appear');
    });
  });
});

describe('version pin detection', () => {
  it('flags npx without version pin', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'npx', args: ['some-mcp-server'], env: {} },
      },
    }, (servers) => {
      assert.ok(issuesOf(servers).some(i => i.type === 'missing-version-pin'));
    });
  });

  it('flags npx @latest as NOT a version pin (severity: error)', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'npx', args: ['some-mcp-server@latest'], env: {} },
      },
    }, (servers) => {
      const pinIssues = issuesOf(servers).filter(i => i.type === 'missing-version-pin');
      assert.ok(pinIssues.length > 0, '@latest should trigger missing-version-pin');
      assert.equal(pinIssues[0].severity, 'error', '@latest should be severity error');
      assert.ok(pinIssues[0].message.includes('@latest'), 'Message should mention @latest');
    });
  });

  it('accepts npx with exact version pin', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'npx', args: ['some-mcp-server@1.2.3'], env: {} },
      },
    }, (servers) => {
      assert.ok(!issuesOf(servers).some(i => i.type === 'missing-version-pin'));
    });
  });

  it('flags uvx without version pin', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'uvx', args: ['some-mcp-server'], env: {} },
      },
    }, (servers) => {
      assert.ok(issuesOf(servers).some(i => i.type === 'missing-version-pin'));
    });
  });

  it('accepts uvx with ==version pin', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'uvx', args: ['some-mcp-server==1.0.0'], env: {} },
      },
    }, (servers) => {
      assert.ok(!issuesOf(servers).some(i => i.type === 'missing-version-pin'));
    });
  });
});

describe('wide permissions', () => {
  it('flags --allow-all', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'node', args: ['server.js', '--allow-all'], env: {} },
      },
    }, (servers) => {
      assert.ok(issuesOf(servers).some(i => i.type === 'wide-permission'));
    });
  });

  it('flags --no-sandbox', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'node', args: ['server.js', '--no-sandbox'], env: {} },
      },
    }, (servers) => {
      assert.ok(issuesOf(servers).some(i => i.type === 'wide-permission'));
    });
  });
});

describe('trust levels', () => {
  it('marks server as risky when error-severity issues exist', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'node', args: [], env: { api_key: 'sk-secret123456789' } },
      },
    }, (servers) => {
      const server = servers.find(s => s.name === 'test');
      assert.ok(server, 'test server should exist');
      assert.equal(server.trust, 'risky');
    });
  });

  it('marks server as unknown when only warnings exist', () => {
    withTempConfig({
      mcpServers: {
        test: { command: 'npx', args: ['some-server'], env: {} },
      },
    }, (servers) => {
      const server = servers.find(s => s.name === 'test');
      assert.ok(server, 'test server should exist');
      assert.equal(server.trust, 'unknown');
    });
  });
});

describe('malformed configs', () => {
  it('handles missing mcpServers key gracefully', () => {
    withTempConfig({}, (servers) => {
      assert.equal(servers.length, 0);
    });
  });

  it('handles empty mcpServers gracefully', () => {
    withTempConfig({ mcpServers: {} }, (servers) => {
      assert.equal(servers.length, 0);
    });
  });
});

describe('scan result structure', () => {
  it('counts total issues correctly', () => {
    withTempConfig({
      mcpServers: {
        a: { command: 'npx', args: ['pkg'], env: { api_key: 'sk-test1234567890' } },
        b: { command: 'node', args: ['--allow-all'], env: {} },
      },
    }, (servers, result) => {
      assert.equal(result.totalIssues, result.servers.reduce((n, s) => n + s.issues.length, 0));
      const testIssues = issuesOf(servers);
      assert.ok(testIssues.length >= 2);
    });
  });

  it('includes config path in scanned list', () => {
    withTempConfig({ mcpServers: { test: { command: 'node', args: [], env: {} } } }, (_servers, result) => {
      assert.ok(result.configsScanned.some(p => p.includes('.cursor')));
    });
  });
});
