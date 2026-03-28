/**
 * Config Scanner — standalone CLI version of Config Guardian.
 *
 * Scans MCP configuration files for security issues without any VS Code
 * dependencies. Replicates the pure detection logic from config-guardian.ts.
 */

import { readFileSync, existsSync } from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ConfigIssue {
  type: 'hardcoded-secret' | 'unscanned-path' | 'missing-version-pin' | 'wide-permission';
  message: string;
  severity: 'error' | 'warning' | 'info';
  detail?: string;
}

export type TrustLevel = 'verified' | 'unknown' | 'risky';

export interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  source: string;
  configPath: string;
  issues: ConfigIssue[];
  trust: TrustLevel;
}

export interface ConfigScanResult {
  servers: McpServerEntry[];
  configsScanned: string[];
  configsMissing: string[];
  totalIssues: number;
}

const SECRET_PREFIXES = /^(sk-|ghp_|gho_|github_pat_|xox[bpas]-|AKIA|AIza|Bearer\s|glpat-|npm_|pypi-)/;
const SECRET_KEY_NAMES = /^(api[_-]?key|secret[_-]?key|password|token|private[_-]?key|auth[_-]?token|access[_-]?key|client[_-]?secret|database[_-]?url)$/i;

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const c of s) freq.set(c, (freq.get(c) || 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function isLikelySecret(key: string, value: string): boolean {
  if (SECRET_PREFIXES.test(value)) return true;
  if (SECRET_KEY_NAMES.test(key)) return true;
  if (value.length > 16 && shannonEntropy(value) > 4.5) return true;
  return false;
}

function redact(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

interface ConfigTarget {
  path: string;
  source: string;
}

function discoverConfigPaths(workspaceRoot?: string): ConfigTarget[] {
  const home = os.homedir();
  const platform = os.platform();
  const targets: ConfigTarget[] = [];

  if (platform === 'darwin') {
    targets.push({ path: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'), source: 'claude-desktop' });
  } else if (platform === 'win32') {
    targets.push({ path: path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'), source: 'claude-desktop' });
  } else {
    targets.push({ path: path.join(home, '.config', 'claude', 'claude_desktop_config.json'), source: 'claude-desktop' });
  }

  targets.push({ path: path.join(home, '.claude', 'claude_code_config.json'), source: 'claude-code' });
  targets.push({ path: path.join(home, '.windsurf', 'mcp.json'), source: 'windsurf' });

  if (workspaceRoot) {
    targets.push({ path: path.join(workspaceRoot, '.cursor', 'mcp.json'), source: 'cursor' });
    targets.push({ path: path.join(workspaceRoot, '.vscode', 'mcp.json'), source: 'vscode' });
    targets.push({ path: path.join(workspaceRoot, '.windsurf', 'mcp.json'), source: 'windsurf' });
  }

  return targets;
}

interface RawMcpConfig {
  mcpServers?: Record<string, {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

function analyzeConfig(raw: string, source: string, configPath: string): McpServerEntry[] {
  const entries: McpServerEntry[] = [];
  let parsed: RawMcpConfig;
  try {
    parsed = JSON.parse(raw) as RawMcpConfig;
  } catch {
    return entries;
  }

  const servers = parsed.mcpServers ?? {};

  for (const [name, config] of Object.entries(servers)) {
    const command = config.command ?? '';
    const args = config.args ?? [];
    const env = config.env ?? {};
    const issues: ConfigIssue[] = [];

    for (const [key, value] of Object.entries(env)) {
      if (isLikelySecret(key, value)) {
        issues.push({
          type: 'hardcoded-secret',
          severity: 'error',
          message: `Hardcoded secret in env.${key}: ${redact(value)}`,
          detail: 'Move to a .env file or system keychain. Never commit secrets in MCP configs.',
        });
      }
    }

    if (/\bnpx\b/.test(command) || args.some(a => /\bnpx\b/.test(a))) {
      const fullCmd = [command, ...args].join(' ');
      const hasExactPin = /@\d/.test(fullCmd) && !/@latest\b/.test(fullCmd);
      if (!hasExactPin) {
        const isLatest = /@latest\b/.test(fullCmd);
        issues.push({
          type: 'missing-version-pin',
          severity: isLatest ? 'error' : 'warning',
          message: isLatest
            ? 'npx package@latest is NOT a version pin — resolves to whatever is current'
            : 'npx package without version pin — supply chain risk',
          detail: 'Use npx package@1.2.3 instead of npx package or npx package@latest',
        });
      }
    }

    if (/\buvx\b/.test(command) || args.some(a => /\buvx\b/.test(a))) {
      const fullCmd = [command, ...args].join(' ');
      const hasUvxPin = /==\d/.test(fullCmd) || (/@\d/.test(fullCmd) && !/@latest\b/.test(fullCmd));
      if (!hasUvxPin) {
        const isLatest = /@latest\b/.test(fullCmd);
        issues.push({
          type: 'missing-version-pin',
          severity: isLatest ? 'error' : 'warning',
          message: isLatest
            ? 'uvx package@latest is NOT a version pin — resolves to whatever is current'
            : 'uvx package without version pin — supply chain risk',
          detail: 'Use uvx package==1.2.3 instead of uvx package',
        });
      }
    }

    const fullArgs = args.join(' ');
    if (/--allow-all|--no-sandbox|--disable-security/.test(fullArgs)) {
      issues.push({
        type: 'wide-permission',
        severity: 'error',
        message: 'Wide permission flag detected: disables security restrictions',
      });
    }

    const isLocalPath = command.startsWith('/') || command.startsWith('./') || command.startsWith('~');
    if (isLocalPath) {
      const resolved = command.startsWith('~') ? command.replace('~', os.homedir()) : command;
      if (!existsSync(resolved)) {
        issues.push({
          type: 'unscanned-path',
          severity: 'info',
          message: `Command path not found: ${command}`,
        });
      }
    }

    let trust: TrustLevel = 'verified';
    if (issues.some(i => i.severity === 'error')) {
      trust = 'risky';
    } else if (issues.length > 0 || !isLocalPath) {
      trust = 'unknown';
    }

    const redactedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      redactedEnv[key] = isLikelySecret(key, value) ? redact(value) : value;
    }

    entries.push({ name, command, args, env: redactedEnv, source, configPath, issues, trust });
  }

  return entries;
}

export function scanMcpConfigs(workspaceRoot?: string): ConfigScanResult {
  const targets = discoverConfigPaths(workspaceRoot);
  const servers: McpServerEntry[] = [];
  const configsScanned: string[] = [];
  const configsMissing: string[] = [];

  for (const target of targets) {
    if (!existsSync(target.path)) {
      configsMissing.push(target.path);
      continue;
    }
    try {
      const raw = readFileSync(target.path, 'utf-8');
      const entries = analyzeConfig(raw, target.source, target.path);
      servers.push(...entries);
      configsScanned.push(target.path);
    } catch {
      configsMissing.push(target.path);
    }
  }

  return {
    servers,
    configsScanned,
    configsMissing,
    totalIssues: servers.reduce((sum, s) => sum + s.issues.length, 0),
  };
}
