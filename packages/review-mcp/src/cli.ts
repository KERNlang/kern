#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { generateReportJSON } from './badge.js';
import { type ConfigScanResult, scanMcpConfigs } from './config-scan.js';
import { generateLockFile, verifyLockFile } from './tool-pin.js';
import { scanWorkspace, type WorkspaceScanResult } from './workspace-scan.js';

const PKG_VERSION: string = (() => {
  try {
    const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

interface CliArgs {
  paths: string[];
  threshold: number;
  format: 'json' | 'sarif' | 'text';
  output: string | null;
  quiet: boolean;
  scanConfig: boolean;
  lock: boolean;
  verify: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    paths: [],
    threshold: 0,
    format: 'text',
    output: null,
    quiet: false,
    scanConfig: false,
    lock: false,
    verify: false,
  };

  let i = 2;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--threshold' && argv[i + 1]) {
      args.threshold = parseInt(argv[++i], 10) || 0;
    } else if (arg === '--format' && argv[i + 1]) {
      const fmt = argv[++i];
      if (fmt === 'json' || fmt === 'sarif' || fmt === 'text') args.format = fmt;
    } else if (arg === '--output' && argv[i + 1]) {
      args.output = argv[++i];
    } else if (arg === '--quiet' || arg === '-q') {
      args.quiet = true;
    } else if (arg === '--scan-config') {
      args.scanConfig = true;
    } else if (arg === '--lock') {
      args.lock = true;
    } else if (arg === '--verify') {
      args.verify = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (arg === '--version' || arg === '-V') {
      console.log(`kern-mcp-security ${PKG_VERSION}`);
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      args.paths.push(arg);
    }
    i++;
  }

  if (args.paths.length === 0) args.paths.push('.');
  return args;
}

function printHelp(): void {
  console.log(`kern-mcp-security ${PKG_VERSION} — MCP server security scanner

Usage:
  kern-mcp-security [options] [path]

Options:
  --threshold N   Minimum score to pass (exit 1 if below)
  --format fmt    Output: text | json | sarif (default: text)
  --output file   Write report to file (default: stdout)
  --quiet, -q     Only output score + exit code
  --scan-config   Scan MCP config files for secrets & misconfig
  --lock          Generate .kern-mcp-lock.json (pin tool schemas)
  --verify        Compare against lockfile, exit 1 on drift
  --help, -h      Show this help
  --version, -V   Show version

Examples:
  kern-mcp-security ./src/server.ts
  kern-mcp-security --threshold 70 --format sarif --output report.sarif .
  kern-mcp-security --scan-config
  kern-mcp-security --lock ./src/server.ts
  kern-mcp-security --verify ./src/server.ts`);
}

function toSARIF(result: WorkspaceScanResult): object {
  const runs = [
    {
      tool: {
        driver: {
          name: 'KERN MCP Security',
          version: PKG_VERSION,
          informationUri: 'https://github.com/KERNlang/kern-sight-mcp',
          rules: [] as object[],
        },
      },
      results: [] as object[],
    },
  ];

  const ruleIds = new Set<string>();

  for (const file of result.files) {
    for (const f of file.findings) {
      if (!ruleIds.has(f.ruleId)) {
        ruleIds.add(f.ruleId);
        runs[0].tool.driver.rules.push({
          id: f.ruleId,
          shortDescription: { text: f.message.split('—')[0].trim() },
          defaultConfiguration: {
            level: f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'note',
          },
        });
      }

      runs[0].results.push({
        ruleId: f.ruleId,
        level: f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'note',
        message: { text: f.message },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: path.relative(process.cwd(), file.filePath) },
              region: {
                startLine: f.primarySpan.startLine,
                startColumn: f.primarySpan.startCol,
              },
            },
          },
        ],
        ...(f.suggestion ? { fixes: [{ description: { text: f.suggestion }, artifactChanges: [] }] } : {}),
      });
    }
  }

  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs,
  };
}

function toText(result: WorkspaceScanResult): string {
  const lines: string[] = [];
  const { score } = result;

  lines.push(`KERN MCP Security Score: ${score.grade} (${score.total}/100)`);
  lines.push(`  Guard coverage:    ${score.guardCoverage}%`);
  lines.push(`  Input validation:  ${score.inputValidation}%`);
  lines.push(`  Rule compliance:   ${score.ruleCompliance}%`);
  lines.push(`  Auth posture:      ${score.authPosture}%`);
  lines.push('');

  if (result.files.length === 0) {
    lines.push('No MCP server files found.');
    return lines.join('\n');
  }

  lines.push(`${result.files.length} MCP server file(s) scanned:`);

  for (const file of result.files) {
    const findingCount = file.findings.length;
    const grade = file.score?.grade ?? '?';
    lines.push(`  ${file.fileName} — ${grade} (${findingCount} finding${findingCount !== 1 ? 's' : ''})`);

    for (const f of file.findings) {
      const sev = f.severity === 'error' ? 'BUG' : f.severity === 'warning' ? 'WARN' : 'INFO';
      lines.push(`    [${sev}] L${f.primarySpan.startLine} ${f.ruleId}: ${f.message.slice(0, 100)}`);
    }
  }

  return lines.join('\n');
}

