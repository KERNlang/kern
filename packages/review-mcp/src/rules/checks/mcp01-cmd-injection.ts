/**
 * MCP01: command-injection-tool-handler
 * User-supplied tool parameters flow to shell command execution.
 * CWE-77, OWASP MCP04
 */

import type { ReviewFinding } from '@kernlang/review';
import { finding } from '../mcp-types.js';
import { isCommentLine, findLines } from '../mcp-lexical.js';
import { TS_EXEC_SINKS, TS_EXEC_LINE, PY_EXEC_SINKS, PY_EVAL_SINKS, PY_CODE_EXEC } from '../mcp-patterns.js';
import { findToolHandlerRegions, isMCPServerTS } from '../mcp-regions.js';

export function commandInjectionTS(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  // Quick bail: no exec sinks at all
  if (!TS_EXEC_SINKS.test(source)) return findings;

  // Find tool handler regions (server.tool(...) calls)
  const toolHandlerRegions = findToolHandlerRegions(lines, 'typescript');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');
    if (!TS_EXEC_SINKS.test(block)) continue;

    // Check each exec line (skip comments)
    for (let i = region.start; i < region.end; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      if (!TS_EXEC_LINE.test(line) && !/\beval\s*\(/.test(line)) continue;

      // Check if line uses template literals or string concat with params
      const usesParams = /\$\{/.test(line) || /\+\s*\w/.test(line) || /`[^`]*\$\{/.test(block.substring(0, i - region.start));
      // Check for execFileSync/spawn with array args (safer pattern)
      const usesArrayArgs = /\b(?:execFile|execFileSync|spawn|spawnSync)\s*\(\s*['"][^'"]+['"],\s*\[/.test(line);

      if (usesParams && !usesArrayArgs) {
        findings.push(finding(
          'mcp-command-injection', 'error',
          `Shell command execution in MCP tool handler with interpolated parameters — command injection risk`,
          filePath, i + 1,
          'Use execFile/spawn with array arguments instead of exec with string interpolation. Validate parameters against an allowlist.',
        ));
      }
    }
  }

  // Detect eval() inside tool handler regions (skip comments)
  for (const region of toolHandlerRegions) {
    for (let i = region.start; i < region.end; i++) {
      if (isCommentLine(lines[i])) continue;
      if (/\beval\s*\(/.test(lines[i])) {
        findings.push(finding(
          'mcp-command-injection', 'error',
          `eval() in MCP tool handler — arbitrary code execution risk`,
          filePath, i + 1,
          'Never use eval() with user-supplied input. Use JSON.parse for data, or a sandboxed interpreter.',
        ));
      }
    }
  }

  // Also catch exec/eval calls in the general file context if MCP patterns are present
  if (toolHandlerRegions.length === 0 && isMCPServerTS(source)) {
    for (const lineNum of findLines(source, TS_EXEC_LINE)) {
      const line = lines[lineNum - 1];
      if (/\$\{/.test(line) || /\+\s*\w/.test(line)) {
        findings.push(finding(
          'mcp-command-injection', 'warning',
          `Shell command execution with interpolated values in MCP server — potential command injection`,
          filePath, lineNum,
          'Use execFile/spawn with array arguments. Validate all parameters before shell execution.',
        ));
      }
    }
    // Catch eval() in general MCP server context
    for (const lineNum of findLines(source, /\beval\s*\(/)) {
      findings.push(finding(
        'mcp-command-injection', 'error',
        `eval() in MCP server — arbitrary code execution risk`,
        filePath, lineNum,
        'Never use eval() with user-supplied input. Use JSON.parse for data, or a sandboxed interpreter.',
      ));
    }
  }

  return findings;
}

export function commandInjectionPython(source: string, filePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const lines = source.split('\n');

  if (!PY_EXEC_SINKS.test(source) && !PY_EVAL_SINKS.test(source) && !PY_CODE_EXEC.test(source)) return findings;

  const toolHandlerRegions = findToolHandlerRegions(lines, 'python');

  for (const region of toolHandlerRegions) {
    const block = lines.slice(region.start, region.end).join('\n');

    for (let i = region.start; i < region.end; i++) {
      const line = lines[i];

      if (PY_EXEC_SINKS.test(line)) {
        // Check for f-strings, .format(), or % formatting with params
        const usesInterp = /f['"]/.test(line) || /\.format\s*\(/.test(line) || /%\s*\(/.test(line) || /\+\s*\w/.test(line);
        // subprocess.run with shell=True is always dangerous
        const shellTrue = /shell\s*=\s*True/.test(line);

        if (usesInterp || shellTrue) {
          findings.push(finding(
            'mcp-command-injection', 'error',
            `Shell command execution in MCP tool handler${shellTrue ? ' with shell=True' : ''} — command injection risk`,
            filePath, i + 1,
            'Use subprocess.run with a list of arguments (no shell=True). Validate parameters against an allowlist.',
          ));
        }
      }

      if (PY_EVAL_SINKS.test(line) && !/\bexec\s*\(\s*['"]/.test(line)) {
        findings.push(finding(
          'mcp-command-injection', 'error',
          `eval()/exec() in MCP tool handler — arbitrary code execution risk`,
          filePath, i + 1,
          'Never use eval/exec with user-supplied input. Use ast.literal_eval for data parsing or a sandboxed approach.',
        ));
      }

      // asyncio.create_subprocess_exec with sys.executable — arbitrary code execution
      if (/create_subprocess_exec/.test(line) && PY_CODE_EXEC.test(block)) {
        findings.push(finding(
          'mcp-command-injection', 'error',
          `Arbitrary code execution via subprocess with Python interpreter in MCP tool handler`,
          filePath, i + 1,
          'Do not execute user-supplied code via sys.executable. Use a sandboxed environment or restrict to predefined scripts.',
        ));
      }
    }
  }

  return findings;
}
