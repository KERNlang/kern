/**
 * MCP Server Inspector — live tool inspection + poisoning detection.
 *
 * Discovers configured MCP servers from config files, spawns each one,
 * performs a JSON-RPC 2.0 handshake, retrieves tool list, and checks
 * tool descriptions for poisoning patterns (hidden instructions,
 * cross-origin escalation, tool shadowing).
 *
 * No external dependencies — hand-rolls minimal JSON-RPC over stdio.
 */

import { type ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import { type McpServerEntry, scanMcpConfigs } from './config-scan.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema?: unknown;
}

export interface PoisoningFinding {
  serverName: string;
  serverSource: string;
  toolName: string;
  pattern: string;
  severity: 'error' | 'warning';
  message: string;
  matchedText?: string;
}

export interface InspectedServer {
  name: string;
  source: string;
  command: string;
  args: string[];
  status: 'ok' | 'error' | 'timeout';
  error?: string;
  tools: McpToolInfo[];
  findings: PoisoningFinding[];
}

export interface InspectionResult {
  servers: InspectedServer[];
  totalTools: number;
  totalFindings: number;
  configsScanned: number;
}

export interface InspectOptions {
  /** Timeout per server connection in ms (default: 10000) */
  timeout?: number;
  /** Max stdout bytes to read before killing (default: 1MB) */
  maxOutput?: number;
  /** Only inspect servers whose names match these (default: all) */
  allowlist?: string[];
}

// ── Poisoning detection patterns ───────────────────────────────────────

interface PoisonPattern {
  id: string;
  severity: 'error' | 'warning';
  regex: RegExp;
  message: string;
}

const POISON_PATTERNS: PoisonPattern[] = [
  // Hidden instructions — attempts to override LLM behavior
  {
    id: 'hidden-instruction',
    severity: 'error',
    regex: /ignore\s+(all\s+)?previous\s+instructions/i,
    message: 'Tool description contains "ignore previous instructions" — likely prompt injection',
  },
  {
    id: 'hidden-instruction',
    severity: 'error',
    regex: /do\s+not\s+tell\s+the\s+user/i,
    message: 'Tool description contains "do not tell the user" — hidden instruction',
  },
  {
    id: 'hidden-instruction',
    severity: 'error',
    regex: /system\s*:\s*you\s+are/i,
    message: 'Tool description contains system prompt override pattern',
  },
  {
    id: 'hidden-instruction',
    severity: 'error',
    regex: /\bALWAYS\s+call\s+this\s+tool\s+(first|before)\b/i,
    message: 'Tool description forces priority execution — coercion pattern',
  },
  {
    id: 'hidden-instruction',
    severity: 'error',
    regex: /\b(secretly|covertly|without\s+telling)\b/i,
    message: 'Tool description uses stealth language — hidden behavior',
  },
  // Cross-origin escalation — tool references other tools
  {
    id: 'cross-origin-escalation',
    severity: 'error',
    regex: /\b(before|after)\s+using\s+this\s+tool,?\s+(always\s+)?(call|use|invoke|run)\s/i,
    message: 'Tool description instructs calling other tools — cross-origin escalation',
  },
  {
    id: 'cross-origin-escalation',
    severity: 'warning',
    regex: /\bthis\s+tool\s+(should|must|needs\s+to)\s+be\s+(called|used|invoked)\s+(with|alongside|after|before)\b/i,
    message: 'Tool description prescribes execution order — potential cross-origin influence',
  },
  // Data exfiltration
  {
    id: 'data-exfiltration',
    severity: 'error',
    regex: /\b(send|post|upload|transmit|exfiltrate)\b.*\b(to|at)\s+(https?:\/\/|wss?:\/\/)/i,
    message: 'Tool description references sending data to external URL',
  },
  {
    id: 'data-exfiltration',
    severity: 'warning',
    regex: /https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^\s"']+/i,
    message: 'Tool description contains external URL — verify it is legitimate',
  },
  // Encoding / obfuscation in descriptions
  {
    id: 'obfuscation',
    severity: 'warning',
    regex: /(?:[A-Za-z0-9+/]{40,}={0,2})/,
    message: 'Tool description contains base64-like encoded string — possible hidden payload',
  },
  {
    id: 'obfuscation',
    severity: 'warning',
    regex: /\\u[0-9a-fA-F]{4}/,
    message: 'Tool description contains unicode escape sequences — possible obfuscation',
  },
  // Excessive length (can hide instructions in noise)
  {
    id: 'excessive-description',
    severity: 'warning',
    regex: /.{2000,}/s,
    message: 'Tool description exceeds 2000 chars — may hide instructions in long text',
  },
];

// Common tool names that could be shadowed
const SHADOW_TARGETS = new Set([
  'read_file',
  'write_file',
  'execute_command',
  'run_command',
  'bash',
  'shell',
  'exec',
  'read',
  'write',
  'delete',
  'list_files',
  'search',
  'fetch',
  'http_request',
  'sql_query',
  'database_query',
]);

