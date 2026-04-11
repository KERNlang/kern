/**
 * Ink review rules — active when target = ink (on top of React rules).
 *
 * Focused on Ink terminal rendering / input handling pitfalls.
 * Codex base rules + Claude extras (uncleared-interval, missing-error-boundary).
 */

import type { ReviewFinding, ReviewRule, RuleContext } from '../types.js';
import { finding } from './utils.js';

function lineForIndex(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function findAll(text: string, pattern: RegExp): number[] {
  const lines: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    lines.push(lineForIndex(text, match.index));
  }
  return lines;
}

function isInkFile(text: string): boolean {
  return /from\s+['"]ink['"]|require\s*\(\s*['"]ink['"]\s*\)/.test(text);
}

// ── Rule: ink-console-output (Codex) ────────────────────────────────────

function consoleOutput(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isInkFile(fullText)) return [];

  return findAll(fullText, /\bconsole\.(?:log|warn|error|info)\s*\(/g).map((line) =>
    finding(
      'ink-console-output',
      'warning',
      'bug',
      'Ink app writes through console.* — direct console output corrupts the rendered terminal frame',
      ctx.filePath,
      line,
      1,
      { suggestion: 'Render status via <Text>, <Static>, or useStdout()/useStderr() instead of console.*' },
    ),
  );
}

// ── Rule: ink-direct-stdout (Codex) ─────────────────────────────────────

function directStdout(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isInkFile(fullText)) return [];

  return findAll(fullText, /\bprocess\.(?:stdout|stderr)\.write\s*\(/g).map((line) =>
    finding(
      'ink-direct-stdout',
      'error',
      'bug',
      'Ink app writes directly to stdout/stderr — bypassing Ink output breaks layout reconciliation',
      ctx.filePath,
      line,
      1,
      { suggestion: "Use Ink components or useStdout()/useStderr() so output stays inside Ink's renderer" },
    ),
  );
}

// ── Rule: ink-process-exit (Codex) ──────────────────────────────────────

function processExit(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isInkFile(fullText)) return [];

  return findAll(fullText, /\bprocess\.exit\s*\(/g).map((line) =>
    finding(
      'ink-process-exit',
      'warning',
      'pattern',
      'Ink app calls process.exit() directly — this skips Ink cleanup and can leave the terminal in a dirty state',
      ctx.filePath,
      line,
      1,
      { suggestion: 'Use const { exit } = useApp(); exit(); so Ink can clean up properly' },
    ),
  );
}

// ── Rule: ink-stdin-bypass (Codex) ──────────────────────────────────────

function stdinBypass(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isInkFile(fullText)) return [];

  const pattern = /\bprocess\.stdin\.(?:on|addListener|once|resume|setRawMode)\s*\(|\breadline\.createInterface\s*\(/g;
  return findAll(fullText, pattern).map((line) =>
    finding(
      'ink-stdin-bypass',
      'warning',
      'pattern',
      "Ink app bypasses useInput() with raw stdin/readline listeners — input handling will fight with Ink's renderer",
      ctx.filePath,
      line,
      1,
      { suggestion: 'Handle keyboard input with useInput() or useStdin() instead of process.stdin/readline listeners' },
    ),
  );
}

// ── Rule: ink-uncleared-interval (Claude) ───────────────────────────────

function unclearedInterval(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isInkFile(fullText)) return [];

  // Already has cleanup
  if (fullText.includes('clearInterval')) return [];

  return findAll(fullText, /\bsetInterval\s*\(/g).map((line) =>
    finding(
      'ink-uncleared-interval',
      'warning',
      'bug',
      'setInterval without clearInterval in Ink component — timer leaks on unmount',
      ctx.filePath,
      line,
      1,
      { suggestion: 'Store the interval ID and clear it in useEffect cleanup: return () => clearInterval(id)' },
    ),
  );
}

// ── Rule: ink-missing-error-boundary (Claude) ───────────────────────────

function missingErrorBoundary(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isInkFile(fullText)) return [];

  // Check for Ink render() call — this is the app entry point
  const renderMatch = fullText.match(/\brender\s*\(\s*<\w+/);
  if (!renderMatch) return [];

  const hasErrorBoundary = fullText.includes('ErrorBoundary') || fullText.includes('errorBoundary');
  const hasExitHandler = /\.waitUntilExit\s*\(\s*\)\s*\.catch/.test(fullText) || /try\s*\{[^}]*render/.test(fullText);

  if (!hasErrorBoundary && !hasExitHandler) {
    const line = lineForIndex(fullText, renderMatch.index!);
    return [
      finding(
        'ink-missing-error-boundary',
        'warning',
        'pattern',
        'Ink render() without error handling — uncaught errors will corrupt terminal state',
        ctx.filePath,
        line,
        1,
        { suggestion: 'Add .waitUntilExit().catch() or wrap with an ErrorBoundary component' },
      ),
    ];
  }

  return [];
}

// ── Rule: ink-raw-setter-in-async (Claude) ─────────────────────────────

function rawSetterInAsync(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isInkFile(fullText)) return [];

  // Detect raw _set*Raw calls outside of KERN-generated wrappers (__inkSafe, throttle, debounce).
  // Lines containing __inkSafe, useMemo, or setTimeout are part of the generated wrapper — skip them.
  const lines = fullText.split('\n');
  const findings: ReviewFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/_set\w+Raw\s*\(/.test(line)) continue;
    // Skip KERN-generated wrapper patterns
    if (/__inkSafe/.test(line) || /useMemo/.test(line) || /setTimeout/.test(line)) continue;
    findings.push(
      finding(
        'ink-raw-setter-in-async',
        'warning',
        'bug',
        'Raw state setter (_set*Raw) called directly — bypasses __inkSafe wrapper, may cause missed Ink repaints',
        ctx.filePath,
        i + 1,
        1,
        {
          suggestion:
            'Use the safe setter (without Raw suffix) which auto-bridges microtask → macrotask via setTimeout',
        },
      ),
    );
  }
  return findings;
}

// ── Rule: ink-animation-too-fast (Phase 5) ─────────────────────────────

function animationTooFast(ctx: RuleContext): ReviewFinding[] {
  const fullText = ctx.sourceFile.getFullText();
  if (!isInkFile(fullText)) return [];

  // Match setInterval with very short intervals (< 16ms = faster than 60fps)
  const pattern = /setInterval\s*\([^,]+,\s*(\d+)\s*\)/g;
  const findings: ReviewFinding[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fullText)) !== null) {
    const interval = Number(match[1]);
    if (interval < 16) {
      findings.push(
        finding(
          'ink-animation-too-fast',
          'warning',
          'pattern',
          `setInterval with ${interval}ms interval — faster than 60fps, wastes CPU in terminal rendering`,
          ctx.filePath,
          lineForIndex(fullText, match.index),
          1,
          { suggestion: 'Use at least 16ms (60fps) or higher intervals for terminal animations' },
        ),
      );
    }
  }
  return findings;
}

export const inkRules: ReviewRule[] = [
  consoleOutput,
  directStdout,
  processExit,
  stdinBypass,
  unclearedInterval,
  missingErrorBoundary,
  rawSetterInAsync,
  animationTooFast,
];
