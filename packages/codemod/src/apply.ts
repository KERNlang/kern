/**
 * Apply orchestrator — turn a TemplateMatch into a transformed source file.
 *
 * Pipeline:
 *   1. Adapter resolves the exact rewrite region (re-derived from AST; detector
 *      reports endLine=EOF which we ignore).
 *   2. Adapter extracts the user interior as CHILDREN lines.
 *   3. Parse match.suggestedKern into an IR node and register the named
 *      template if it isn't already.
 *   4. Attach a `handler` child carrying the extracted CHILDREN.
 *   5. expandTemplateNode → generateCoreNode-style line array.
 *   6. Strip template-prepended imports (source file already imports them).
 *   7. Splice new text into source at [region.start, region.end] (no comment
 *      duplication — `before` already contains any leading trivia).
 *   8. Mutate the original SourceFile IN-PLACE with replaceWithText so that
 *      downstream consumers see the transformed module when diagnostics run,
 *      then revert if any gate fails.
 *   9. Reparse check (syntax), re-detect gate (template still recognized),
 *      affected-set diagnostics gate, whole-program gate (--write only).
 *  10. Write audit entry and return ApplyResult.
 *
 * The shared ts-morph Project is the caller's responsibility (see project.ts)
 * so affected-set diagnostics amortize across --interactive sessions.
 */

import { expandTemplateNode, type IRNode, parse } from '@kernlang/core';
import { detectTemplates, type TemplateMatch } from '@kernlang/review';
import type { Project, SourceFile } from 'ts-morph';
import { getAdapter } from './adapter-registry.js';
import { runAffectedSetDiagnostics, runWholeProgramDiagnostics, snapshotWholeProgram } from './diagnostics.js';
import { ensureTemplate } from './template-loader.js';
import type { ApplyOptions, ApplyResult } from './types.js';

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Strip leading `import ... from '...';` lines plus a single following blank line.
 * The source file already imports what the template requires; re-injecting the
 * template's import block would duplicate it.
 */
function stripTemplateImports(lines: string[]): string[] {
  const out = [...lines];
  while (out.length > 0 && /^\s*import\s/.test(out[0])) {
    out.shift();
  }
  if (out.length > 0 && out[0].trim() === '') {
    out.shift();
  }
  return out;
}

/** Return the column (0-indexed) of region.start in its containing line. */
function columnAt(sourceText: string, offset: number): number {
  const lineStart = sourceText.lastIndexOf('\n', offset - 1) + 1;
  return offset - lineStart;
}

/** Indent every line (except the first) by `col` spaces. */
function indentBlock(text: string, col: number): string {
  if (col <= 0) return text;
  const pad = ' '.repeat(col);
  return text
    .split('\n')
    .map((line, i) => (i === 0 || line.length === 0 ? line : pad + line))
    .join('\n');
}

/**
 * Produce a minimal unified-style diff for audit/dry-run display.
 * Not a full diff engine — just enough to visualize what will change.
 */
function minimalDiff(oldText: string, newText: string, filePath: string): string {
  if (oldText === newText) return '';
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const header = `--- a/${filePath}\n+++ b/${filePath}\n`;
  return header + oldLines.map((l) => `-${l}`).join('\n') + '\n' + newLines.map((l) => `+${l}`).join('\n') + '\n';
}

// ── Core apply ─────────────────────────────────────────────────────────

export interface ApplyFileInput {
  project: Project;
  /** Absolute path to the file being transformed (must already be in Project). */
  filePath: string;
  /** One TemplateMatch candidate from detectTemplates(). */
  match: TemplateMatch;
  /** Pre-computed file-level diagnostics snapshot (perf: avoids re-walking). */
  preDiagnostics?: ReadonlyArray<string>;
}

