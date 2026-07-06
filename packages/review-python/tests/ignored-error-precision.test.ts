/**
 * Precision tests for the Python ignored-error classifier.
 *
 * kern-guard on fitvt PR #16 flagged four CORRECT swallows as ignored-error
 * false positives. A silent swallow (`pass`/`...`/empty) should read as
 * "ignored" ONLY when the catch is broad/bare AND undocumented; a narrow
 * non-builtin (domain/library) exception, or any explanatory comment, is an
 * intentional decision. Builtin exceptions stay flaggable because they are
 * broad enough to hide an unrelated failure.
 */

import { runConceptRules } from '@kernlang/review';
import { extractPythonConcepts } from '../src/mapper.js';

function fires(source: string): boolean {
  const concepts = extractPythonConcepts(source, 'test.py');
  const findings = runConceptRules(concepts, 'test.py');
  return Boolean(findings.find((f) => f.ruleId === 'ignored-error'));
}

describe('Python ignored-error precision (fitvt PR #16)', () => {
  it('does NOT fire on a narrow non-builtin exception swallow (dedupe pattern)', () => {
    expect(
      fires(`
try:
    async with db.begin_nested():
        db.add(CustomFoodReport(custom_food_id=cid))
except IntegrityError:
    pass
`),
    ).toBe(false);
  });

  it('does NOT fire on a narrow domain-exception swallow (optional section)', () => {
    expect(
      fires(`
try:
    weight = get_weight_progress(user_id)
    summary["weight"] = weight
except ProgressDataNotFoundException:
    pass
`),
    ).toBe(false);
  });

  it('does NOT fire on a broad catch with an inline explanatory comment', () => {
    expect(
      fires(`
try:
    logger.info("metric %d", n)
except Exception:  # instrumentation must never break a chat turn
    pass
`),
    ).toBe(false);
  });

  it('does NOT fire on a broad catch with a standalone explanatory comment', () => {
    expect(
      fires(`
try:
    return verify_token(header).get("sub")
except Exception:
    # Never let token-parsing errors block or crash the limiter.
    pass
`),
    ).toBe(false);
  });

  it('STILL fires on a broad, undocumented Exception swallow', () => {
    expect(
      fires(`
try:
    analytics["body_fat"] = get_average_body_fat(user_id)
except Exception:
    pass
`),
    ).toBe(true);
  });

  it('STILL fires on a bare except: pass', () => {
    expect(
      fires(`
try:
    do_work()
except:
    pass
`),
    ).toBe(true);
  });

  it('STILL fires on a narrow BUILTIN exception mixed with real work (can hide unrelated failure)', () => {
    expect(
      fires(`
try:
    os.close(fd)
    open(path).read()
except OSError:
    pass
`),
    ).toBe(true);
  });

  it('STILL fires when a non-builtin is mixed with a broad Exception', () => {
    expect(
      fires(`
try:
    db.add(row)
except (IntegrityError, Exception):
    pass
`),
    ).toBe(true);
  });
});
