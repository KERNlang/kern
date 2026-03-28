/**
 * Badge & report generation for KERN MCP Security.
 */

import * as fs from 'fs';
import * as path from 'path';
import { gradeColor, type SecurityScore, type ToolScore, type Grade } from './score.js';
import type { McpReviewResult } from './scan-types.js';

export function generateBadgeMarkdown(score: SecurityScore): string {
  const color = gradeColor(score.grade).replace('#', '');
  const label = 'MCP Security';
  const message = `${score.grade} (${score.total}/100)`;
  const url = `https://img.shields.io/badge/${encodeURIComponent(label)}-${encodeURIComponent(message)}-${color}`;
  return `![${label}: ${message}](${url})`;
}

export function generateToolTable(score: SecurityScore): string {
  if (score.perTool.length === 0) return '';
  const header = '| Tool | Score | Grade | Guards | Validation | Auth |\n| --- | ---:| --- | ---:| --- | --- |';
  const rows = score.perTool.map((t: ToolScore) =>
    `| ${t.toolName} | ${t.total} | ${t.grade} | ${t.guards}/${t.effects} | ${t.hasValidation ? 'Yes' : 'No'} | ${t.hasAuth ? 'Yes' : 'No'} |`,
  );
  return [header, ...rows].join('\n');
}

export interface SecurityReportJSON {
  version: 1;
  timestamp: string;
  score: {
    total: number;
    grade: Grade;
    guardCoverage: number;
    inputValidation: number;
    ruleCompliance: number;
    authPosture: number;
  };
  perTool: ToolScore[];
  findingsCount: number;
  meta: {
    fileName: string;
    filePath: string;
    lang: string | null;
  };
}

export function generateReportJSON(result: McpReviewResult, score: SecurityScore): SecurityReportJSON {
  return {
    version: 1,
    timestamp: new Date().toISOString(),
    score: {
      total: score.total,
      grade: score.grade,
      guardCoverage: score.guardCoverage,
      inputValidation: score.inputValidation,
      ruleCompliance: score.ruleCompliance,
      authPosture: score.authPosture,
    },
    perTool: score.perTool,
    findingsCount: result.findings.length,
    meta: {
      fileName: result.fileName,
      filePath: result.filePath,
      lang: result.lang,
    },
  };
}

const MARKER_START = '<!-- kern-mcp-security-start -->';
const MARKER_END = '<!-- kern-mcp-security-end -->';

export function updateReadme(workspaceRoot: string, score: SecurityScore, result: McpReviewResult): void {
  const readmePath = path.join(workspaceRoot, 'README.md');

  const badge = generateBadgeMarkdown(score);
  const table = generateToolTable(score);
  const section = [
    MARKER_START,
    '',
    '## MCP Security',
    '',
    badge,
    '',
    ...(table ? [table, ''] : []),
    `> Scanned by [KERN MCP Security](https://github.com/KERNlang/kern-sight-mcp) | Score: ${score.total}/100 (${score.grade})`,
    '',
    MARKER_END,
  ].join('\n');

  let content: string;
  if (fs.existsSync(readmePath)) {
    content = fs.readFileSync(readmePath, 'utf-8');
    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);
    if (startIdx !== -1 && endIdx !== -1) {
      content = content.slice(0, startIdx) + section + content.slice(endIdx + MARKER_END.length);
    } else {
      content = content + '\n\n' + section + '\n';
    }
  } else {
    content = section + '\n';
  }

  fs.writeFileSync(readmePath, content, 'utf-8');
}
