/**
 * Workspace-level MCP security scan.
 */

import type { IRNode } from '@kernlang/core';
import type { ReviewFinding } from '@kernlang/review';
import * as fs from 'fs';
import * as path from 'path';
import { detectMCPServer, inferMCP, reviewMCPSource } from './index.js';
import { runPostScan } from './post-scan.js';
import type { McpReviewResult } from './scan-types.js';
import { computeSecurityScore, type SecurityScore, type ToolScore } from './score.js';

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py']);
const IGNORE_DIRS = new Set(['node_modules', 'dist', '.git', '__pycache__', '.venv', 'venv']);

function walkDir(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        results.push(...walkDir(fullPath));
      }
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

export interface WorkspaceScanResult {
  score: SecurityScore;
  files: McpReviewResult[];
}

export function scanWorkspace(workspaceRoot: string): WorkspaceScanResult {
  const files = walkDir(workspaceRoot);
  const results: McpReviewResult[] = [];

  for (const filePath of files) {
    let source: string;
    try {
      source = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    let lang: 'typescript' | 'python' | null = null;
    try {
      lang = detectMCPServer(source, filePath);
    } catch {
      continue;
    }
    if (!lang) continue;

    let findings: ReviewFinding[] = [];
    try {
      findings = reviewMCPSource(source, filePath);
    } catch {
      // best-effort
    }

    let irNodes: IRNode[] = [];
    try {
      irNodes = inferMCP(source, filePath);
    } catch {
      irNodes = [];
    }

    findings.push(...runPostScan(source, filePath));

    const score = computeSecurityScore(irNodes, findings);
    results.push({
      fileName: path.basename(filePath),
      filePath,
      findings,
      irNodes,
      lang,
      score,
    });
  }

  const score = aggregateScores(results);
  return { score, files: results };
}

function aggregateScores(results: McpReviewResult[]): SecurityScore {
  if (results.length === 0) {
    return {
      total: 100,
      grade: 'A',
      guardCoverage: 100,
      inputValidation: 100,
      ruleCompliance: 100,
      authPosture: 100,
      perTool: [],
    };
  }

  const scores = results.map((r) => r.score!);
  const avg = (fn: (s: SecurityScore) => number): number =>
    Math.round(scores.reduce((sum, s) => sum + fn(s), 0) / scores.length);

  const guardCoverage = avg((s) => s.guardCoverage);
  const inputValidation = avg((s) => s.inputValidation);
  const ruleCompliance = avg((s) => s.ruleCompliance);
  const authPosture = avg((s) => s.authPosture);

  const total = Math.round(guardCoverage * 0.4 + inputValidation * 0.25 + ruleCompliance * 0.2 + authPosture * 0.15);

  const grade = total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : total >= 40 ? 'D' : 'F';
  const perTool: ToolScore[] = scores.flatMap((s) => s.perTool);

  return { total, grade, guardCoverage, inputValidation, ruleCompliance, authPosture, perTool };
}