function checkPoisoning(serverName: string, serverSource: string, tool: McpToolInfo): PoisoningFinding[] {
  const findings: PoisoningFinding[] = [];
  const desc = tool.description || '';

  for (const pattern of POISON_PATTERNS) {
    const match = desc.match(pattern.regex);
    if (match) {
      findings.push({
        serverName,
        serverSource,
        toolName: tool.name,
        pattern: pattern.id,
        severity: pattern.severity,
        message: pattern.message,
        matchedText: match[0].slice(0, 100),
      });
    }
  }

  // Tool shadowing — common tool names used by a third-party server
  if (SHADOW_TARGETS.has(tool.name.toLowerCase())) {
    findings.push({
      serverName,
      serverSource,
      toolName: tool.name,
      pattern: 'tool-shadowing',
      severity: 'warning',
      message: `Tool '${tool.name}' shadows a common tool name — may intercept calls meant for other servers`,
    });
  }

  return findings;
}

// ── JSON-RPC over stdio ────────────────────────────────────────────────

function jsonRpcRequest(id: number, method: string, params: unknown = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
}

function jsonRpcNotification(method: string, params: unknown = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n';
}

async function connectAndListTools(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeout: number,
  maxOutput: number,
): Promise<McpToolInfo[]> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        timeout,
      });
    } catch (err) {
      reject(new Error(`Failed to spawn: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    let buffer = '';
    let totalBytes = 0;
    let resolved = false;
    const pendingResponses = new Map<number, (data: any) => void>();

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill('SIGKILL');
        reject(new Error('Connection timed out'));
      }
    }, timeout);

    const cleanup = () => {
      clearTimeout(timer);
      if (!child.killed) child.kill('SIGTERM');
    };

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error(`Process error: ${err.message}`));
      }
    });

    child.on('close', (code) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error(`Process exited with code ${code} before completing handshake`));
      }
    });

    child.stdout!.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxOutput) {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Output exceeded ${maxOutput} bytes — killed`));
        }
        return;
      }

      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id != null && pendingResponses.has(msg.id)) {
            const cb = pendingResponses.get(msg.id)!;
            pendingResponses.delete(msg.id);
            cb(msg);
          }
        } catch {
          // Ignore non-JSON lines (server logs, etc.)
        }
      }
    });

    // Ignore stderr
    child.stderr!.on('data', () => {});

    // Step 1: Send initialize
    const initPromise = new Promise<any>((res) => {
      pendingResponses.set(1, res);
    });
    child.stdin!.write(
      jsonRpcRequest(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'kern-inspector', version: '1.0.0' },
      }),
    );

    initPromise
      .then(() => {
        // Step 2: Send initialized notification
        child.stdin!.write(jsonRpcNotification('notifications/initialized'));

        // Step 3: Request tools/list
        const toolsPromise = new Promise<any>((res) => {
          pendingResponses.set(2, res);
        });
        child.stdin!.write(jsonRpcRequest(2, 'tools/list'));
        return toolsPromise;
      })
      .then((msg) => {
        if (!resolved) {
          resolved = true;
          cleanup();

          const tools: McpToolInfo[] = (msg.result?.tools ?? []).map((t: any) => ({
            name: t.name ?? '',
            description: t.description ?? '',
            inputSchema: t.inputSchema,
          }));
          resolve(tools);
        }
      })
      .catch((err) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      });
  });
}

// ── Public API ──────────────────────────────────────────────────────────

export async function inspectMcpServers(
  workspaceRoot?: string,
  options: InspectOptions = {},
): Promise<InspectionResult> {
  const timeout = options.timeout ?? 10_000;
  const maxOutput = options.maxOutput ?? 1_048_576; // 1MB

  const configResult = scanMcpConfigs(workspaceRoot);
  const servers: InspectedServer[] = [];

  for (const entry of configResult.servers) {
    // Skip if allowlist is set and server not in it
    if (options.allowlist && !options.allowlist.includes(entry.name)) continue;

    const inspected = await inspectSingleServer(entry, timeout, maxOutput);
    servers.push(inspected);
  }

  return {
    servers,
    totalTools: servers.reduce((sum, s) => sum + s.tools.length, 0),
    totalFindings: servers.reduce((sum, s) => sum + s.findings.length, 0),
    configsScanned: configResult.configsScanned.length,
  };
}

