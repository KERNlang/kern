/**
 * CLI review rules — active when target = cli.
 *
 * Focused on Commander.js entrypoint pitfalls.
 */

import { Node, SyntaxKind } from 'ts-morph';
import type { ReviewFinding, ReviewRule, RuleContext } from '../types.js';
import { finding } from './utils.js';

function isCommanderFile(text: string): boolean {
  return /from\s+['"]commander['"]|require\s*\(\s*['"]commander['"]\s*\)|\bnew\s+Command\s*\(/.test(text);
}

function isEntrypointLike(ctx: RuleContext, text: string): boolean {
  return /(?:^|\/)(?:cli|bin|main|index)\.[cm]?[jt]sx?$/.test(ctx.filePath) ||
    text.startsWith('#!') ||
    /\bprocess\.argv\b/.test(text) ||
    /\.\s*parse(?:Async)?\s*\(/.test(text);
}

function hasCommandInstance(ctx: RuleContext): boolean {
  return ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression).some(expr => expr.getExpression().getText() === 'Command');
}

// ── Rule: cli-missing-shebang ───────────────────────────────────────────

function missingShebang(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isCommanderFile(fullText) || !hasCommandInstance(ctx) || !isEntrypointLike(ctx, fullText)) return [];
  if (fullText.startsWith('#!')) return [];

  return [finding(
    'cli-missing-shebang',
    'warning',
    'pattern',
    'CLI entrypoint is missing a shebang — direct execution via npm bin or shell will fail',
    ctx.filePath,
    1,
    1,
    { suggestion: '#!/usr/bin/env node' },
  )];
}

// ── Rule: cli-missing-parse ─────────────────────────────────────────────

function missingParse(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isCommanderFile(fullText) || !hasCommandInstance(ctx) || !isEntrypointLike(ctx, fullText)) return [];
  if (/\.\s*parse(?:Async)?\s*\(/.test(fullText)) return [];

  const command = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.NewExpression)
    .find(expr => expr.getExpression().getText() === 'Command');
  if (!command) return [];

  return [finding(
    'cli-missing-parse',
    'error',
    'bug',
    'Commander CLI creates a Command instance but never parses argv — commands and options will never run',
    ctx.filePath,
    command.getStartLineNumber(),
    1,
    { suggestion: 'Call await program.parseAsync() (or program.parse() for fully synchronous handlers)' },
  )];
}

// ── Rule: cli-async-parse-sync ──────────────────────────────────────────

function asyncParseSync(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isCommanderFile(fullText)) return [];

  const hasAsyncAction = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).some(call => {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== 'action') return false;
    const callback = call.getArguments()[0];
    return (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) && callback.isAsync();
  });
  if (!hasAsyncAction || /\.\s*parseAsync\s*\(/.test(fullText)) return [];

  const syncParse = ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).find(call => {
    const expr = call.getExpression();
    return Node.isPropertyAccessExpression(expr) && expr.getName() === 'parse';
  });
  if (!syncParse) return [];

  return [finding(
    'cli-async-parse-sync',
    'error',
    'bug',
    'Commander async action handler paired with parse() — pending promises can be dropped before completion',
    ctx.filePath,
    syncParse.getStartLineNumber(),
    1,
    { suggestion: 'Use await program.parseAsync() when any action handler is async' },
  )];
}

// ── Rule: cli-process-exit-in-action ────────────────────────────────────

function processExitInAction(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();
  if (!isCommanderFile(fullText)) return findings;

  for (const call of ctx.sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== 'action') continue;

    const callback = call.getArguments()[0];
    if (!callback || (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback))) continue;

    const exitCall = callback.getDescendantsOfKind(SyntaxKind.CallExpression).find(desc => {
      const descExpr = desc.getExpression();
      return Node.isPropertyAccessExpression(descExpr) &&
        descExpr.getExpression().getText() === 'process' &&
        descExpr.getName() === 'exit';
    });
    if (!exitCall) continue;

    findings.push(finding(
      'cli-process-exit-in-action',
      'warning',
      'pattern',
      'Commander action handler calls process.exit() directly — this can skip cleanup and truncate stdio output',
      ctx.filePath,
      exitCall.getStartLineNumber(),
      1,
      { suggestion: 'Throw an error or set process.exitCode and return from the action handler' },
    ));
  }

  return findings;
}

export const cliRules: ReviewRule[] = [
  missingShebang,
  missingParse,
  asyncParseSync,
  processExitInAction,
];
