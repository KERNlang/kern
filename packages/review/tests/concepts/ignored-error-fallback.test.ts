import type { ConceptNode, ErrorHandlePayload } from '@kernlang/core';
import { extractPythonConceptsFallback } from '../../src/python-fallback.js';

// Exercises the REGEX FALLBACK path (used when @kernlang/review-python /
// tree-sitter is unavailable). The `ignored-error` precision rules — narrow
// non-builtin swallow, explanatory comment, and the shared builtin set — must
// behave the same here as on the AST path. This locks in the multi-line header
// fix and the single-sourced PYTHON_BUILTIN_EXCEPTIONS.

function disposition(source: string): ErrorHandlePayload['disposition'] | undefined {
  const node = extractPythonConceptsFallback(source, 'svc.py').nodes.find(
    (n: ConceptNode): n is ConceptNode & { payload: ErrorHandlePayload } => n.kind === 'error_handle',
  );
  return node?.payload.disposition;
}

describe('python-fallback ignored-error precision', () => {
  it('narrow non-builtin single-line → wrapped (not ignored)', () => {
    expect(disposition(`\ntry:\n    db.add(row)\nexcept IntegrityError:\n    pass\n`)).toBe('wrapped');
  });

  it('narrow non-builtin MULTI-LINE tuple header → wrapped (header joined, not truncated to bare)', () => {
    expect(disposition(`\ntry:\n    db.add(row)\nexcept (\n    IntegrityError,\n):\n    pass\n`)).toBe('wrapped');
  });

  it('broad Exception with explanatory comment → wrapped', () => {
    expect(disposition(`\ntry:\n    logger.info("x")\nexcept Exception:\n    # best effort\n    pass\n`)).toBe(
      'wrapped',
    );
  });

  it('broad undocumented Exception → ignored', () => {
    expect(disposition(`\ntry:\n    do_work()\nexcept Exception:\n    pass\n`)).toBe('ignored');
  });

  it('bare except → ignored', () => {
    expect(disposition(`\ntry:\n    do_work()\nexcept:\n    pass\n`)).toBe('ignored');
  });

  it('builtin ExceptionGroup / Warning subclass → ignored (shared builtin set)', () => {
    expect(disposition(`\ntry:\n    do_work()\nexcept ExceptionGroup:\n    pass\n`)).toBe('ignored');
    expect(disposition(`\ntry:\n    do_work()\nexcept DeprecationWarning:\n    pass\n`)).toBe('ignored');
  });
});
