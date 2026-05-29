import type { IRNode, TranspileDiagnostic } from '@kernlang/core';

export type FenceSeverity = 'error' | 'warning' | 'info';

// Foreign fence languages that are explicitly NOT Python — declared on purpose,
// but still dropped by the (models-only) python target.
const FOREIGN_TS_LANGS = new Set(['ts', 'typescript', 'js', 'javascript', 'tsx', 'jsx']);
const PYTHON_LANGS = new Set(['python', 'py']);

const kernNotEmitted = (label: string) =>
  `${label}: portable kern handler body is not yet emitted by the python target (dropped)`;

function ownerLabel(owner: IRNode | null): string {
  if (!owner) return 'handler';
  const name = owner.props?.name;
  if (typeof name === 'string' && name !== '') return `${owner.type} "${name}"`;
  return owner.type || 'handler';
}

function mk(node: IRNode, severity: FenceSeverity, message: string): TranspileDiagnostic {
  return {
    nodeType: node.type,
    outcome: 'unsupported',
    target: 'python',
    loc: node.loc ? { line: node.loc.line, col: node.loc.col } : undefined,
    severity,
    message,
  };
}

function classify(handler: IRNode, owner: IRNode | null, rawFenceSeverity: FenceSeverity): TranspileDiagnostic | null {
  const props = handler.props ?? {};
  const lang = typeof props.lang === 'string' ? props.lang.trim().toLowerCase() : undefined;
  const rawCode = typeof props.code === 'string' ? props.code : undefined;
  const label = ownerLabel(owner);

  // Raw / foreign fence — the body lives verbatim in props.code.
  if (rawCode !== undefined) {
    if (rawCode.trim() === '') return null; // Empty fence — nothing to port.
    if (lang === undefined || lang === '') {
      // Unmarked raw fence — assumed TypeScript. The direct twin of the TS shadow analyzer.
      return mk(
        handler,
        rawFenceSeverity,
        `${label}: raw TS fence is not portable to the python target (handler body dropped)`,
      );
    }
    if (FOREIGN_TS_LANGS.has(lang)) {
      return mk(handler, 'info', `${label}: lang="${lang}" foreign fence is dropped in the python target`);
    }
    if (PYTHON_LANGS.has(lang)) {
      return mk(handler, 'info', `${label}: python-native fence is not yet emitted by the python target (dropped)`);
    }
    if (lang === 'kern') {
      return mk(handler, 'info', kernNotEmitted(label));
    }
    // Unknown lang — treat as a raw, non-portable fence.
    return mk(
      handler,
      rawFenceSeverity,
      `${label}: lang="${lang}" fence is not portable to the python target (handler body dropped)`,
    );
  }

  // No raw code: a native body lives in statement children. Report it dropped so
  // native handlers never look silently portable — independent of whether the
  // parser tagged the body lang="kern".
  if ((handler.children?.length ?? 0) > 0) {
    return mk(handler, 'info', kernNotEmitted(label));
  }
  return null; // Bodiless handler — nothing dropped.
}

/**
 * Walk every handler body and report what the (models-only) python target drops.
 *
 * The python target emits only models/types — every handler body is dropped. This
 * surfaces at most one diagnostic per dropped handler so the drop is never silent:
 *  - raw unmarked TS fence  → `rawFenceSeverity` (default warning) — the portability hazard
 *  - explicit lang="ts"/etc → info (foreign, intentional, but still dropped)
 *  - native kern / python   → info ("not yet emitted") — prevents a false sense of portability
 *  - empty fence            → skipped (nothing to port)
 *
 * Classifying a handler stops descent into its children (they are body content),
 * so each handler yields a single diagnostic and there is no double-reporting; the
 * python target runs no generic `buildDiagnostics` pass.
 */
export function collectFenceDiagnostics(
  root: IRNode,
  rawFenceSeverity: FenceSeverity = 'warning',
): TranspileDiagnostic[] {
  const diagnostics: TranspileDiagnostic[] = [];

  function walk(node: IRNode, parent: IRNode | null): void {
    if (node.type === 'handler') {
      const diag = classify(node, parent, rawFenceSeverity);
      if (diag) diagnostics.push(diag);
      return; // Handler children are body content — don't descend.
    }
    for (const child of node.children ?? []) walk(child, node);
  }

  walk(root, null);
  return diagnostics;
}
