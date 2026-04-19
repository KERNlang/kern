import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '../../dist/index.js');

function sendMCP(messages: object[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const cp = spawn('node', [SERVER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    cp.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    cp.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });

    for (const msg of messages) {
      cp.stdin.write(`${JSON.stringify(msg)}\n`);
    }

    setTimeout(() => {
      cp.kill();
      resolve({ stdout, stderr });
    }, 3000);

    cp.on('error', reject);
  });
}

function rpc(method: string, params: object = {}, id = 1): object {
  return { jsonrpc: '2.0', method, params, id };
}

describe('KERN MCP Server Integration', () => {
  it('should respond to initialize', async () => {
    const { stdout } = await sendMCP([
      rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    ]);

    const response = JSON.parse(stdout.split('\n')[0]);
    expect(response.result.serverInfo.name).toBe('kern');
    expect(response.result.serverInfo.version).toBe('3.0.0');
    expect(response.result.capabilities.tools).toBeDefined();
    expect(response.result.capabilities.resources).toBeDefined();
    expect(response.result.capabilities.prompts).toBeDefined();
  });

  it('should list tools', async () => {
    const { stdout } = await sendMCP([
      rpc(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        1,
      ),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc('tools/list', {}, 2),
    ]);

    const lines = stdout.split('\n').filter(Boolean);
    const listResponse = JSON.parse(lines[lines.length - 1]);
    const toolNames = listResponse.result.tools.map((t: { name: string }) => t.name);

    expect(toolNames).toContain('compile');
    expect(toolNames).toContain('review');
    expect(toolNames).toContain('parse');
    expect(toolNames).toContain('validate');
    expect(toolNames).toContain('list-targets');
  });

  it('should compile .kern source via tools/call', async () => {
    const { stdout } = await sendMCP([
      rpc(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        1,
      ),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc(
        'tools/call',
        {
          name: 'compile',
          arguments: {
            source: 'page name=Home\n  text value="Hello"',
            target: 'nextjs',
          },
        },
        2,
      ),
    ]);

    const lines = stdout.split('\n').filter(Boolean);
    const callResponse = JSON.parse(lines[lines.length - 1]);
    expect(callResponse.result.content[0].type).toBe('text');
    expect(callResponse.result.content[0].text).toContain('Compiled to nextjs');
  });

  it('should compile React targets with bulletproof structure via tools/call', async () => {
    const { stdout } = await sendMCP([
      rpc(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        1,
      ),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc(
        'tools/call',
        {
          name: 'compile',
          arguments: {
            source: ['screen name=Dashboard', '  card name=CalorieCard', '    text value=Calories'].join('\n'),
            target: 'nextjs',
            structure: 'bulletproof',
          },
        },
        2,
      ),
    ]);

    const lines = stdout.split('\n').filter(Boolean);
    const callResponse = JSON.parse(lines[lines.length - 1]);
    const text = callResponse.result.content[0].text;
    expect(text).toContain('Compiled to nextjs / bulletproof');
    expect(text).toContain('--- features/dashboard/');
  });

  it('should parse .kern source', async () => {
    const { stdout } = await sendMCP([
      rpc(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        1,
      ),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc(
        'tools/call',
        {
          name: 'parse',
          arguments: { source: 'screen name=Dashboard\n  text value="Hello"' },
        },
        2,
      ),
    ]);

    const lines = stdout.split('\n').filter(Boolean);
    const callResponse = JSON.parse(lines[lines.length - 1]);
    expect(callResponse.result.content[0].text).toContain('IR tokens');
  });

  it('should validate .kern source', async () => {
    const { stdout } = await sendMCP([
      rpc(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        1,
      ),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc(
        'tools/call',
        {
          name: 'validate',
          arguments: { source: 'button label="Click"' },
        },
        2,
      ),
    ]);

    const lines = stdout.split('\n').filter(Boolean);
    const callResponse = JSON.parse(lines[lines.length - 1]);
    expect(callResponse.result.content[0].text).toContain('Valid .kern');
  });

  it('should list targets', async () => {
    const { stdout } = await sendMCP([
      rpc(
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
        1,
      ),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      rpc('tools/call', { name: 'list-targets', arguments: {} }, 2),
    ]);

    const lines = stdout.split('\n').filter(Boolean);
    const callResponse = JSON.parse(lines[lines.length - 1]);
    const text = callResponse.result.content[0].text;
    expect(text).toContain('13 targets');
    expect(text).toContain('mcp');
    expect(text).toContain('nextjs');
    expect(text).toContain('express');
    expect(text).toContain('bulletproof');
  });

  it('should log server start to stderr', async () => {
    const { stderr } = await sendMCP([
      rpc('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      }),
    ]);

    expect(stderr).toContain('server:start');
    expect(stderr).toContain('"name":"kern"');
  });
});
