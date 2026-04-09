/**
 * MCP Server Inspector — live tool inspection + structural poisoning detection.
 *
 * Discovers configured MCP servers from config files, spawns each one,
 * performs a JSON-RPC 2.0 handshake, retrieves tool list, and analyzes
 * tool descriptions using KERN's existing security pattern library.
 *
 * Uses the same detection patterns as the source-code scanner (mcp-patterns.ts)
 * plus structural checks only possible with live data: cross-server shadowing,
 * schema/description mismatch, cross-server tool reference analysis.
 *
 * No external dependencies — hand-rolls minimal JSON-RPC over stdio.
 */

import { type ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import { type McpServerEntry, scanMcpConfigs } from './config-scan.js';
import { checkDescriptionForPoisoning } from './rules/checks/mcp03-tool-poisoning.js';
import { DATA_INJECTION_PATTERNS } from './rules/mcp-patterns.js';

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

// ── Poisoning detection (KERN structural analysis) ─────────────────────
//
// Layer 1: Reuses KERN's existing pattern library (checkDescriptionForPoisoning,
//          SUSPICIOUS_DESC_PATTERNS, INVISIBLE_CHARS, DIRECTION_OVERRIDE,
//          DATA_INJECTION_PATTERNS) — same checks as source-code scanner.
// Layer 2: Cross-origin escalation patterns (tool-description-specific).
// Layer 3: Structural checks only possible with live multi-server data:
//          cross-server shadowing, schema/description mismatch, cross-server
//          tool references.

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

// Cross-origin patterns (live-inspection-specific — not in source scanner)
const CROSS_ORIGIN_PATTERNS: { regex: RegExp; severity: 'error' | 'warning'; message: string }[] = [
  {
    regex: /\b(before|after)\s+using\s+this\s+tool,?\s+(always\s+)?(call|use|invoke|run)\s/i,
    severity: 'error',
    message: 'Tool description instructs calling other tools — cross-origin escalation',
  },
  {
    regex: /\bthis\s+tool\s+(should|must|needs\s+to)\s+be\s+(called|used|invoked)\s+(with|alongside|after|before)\b/i,
    severity: 'warning',
    message: 'Tool description prescribes execution order — potential cross-origin influence',
  },
  {
    regex: /\bALWAYS\s+call\s+this\s+tool\s+(first|before)\b/i,
    severity: 'error',
    message: 'Tool description forces priority execution — coercion pattern',
  },
  {
    regex: /\b(secretly|covertly|without\s+telling)\b/i,
    severity: 'error',
    message: 'Tool description uses stealth language — hidden behavior',
  },
  {
    regex: /\b(send|post|upload|transmit|exfiltrate)\b.*\b(to|at)\s+(https?:\/\/|wss?:\/\/)/i,
    severity: 'error',
    message: 'Tool description references sending data to external URL — data exfiltration risk',
  },
];

/**
 * Layer 1: Run KERN's existing description poisoning checks.
 * Same function the source-code scanner uses for MCP03.
 */
function runKernPoisoningChecks(serverName: string, serverSource: string, tool: McpToolInfo): PoisoningFinding[] {
  const findings: PoisoningFinding[] = [];
  const desc = tool.description || '';
  if (!desc) return findings;

  // Use KERN's existing checkDescriptionForPoisoning (MCP03)
  const kernFindings: { ruleId: string; severity: string; message: string }[] = [];
  checkDescriptionForPoisoning(desc, `live:${serverName}`, 1, kernFindings as any);

  for (const kf of kernFindings) {
    findings.push({
      serverName,
      serverSource,
      toolName: tool.name,
      pattern: 'kern-mcp03',
      severity: kf.severity === 'error' ? 'error' : 'warning',
      message: kf.message,
    });
  }

  // Data injection patterns from KERN's pattern library
  for (const dip of DATA_INJECTION_PATTERNS) {
    if (dip.pattern.test(desc)) {
      findings.push({
        serverName,
        serverSource,
        toolName: tool.name,
        pattern: 'data-injection',
        severity: 'error',
        message: `Tool description contains data injection marker: ${dip.label}`,
        matchedText: desc.match(dip.pattern)?.[0]?.slice(0, 100),
      });
    }
  }

  return findings;
}

/**
 * Layer 2: Cross-origin and behavioral patterns.
 */
function runCrossOriginChecks(serverName: string, serverSource: string, tool: McpToolInfo): PoisoningFinding[] {
  const findings: PoisoningFinding[] = [];
  const desc = tool.description || '';

  for (const pat of CROSS_ORIGIN_PATTERNS) {
    const match = desc.match(pat.regex);
    if (match) {
      findings.push({
        serverName,
        serverSource,
        toolName: tool.name,
        pattern: 'cross-origin',
        severity: pat.severity,
        message: pat.message,
        matchedText: match[0].slice(0, 100),
      });
    }
  }

  // Excessive description length
  if (desc.length > 2000) {
    findings.push({
      serverName,
      serverSource,
      toolName: tool.name,
      pattern: 'excessive-description',
      severity: 'warning',
      message: `Tool description is ${desc.length} chars — may hide instructions in long text`,
    });
  }

  return findings;
}

/**
 * Layer 3: Structural checks that require multi-server context.
 * - Tool shadowing: common tool names used by third-party servers
 * - Cross-server tool references: description mentions tools from other servers
 * - Schema/description mismatch: description says "read-only" but schema has write params
 */
function runStructuralChecks(
  serverName: string,
  serverSource: string,
  tool: McpToolInfo,
  allServersTools: Map<string, McpToolInfo[]>,
): PoisoningFinding[] {
  const findings: PoisoningFinding[] = [];
  const desc = (tool.description || '').toLowerCase();

  // Tool shadowing — common tool names
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

  // Cross-server tool reference — description mentions tool names from OTHER servers
  for (const [otherServer, otherTools] of allServersTools) {
    if (otherServer === serverName) continue;
    for (const otherTool of otherTools) {
      if (new RegExp(`\\b${otherTool.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(desc)) {
        findings.push({
          serverName,
          serverSource,
          toolName: tool.name,
          pattern: 'cross-server-reference',
          severity: 'warning',
          message: `Tool description references '${otherTool.name}' from server '${otherServer}' — potential cross-origin influence`,
        });
      }
    }
  }

  // Schema/description mismatch — description implies read-only but schema has write-like params
  if (desc && tool.inputSchema) {
    const schema = tool.inputSchema as { properties?: Record<string, unknown> };
    const props = Object.keys(schema.properties ?? {});
    const claimsReadOnly = /\bread[- ]?only\b|\bno\s+(?:side\s+)?effects?\b|\bsafe\b/.test(desc);
    const hasWriteParams = props.some((p) => /write|delete|update|create|modify|execute|run|command/i.test(p));
    if (claimsReadOnly && hasWriteParams) {
      findings.push({
        serverName,
        serverSource,
        toolName: tool.name,
        pattern: 'schema-description-mismatch',
        severity: 'error',
        message: `Description claims read-only but schema has write-like params (${props.filter((p) => /write|delete|update|create|modify|execute|run|command/i.test(p)).join(', ')})`,
      });
    }
  }

  return findings;
}

/** Run all three detection layers on a tool. */
function checkPoisoning(
  serverName: string,
  serverSource: string,
  tool: McpToolInfo,
  allServersTools: Map<string, McpToolInfo[]>,
): PoisoningFinding[] {
  return [
    ...runKernPoisoningChecks(serverName, serverSource, tool),
    ...runCrossOriginChecks(serverName, serverSource, tool),
    ...runStructuralChecks(serverName, serverSource, tool, allServersTools),
  ];
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

  // Pass 1: Connect to all servers and collect tool lists
  const servers: InspectedServer[] = [];
  for (const entry of configResult.servers) {
    if (options.allowlist && !options.allowlist.includes(entry.name)) continue;
    const inspected = await connectToServer(entry, timeout, maxOutput);
    servers.push(inspected);
  }

  // Build cross-server tool map for structural analysis (Layer 3)
  const allServersTools = new Map<string, McpToolInfo[]>();
  for (const srv of servers) {
    if (srv.status === 'ok') allServersTools.set(srv.name, srv.tools);
  }

  // Pass 2: Run all three detection layers with cross-server context
  for (const srv of servers) {
    if (srv.status !== 'ok') continue;
    for (const tool of srv.tools) {
      srv.findings.push(...checkPoisoning(srv.name, srv.source, tool, allServersTools));
    }
  }

  return {
    servers,
    totalTools: servers.reduce((sum, s) => sum + s.tools.length, 0),
    totalFindings: servers.reduce((sum, s) => sum + s.findings.length, 0),
    configsScanned: configResult.configsScanned.length,
  };
}

async function connectToServer(entry: McpServerEntry, timeout: number, maxOutput: number): Promise<InspectedServer> {
  const base: Omit<InspectedServer, 'status' | 'tools' | 'findings'> = {
    name: entry.name,
    source: entry.source,
    command: entry.command,
    args: entry.args,
  };

  try {
    const tools = await connectAndListTools(entry.command, entry.args, entry.env, timeout, maxOutput);
    return { ...base, status: 'ok', tools, findings: [] };
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
