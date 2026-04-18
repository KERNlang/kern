/**
 * Two-stage diagnostics gate.
 *
 * Stage 1 (always): affected-set — the transformed file plus any source files
 * that directly reference it. Fast enough for --interactive.
 *
 * Stage 2 (--write only): whole-program — full Program diagnostics via the
 * shared Project. Catches cross-file regressions through transitive references
 * that stage 1 misses. Slow (~500ms–2s on medium repos) so we reserve it for
 * actual writes.
 *
 * Both stages compare pre-transform vs post-transform diagnostic fingerprints
 * and return ONLY NEW diagnostics as an array of human-readable strings.
 */

import type { Diagnostic, Project, SourceFile } from 'ts-morph';

const TEMP_SUFFIX = '.kern-codemod.tmp.ts';

/**
 * Normalize the temp file path back to its original form so the same
 * diagnostic on the original file and on the temp file share a fingerprint.
 */
function normalizePath(p: string): string {
  if (p.endsWith(TEMP_SUFFIX)) return p.slice(0, -TEMP_SUFFIX.length);
  return p;
}

/**
 * Fingerprint a diagnostic for baseline comparison. We exclude start offset —
 * the transform will shift every position in the file, so offset-sensitive
 * fingerprints would report every pre-existing diagnostic as "new". We keep
 * code + normalized file + message, which is coarse but sound: two logically
 * identical diagnostics match, and any NEW compile error shows up as new.
 */
function fingerprint(d: Diagnostic): string {
  const file = normalizePath(d.getSourceFile()?.getFilePath() ?? '<no-file>');
  const code = d.getCode();
  const msg = typeof d.getMessageText() === 'string' ? (d.getMessageText() as string) : 'multi-line';
  const shortMsg = msg.length > 120 ? `${msg.slice(0, 120)}…` : msg;
  return `${file}|${code}|${shortMsg}`;
}

function readable(d: Diagnostic): string {
  const file = d.getSourceFile()?.getFilePath() ?? '<no-file>';
  const line = d.getLineNumber() ?? 0;
  const code = d.getCode();
  const msg = typeof d.getMessageText() === 'string' ? (d.getMessageText() as string) : 'multi-line diagnostic';
  return `${file}:${line} TS${code}: ${msg}`;
}

function affectedFiles(sourceFile: SourceFile): Set<SourceFile> {
  const files = new Set<SourceFile>([sourceFile]);
  try {
    for (const ref of sourceFile.getReferencingSourceFiles()) {
      files.add(ref);
    }
  } catch {
    // fall back to file-only
  }
  return files;
}

/**
 * Snapshot diagnostics for a file's affected set (file + direct referencers).
 * Use this once per file BEFORE transform; pass the returned strings back
 * to runAffectedSetDiagnostics as the `preDiagnostics` baseline.
 */
export function snapshotAffectedSet(_project: Project, sourceFile: SourceFile): string[] {
  const files = affectedFiles(sourceFile);
  const fps: string[] = [];
  for (const f of files) {
    for (const d of f.getPreEmitDiagnostics()) {
      fps.push(fingerprint(d));
    }
  }
  return fps;
}

/**
 * Run the affected-set diagnostics check and return any NEW diagnostics
 * (not present in preDiagnostics baseline).
 */
export function runAffectedSetDiagnostics(
  _project: Project,
  transformedFile: SourceFile,
  preDiagnostics: ReadonlyArray<string> | undefined,
): string[] {
  const baseline = new Set(preDiagnostics ?? []);
  const newDiags: string[] = [];

  const files = affectedFiles(transformedFile);
  for (const f of files) {
    for (const d of f.getPreEmitDiagnostics()) {
      const fp = fingerprint(d);
      if (!baseline.has(fp)) {
        newDiags.push(readable(d));
      }
    }
  }
  return newDiags;
}

/**
 * Snapshot every diagnostic the Program currently produces. Use before --write
 * to establish the whole-program baseline.
 */
export function snapshotWholeProgram(project: Project): string[] {
  const out: string[] = [];
  for (const d of project.getPreEmitDiagnostics()) {
    out.push(fingerprint(d));
  }
  return out;
}

/**
 * Whole-program check — diff post-transform Program diagnostics against a
 * baseline snapshot taken before the transform. Returns any NEW entries.
 */
export function runWholeProgramDiagnostics(project: Project, preDiagnostics: ReadonlyArray<string>): string[] {
  const baseline = new Set(preDiagnostics);
  const newDiags: string[] = [];
  for (const d of project.getPreEmitDiagnostics()) {
    const fp = fingerprint(d);
    if (!baseline.has(fp)) {
      newDiags.push(readable(d));
    }
  }
  return newDiags;
}
