/**
 * Terminal review rules — active when target = terminal.
 *
 * Focused on interactive ANSI / readline terminal apps.
 * Codex base rules + Claude extras (signal-handler, cursor-restore, unthrottled-render).
 */

import type { ReviewFinding, ReviewRule, RuleContext } from '../types.js';
import { finding } from './utils.js';

function lineForIndex(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function matchLine(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  return match ? lineForIndex(text, match.index) : null;
}

// ── Rule: terminal-missing-tty-guard (Codex) ────────────────────────────

function missingTtyGuard(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  const interactivePattern = /\b(?:readline\.)?createInterface\s*\(|\b(?:process\.)?stdin\.setRawMode\s*\(\s*true|\b(?:process\.)?stdout\.(?:write|clearLine|cursorTo|clearScreenDown)\s*\(|\?1049h|\x1b\[|\u001b\[/;
  if (!interactivePattern.test(fullText)) return [];
  if (/\b(?:process\.)?(?:stdout|stdin)\.isTTY\b|\btty\.isatty\s*\(/.test(fullText)) return [];

  const line = matchLine(fullText, interactivePattern) ?? 1;
  return [finding(
    'terminal-missing-tty-guard',
    'warning',
    'bug',
    'Interactive terminal code runs without a TTY guard — pipes and non-interactive shells will render incorrectly',
    ctx.filePath,
    line,
    1,
    { suggestion: 'Guard interactive paths with process.stdout.isTTY / process.stdin.isTTY before enabling ANSI UI features' },
  )];
}

// ── Rule: terminal-raw-mode-no-restore (Codex) ──────────────────────────

function rawModeNoRestore(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  const enable = /\.setRawMode\s*\(\s*true\s*\)/g;
  if (!enable.test(fullText)) return [];
  if (/\.setRawMode\s*\(\s*false\s*\)/.test(fullText)) return [];

  enable.lastIndex = 0;
  const match = enable.exec(fullText);
  const line = match ? lineForIndex(fullText, match.index) : 1;
  return [finding(
    'terminal-raw-mode-no-restore',
    'error',
    'bug',
    'stdin raw mode is enabled without restoring it — the shell can be left in a broken state after exit',
    ctx.filePath,
    line,
    1,
    { suggestion: 'Restore raw mode in cleanup handlers with process.stdin.setRawMode(false)' },
  )];
}

// ── Rule: terminal-readline-no-close (Codex) ────────────────────────────

function readlineNoClose(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();
  const decl = /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:readline\.)?createInterface\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = decl.exec(fullText)) !== null) {
    const name = match[1];
    const closePattern = new RegExp(`\\b${name}\\.close\\s*\\(`);
    if (closePattern.test(fullText)) continue;

    findings.push(finding(
      'terminal-readline-no-close',
      'warning',
      'bug',
      `Readline interface '${name}' is never closed — stdin can remain open and keep the process hanging`,
      ctx.filePath,
      lineForIndex(fullText, match.index),
      1,
      { suggestion: `Call ${name}.close() in completion and shutdown paths` },
    ));
  }

  return findings;
}

// ── Rule: terminal-alt-screen-no-restore (Codex) ────────────────────────

function altScreenNoRestore(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  const enter = /\?1049h|\?47h/g;
  if (!enter.test(fullText)) return [];
  if (/\?1049l|\?47l/.test(fullText)) return [];

  enter.lastIndex = 0;
  const match = enter.exec(fullText);
  const line = match ? lineForIndex(fullText, match.index) : 1;
  return [finding(
    'terminal-alt-screen-no-restore',
    'warning',
    'bug',
    'Terminal app enters the alternate screen without restoring it on exit — users can be left in a blank session',
    ctx.filePath,
    line,
    1,
    { suggestion: 'Emit the matching ?1049l / ?47l escape sequence during shutdown and signal cleanup' },
  )];
}

// ── Rule: terminal-missing-signal-handler (Claude) ──────────────────────

function missingSignalHandler(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();

  // Only check files that do terminal-specific work
  const isTerminal = /\b(setRawMode|cursorTo|clearLine|moveCursor|createInterface|blessed|inquirer|ora|chalk\.)\b/.test(fullText);
  if (!isTerminal) return [];

  const hasSigint = /process\.on\s*\(\s*['"`]SIGINT['"`]/.test(fullText);
  const hasSigterm = /process\.on\s*\(\s*['"`]SIGTERM['"`]/.test(fullText);

  if (!hasSigint && !hasSigterm) {
    const termMatch = fullText.match(/\b(setRawMode|cursorTo|clearLine|moveCursor|createInterface)\b/);
    const line = termMatch ? lineForIndex(fullText, termMatch.index!) : 1;
    return [finding(
      'terminal-missing-signal-handler',
      'warning',
      'pattern',
      'Terminal app has no SIGINT/SIGTERM handler — cleanup code may not run on Ctrl+C',
      ctx.filePath,
      line,
      1,
      { suggestion: 'Add process.on("SIGINT", () => { cleanup(); process.exit(130); })' },
    )];
  }

  return [];
}

// ── Rule: terminal-cursor-not-restored (Claude) ─────────────────────────

function cursorNotRestored(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();

  const hidesCursor = /\\(?:x1[Bb]|u001[Bb]|e|033)\[\?25l/.test(fullText) ||
                      fullText.includes('cursor(false)') ||
                      fullText.includes('hideCursor') ||
                      fullText.includes('cursor.hide');
  if (!hidesCursor) return [];

  const restoresCursor = /\\(?:x1[Bb]|u001[Bb]|e|033)\[\?25h/.test(fullText) ||
                         fullText.includes('cursor(true)') ||
                         fullText.includes('showCursor') ||
                         fullText.includes('cursor.show');

  if (!restoresCursor) {
    const match = fullText.match(/(?:hideCursor|cursor\.hide|cursor\(false\)|\?\s*25\s*l)/);
    const line = match ? lineForIndex(fullText, match.index!) : 1;
    return [finding(
      'terminal-cursor-not-restored',
      'warning',
      'bug',
      'Cursor hidden without restore — cursor will stay invisible after exit',
      ctx.filePath,
      line,
      1,
      { suggestion: 'Add process.on("exit", () => process.stdout.write("\\x1B[?25h"))' },
    )];
  }

  return [];
}

// ── Rule: terminal-unthrottled-render (Claude) ──────────────────────────

function unthrottledRender(ctx: RuleContext): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const fullText = ctx.sourceFile.getFullText();

  const intervalRegex = /setInterval\s*\([^,]+,\s*(\d+)\s*\)/g;
  let match;
  while ((match = intervalRegex.exec(fullText)) !== null) {
    const ms = parseInt(match[1], 10);
    if (ms < 16) {
      const line = lineForIndex(fullText, match.index);
      findings.push(finding(
        'terminal-unthrottled-render',
        'warning',
        'pattern',
        `setInterval at ${ms}ms (>${Math.round(1000 / ms)}fps) — excessive terminal redraws cause flicker`,
        ctx.filePath,
        line,
        1,
        { suggestion: 'Use ≥16ms (60fps) for smooth terminal rendering without excess CPU' },
      ));
    }
  }

  return findings;
}

export const terminalRules: ReviewRule[] = [
  missingTtyGuard,
  rawModeNoRestore,
  readlineNoClose,
  altScreenNoRestore,
  missingSignalHandler,
  cursorNotRestored,
  unthrottledRender,
];