export function applyMatch(input: ApplyFileInput, options: ApplyOptions = {}): ApplyResult {
  const { project, filePath, match } = input;
  const timestamp = new Date().toISOString();
  const confidencePct = match.confidencePct;

  const base: ApplyResult = {
    filePath,
    templateName: match.templateName,
    confidencePct,
    decision: 'skipped',
    timestamp,
    tsTokens: match.tsTokens,
    kernTokens: match.kernTokens,
  };

  // Confidence gate first — cheapest check.
  const minConf = options.minConfidence ?? 80;
  if (confidencePct < minConf) {
    return { ...base, reason: `confidence ${confidencePct} < min ${minConf}` };
  }

  if (options.templateName && options.templateName !== match.templateName) {
    return { ...base, reason: `template filter excluded ${match.templateName}` };
  }

  const adapter = getAdapter(match.templateName);
  if (!adapter) {
    return { ...base, reason: `no adapter registered for ${match.templateName}` };
  }

  const sourceFile = project.getSourceFile(filePath);
  if (!sourceFile) {
    return { ...base, reason: `source file not in project: ${filePath}` };
  }

  // 1. Resolve region
  const resolved = adapter.resolveRegion(sourceFile, match);
  if (!resolved.ok) {
    return { ...base, reason: `resolveRegion: ${resolved.reason}` };
  }

  // 2. Extract children
  const extracted = adapter.extractChildren(sourceFile, resolved.region, match);
  if (!extracted.ok) {
    return { ...base, reason: `extractChildren: ${extracted.reason}` };
  }

  // 3. Ensure template registered + parse suggestedKern
  if (!match.suggestedKern) {
    return { ...base, reason: 'match has no suggestedKern' };
  }

  if (!ensureTemplate(match.templateName)) {
    return { ...base, reason: `template ${match.templateName} not found in catalog` };
  }

  let irNode: IRNode;
  try {
    const ast = parse(match.suggestedKern);
    if (ast.type === match.templateName) {
      irNode = ast;
    } else if (ast.children && ast.children.length === 1 && ast.children[0].type === match.templateName) {
      irNode = ast.children[0];
    } else {
      return { ...base, reason: `parsed suggestedKern type=${ast.type}, expected ${match.templateName}` };
    }
  } catch (err) {
    return { ...base, reason: `parse suggestedKern: ${(err as Error).message}` };
  }

  // 4. Attach handler child with extracted CHILDREN (if any).
  if (extracted.children.length > 0) {
    const handlerChild: IRNode = {
      type: 'handler',
      props: { code: extracted.children.join('\n') },
      children: [],
    };
    irNode = { ...irNode, children: [...(irNode.children || []), handlerChild] };
  }

  // 5. Expand
  let expandedLines: string[];
  try {
    expandedLines = expandTemplateNode(irNode);
  } catch (err) {
    return { ...base, reason: `expandTemplateNode: ${(err as Error).message}` };
  }

  // 6. Strip template-added imports (file already has them).
  expandedLines = stripTemplateImports(expandedLines);

  while (expandedLines.length > 0 && expandedLines[expandedLines.length - 1].trim() === '') {
    expandedLines.pop();
  }

  const expandedText = expandedLines.join('\n');
  const originalText = sourceFile.getFullText();
  const col = columnAt(originalText, resolved.region.start);
  const indented = indentBlock(expandedText, col);

  // 7. Splice — `before` already contains any leading trivia, so do NOT prepend
  //    comments separately (that would duplicate them, per codex-review feedback).
  const before = originalText.slice(0, resolved.region.start);
  const after = originalText.slice(resolved.region.end);
  const newText = before + indented + after;

  if (newText === originalText) {
    return {
      ...base,
      decision: 'skipped',
      reason: 'transform produced identical output (idempotent)',
      replacedSpan: { start: resolved.region.start, end: resolved.region.end },
      diff: '',
    };
  }

  // 8. Mutate in place so dependents see the transformed module when we run
  //    downstream diagnostics. Revert on any gate failure.
  const wholeProgramBaseline = options.write ? snapshotWholeProgram(project) : undefined;

  try {
    sourceFile.replaceWithText(newText);
  } catch (err) {
    return {
      ...base,
      reason: `reparse failed: ${(err as Error).message}`,
      replacedSpan: { start: resolved.region.start, end: resolved.region.end },
      parseOk: false,
    };
  }

  const revert = (): void => {
    sourceFile.replaceWithText(originalText);
  };

  // 9a. Re-detect gate: a canonical rewrite must still be detectable as the
  //     same template. If the rewrite broke pattern recognition, reject.
  let reDetectOk = true;
  try {
    const reMatches = detectTemplates(sourceFile);
    if (!reMatches.some((m) => m.templateName === match.templateName)) {
      reDetectOk = false;
    }
  } catch {
    // Detection errors are non-fatal; tsc gate remains authoritative.
  }

  if (!reDetectOk) {
    revert();
    return {
      ...base,
      decision: 'rejected',
      reason: 're-detect failed: template pattern no longer recognized after rewrite',
      replacedSpan: { start: resolved.region.start, end: resolved.region.end },
      diff: minimalDiff(originalText, newText, filePath),
      parseOk: true,
      reDetectOk: false,
    };
  }

  // 9b. Affected-set diagnostics (always). The transformed SourceFile is the
  //     real one now, so referencing files are checked against the new module.
  const newDiags = runAffectedSetDiagnostics(project, sourceFile, input.preDiagnostics);

  if (newDiags.length > 0) {
    revert();
    return {
      ...base,
      decision: 'rejected',
      reason: `new diagnostics: ${newDiags.length}`,
      replacedSpan: { start: resolved.region.start, end: resolved.region.end },
      diff: minimalDiff(originalText, newText, filePath),
      parseOk: true,
      reDetectOk,
      newDiagnostics: newDiags,
    };
  }

  // 9c. Whole-program final gate (--write only) — catches transitive-dep errors.
  if (options.write && wholeProgramBaseline) {
    const programNewDiags = runWholeProgramDiagnostics(project, wholeProgramBaseline);
    if (programNewDiags.length > 0) {
      revert();
      return {
        ...base,
        decision: 'rejected',
        reason: `new whole-program diagnostics: ${programNewDiags.length}`,
        replacedSpan: { start: resolved.region.start, end: resolved.region.end },
        diff: minimalDiff(originalText, newText, filePath),
        parseOk: true,
        reDetectOk,
        newDiagnostics: programNewDiags,
      };
    }
  }

  const diff = minimalDiff(originalText, newText, filePath);

  if (options.write) {
    sourceFile.saveSync();
    return {
      ...base,
      decision: 'applied',
      replacedSpan: { start: resolved.region.start, end: resolved.region.end },
      diff,
      parseOk: true,
      reDetectOk,
      newDiagnostics: [],
    };
  }

  // Dry-run path — revert the in-memory edit so subsequent candidates see the
  // original file.
  revert();
  return {
    ...base,
    decision: 'dry-run',
    replacedSpan: { start: resolved.region.start, end: resolved.region.end },
    diff,
    parseOk: true,
    reDetectOk,
    newDiagnostics: [],
  };
}