function configScanToText(result: ConfigScanResult): string {
  const lines: string[] = [];

  lines.push('KERN MCP Config Scan');
  lines.push(`  Configs found: ${result.configsScanned.length}`);
  lines.push(`  Servers:       ${result.servers.length}`);
  lines.push(`  Issues:        ${result.totalIssues}`);
  lines.push('');

  if (result.configsScanned.length === 0) {
    lines.push('No MCP configuration files found.');
    return lines.join('\n');
  }

  for (const configPath of result.configsScanned) {
    lines.push(`Config: ${configPath}`);
    const serversInConfig = result.servers.filter((s) => s.configPath === configPath);
    for (const server of serversInConfig) {
      const trustIcon = server.trust === 'verified' ? 'OK' : server.trust === 'unknown' ? '??' : '!!';
      lines.push(`  [${trustIcon}] ${server.name} (${server.command})`);
      for (const issue of server.issues) {
        const sev = issue.severity === 'error' ? 'ERR ' : issue.severity === 'warning' ? 'WARN' : 'INFO';
        lines.push(`       [${sev}] ${issue.message}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function main(): void {
  const args = parseArgs(process.argv);

  if (args.scanConfig) {
    const workspaceRoot = args.paths[0] !== '.' ? path.resolve(args.paths[0]) : process.cwd();
    const result = scanMcpConfigs(workspaceRoot);

    let output: string;
    if (args.format === 'json') {
      output = JSON.stringify(result, null, 2);
    } else {
      output = configScanToText(result);
    }

    if (args.output) {
      fs.writeFileSync(args.output, `${output}\n`, 'utf-8');
      if (!args.quiet) console.log(`Report written to ${args.output}`);
    } else if (!args.quiet) {
      console.log(output);
    } else {
      const errors = result.servers.reduce((n, s) => n + s.issues.filter((i) => i.severity === 'error').length, 0);
      console.log(`issues:${result.totalIssues} errors:${errors}`);
    }

    if (result.servers.some((s) => s.issues.some((i) => i.severity === 'error'))) {
      process.exit(1);
    }
    return;
  }

  const scanPath = path.resolve(args.paths[0]);
  const result = scanWorkspace(scanPath);

  if (args.lock) {
    let _totalPinned = 0;
    for (const file of result.files) {
      const lockFile = generateLockFile(file.filePath, file.irNodes);
      const lockPath = path.join(path.dirname(file.filePath), '.kern-mcp-lock.json');
      fs.writeFileSync(lockPath, `${JSON.stringify(lockFile, null, 2)}\n`, 'utf-8');
      _totalPinned += lockFile.tools.length;
      if (!args.quiet) {
        console.log(`Lockfile generated: ${lockPath} (${lockFile.tools.length} tools pinned)`);
      }
    }
    if (result.files.length === 0 && !args.quiet) {
      console.log('No MCP server files found — no lockfile generated.');
    }
  }

  if (args.verify) {
    let hasErrors = false;
    let anyLockFound = false;

    for (const file of result.files) {
      const lockPath = path.join(path.dirname(file.filePath), '.kern-mcp-lock.json');
      if (!fs.existsSync(lockPath)) continue;
      anyLockFound = true;

      const drifts = verifyLockFile(lockPath, file.filePath, file.irNodes);
      if (drifts.length === 0) {
        if (!args.quiet) console.log(`Tool pinning OK: ${file.fileName} (no drift)`);
        continue;
      }

      console.log('Tool pinning drift detected:');
      for (const d of drifts) {
        const tag = d.severity === 'error' ? '[ERROR]' : '[WARN] ';
        console.log(`  ${tag} ${d.message}`);
        if (d.severity === 'error') hasErrors = true;
      }
    }

    if (!anyLockFound && !args.quiet) {
      console.log('No .kern-mcp-lock.json found — run with --lock first.');
    }

    if (hasErrors) {
      process.exit(1);
    }
  }

  let output: string;
  if (args.format === 'sarif') {
    output = JSON.stringify(toSARIF(result), null, 2);
  } else if (args.format === 'json') {
    const aggregate = {
      fileName: 'workspace',
      filePath: scanPath,
      findings: result.files.flatMap((f) => f.findings),
      irNodes: result.files.flatMap((f) => f.irNodes),
      lang: null,
      score: result.score,
    };
    output = JSON.stringify(generateReportJSON(aggregate, result.score), null, 2);
  } else {
    output = toText(result);
  }

  if (args.output) {
    fs.writeFileSync(args.output, `${output}\n`, 'utf-8');
    if (!args.quiet) {
      console.log(`Report written to ${args.output}`);
      console.log(`Score: ${result.score.grade} (${result.score.total}/100)`);
    }
  } else if (!args.quiet) {
    console.log(output);
  } else {
    console.log(`${result.score.grade} ${result.score.total}`);
  }

  if (args.threshold > 0 && result.score.total < args.threshold) {
    console.error(`Score ${result.score.total} below threshold ${args.threshold} — failing`);
    process.exit(1);
  }
}

main();