async function inspectSingleServer(
  entry: McpServerEntry,
  timeout: number,
  maxOutput: number,
): Promise<InspectedServer> {
  const base: Omit<InspectedServer, 'status' | 'tools' | 'findings'> = {
    name: entry.name,
    source: entry.source,
    command: entry.command,
    args: entry.args,
  };

  try {
    const tools = await connectAndListTools(entry.command, entry.args, entry.env, timeout, maxOutput);
    const findings: PoisoningFinding[] = [];
    for (const tool of tools) {
      findings.push(...checkPoisoning(entry.name, entry.source, tool));
    }

    return { ...base, status: 'ok', tools, findings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('timed out') ? 'timeout' : 'error';
    return { ...base, status, error: message, tools: [], findings: [] };
  }
}

// ── Hashing for live tool pinning ──────────────────────────────────────

export function hashToolList(tools: McpToolInfo[]): string {
  const canonical = tools
    .map((t) => JSON.stringify({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
    .sort()
    .join('\n');
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function hashTool(tool: McpToolInfo): { descriptionHash: string; schemaHash: string } {
  return {
    descriptionHash: crypto.createHash('sha256').update(tool.description).digest('hex'),
    schemaHash: crypto
      .createHash('sha256')
      .update(JSON.stringify(tool.inputSchema ?? {}))
      .digest('hex'),
  };
}

// ── Live lockfile generation + verification ────────────────────────────

export interface LiveToolPin {
  name: string;
  descriptionHash: string;
  schemaHash: string;
}

export interface LiveServerPin {
  serverName: string;
  source: string;
  command: string;
  toolListHash: string;
  tools: LiveToolPin[];
  timestamp: string;
}

export interface LiveLockFile {
  version: 2;
  generated: string;
  servers: LiveServerPin[];
}

export interface LivePinDrift {
  serverName: string;
  toolName: string;
  field: 'description' | 'schema' | 'new-tool' | 'removed-tool' | 'new-server' | 'removed-server';
  severity: 'error' | 'warning';
  message: string;
}

export function generateLiveLockFile(inspectionResult: InspectionResult): LiveLockFile {
  const now = new Date().toISOString();

  const servers: LiveServerPin[] = inspectionResult.servers
    .filter((s) => s.status === 'ok')
    .map((s) => ({
      serverName: s.name,
      source: s.source,
      command: s.command,
      toolListHash: hashToolList(s.tools),
      tools: s.tools.map((t) => ({
        name: t.name,
        ...hashTool(t),
      })),
      timestamp: now,
    }));

  return { version: 2, generated: now, servers };
}

export function verifyLiveLockFile(lockFile: LiveLockFile, inspectionResult: InspectionResult): LivePinDrift[] {
  const drifts: LivePinDrift[] = [];

  const lockedByName = new Map(lockFile.servers.map((s) => [s.serverName, s]));
  const currentByName = new Map(inspectionResult.servers.filter((s) => s.status === 'ok').map((s) => [s.name, s]));

  // Check for removed servers
  for (const [name] of lockedByName) {
    if (!currentByName.has(name)) {
      drifts.push({
        serverName: name,
        toolName: '*',
        field: 'removed-server',
        severity: 'warning',
        message: `Server '${name}' was in lockfile but is no longer configured`,
      });
    }
  }

  // Check for new servers
  for (const [name] of currentByName) {
    if (!lockedByName.has(name)) {
      drifts.push({
        serverName: name,
        toolName: '*',
        field: 'new-server',
        severity: 'warning',
        message: `Server '${name}' is new — not in lockfile`,
      });
    }
  }

  // Check each locked server's tools
  for (const [name, locked] of lockedByName) {
    const current = currentByName.get(name);
    if (!current) continue;

    const lockedTools = new Map(locked.tools.map((t) => [t.name, t]));
    const currentTools = new Map(current.tools.map((t) => [t.name, { ...hashTool(t), name: t.name }]));

    for (const [toolName, pinnedTool] of lockedTools) {
      const currentTool = currentTools.get(toolName);
      if (!currentTool) {
        drifts.push({
          serverName: name,
          toolName,
          field: 'removed-tool',
          severity: 'error',
          message: `Tool '${toolName}' in server '${name}' was removed`,
        });
        continue;
      }

      if (currentTool.descriptionHash !== pinnedTool.descriptionHash) {
        drifts.push({
          serverName: name,
          toolName,
          field: 'description',
          severity: 'error',
          message: `Tool '${toolName}' in server '${name}' — description changed (possible tool poisoning / rug pull)`,
        });
      }

      if (currentTool.schemaHash !== pinnedTool.schemaHash) {
        drifts.push({
          serverName: name,
          toolName,
          field: 'schema',
          severity: 'error',
          message: `Tool '${toolName}' in server '${name}' — input schema changed`,
        });
      }
    }

    for (const [toolName] of currentTools) {
      if (!lockedTools.has(toolName)) {
        drifts.push({
          serverName: name,
          toolName,
          field: 'new-tool',
          severity: 'warning',
          message: `Tool '${toolName}' in server '${name}' is new — not pinned`,
        });
      }
    }
  }

  return drifts;
}
